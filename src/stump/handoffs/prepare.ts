// stump.handoffs.prepare: a brief and a draft for one named member at a venue
// whose rules keep posting for its members (STUMP-HANDOFF-001, STUMP-VENUE-006,
// STUMP-VENUE-003.4, D-1, D-2, D-3, D-8). Generated and hand-written drafts go
// through the drafting module exactly as stump.drafts.write does them.
import { refuse, refuseAct } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { checkDraft, loadBrand, type Brand } from '../drafting/check.ts'
import { saveItem } from '../drafting/items.ts'
import { createItem, draftingClasses, screen } from '../drafting/write.ts'
import { readPerson, type StumpPerson } from '../people/store.ts'
import { usage } from '../venues/limits.ts'
import { handoffEligibility, type Eligibility } from '../venues/members.ts'
import { rulesOf, venueOrRefuse, type VenueRow } from '../venues/model.ts'
import { routesFor } from '../venues/rules.ts'
import { disclosureFor, factsFor, nextOpening, outsideVoice, talkingPoints } from './brief.ts'
import { onVenue, parseLink } from './link.ts'
import { ruleHold, ruleHoldJson } from './refresh.ts'
import { history } from './model.ts'

export const TOOL = 'stump.handoffs.prepare'

export interface Plan {
  venue: VenueRow; person: StumpPerson; product: Brand['products'][number]; brand: Brand; due: number; eligibility: Eligibility
  route: 'handoff_draft' | 'handoff_brief'; d8: boolean; writes: boolean
}

/** Someone on the team who has signed in and may post by hand: everyone but a viewer (D-1, STUMP-TEAM-001). */
async function poster(ctx: ActionContext, id: unknown): Promise<StumpPerson> {
  const person = await readPerson(ctx.db, String(id))
  if (!person || person.status !== 'active') return refuseAct(ctx, TOOL, 'prepare', { rule: 'D-1', source: 'STUMP-TRUTH-001' }, { person_id: String(id) })
  if (person.role === 'viewer') refuse('person_cannot_act', { person_id: person.id, role: person.role, reason: `${person.display_name} reads Stump and does not post.` })
  return person
}

/**
 * Every refusal a prepare meets, before any policy decision and before anything
 * is written: who it is for, the venue's route, its gates, its shared limit, and
 * text the route does not take.
 */
export async function plan(ctx: ActionContext, args: Args): Promise<Plan> {
  // Editors prepare for anyone; a contributor (or their agent) only for themselves.
  if (!['owner', 'admin', 'editor'].includes(ctx.person.role) && args.person_id !== ctx.person.id) refuse('forbidden', { action: 'prepare', role: ctx.person.role, person_id: String(args.person_id) })
  const venue = await venueOrRefuse(ctx.db, args.venue_id), person = await poster(ctx, args.person_id)
  const brand = await loadBrand(ctx.db), product = brand.products.find(entry => entry.id === args.product_id)
  if (!product) refuse('not_found', { product_id: String(args.product_id) })

  // D-3: the venue's rules decide the route at the moment this runs.
  const routes = routesFor(venue)
  if (routes.routes.includes('publish')) refuse('route_publish', { venue_id: venue.id, venue: venue.name, route: 'publish', rule: 'posting', reason: `${venue.name} takes posts from the company's account; schedule it there instead.` })
  if (!routes.routes.length) {
    const closed = routes.reasons.find(reason => !reason.open)!
    refuse('route_closed', { venue_id: venue.id, venue: venue.name, rule: closed.rule, reason: `${venue.name}: ${closed.because}` })
  }
  const due = Date.parse(String(args.due_at))
  if (!Number.isFinite(due) || due <= ctx.now()) refuse('invalid_arguments', { field: 'due_at', reason: 'Give a time in the future.' })
  if (typeof args.thread_url === 'string' && !onVenue(venue, parseLink(args.thread_url))) refuse('link_not_on_venue', { field: 'thread_url', venue_id: venue.id, venue: venue.name, url: args.thread_url })

  // STUMP-VENUE-006: a member below a gate cannot receive it; someone not yet a member joins first.
  const eligibility = await handoffEligibility(ctx.db, venue, person.id, ctx.now())
  if (!eligibility.join_first && !eligibility.eligible) {
    refuse('gate_unmet', { venue_id: venue.id, venue: venue.name, person_id: person.id, gates: eligibility.unmet.map(unmet => unmet.gate), unmet: eligibility.unmet })
  }
  // STUMP-VENUE-003.4: the company's shared limit there, counted across people and products. A call the
  // policy held and a person approved is read again when it runs: the hand-off it already made is its own place.
  const use = await usage(ctx.db, venue, due)
  if (use.limit) {
    const own = await ctx.db.prepare('SELECT id FROM stump_handoffs WHERE operation_id=?').bind(ctx.operationId).first<{ id: string }>()
    if (use.counted.filter(entry => !(entry.kind === 'handoff' && entry.id === own?.id)).length >= use.limit.posts) {
      const { posts, per } = use.limit, next = await nextOpening(ctx.db, venue, due, own?.id ?? null)
      refuse('shared_limit', { venue_id: venue.id, venue: venue.name, rule: 'shared_limit', limit: use.limit, next_open_at: next === null ? null : new Date(next).toISOString(),
        reason: `${venue.name} takes ${posts} post${posts === 1 ? '' : 's'} a ${per} from the whole company, and this ${per} is full.` })
    }
  }

  // D-8: an outside voice recommending the product gets talking points and facts only.
  const d8 = args.recommends === true && outsideVoice(person)
  const route = routes.routes.includes('handoff_draft') && !d8 ? 'handoff_draft' : 'handoff_brief'
  const writes = args.generate === true || typeof args.text === 'string'
  if (writes) {
    // The drafting module's own refusals first, as stump.drafts.write meets them (D-1, D-3, D-4, D-8).
    if (args.generate === true) await screen(ctx, draftArgs(args), 'create')
    if (route === 'handoff_brief') {
      await refuseAct(ctx, TOOL, 'prepare', d8 ? { rule: 'D-8', source: 'STUMP-HANDOFF-001' } : { rule: 'D-3', source: rulesOf(venue).ai_text?.source_url ?? 'STUMP-VENUE-002' },
        { venue_id: venue.id, venue: venue.name, route, field: args.generate === true ? 'generate' : 'text', offer: 'talking_points' })
    }
  }
  return { venue, person, product, brand, due, eligibility, route, d8, writes }
}

/** The drafting request a hand-off makes: one post for the person at the venue. */
const draftArgs = (args: Args): Args => ({
  format: 'post', person_id: args.person_id, product_id: args.product_id, venue_id: args.venue_id,
  ...(args.generate === true ? { generate: true } : { text: args.text }), ...(args.campaign !== undefined ? { campaign: args.campaign } : {}), ...(args.recommends !== undefined ? { recommends: args.recommends } : {}),
})

/** A hand-off is a step the venue keeps for a person: gated, with the venue and "a member posts" (STUMP-SURFACE-005.1); an AI draft adds the provider. */
export async function classes(args: Args, ctx: ActionContext) {
  const planned = await plan(ctx, args)
  return [{ class: 'gated' as const, facts: { measure: 1, provider: planned.venue.name, step: 'a member posts' } }, ...draftingClasses(ctx.env, args.generate === true ? 1 : 0, 1)]
}

/** Writes the hand-off: the draft item through the drafting module where the route takes one, then the brief. */
export async function prepare(ctx: ActionContext, args: Args, planned: Plan): Promise<string> {
  const { venue, person, product, brand, due, eligibility, route, d8 } = planned
  const disclosure = disclosureFor(venue, person, brand, product.name)
  let itemId: string | null = null, draft: string | null = null, used: string[] = []
  if (planned.writes) {
    // A hand-written draft that names the company carries the disclosure from the start (D-2).
    const made = await createItem(ctx, draftArgs(args))
    itemId = made.id
    let check = made.check
    let row = (await ctx.db.prepare('SELECT * FROM stump_items WHERE id=?').bind(itemId).first<Record<string, unknown>>())!
    if (check.flags.some(flag => flag.code === 'disclosure_missing' || flag.code === 'disclosure_below_cut')) {
      // The generated or given text lacked the disclosure: it goes first, as a new revision through the drafting module.
      const saved = await saveItem(ctx, row, { text: `${disclosure}\n\n${String(row.text ?? '')}`, parts: null }, 'disclosure added for the hand-off')
      check = saved.check
      row = (await ctx.db.prepare('SELECT * FROM stump_items WHERE id=?').bind(itemId).first<Record<string, unknown>>())!
    }
    draft = String(row.text ?? '')
    used = check.claims_used
  }
  const facts = factsFor(brand, product.id, ctx.now(), used)
  const id = crypto.randomUUID(), now = ctx.now()
  const hold = ruleHold(venue, { draft_text: draft, thread_url: (args.thread_url as string | undefined) ?? null })
  const state = hold ? 'held' : eligibility.join_first ? 'join_first' : 'open'
  const opening = await nextOpening(ctx.db, venue, now)
  const actor = { db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now }
  const holdJson = hold ? ruleHoldJson(hold, now) : null
  await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO stump_handoffs(id,item_id,venue_id,person_id,product_id,state,due_at,lapse,rules,facts,disclosure_line,draft_text,talking_points,own_words_required,
      attestation_required,join_steps,next_open_at,hold,thread_url,campaign,agent,created_by,created_at,updated_at,route,recommends,operation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, itemId, venue.id, person.id, product.id, state, due, String(args.lapse), venue.rules, JSON.stringify(facts), disclosure, draft,
        JSON.stringify(draft === null ? talkingPoints(venue, product, facts, disclosure) : []), draft === null ? 1 : 0, d8 ? 1 : 0, JSON.stringify(eligibility.join_steps),
        opening, holdJson, (args.thread_url as string | undefined) ?? null, (args.campaign as string | undefined) ?? null,
        ctx.agent ? JSON.stringify({ id: ctx.agent.id, name: ctx.agent.name }) : null, ctx.person.id, now, now, route, args.recommends === true ? 1 : 0, ctx.operationId),
    history(actor, id, 'prepared', null, state, { route, lapse: args.lapse, due_at: new Date(due).toISOString(), item_id: itemId, ...(hold ? { rule: hold.rule, reason: hold.reason } : {}),
      ...(eligibility.join_first ? { join_first: true } : {}), ...(d8 ? { rule: 'D-8' } : {}) }),
  ])
  ctx.emit('handoff.prepared', `stump://handoffs/${id}`, { person_id: person.id, venue_id: venue.id })
  return id
}

/** The check a hand-off draft edit must pass before it saves: the disclosure stays in a draft that names the product (STUMP-HANDOFF-001.4). */
export async function disclosureKept(ctx: ActionContext, item: Record<string, unknown>, text: string, disclosure: string | null) {
  const brand = await loadBrand(ctx.db), person = await readPerson(ctx.db, String(item.person_id))
  const check = await checkDraft(ctx.db, brand, { id: String(item.id), format: 'post', network: null, account_id: null, venue_id: item.venue_id as string | null,
    person_id: String(item.person_id), product_id: item.product_id as string | null, master_id: null, text, parts: null }, person, ctx.now())
  const missing = check.flags.find(flag => flag.code === 'disclosure_missing' || flag.code === 'disclosure_below_cut')
  if (missing && !(disclosure && text.includes(disclosure))) refuse('disclosure_required', { rule: 'D-2', disclosure_line: disclosure, reason: 'A hand-off that names the product keeps its disclosure.' })
}
