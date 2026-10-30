// stump.handoffs.prepare: a brief and a draft for one named member at a venue
// whose rules keep posting for its members (STUMP-HANDOFF-001, STUMP-VENUE-006,
// STUMP-VENUE-003.4, D-1, D-2, D-3, D-8). Generated and hand-written drafts go
// through the drafting module exactly as stump.drafts.write does them; where the
// venue bans AI-written text or the person is an outside voice, the brief carries
// talking points and facts, and no text is generated or kept.
import { refuse, refuseAct } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { loadBrand, type Brand } from '../drafting/check.ts'
import { saveItem } from '../drafting/items.ts'
import { createItem, draftingClasses, screen } from '../drafting/write.ts'
import { readPerson, type StumpPerson } from '../people/store.ts'
import { handoffEligibility } from '../venues/members.ts'
import { rulesOf, venueOrRefuse, type VenueRow } from '../venues/model.ts'
import { routesFor } from '../venues/rules.ts'
import { disclosureFor, factsFor, nextOpening, outsideVoice, talkingPoints } from './brief.ts'
import { limitHold, ruleHold, ruleHoldJson, type RuleHold } from './holds.ts'
import { onVenue, parseLink } from './link.ts'
import { history } from './model.ts'

export const TOOL = 'stump.handoffs.prepare'

export interface Plan {
  venue: VenueRow; person: StumpPerson; product: Brand['products'][number]; brand: Brand; due: number
  route: 'handoff_draft' | 'handoff_brief'; d8: boolean; writes: boolean
  /** Text the call asked for or gave that the brief does not use, and the rule why (D-3, D-8). */
  unused: { field: 'generate' | 'text'; rule: 'D-3' | 'D-8'; source: string; because: string } | null
}

/** Someone on the team who has signed in and may post by hand: everyone but a viewer (D-1, STUMP-TEAM-001). */
async function poster(ctx: ActionContext, id: unknown): Promise<StumpPerson> {
  const person = await readPerson(ctx.db, String(id))
  if (!person || person.status !== 'active') return refuseAct(ctx, TOOL, 'prepare', { rule: 'D-1', source: 'STUMP-TRUTH-001' }, { person_id: String(id) })
  if (person.role === 'viewer') refuse('person_cannot_act', { person_id: person.id, role: person.role, reason: `${person.display_name} reads Stump and does not post.` })
  return person
}

/**
 * The refusals a prepare meets before any policy decision and before anything
 * is written: who it is for and the venue's route from its rules (D-1, D-3).
 * Text the route does not take is not refused: the brief gets talking points
 * and facts instead, and its history says why (D-3, D-8).
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

  // D-8: an outside voice recommending the product, or one Stump would write about it for, gets talking points and facts only.
  const d8 = outsideVoice(person) && (args.recommends === true || args.generate === true)
  const route = routes.routes.includes('handoff_draft') && !d8 ? 'handoff_draft' : 'handoff_brief'
  const asked = args.generate === true ? 'generate' : typeof args.text === 'string' ? 'text' : null
  // The drafting module's own refusals, as stump.drafts.write meets them (D-1, D-4), for a draft the brief will carry.
  if (asked && route === 'handoff_draft') await screen(ctx, draftArgs(args), 'create')
  const draftReason = routes.reasons.find(reason => reason.route === 'handoff_draft')
  const unused: Plan['unused'] = asked && route === 'handoff_brief'
    ? d8 ? { field: asked, rule: 'D-8', source: 'STUMP-HANDOFF-001', because: `${person.display_name} is not a founder or employee: they post their own words from talking points and facts.` }
      : { field: asked, rule: 'D-3', source: rulesOf(venue).ai_text?.source_url ?? 'STUMP-VENUE-002', because: `${venue.name}: ${draftReason?.because ?? 'AI-written text is not allowed.'} The member writes their own words from talking points and facts.` }
    : null
  return { venue, person, product, brand, due, route, d8, writes: !!asked && route === 'handoff_draft', unused }
}

/**
 * What the venue's state allows when the hand-off is written: its gates for this
 * person and its shared limit. These are read when the call runs, not when it is
 * classified, so a call a person approved is judged on the venue as it is then.
 */
export async function admit(ctx: ActionContext, planned: Plan) {
  const { venue, person, due } = planned
  // STUMP-VENUE-006: a member below a gate cannot receive it; someone not yet a member joins first.
  const eligibility = await handoffEligibility(ctx.db, venue, person.id, ctx.now())
  if (!eligibility.join_first && !eligibility.eligible) {
    refuse('gate_unmet', { venue_id: venue.id, venue: venue.name, person_id: person.id, gates: eligibility.unmet.map(unmet => unmet.gate), unmet: eligibility.unmet })
  }
  // STUMP-VENUE-003.4, D-3: the company's shared limit there, counted across people and products. A full period holds the hand-off with the next open date.
  const full = await limitHold(ctx.db, venue, due, null)
  return { eligibility, full }
}

/** The drafting request a hand-off makes: one post for the person at the venue. */
const draftArgs = (args: Args): Args => ({
  format: 'post', person_id: args.person_id, product_id: args.product_id, venue_id: args.venue_id,
  ...(args.generate === true ? { generate: true } : { text: args.text }), ...(args.campaign !== undefined ? { campaign: args.campaign } : {}), ...(args.recommends !== undefined ? { recommends: args.recommends } : {}),
})

/** A hand-off is a step the venue keeps for a person: gated, with the venue and "a member posts" (STUMP-SURFACE-005.1); an AI draft adds the provider. */
export async function classes(args: Args, ctx: ActionContext) {
  const planned = await plan(ctx, args)
  return [{ class: 'gated' as const, facts: { measure: 1, provider: planned.venue.name, step: 'a member posts' } }, ...draftingClasses(ctx.env, args.generate === true && planned.route === 'handoff_draft' ? 1 : 0, 1)]
}

/** Writes the hand-off: the draft item through the drafting module where the route takes one, then the brief. */
export async function prepare(ctx: ActionContext, args: Args, planned: Plan): Promise<string> {
  const { eligibility, full } = await admit(ctx, planned)
  const { venue, person, product, brand, due, route, d8, unused } = planned
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
  const hold: RuleHold | null = ruleHold(venue, { draft_text: draft, thread_url: (args.thread_url as string | undefined) ?? null }) ?? full
  const state = hold ? 'held' : eligibility.join_first ? 'join_first' : 'open'
  const opening = hold?.rule === 'shared_limit' ? Date.parse(hold.next_open_at ?? '') || null : await nextOpening(ctx.db, venue, now)
  const actor = { db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now }
  const holdJson = hold ? ruleHoldJson(hold, now) : null
  await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO stump_handoffs(id,item_id,venue_id,person_id,product_id,state,due_at,lapse,rules,facts,disclosure_line,draft_text,talking_points,own_words_required,
      attestation_required,join_steps,next_open_at,hold,thread_url,campaign,agent,created_by,created_at,updated_at,route,recommends) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, itemId, venue.id, person.id, product.id, state, due, String(args.lapse), venue.rules, JSON.stringify(facts), disclosure, draft,
        JSON.stringify(draft === null ? talkingPoints(venue, product, facts, disclosure) : []), draft === null ? 1 : 0, d8 ? 1 : 0, JSON.stringify(eligibility.join_steps),
        opening, holdJson, (args.thread_url as string | undefined) ?? null, (args.campaign as string | undefined) ?? null,
        ctx.agent ? JSON.stringify({ id: ctx.agent.id, name: ctx.agent.name }) : null, ctx.person.id, now, now, route, args.recommends === true ? 1 : 0),
    history(actor, id, 'prepared', null, state, { route, lapse: args.lapse, due_at: new Date(due).toISOString(), item_id: itemId,
      ...(hold ? { rule: hold.rule, reason: hold.reason, ...(hold.next_open_at !== undefined ? { next_open_at: hold.next_open_at } : {}) } : {}),
      ...(eligibility.join_first ? { join_first: true } : {}), ...(d8 ? { d8: true } : {}),
      ...(unused ? { text_not_used: { field: unused.field, rule: unused.rule, source: unused.source, reason: unused.because } } : {}) }),
  ])
  ctx.emit('handoff.prepared', `stump://handoffs/${id}`, { person_id: person.id, venue_id: venue.id })
  return id
}
