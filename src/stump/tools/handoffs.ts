import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpAction, StumpTool } from '../actions/types.ts'
import { CONTRIBUTORS, EVERYONE } from '../people/roles.ts'
import { classes, plan, prepare } from '../handoffs/prepare.ts'
import { linkClasses, record } from '../handoffs/posted.ts'
import { edit, get, hold, queue, release, skip } from '../handoffs/manage.ts'
import { handoffOrRefuse, LAPSES } from '../handoffs/model.ts'
import { one } from '../handoffs/view.ts'

// The hand-off queue (STUMP-HANDOFF-001 to -003): a brief and a draft for the
// named member who posts by hand, the posted link recorded and checked, and
// nothing left waiting in silence.
const id = { type: 'string', minLength: 1, maxLength: 80 }
const handoffId = id
const when = { type: 'string', format: 'date-time' }
const reason = { type: 'string', minLength: 1, maxLength: 500 }
const url = { type: 'string', minLength: 1, maxLength: 2048 }
const standard = (measure = 1) => [{ class: 'standard' as const, facts: { measure } }]
const target = (args: Args) => ({ kind: 'handoff', id: String(args.handoff_id) })
const revision = async (args: Args, ctx: ActionContext) => (await handoffOrRefuse(ctx, args.handoff_id)).revision
/** An argument the action does not take is refused by name, never dropped, before anything is decided. */
const DOOR_KEYS = new Set(['action', 'idempotency_key', 'expected_revision'])
const strict = (action: StumpAction): StumpAction => ({
  ...action,
  classify(args, ctx) {
    for (const key of Object.keys(args)) if (!DOOR_KEYS.has(key) && !Object.hasOwn(action.properties ?? {}, key)) refuse('invalid_arguments', { field: key, reason: `${String(args.action)} takes no ${key}.` })
    return action.classify(args, ctx)
  },
})
/** Everyone who may post by hand works a hand-off; a viewer only reads. */
const WORKERS = EVERYONE.filter(role => role !== 'viewer')

export const handoffTools: StumpTool[] = [{
  name: 'stump.handoffs.prepare', title: 'Prepare a hand-off for a named member',
  description: 'Prepare a hand-off at a venue whose rules keep posting for its members: the named person gets the venue\'s rules, the facts with their proof, the disclosure for their connection and a draft in their voice, or talking points only where the venue bans AI-written text or the person is an outside voice recommending the product. Someone not yet a member gets the venue\'s join steps first.',
  scope: 'stump:handoffs', classes: ['standard', 'gated', 'external'], clauses: ['STUMP-HANDOFF-001', 'STUMP-SURFACE-005'],
  actions: {
    prepare: strict({
      roles: CONTRIBUTORS,
      properties: {
        venue_id: id, person_id: id, product_id: id, thread_url: url, due_at: when, time_zone: { type: 'string', minLength: 1, maxLength: 64 }, lapse: { enum: [...LAPSES] },
        text: { type: 'string', minLength: 1, maxLength: 25_000 }, generate: { type: 'boolean' }, recommends: { type: 'boolean' }, campaign: { type: 'string', minLength: 1, maxLength: 120 },
      },
      required: ['venue_id', 'person_id', 'product_id', 'due_at', 'lapse'],
      classify: classes,
      // The approver reads names, never ids: who posts, where, for which product, and what the brief carries.
      async summary(args, ctx) {
        const planned = await plan(ctx, args)
        const carries = planned.route === 'handoff_brief' || !planned.writes ? 'Talking points and facts; the member writes the post'
          : args.generate === true ? 'A draft written through the AI provider' : `A draft written by ${ctx.agent?.name ?? ctx.person.display_name}`
        return { target: { id: String(args.venue_id), name: `Hand ${planned.person.display_name} a post on ${planned.venue.name}` }, items: [`For ${planned.product.name}`, carries] }
      },
      target: args => ({ kind: 'venue', id: String(args.venue_id) }),
      async run(args, ctx) { return one(ctx, await prepare(ctx, args, await plan(ctx, args))) },
    }),
  },
}, {
  name: 'stump.handoffs.check_link', title: 'Record and check a posted link',
  description: 'Record the link to a hand-off\'s post. Stump checks the link is on the venue, confirms the post and its author through the network where it has a public API (Bluesky, Mastodon, X, Hacker News), records Reddit, LinkedIn and members-only links as confirmed by the person, writes the ledger entry and marks the hand-off posted.',
  scope: 'stump:handoffs', classes: ['standard', 'external'], clauses: ['STUMP-HANDOFF-002'],
  actions: {
    record: strict({
      roles: WORKERS, properties: { handoff_id: handoffId, url, own_words: { type: 'string', minLength: 1, maxLength: 25_000 }, attest_own_words: { type: 'boolean' } },
      required: ['handoff_id', 'url'],
      classify: linkClasses, target, revision,
      async summary(args, ctx) { const row = await handoffOrRefuse(ctx, args.handoff_id); return { target: { id: row.id, name: `Record ${String(args.url)}` } } },
      run: record,
    }),
  },
}, {
  name: 'stump.handoffs.manage', title: 'Work the hand-off queue',
  description: 'Read the queue (your own hand-offs first) and one hand-off; edit its draft; skip it with a reason; hold it until a review date; release a hold.',
  scope: 'stump:handoffs', classes: ['standard'], clauses: ['STUMP-HANDOFF-001', 'STUMP-HANDOFF-003'],
  actions: {
    queue: strict({ roles: EVERYONE, read: true, classify: () => standard(0), run: (_args, ctx) => queue(ctx) }),
    get: strict({ roles: EVERYONE, read: true, properties: { handoff_id: handoffId }, required: ['handoff_id'], classify: () => standard(0), target, run: get }),
    edit: strict({ roles: WORKERS, properties: { handoff_id: handoffId, draft_text: { type: 'string', minLength: 1, maxLength: 25_000 } }, required: ['handoff_id', 'draft_text'], classify: () => standard(), target, revision, run: edit }),
    skip: strict({ roles: WORKERS, properties: { handoff_id: handoffId, reason }, required: ['handoff_id', 'reason'], classify: () => standard(), target, revision, run: skip }),
    hold: strict({ roles: WORKERS, properties: { handoff_id: handoffId, reason, review_at: when }, required: ['handoff_id', 'reason', 'review_at'], classify: () => standard(), target, revision, run: hold }),
    release: strict({ roles: WORKERS, properties: { handoff_id: handoffId }, required: ['handoff_id'], classify: () => standard(), target, revision, run: release }),
  },
}]
