// stump.handoffs.check_link record: the named person (or their agent) records
// the posted link; Stump checks it is on the venue, confirms the post through the
// network where docs/networks.md lists a check, writes the ledger entry and marks
// the hand-off posted (STUMP-HANDOFF-001.5, .8, STUMP-HANDOFF-002, D-5, D-8).
import { refuse, refuseAct } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { tagOwnLinks } from '../links/index.ts'
import { readPerson } from '../people/store.ts'
import { annotateLedgerEntry } from '../stack/index.ts'
import { memberOf } from '../venues/members.ts'
import { rulesOf, venueOrRefuse, type VenueRow } from '../venues/model.ts'
import { recordedDisclosure } from './disclosure.ts'
import { recordHandedOff } from './ledger.ts'
import { authorMatches, checkLink, methodFor, onVenue, parseLink, sameLink, venueMethod, type Checked } from './link.ts'
import { handoffOrRefuse, move, type HandoffRow, type Hold } from './model.ts'
import { refreshed } from './refresh.ts'

export const TOOL = 'stump.handoffs.check_link'

/** A link fetch to check the post is a call outside the company, to the venue (STUMP-SURFACE-002); a person-confirmed link reaches nobody. */
export async function linkClasses(args: Args, ctx: ActionContext) {
  const row = await handoffOrRefuse(ctx, args.handoff_id), venue = await venueOrRefuse(ctx.db, row.venue_id), method = venueMethod(venue)
  return method && method.method !== 'person'
    ? [{ class: 'external' as const, facts: { measure: 1, counterparty: 'known' as const, provider: venue.name } }]
    : [{ class: 'standard' as const, facts: { measure: 1 } }]
}

const answer = (row: Pick<HandoffRow, 'state' | 'confirmation' | 'ledger_id' | 'url'>, extra: Record<string, unknown> = {}) =>
  ({ state: row.state, confirmation: row.confirmation, ledger_id: row.ledger_id, url: row.url, ...extra })

/** Only the named person, or an agent acting for them, records the post (STUMP-HANDOFF-001.8). */
function named(ctx: ActionContext, row: HandoffRow) {
  if (ctx.person.id !== row.person_id) refuse('forbidden', { action: 'record', handoff_id: row.id, person_id: row.person_id, reason: 'Only the named person, or their agent, records the post.' })
}
/** An agent records for its person but never attests or supplies that person's own words (D-1, D-3, D-8). */
async function agentLimits(ctx: ActionContext, row: HandoffRow, venue: VenueRow, args: Args) {
  if (!ctx.agent) return
  if (row.attestation_required === 1) await refuseAct(ctx, TOOL, 'record', { rule: 'D-8', source: 'STUMP-HANDOFF-001' }, { handoff_id: row.id, reason: 'The person attests their own words; an agent cannot.' })
  if (args.own_words !== undefined || args.attest_own_words !== undefined) {
    const rule = rulesOf(venue).ai_text
    await refuseAct(ctx, TOOL, 'record', row.route === 'handoff_brief' ? { rule: 'D-3', source: rule?.source_url ?? 'STUMP-VENUE-002' } : { rule: 'D-1', source: 'STUMP-TRUTH-001' },
      { handoff_id: row.id, field: args.own_words !== undefined ? 'own_words' : 'attest_own_words', reason: 'A person\'s own words come from that person, not their agent.' })
  }
}

export async function record(args: Args, ctx: ActionContext) {
  const actor = { db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now }
  const read = await handoffOrRefuse(ctx, args.handoff_id)
  named(ctx, read)
  const [row] = await refreshed(actor, [read])
  const venue = await venueOrRefuse(ctx.db, row!.venue_id), link = parseLink(String(args.url))
  await agentLimits(ctx, row!, venue, args)
  // STUMP-HANDOFF-002.8: the same link twice has one effect; a different one asks which is the post.
  if (row!.state === 'posted') {
    if (sameLink(row!.url!, link.href)) return answer(row!, { repeated: true })
    refuse('link_conflict', { handoff_id: row!.id, recorded_url: row!.url, url: link.href, reason: 'This hand-off already has a posted link. Which is the post?' })
  }
  if (row!.state !== 'open') {
    const hold = row!.hold ? JSON.parse(row!.hold) as Hold : null
    refuse('handoff_not_open', { handoff_id: row!.id, state: row!.state, ...(hold ? { rule: hold.rule, reason: hold.reason } : {}), ...(row!.state === 'join_first' ? { join_steps: JSON.parse(row!.join_steps) } : {}) })
  }
  if (!onVenue(venue, link)) refuse('link_not_on_venue', { handoff_id: row!.id, venue_id: venue.id, venue: venue.name, url: link.href, reason: `That link is not on ${venue.name}.` })
  // D-8: the person attests their words are their own.
  if (row!.attestation_required === 1 && args.attest_own_words !== true) refuse('attestation_required', { handoff_id: row!.id, rule: 'D-8', reason: 'Attest that the words you posted are your own.' })
  const ownWords = typeof args.own_words === 'string' && args.own_words.trim() ? args.own_words.trim() : null
  // D-2: words that name the product say how the person is connected before they are recorded as posted, checked before any request.
  if (ownWords !== null) await recordedDisclosure(ctx.db, row!, ownWords, 'own_words', methodFor(venue, link).network, ctx.now())

  const checked: Checked = await checkLink(ctx.env, venue, link)
  if (checked.confirmation === 'network') {
    const member = (await memberOf(ctx.db, venue.id, row!.person_id)).member
    if (!member || !await authorMatches(ctx.env, checked, member.handle, link.hostname)) {
      const author = checked.author_handle ?? checked.author
      refuse('author_mismatch', { handoff_id: row!.id, network: checked.network, author, ...(checked.author_handle ? { author_did: checked.author } : {}), handle: member?.handle ?? null,
        reason: `The post's author is not ${member?.handle ?? 'the person'} on ${venue.name}.` })
    }
  }
  // The text as the network shows it carries the disclosure too; with none read back, the draft the person posted does.
  if (checked.text !== null) await recordedDisclosure(ctx.db, row!, checked.text, 'url', checked.network, ctx.now())
  else if (ownWords === null && row!.draft_text !== null) await recordedDisclosure(ctx.db, row!, row!.draft_text, 'draft_text', checked.network, ctx.now())
  // With no draft and no text read back, the person's own words are what the ledger keeps (the venue's AI text rule, or a superseded draft).
  if (row!.draft_text === null && checked.text === null && ownWords === null) {
    refuse('own_words_required', { handoff_id: row!.id, rule: row!.route === 'handoff_brief' ? 'ai_text' : 'own_words', source_url: rulesOf(venue).ai_text?.source_url ?? null, reason: 'Paste the words you posted.' })
  }
  const person = (await readPerson(ctx.db, row!.person_id))!, now = ctx.now()
  const prepared = row!.agent ? JSON.parse(row!.agent) as { id: string; name: string } : null
  const agent = ctx.agent ? { id: ctx.agent.id, name: ctx.agent.name } : prepared
  // The text as posted: read back where the network shows it, else what the person posted, with the company's own links tagged for the hand-off route.
  const text = checked.text ?? await tagOwnLinks(ctx.db, { text: ownWords ?? row!.draft_text!, route: 'handoff', source: venue.platform ?? venue.name, campaign: row!.campaign, content: row!.id })
  const item = row!.item_id ? await ctx.db.prepare('SELECT revision,claims_used FROM stump_items WHERE id=?').bind(row!.item_id).first<{ revision: number; claims_used: string }>() : null
  const ledgerId = crypto.randomUUID(), postedAt = checked.posted_at ?? now
  const [, updated] = await ctx.db.batch([
    recordHandedOff(ctx.db, { handoff_id: row!.id, item_id: row!.item_id, venue_id: venue.id, network: checked.network, network_id: checked.network_id, url: link.href,
      person_id: person.id, person_name: person.display_name, agent, text, disclosure_line: row!.disclosure_line,
      claims: item ? JSON.parse(item.claims_used) as string[] : (JSON.parse(row!.facts) as Array<{ claim_id: string }>).map(fact => fact.claim_id),
      product_id: row!.product_id, campaign: row!.campaign, confirmation: checked.confirmation, revision: item?.revision ?? null, posted_at: postedAt }, ledgerId, now),
    ...move(actor, row!, 'posted', 'posted', { url: link.href, ledger_id: ledgerId, confirmation: checked.confirmation, posted_at: postedAt, own_words: ownWords,
      attested_at: args.attest_own_words === true ? now : null, hold: null }, { url: link.href, confirmation: checked.confirmation, network: checked.network, ledger_id: ledgerId }),
  ])
  if (!updated!.meta.changes) refuse('revision_conflict', { handoff_id: row!.id })
  ctx.emit('handoff.posted', `stump://handoffs/${row!.id}`, { ledger_id: ledgerId })
  // Each post is annotated in Vane; with Vane not connected the annotation waits as an offer.
  const annotation = await annotateLedgerEntry(ctx.env, ledgerId, ctx.person.id, now)
  return { state: 'posted' as const, confirmation: checked.confirmation, ledger_id: ledgerId, url: link.href, network: checked.network, annotation: annotation.status }
}
