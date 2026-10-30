import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { erase, HANDLE_KEYS, removedCount, scopeOf, subjectOf, type Scope } from '../data/erase.ts'
import { ADMINS } from '../people/roles.ts'

// stump.data.erase: erasure of a person outside the company (STUMP-DATA-002).
// The full export and restore are the rer export and rer import commands.
const handle = { anyOf: [{ type: 'string', minLength: 1, maxLength: 300 }, { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 300 } }] }
const subject = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: {
    kind: { enum: ['journalist', 'engager'] },
    contact_id: { type: 'string', minLength: 1, maxLength: 64 },
    // The engager's handle on each network or source, so each match stays on its own network: {"x": "alice", "hn": "alice"}.
    handles: {
      type: 'object', additionalProperties: false, minProperties: 1,
      properties: Object.fromEntries(HANDLE_KEYS.map(key => [key, handle])),
    },
  },
}

/** The records the call would change, read once per call and shared by classify, summary and run. */
const scopes = new WeakMap<ActionContext, Scope>()
async function scope(args: Args, ctx: ActionContext): Promise<Scope> {
  const found = scopes.get(ctx)
  if (found) return found
  const read = await scopeOf(ctx, subjectOf(args))
  scopes.set(ctx, read)
  return read
}

export const dataTools: StumpTool[] = [{
  name: 'stump.data.erase', title: 'Erase a person',
  description: 'Erase a journalist or an engager: their record, contact route, findings, inbox items and offers leave Stump, pitches keep an anonymised reference, and each of the company\'s posts that names them is asked to be deleted at its network, answered with its outcome. An entry under legal hold is kept.',
  scope: 'stump:data', classes: ['destructive', 'sensitive', 'external'], clauses: ['STUMP-DATA-002', 'STUMP-SURFACE-008', 'STUMP-SURFACE-015'],
  actions: {
    erase: {
      roles: ADMINS,
      properties: { subject }, required: ['subject'],
      // Erasing a person computes destructive with its count, sensitive for the one person, and external for each delete asked of a network.
      async classify(args, ctx) {
        const read = await scope(args, ctx)
        return [
          { class: 'destructive', facts: { measure: removedCount(read) } },
          { class: 'sensitive', facts: { measure: 1, kind: read.subject.kind === 'journalist' ? 'contact route' : 'public handles and post links' } },
          { class: 'external', facts: { measure: read.entries.filter(entry => entry.route === 'published' && !entry.legal_hold).length, counterparty: 'public' } },
        ]
      },
      // What an approver sees names the kind of person and the counts, never who they are.
      async summary(args, ctx) {
        const read = await scope(args, ctx)
        return { target: { name: `Erase a ${read.subject.kind}: ${removedCount(read)} records, ${read.entries.length} posts naming them` } }
      },
      async run(args, ctx) { return erase(ctx, await scope(args, ctx)) },
    },
  },
}]
