import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpAction, StumpTool } from '../actions/types.ts'
import { correct, corrections, legalHold, markRemoved } from '../ledger/correct.ts'
import { toCsv } from '../ledger/csv.ts'
import { count, everything, one, page } from '../ledger/query.ts'
import { ADMINS, EDITORS, EVERYONE } from '../people/roles.ts'

// Reading, searching, correcting and exporting the ledger (STUMP-LEDGER-001, -002).
// The entries themselves are written once, by the publishing lane's recorder.
const text = { type: 'string', minLength: 1, maxLength: 200 }
const id = { type: 'string', minLength: 1, maxLength: 64 }
const when = { type: 'string', minLength: 10, maxLength: 40 }
const filters = {
  q: text, venue_id: id, network: text, person_id: id, product_id: id, campaign: text, from: when, to: when,
  route: { enum: ['published', 'handed_off', 'orbit', 'mango'] }, state: { enum: ['posted', 'failed', 'uncertain', 'deleted', 'removed'] },
}
const standard = (measure = 1) => [{ class: 'standard' as const, facts: { measure } }]

const searchAction: StumpAction = {
  roles: EVERYONE, read: true,
  properties: { ...filters, limit: { type: 'integer', minimum: 1, maximum: 200 }, offset: { type: 'integer', minimum: 0, maximum: 1000000 } },
  async classify(args, ctx) { return standard(await count(args, ctx)) },
  run: (args, ctx) => page(args, ctx),
}

/** The venue or the person a history is of; exactly one. */
function historyScope(args: Args): { venue_id: string } | { person_id: string } {
  const venue = typeof args.venue_id === 'string' ? args.venue_id : undefined, person = typeof args.person_id === 'string' ? args.person_id : undefined
  if ((venue === undefined) === (person === undefined)) refuse('invalid_arguments', { field: 'venue_id', reason: 'Name a venue or a person.' })
  return venue ? { venue_id: venue } : { person_id: person as string }
}

/** A venue's or a person's history: everything posted there or by them, newest first, removals included. */
async function history(args: Args, ctx: ActionContext) {
  const scope = historyScope(args)
  return { ...scope, ...await page({ limit: args.limit, offset: args.offset }, ctx, scope) }
}

export const ledgerTools: StumpTool[] = [{
  name: 'stump.ledger.search', title: 'Search the ledger',
  description: 'Search every published and handed-off post on the ledger by text and filters, read one entry with its versions, read a venue\'s or a person\'s history, and export a filtered view as CSV.',
  scope: 'stump:ledger', classes: ['standard'], clauses: ['STUMP-LEDGER-001', 'STUMP-LEDGER-002'],
  actions: {
    search: searchAction,
    get: {
      roles: EVERYONE, read: true,
      properties: { entry_id: id }, required: ['entry_id'],
      classify: () => standard(),
      target: args => ({ kind: 'ledger', id: String(args.entry_id) }),
      // The entry record itself, with its versions, as every get answers its record.
      async run(args, ctx) { return (await one(ctx, String(args.entry_id))).entry },
    },
    history: {
      roles: EVERYONE, read: true,
      properties: { venue_id: id, person_id: id, limit: { type: 'integer', minimum: 1, maximum: 200 }, offset: { type: 'integer', minimum: 0, maximum: 1000000 } },
      async classify(args, ctx) { return standard(await count(args, ctx, historyScope(args))) },
      run: history,
    },
    export_csv: {
      roles: EVERYONE, read: true,
      properties: filters,
      async classify(args, ctx) { return standard(await count(args, ctx)) },
      async run(args, ctx) {
        const view = await everything(args, ctx)
        return { csv: toCsv(view.rows, view.versions), rows: view.rows.length, total: view.total, truncated: view.rows.length < view.total }
      },
    },
  },
}, {
  name: 'stump.ledger.correct', title: 'Correct the ledger',
  description: 'Add a corrected version of a ledger entry (the earlier versions stay readable), mark a post a venue removed with the reason, or put a legal hold on an entry.',
  scope: 'stump:ledger', classes: ['standard'], clauses: ['STUMP-LEDGER-001'],
  actions: {
    correct: {
      roles: EDITORS,
      properties: {
        entry_id: id, note: { type: 'string', minLength: 1, maxLength: 500 },
        text: { type: 'string', minLength: 1, maxLength: 20000 }, url: { type: 'string', minLength: 1, maxLength: 2048 }, network_id: { type: 'string', minLength: 1, maxLength: 200 },
        campaign: text, product_id: id, disclosure_line: { type: 'string', minLength: 1, maxLength: 500 },
      },
      required: ['entry_id', 'note'],
      classify: () => standard(),
      summary: args => ({ target: { name: `Correct ledger entry ${String(args.entry_id)}` } }),
      target: args => ({ kind: 'ledger', id: String(args.entry_id) }),
      run: correct,
    },
    mark_removed: {
      roles: EDITORS,
      properties: { entry_id: id, reason: { type: 'string', minLength: 1, maxLength: 500 } }, required: ['entry_id', 'reason'],
      classify: () => standard(),
      summary: args => ({ target: { name: `Mark ledger entry ${String(args.entry_id)} removed` } }),
      target: args => ({ kind: 'ledger', id: String(args.entry_id) }),
      run: markRemoved,
    },
    corrections: {
      roles: EVERYONE, read: true,
      properties: { entry_id: id, limit: { type: 'integer', minimum: 1, maximum: 200 } },
      classify: () => standard(0),
      run: corrections,
    },
    legal_hold: {
      roles: ADMINS,
      properties: { entry_id: id, reason: { type: 'string', minLength: 1, maxLength: 500 } }, required: ['entry_id', 'reason'],
      classify: () => standard(),
      summary: args => ({ target: { name: `Put ledger entry ${String(args.entry_id)} on legal hold` } }),
      target: args => ({ kind: 'ledger', id: String(args.entry_id) }),
      run: legalHold,
    },
  },
}]
