import { refuse } from '../actions/refusals.ts'
import type { StumpTool } from '../actions/types.ts'
import { APP_NETWORKS, checkKeys, checkPrices, describeApps, saveKeys, savePrices, type AppNetwork } from '../accounts/apps.ts'
import { ADMINS } from '../people/roles.ts'

// stump.setup.apps: the company's own network apps and the X price table
// (STUMP-CONNECT-002, STUMP-SURFACE-004). Keys are sealed and read back masked.

const security = (setting: string, measure = 1) => ({ class: 'security' as const, facts: { measure, setting } })
const price = { type: 'number', minimum: 0, maximum: 1000 }

export const setupTools: StumpTool[] = [{
  name: 'stump.setup.apps', title: 'Set up network apps',
  description: 'List each network\'s app with its steps, callback URLs, scopes and state; record the company\'s own X and LinkedIn app keys; keep the X price table.',
  scope: 'stump:setup', classes: ['security', 'gated'], clauses: ['STUMP-CONNECT-002', 'STUMP-SURFACE-004'],
  actions: {
    list: {
      // Network apps are Admin work (STUMP-TEAM-001); everyone else reads each network's readiness from stump.accounts.connect list.
      roles: ADMINS, read: true,
      classify: () => [security('network_apps', 0)],
      async run(_args, ctx) { const items = await describeApps(ctx.db, ctx.env); return { items, total: items.length } },
    },
    set: {
      roles: ADMINS,
      properties: { network: { enum: [...APP_NETWORKS] }, client_id: { type: 'string', minLength: 1, maxLength: 300 }, client_secret: { type: 'string', minLength: 1, maxLength: 300 } },
      required: ['network', 'client_id', 'client_secret'],
      // The developer app is a step a person completes at the network; its keys are a security setting.
      classify: args => [security(`${String(args.network)}_app`), { class: 'gated', facts: { measure: 1, provider: String(args.network), step: 'developer_app' } }],
      summary: args => ({ target: { name: `Set the company's ${String(args.network)} app keys` } }),
      target: args => ({ kind: 'network_app', id: String(args.network) }),
      async run(args, ctx) {
        const network = args.network as AppNetwork, keys = { client_id: args.client_id, client_secret: args.client_secret }
        const check = checkKeys(network, keys)
        if (!check.ok) refuse('invalid_arguments', { field: check.field, reason: check.error })
        await saveKeys(ctx.db, ctx.env, network, keys as { client_id: string; client_secret: string }, ctx.person.id, ctx.now())
        ctx.emit('setup.app_keys', `stump://setup/apps/${network}`, { network })
        return { app: (await describeApps(ctx.db, ctx.env)).find(app => app.network === network) }
      },
    },
    set_prices: {
      roles: ADMINS,
      properties: { network: { enum: [...APP_NETWORKS] }, prices: { type: 'object', additionalProperties: false, required: ['post', 'post_with_url', 'read', 'owned_read'],
        properties: { post: price, post_with_url: price, read: price, owned_read: price } } },
      required: ['network', 'prices'],
      classify: () => [security('x_prices')],
      summary: () => ({ target: { name: 'Update the X price table' } }),
      target: () => ({ kind: 'network_app', id: 'x' }),
      async run(args, ctx) {
        if (args.network !== 'x') refuse('invalid_arguments', { field: 'network', reason: 'Only X charges per call.' })
        const checked = checkPrices(args.prices)
        if (!checked.ok) refuse('invalid_arguments', { field: checked.field ?? 'prices', reason: checked.error })
        await savePrices(ctx.db, checked.table, ctx.person.id, ctx.now())
        return { app: (await describeApps(ctx.db, ctx.env)).find(app => app.network === 'x') }
      },
    },
  },
}]
