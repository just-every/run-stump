import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { EVERYONE } from '../people/roles.ts'

// The ledger lane owns this area's behaviour (histories, CSV, corrections). The
// spine ships the read the agent door's conformance journey uses as its witness.
const text = { type: 'string', minLength: 1, maxLength: 200 }
const id = { type: 'string', minLength: 1, maxLength: 64 }

interface Row { [key: string]: unknown }
const json = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value ?? null
const iso = (value: unknown) => typeof value === 'number' ? new Date(value).toISOString() : null
export const ledgerEntry = (row: Row) => ({
  id: row.id, url: row.url, network: row.network, network_id: row.network_id, venue_id: row.venue_id, account_id: row.account_id,
  person_id: row.person_id, agent: json(row.agent), by: row.by_label, text: row.text, disclosure_line: row.disclosure_line,
  claims: json(row.claims), product_id: row.product_id, campaign: row.campaign, route: row.route, state: row.state,
  confirmation: row.confirmation, revision: row.revision, posted_at: iso(row.posted_at), charge_usd: row.charge_usd,
  approved_by: json(row.approved_by), hold: json(row.hold),
})

/** A poster sees only the entries they posted (STUMP-TEAM-001.2). */
const visible = (ctx: ActionContext) => ctx.person.role === 'poster' ? { sql: ' AND person_id=?', args: [ctx.person.id] } : { sql: '', args: [] as unknown[] }

async function search(args: Args, ctx: ActionContext) {
  const filters: string[] = [], values: unknown[] = []
  for (const field of ['venue_id', 'network', 'person_id', 'product_id', 'campaign', 'route', 'state'] as const) {
    if (typeof args[field] === 'string') { filters.push(`${field}=?`); values.push(args[field]) }
  }
  if (typeof args.q === 'string') { filters.push("(text LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')"); const like = `%${args.q.replace(/[\\%_]/g, c => `\\${c}`)}%`; values.push(like, like) }
  const scope = visible(ctx), where = `WHERE 1=1${filters.map(filter => ` AND ${filter}`).join('')}${scope.sql}`
  const rows = (await ctx.db.prepare(`SELECT * FROM stump_ledger ${where} ORDER BY posted_at DESC,id LIMIT 200`).bind(...values, ...scope.args).all<Row>()).results
  const total = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM stump_ledger ${where}`).bind(...values, ...scope.args).first<{ n: number }>()
  return { items: rows.map(ledgerEntry), total: total?.n ?? 0 }
}

export const ledgerTools: StumpTool[] = [{
  name: 'stump.ledger.search', title: 'Search the ledger',
  description: 'Search every published and handed-off post on the ledger, and read one entry.',
  scope: 'stump:ledger', classes: ['standard'], clauses: ['STUMP-LEDGER-001', 'STUMP-LEDGER-002'],
  actions: {
    search: {
      roles: EVERYONE, read: true,
      properties: { q: text, venue_id: id, network: text, person_id: id, product_id: id, campaign: text, route: { enum: ['published', 'handed_off', 'orbit', 'mango'] }, state: { enum: ['posted', 'failed', 'uncertain', 'deleted', 'removed'] } },
      async classify(args, ctx) { return [{ class: 'standard', facts: { measure: (await search(args, ctx)).items.length } }] },
      run: search,
    },
    get: {
      roles: EVERYONE, read: true,
      properties: { entry_id: id }, required: ['entry_id'],
      classify: () => [{ class: 'standard', facts: { measure: 1 } }],
      target: args => ({ kind: 'ledger', id: String(args.entry_id) }),
      async run(args, ctx) {
        const scope = visible(ctx)
        const row = await ctx.db.prepare(`SELECT * FROM stump_ledger WHERE id=?${scope.sql}`).bind(String(args.entry_id), ...scope.args).first<Row>()
        if (!row) refuse('not_found', { entry_id: String(args.entry_id) })
        return { entry: ledgerEntry(row) }
      },
    },
  },
}]
