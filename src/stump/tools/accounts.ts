import { NO_PERSONAS, refuse, refuseAct } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { NETWORKS, appStates, type Network } from '../accounts/apps.ts'
import { completeConnection, disconnectAccount, mayManage, startConnection } from '../accounts/connect.ts'
import { digest } from '../accounts/seal.ts'
import { shownHandle } from '../accounts/handle.ts'
import { accountView, readAccount, type AccountRow } from '../accounts/store.ts'
import { EVERYONE } from '../people/roles.ts'

// stump.accounts.connect: connect, list, disconnect and reconnect the network
// accounts a person or the company owns (STUMP-PUBLISH-001, STUMP-CONNECT-001).

/** Everyone who may own a personal account; viewers read only. */
const CONNECTORS = ['owner', 'admin', 'editor', 'contributor', 'poster'] as const
const id = { type: 'string', minLength: 1, maxLength: 64 }
const network = { enum: [...NETWORKS] }
/** A value the network gave or the person typed, which Stump keeps only sealed and never answers. */
const secret = { type: 'string', minLength: 1, maxLength: 2048, writeOnly: true }

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
/** An account its owner may disconnect; an owner or admin also disconnects a personal account whose person has left the team (STUMP-CONNECT-001). */
async function disconnectable(ctx: ActionContext, args: Args): Promise<AccountRow> {
  const row = await account(ctx, args)
  if (mayManage(ctx, row)) return row
  const left = row.owner_kind === 'person' && ['owner', 'admin'].includes(ctx.person.role)
    && await ctx.db.prepare("SELECT 1 FROM stump_people WHERE id=? AND status='removed'").bind(row.owner_person_id).first()
  if (!left) refuse('not_account_owner', { account_id: row.id, owner: { kind: row.owner_kind, person_id: row.owner_person_id } })
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
  scope: 'stump:accounts', classes: ['security', 'gated', 'accounts', 'standard'], clauses: ['STUMP-PUBLISH-001', 'STUMP-CONNECT-001'],
  actions: {
    start: {
      roles: CONNECTORS,
      properties: { network, owner: { enum: ['me', 'company'] }, instance: { type: 'string', minLength: 1, maxLength: 300 }, service: { type: 'string', minLength: 1, maxLength: 300 },
        handle: { type: 'string', minLength: 1, maxLength: 300 } },
      required: ['network', 'owner'],
      // A person's accounts are connected only by that person, once they have signed in: naming anyone else is D-1 (STUMP-TRUTH-001.5).
      async refuses(args, ctx) {
        if (args.person_id !== undefined && args.person_id !== ctx.person.id) {
          await refuseAct(ctx, 'stump.accounts.connect', 'start', NO_PERSONAS, { person_id: String(args.person_id), reason: 'A person connects only their own accounts, after they sign in.' })
        }
      },
      classify: args => [security('network_connection'), gated(String(args.network), 'consent'), accounts(String(args.network))],
      summary: args => ({ target: { name: `Connect ${args.owner === 'company' ? 'the company\'s' : 'my'} ${String(args.network)} account` } }),
      run: (args, ctx) => startConnection(ctx, { network: args.network as Network, owner: args.owner as 'me' | 'company',
        ...(typeof args.instance === 'string' ? { instance: args.instance } : {}), ...(typeof args.service === 'string' ? { service: args.service } : {}),
        ...(typeof args.handle === 'string' ? { handle: args.handle } : {}) }),
    },
    complete: {
      roles: CONNECTORS,
      properties: { state: secret, connection_id: id, code: secret, iss: { type: 'string', minLength: 1, maxLength: 300 }, error: { type: 'string', minLength: 1, maxLength: 200 }, app_password: secret },
      // An app password is the account's own person's to type; an agent never carries one (D-1), and is refused before any policy decision.
      async refuses(args, ctx) { if (args.app_password !== undefined && ctx.agent) refuse('person_only', { field: 'app_password' }) },
      async classify(args, ctx) { const provider = await connectionNetwork(ctx, args); return [security('network_connection'), accounts(provider)] },
      async summary(args, ctx) { return { target: { name: `Finish connecting a ${await connectionNetwork(ctx, args)} account` } } },
      async run(args, ctx) {
        if (typeof args.state !== 'string' && typeof args.connection_id !== 'string') refuse('invalid_arguments', { field: 'state' })
        return completeConnection(ctx, args as Parameters<typeof completeConnection>[1])
      },
    },
    list: {
      roles: EVERYONE, read: true,
      properties: { include_unconnected: { type: 'boolean' }, connection_id: id },
      // Listing accounts changes nothing, so it is standard work: a policy that blocks security changes still lets an agent find the account to draft for.
      classify: () => [{ class: 'standard' as const, facts: { measure: 0 } }],
      async run(args, ctx) {
        // A poster sees only their own accounts (STUMP-TEAM-001.2); every other role sees the company's and each person's, with its owner.
        const where = [...args.include_unconnected === true ? [] : ["state<>'disconnected'"], ...ctx.person.role === 'poster' ? ["owner_kind='person' AND owner_person_id=?"] : []]
        const rows = (await ctx.db.prepare(`SELECT * FROM stump_accounts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY owner_kind='person',network,handle`)
          .bind(...ctx.person.role === 'poster' ? [ctx.person.id] : []).all<AccountRow>()).results
        const items = rows.map(accountView)
        // What one of the caller's own consents answered when the network sent them back.
        const connection = typeof args.connection_id === 'string'
          ? await ctx.db.prepare('SELECT id,network,account_id,completed_at,outcome FROM stump_connections WHERE id=? AND person_id=?').bind(args.connection_id, ctx.person.id)
            .first<{ id: string; network: Network; account_id: string | null; completed_at: number | null; outcome: string | null }>() : null
        // Each network's readiness to connect, without the app's keys or steps (those are Admin work in stump.setup.apps).
        return { items, total: items.length, apps: await appStates(ctx.db),
          ...(connection ? { connection: { id: connection.id, network: connection.network, account_id: connection.account_id, completed: connection.completed_at !== null,
            outcome: connection.outcome ? JSON.parse(connection.outcome) as Record<string, unknown> : null } } : {}) }
      },
    },
    disconnect: {
      roles: CONNECTORS,
      properties: { account_id: id }, required: ['account_id'],
      async classify(args, ctx) { const row = await disconnectable(ctx, args); return [security('network_connection'), accounts(row.network)] },
      async summary(args, ctx) { const row = await account(ctx, args); return { target: { id: row.id, name: `Disconnect ${row.network} ${shownHandle(row)}` } } },
      target: args => ({ kind: 'account', id: String(args.account_id) }),
      async run(args, ctx) { return disconnectAccount(ctx, await disconnectable(ctx, args)) },
    },
    reconnect: {
      roles: CONNECTORS,
      properties: { account_id: id }, required: ['account_id'],
      async classify(args, ctx) { const row = await managed(ctx, args); return [security('network_connection'), gated(row.network, 'consent'), accounts(row.network)] },
      async summary(args, ctx) { const row = await account(ctx, args); return { target: { id: row.id, name: `Reconnect ${row.network} ${shownHandle(row)}` } } },
      target: args => ({ kind: 'account', id: String(args.account_id) }),
      async run(args, ctx) {
        // Only its owner reconnects a personal account; a company account, its admins (STUMP-CONNECT-001.3).
        const row = await managed(ctx, args)
        return startConnection(ctx, { network: row.network, owner: row.owner_kind === 'company' ? 'company' : 'me', account: row })
      },
    },
    record_label: {
      roles: CONNECTORS,
      // operator_bio: the bio's text naming the operator, or true when the bio names the operator.
      properties: { account_id: id, automated_label: { type: 'boolean' }, operator_bio: { anyOf: [{ type: 'boolean' }, { type: 'string', maxLength: 500 }] } },
      required: ['account_id', 'automated_label'],
      classify: () => [security('automated_label')],
      async summary(args, ctx) { const row = await account(ctx, args); return { target: { id: row.id, name: `Record X's Automated label on ${shownHandle(row)}` } } },
      target: args => ({ kind: 'account', id: String(args.account_id) }),
      async run(args, ctx) {
        const row = await managed(ctx, args)
        if (row.network !== 'x') refuse('invalid_arguments', { field: 'account_id', reason: 'X\'s Automated label belongs to X accounts.' })
        const bio = typeof args.operator_bio === 'string' ? args.operator_bio.trim() : ''
        const named = args.operator_bio === true || bio !== ''
        // D-4: the label counts only with the operator named in the bio.
        if (args.automated_label === true && !named) refuse('invalid_arguments', { field: 'operator_bio', reason: 'Name the operator in the account\'s bio, then record its text or true.' })
        const text = bio || (args.operator_bio === true ? row.operator_bio : null)
        await ctx.db.prepare('UPDATE stump_accounts SET automated_label=?,operator_bio=?,operator_named=?,updated_at=?,revision=revision+1 WHERE id=?')
          .bind(args.automated_label === true ? 1 : 0, text, named ? 1 : 0, ctx.now(), row.id).run()
        return { account: accountView((await readAccount(ctx.db, row.id))!) }
      },
    },
  },
}]
