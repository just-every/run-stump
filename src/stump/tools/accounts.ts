import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { NETWORKS, type Network } from '../accounts/apps.ts'
import { completeConnection, disconnectAccount, mayManage, startConnection } from '../accounts/connect.ts'
import { digest } from '../accounts/seal.ts'
import { accountView, readAccount, type AccountRow } from '../accounts/store.ts'
import { EVERYONE } from '../people/roles.ts'

// stump.accounts.connect: connect, list, disconnect and reconnect the network
// accounts a person or the company owns (STUMP-PUBLISH-001, STUMP-CONNECT-001).

/** Everyone who may own a personal account; viewers read only. */
const CONNECTORS = ['owner', 'admin', 'editor', 'contributor', 'poster'] as const
const id = { type: 'string', minLength: 1, maxLength: 64 }
const network = { enum: [...NETWORKS] }
const secret = { type: 'string', minLength: 1, maxLength: 2048 }

const security = (setting: string, measure = 1) => ({ class: 'security' as const, facts: { measure, setting } })
const accounts = (provider: string) => ({ class: 'accounts' as const, facts: { measure: 1, provider } })
const gated = (provider: string, step: string) => ({ class: 'gated' as const, facts: { measure: 1, provider, step } })

async function account(ctx: ActionContext, args: Args): Promise<AccountRow> {
  const row = await readAccount(ctx.db, String(args.account_id))
  if (!row) refuse('not_found', { account_id: String(args.account_id) })
  return row
}
async function managed(ctx: ActionContext, args: Args): Promise<AccountRow> {
  const row = await account(ctx, args)
  if (!mayManage(ctx, row)) refuse('not_account_owner', { account_id: row.id, owner: { kind: row.owner_kind, person_id: row.owner_person_id } })
  return row
}
/** The network a completion belongs to, read from the consent record, never from the arguments. */
async function connectionNetwork(ctx: ActionContext, args: Args): Promise<Network> {
  const row = typeof args.state === 'string'
    ? await ctx.db.prepare('SELECT network FROM stump_connections WHERE state_hash=?').bind(await digest(args.state)).first<{ network: Network }>()
    : typeof args.connection_id === 'string' ? await ctx.db.prepare('SELECT network FROM stump_connections WHERE id=?').bind(args.connection_id).first<{ network: Network }>() : null
  if (!row) refuse('not_found', { connection: typeof args.connection_id === 'string' ? args.connection_id : 'state' })
  return row.network
}

export const accountTools: StumpTool[] = [{
  name: 'stump.accounts.connect', title: 'Connect network accounts',
  description: 'Connect a person\'s own or the company\'s Bluesky, Mastodon, X or LinkedIn account through the network\'s consent screen, list accounts, record X\'s Automated label, and disconnect or reconnect an account. Tokens never leave Stump.',
  scope: 'stump:accounts', classes: ['security', 'gated', 'accounts'], clauses: ['STUMP-PUBLISH-001', 'STUMP-CONNECT-001'],
  actions: {
    start: {
      roles: CONNECTORS,
      properties: { network, owner: { enum: ['me', 'company'] }, instance: { type: 'string', minLength: 1, maxLength: 300 }, service: { type: 'string', minLength: 1, maxLength: 300 },
        handle: { type: 'string', minLength: 1, maxLength: 300 } },
      required: ['network', 'owner'],
      classify: args => [security('network_connection'), gated(String(args.network), 'consent'), accounts(String(args.network))],
      summary: args => ({ target: { name: `Connect ${args.owner === 'company' ? 'the company\'s' : 'my'} ${String(args.network)} account` } }),
      run: (args, ctx) => startConnection(ctx, { network: args.network as Network, owner: args.owner as 'me' | 'company',
        ...(typeof args.instance === 'string' ? { instance: args.instance } : {}), ...(typeof args.service === 'string' ? { service: args.service } : {}),
        ...(typeof args.handle === 'string' ? { handle: args.handle } : {}) }),
    },
    complete: {
      roles: CONNECTORS,
      properties: { state: secret, connection_id: id, code: secret, iss: { type: 'string', minLength: 1, maxLength: 300 }, error: { type: 'string', minLength: 1, maxLength: 200 }, app_password: secret },
      async classify(args, ctx) { const provider = await connectionNetwork(ctx, args); return [security('network_connection'), accounts(provider)] },
      async summary(args, ctx) { return { target: { name: `Finish connecting a ${await connectionNetwork(ctx, args)} account` } } },
      async run(args, ctx) {
        if (typeof args.state !== 'string' && typeof args.connection_id !== 'string') refuse('invalid_arguments', { field: 'state' })
        // An app password is the account's own person's to type; an agent never carries one (D-1).
        if (typeof args.app_password === 'string' && ctx.agent) refuse('person_only', { field: 'app_password' })
        return completeConnection(ctx, args as Parameters<typeof completeConnection>[1])
      },
    },
    list: {
      roles: EVERYONE, read: true,
      properties: { include_unconnected: { type: 'boolean' } },
      classify: () => [security('network_connections', 0)],
      async run(args, ctx) {
        const rows = (await ctx.db.prepare(`SELECT * FROM stump_accounts ${args.include_unconnected === true ? '' : "WHERE state<>'disconnected'"} ORDER BY owner_kind='person',network,handle`).all<AccountRow>()).results
        const items = rows.map(accountView)
        return { items, total: items.length }
      },
    },
    disconnect: {
      roles: CONNECTORS,
      properties: { account_id: id }, required: ['account_id'],
      async classify(args, ctx) { const row = await managed(ctx, args); return [security('network_connection'), accounts(row.network)] },
      async summary(args, ctx) { const row = await account(ctx, args); return { target: { id: row.id, name: `Disconnect ${row.network} ${row.handle}` } } },
      target: args => ({ kind: 'account', id: String(args.account_id) }),
      async run(args, ctx) { return disconnectAccount(ctx, await managed(ctx, args)) },
    },
    reconnect: {
      roles: CONNECTORS,
      properties: { account_id: id }, required: ['account_id'],
      async classify(args, ctx) { const row = await managed(ctx, args); return [security('network_connection'), gated(row.network, 'consent'), accounts(row.network)] },
      async summary(args, ctx) { const row = await account(ctx, args); return { target: { id: row.id, name: `Reconnect ${row.network} ${row.handle}` } } },
      target: args => ({ kind: 'account', id: String(args.account_id) }),
      async run(args, ctx) {
        // Only its owner reconnects a personal account; a company account, its admins (STUMP-CONNECT-001.3).
        const row = await managed(ctx, args)
        return startConnection(ctx, { network: row.network, owner: row.owner_kind === 'company' ? 'company' : 'me', account: row })
      },
    },
    record_label: {
      roles: CONNECTORS,
      properties: { account_id: id, automated_label: { type: 'boolean' }, operator_bio: { type: 'string', maxLength: 500 } },
      required: ['account_id', 'automated_label'],
      classify: () => [security('automated_label')],
      async summary(args, ctx) { const row = await account(ctx, args); return { target: { id: row.id, name: `Record X's Automated label on ${row.handle}` } } },
      target: args => ({ kind: 'account', id: String(args.account_id) }),
      async run(args, ctx) {
        const row = await managed(ctx, args)
        if (row.network !== 'x') refuse('invalid_arguments', { field: 'account_id', reason: 'X\'s Automated label belongs to X accounts.' })
        const bio = typeof args.operator_bio === 'string' ? args.operator_bio.trim() : ''
        if (args.automated_label === true && !bio) refuse('invalid_arguments', { field: 'operator_bio', reason: 'Name the operator as the account\'s bio does.' })
        await ctx.db.prepare('UPDATE stump_accounts SET automated_label=?,operator_bio=?,updated_at=?,revision=revision+1 WHERE id=?')
          .bind(args.automated_label === true ? 1 : 0, bio || null, ctx.now(), row.id).run()
        return { account: accountView((await readAccount(ctx.db, row.id))!) }
      },
    },
  },
}]
