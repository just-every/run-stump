// The draft check every create and save runs (STUMP-BRAND-004, STUMP-DRAFT-001,
// STUMP-TRUTH-002, -003.5, -004). It reads only the item's text and the records
// it names, so a person and an agent submitting the same item get the same
// result, and stores its outcome in the item's flags as {code, blocking, ...facts}.
import { bannedAct, checkClaims, checkDisclosure, claimsUsed, extractMentions, screenDraftForVenue, type ClaimFinding, type MentionSet } from '../lib/claims/index.ts'
import { countText, nearDuplicates, type Network, type TextCount } from '../lib/text/index.ts'
import type { StumpPerson } from '../people/store.ts'
import { readVenue, rulesOf, type VenueRow } from '../venues/model.ts'
import { holdFor, type VenueHold } from '../venues/rules.ts'
import { otherServer } from '../venues/server.ts'
import { refuse } from '../actions/refusals.ts'
import { claimRecord, itemText, libClaim, parse, productProfile, productRecord, today, type ClaimRecord, type Flag, type ProductRecord, type Row } from './records.ts'

/** The networks whose counting rule Stump knows (lib/text). */
export const COUNTED: readonly Network[] = ['x', 'bluesky', 'mastodon', 'linkedin']
export const counted = (network: unknown): network is Network => COUNTED.includes(network as Network)

/**
 * LinkedIn shows a member post's opening lines and hides the rest behind "see
 * more". LinkedIn publishes no figure; Stump uses the shorter mobile cut, so a
 * disclosure above it is above the cut everywhere (STUMP-TRUTH-002.6).
 */
export const SEE_MORE_CUT: Partial<Record<string, number>> = { linkedin: 140 }

export interface Brand { products: ProductRecord[]; claims: ClaimRecord[]; company_names: string[]; window_days: number }

/** The company's brand memory as it is now: products, claims, its own names and the duplicate window. */
export async function loadBrand(db: D1Database): Promise<Brand> {
  const [products, claims, settings] = await db.batch([
    db.prepare('SELECT * FROM stump_products ORDER BY name,id'),
    db.prepare('SELECT * FROM stump_claims ORDER BY created_at,id'),
    db.prepare('SELECT company_names,duplicate_window_days FROM stump_drafting_settings WHERE id=1'),
  ])
  const row = (settings!.results as Row[])[0]
  return {
    products: (products!.results as Row[]).map(productRecord), claims: (claims!.results as Row[]).map(claimRecord),
    company_names: parse<string[]>(row?.company_names, []), window_days: Number(row?.duplicate_window_days ?? 30),
  }
}

export interface Draft {
  id?: string; format: string; network: string | null; account_id: string | null; venue_id: string | null
  person_id: string; product_id: string | null; master_id: string | null; text: string | null; parts: string[] | null
  /** Where the item is aimed inside its venue: the post it answers, or options.thread_url / options.post_url. */
  reply_to?: unknown; options?: Record<string, unknown> | null
}
export interface Account { id: string; network: string; handle: string; display_name: string | null; owner_kind: 'person' | 'company'; owner_person_id: string | null; instance: string | null }

export interface CheckResult {
  passed: boolean
  claims: ClaimFinding[]
  mentions: MentionSet
  flags: Flag[]
  counts: Array<TextCount & { part?: number }>
  disclosure: { required: boolean; status: string; because: string[] }
  duplicates: Array<{ id: string; kind: 'item' | 'ledger'; score: number; url: string | null }>
  claims_used: string[]
  /** The venue rule that holds the item where it is aimed, if any (D-3, STUMP-VENUE-002.3). */
  venue_hold: (VenueHold & { venue_id: string; venue_name: string }) | null
}

export const readAccount = (db: D1Database, id: string) =>
  db.prepare('SELECT id,network,handle,display_name,owner_kind,owner_person_id,instance FROM stump_accounts WHERE id=?').bind(id).first<Account>()
export const venueDisclosureLine = (venue: Pick<VenueRow, 'rules'> | null) => {
  const value = venue ? rulesOf(venue).disclosure_line?.value : undefined
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

type ClaimInput = Omit<Parameters<typeof checkClaims>[0], 'text'>

/** What the claim check finds in a disclosure line read on its own: a line that finds anything is never read past. */
export function lineFindings(line: string, input: ClaimInput) {
  const result = checkClaims({ ...input, text: line })
  return [...result.claims.map(finding => finding.status), ...result.flags.map(flag => flag.code)]
}

/** Where each disclosure line that on its own makes no claim and raises no flag stands in the text, as [start, end) spans. */
function lineSpans(text: string, lines: ReadonlyArray<string | null | undefined>, input: ClaimInput): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const line of new Set(lines.map(line => line?.trim()).filter((line): line is string => !!line))) {
    if (lineFindings(line, input).length) continue
    for (const match of text.matchAll(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'))) spans.push([match.index, match.index + match[0].length])
  }
  return spans
}

/**
 * The claim check of the whole text, read past its disclosure lines: a finding or flag is left out only when it lies wholly
 * inside a disclosure line that, read on its own, makes no claim and raises no flag, so a line such as "I work on Ferrous."
 * is never taken for a claim about the product, and no line takes any other word of the text out of the check.
 */
export function claimsPastLines(text: string, lines: ReadonlyArray<string | null | undefined>, input: ClaimInput) {
  const result = checkClaims({ ...input, text })
  const spans = lineSpans(text, lines, input)
  const kept = <T extends { start?: number; end?: number }>(item: T) => !(typeof item.start === 'number' && typeof item.end === 'number'
    && spans.some(([start, end]) => start <= item.start! && item.end! <= end))
  const claims = result.claims.filter(kept), flags = result.flags.filter(kept)
  return { ...result, claims, flags, passed: claims.every(finding => finding.status === 'matched') && !flags.some(flag => flag.code === 'avoid_word') }
}

/**
 * Refuses disclosure lines the claim check reads as a claim or flags, naming the first such line, so a line saved for a
 * person or a venue is only ever a statement of connection. `field` names the argument the lines came in.
 */
export async function refuseClaimingLines(db: D1Database, lines: ReadonlyArray<string>, field: string, now: number) {
  const brand = await loadBrand(db)
  const base = { claims: brand.claims.map(libClaim), products: brand.products.map(productProfile), company_names: brand.company_names, today: today(now) }
  for (const line of lines) {
    const found = [base, ...brand.products.map(product => ({ ...base, product_id: product.id }))].flatMap(input => lineFindings(line, input))
    if (!found.length) continue
    const what = found.includes('avoid_word') && found.every(code => code === 'avoid_word' || code === 'matched') ? 'uses a word the brand avoids' : 'reads as a claim about the product'
    refuse('invalid_arguments', { field, line, found: [...new Set(found)],
      reason: `"${line}" ${what}. A disclosure line says only how you are connected, such as "I work on ${brand.products[0]?.name ?? 'the product'}."` })
  }
}

/** The venue rule holding this draft where it is aimed, read the way the venue register reads its items. */
function venueHold(venue: VenueRow, draft: Draft): CheckResult['venue_hold'] {
  const hold = holdFor(venue, {
    id: draft.id ?? '', state: 'draft', format: draft.format, account_id: draft.account_id, text: draft.text, parts: draft.parts?.length ? JSON.stringify(draft.parts) : null,
    reply_to: draft.reply_to ? JSON.stringify(draft.reply_to) : null, options: JSON.stringify(draft.options ?? {}), routes: '[]', flags: '[]', hold: null,
  })
  return hold ? { ...hold, venue_id: venue.id, venue_name: venue.name } : null
}

/** Attached media without alt text: each one stops the item until its alt text is set (STUMP-PUBLISH-002.5). */
async function mediaWithoutAlt(db: D1Database, itemId: string | undefined) {
  if (!itemId) return []
  const rows = await db.prepare("SELECT id,name,type FROM stump_media WHERE item_id=? AND (alt IS NULL OR trim(alt)='') ORDER BY created_at,id").bind(itemId).all<{ id: string; name: string; type: string }>()
  return rows.results
}

/** Every company and product name the brand profile knows: what makes "we" and "our" a disclosure. */
export const brandTerms = (brand: Brand) => [...new Set([...brand.company_names, ...brand.products.flatMap(product => [product.name, ...product.other_names])].filter(Boolean))]

/** The text names the company or one of its products, by name, other name or URL. */
export function namesCompany(brand: Brand, text: string) {
  if (!text.trim()) return false
  const found = extractMentions(text, { products: brand.products.map(productProfile), company_names: brand.company_names })
  return found.products.length > 0 || found.company.length > 0
}

const QUEUED = "('ready','scheduled','posting','posted','partly_posted','paused','uncertain')"

/** Items queued or posted, and ledger entries, inside the company's window: what a new item must not nearly repeat. */
async function earlierTexts(db: D1Database, draft: Draft, now: number, windowDays: number) {
  const since = now - windowDays * 86_400_000
  const [items, ledger] = await db.batch([
    db.prepare(`SELECT i.id,i.text,i.parts,i.network,i.account_id,i.venue_id,i.master_id,COALESCE(i.posted_at,i.scheduled_at,i.updated_at) AS at,a.owner_kind
      FROM stump_items i LEFT JOIN stump_accounts a ON a.id=i.account_id
      WHERE i.state IN ${QUEUED} AND i.id<>? AND COALESCE(i.posted_at,i.scheduled_at,i.updated_at)>=?`).bind(draft.id ?? '', since),
    db.prepare(`SELECT l.id,l.item_id,l.handoff_id,l.text,l.network,l.account_id,l.venue_id,l.url,l.posted_at AS at,a.owner_kind FROM stump_ledger l LEFT JOIN stump_accounts a ON a.id=l.account_id
      WHERE l.state IN ('posted','uncertain') AND l.text IS NOT NULL AND COALESCE(l.item_id,'')<>? AND COALESCE(l.posted_at,l.created_at)>=?`).bind(draft.id ?? '', since),
  ])
  const scope = (row: Row) => ({ network: (row.network as string | null) ?? undefined, account_id: (row.account_id as string | null) ?? undefined,
    venue_id: (row.venue_id as string | null) ?? undefined, own_account: row.owner_kind === 'company', group_id: (row.master_id as string | null) ?? undefined })
  // A handed-off post's ledger entry also names its hand-off, so a hold names the earlier hand-off as well as the post.
  const kinds = new Map<string, { kind: 'item' | 'ledger'; url: string | null; handoff_id: string | null; item_id?: string | null }>()
  const texts = [
    ...(items!.results as Row[]).map(row => { kinds.set(`item:${row.id}`, { kind: 'item', url: null, handoff_id: null }); return { id: `item:${row.id}`, text: itemText(row), at: new Date(Number(row.at)).toISOString(), scope: scope(row) } }),
    ...(ledger!.results as Row[]).map(row => { kinds.set(`ledger:${row.id}`, { kind: 'ledger', url: (row.url as string | null) ?? null, handoff_id: (row.handoff_id as string | null) ?? null, item_id: (row.item_id as string | null) ?? null }); return { id: `ledger:${row.id}`, text: String(row.text), at: new Date(Number(row.at)).toISOString(), scope: scope(row) } }),
  ]
  return { texts, kinds }
}

/** The network counts of a post or of each part of a thread, and an over_limit flag per part that does not fit. */
export function countDraft(draft: Pick<Draft, 'network' | 'text' | 'parts'>): { counts: CheckResult['counts']; flags: Flag[] } {
  if (!counted(draft.network)) return { counts: [], flags: [] }
  const network = draft.network
  const texts = draft.parts?.length ? draft.parts : [draft.text ?? '']
  const counts = texts.map((text, index) => ({ ...countText({ network }, text), ...(draft.parts?.length ? { part: index + 1 } : {}) }))
  const flags = counts.filter(count => !count.fits).map(count => ({ code: 'over_limit', blocking: true, network, count: count.count, limit: count.limit, unit: count.unit,
    failed: count.failed, ...(count.part ? { part: count.part } : {}) }))
  return { counts, flags }
}

/**
 * The full check of one item against the company's records now. A person and
 * an agent submitting the same item get the same result (STUMP-BRAND-004.5,
 * STUMP-TRUTH-004.5): nothing here reads who is asking.
 */
export async function checkDraft(db: D1Database, brand: Brand, draft: Draft, person: StumpPerson | null, now: number): Promise<CheckResult> {
  const text = itemText(draft)
  const [account, venue, unlabelled] = await Promise.all([draft.account_id ? readAccount(db, draft.account_id) : null, draft.venue_id ? readVenue(db, draft.venue_id) : null,
    mediaWithoutAlt(db, draft.id)])
  const network = draft.network ?? account?.network ?? null
  const flags: Flag[] = []

  // The disclosure lines that apply here: the venue's own, and the person's.
  const lines = [venueDisclosureLine(venue), ...(person?.disclosure_lines ?? [])].filter((line): line is string => !!line)
  // Claims and avoided words (STUMP-BRAND-001.2-.3, STUMP-BRAND-004), read past the disclosure lines; mentions from the whole text.
  const claimCheck = claimsPastLines(text, lines, { claims: brand.claims.map(libClaim), products: brand.products.map(productProfile), company_names: brand.company_names,
    ...(draft.product_id ? { product_id: draft.product_id } : {}), today: today(now) })
  const mentions = extractMentions(text, { products: brand.products.map(productProfile), company_names: brand.company_names })
  // One flag per place in the text: two products avoiding the same word flag it once.
  const avoided = new Set<string>()
  const unmatched = new Map(claimCheck.claims.filter(finding => finding.status === 'unmatched').map(finding => [`${finding.start}:${finding.end}`, finding.because ?? []]))
  // A flag about a recorded claim names it, so a number that differs from its proof reads against the claim it is about.
  const claimText = new Map(brand.claims.map(claim => [claim.id, claim.text]))
  for (const raw of claimCheck.flags) {
    const flag = raw.claim_id && claimText.has(raw.claim_id) ? { ...raw, claim_text: claimText.get(raw.claim_id) } : raw
    if (flag.code === 'avoid_word') {
      if (avoided.has(`${flag.start}:${flag.end}`)) continue
      avoided.add(`${flag.start}:${flag.end}`)
      // The avoided word as the product records it (STUMP-BRAND-001.3).
      flags.push({ ...flag, word: flag.reason, blocking: true })
      continue
    }
    if (flag.code !== 'claim_unmatched') { flags.push({ ...flag, blocking: true }); continue }
    // An unmatched sentence stays flagged until it is backed or removed. Only one that states a number, a comparison, a superlative,
    // compliance or a guarantee stops the item; one that only describes what the product does is flagged for a person to back.
    const because = unmatched.get(`${flag.start}:${flag.end}`)
    flags.push({ ...flag, because: because ?? null, blocking: !because || because.some(reason => reason !== 'capability') })
  }

  // Network limits, counted the network's way (STUMP-DRAFT-001.1-.2).
  const counts = countDraft({ network, text: draft.text, parts: draft.parts })
  flags.push(...counts.flags)

  // Disclosure (D-2, STUMP-TRUTH-002): a connected person, anywhere but the company's own accounts.
  const cut = network ? SEE_MORE_CUT[network] : undefined
  const disclosure = checkDisclosure({ text, mentions, connection: person?.connection ?? null, company_account: account?.owner_kind === 'company',
    lines, terms: brandTerms(brand), ...(cut ? { cut } : {}) })
  if (disclosure.status === 'missing') flags.push({ code: 'disclosure_missing', blocking: true, rule: 'D-2', because: disclosure.because, connection: person?.connection ?? null, ...(venueDisclosureLine(venue) ? { venue_line: venueDisclosureLine(venue) } : {}) })
  if (disclosure.status === 'below_cut') flags.push({ code: 'disclosure_below_cut', blocking: true, rule: 'D-2', cut, network })

  // An image without alt text (STUMP-PUBLISH-002.5).
  for (const media of unlabelled) flags.push({ code: 'alt_text_missing', blocking: true, media_id: media.id, name: media.name, type: media.type })

  // The venue's rules where the item is aimed: outside its promotion thread, a link where links are banned,
  // or the company's account where only members post (D-3). The flag has the venue register's shape.
  const held = venue ? venueHold(venue, draft) : null
  // `where` and `thread_url` let a screen link the words that name the venue's thread, never printing its address.
  if (held) flags.push({ code: 'venue_rule', blocking: true, venue_id: held.venue_id, rule: held.rule, reason: held.reason, source_url: held.source_url,
    ...(held.where ? { where: held.where } : {}), ...(held.thread_url ? { thread_url: held.thread_url } : {}) })
  // A Mastodon venue on another server than the account's: the post would go out on the account's own server, not there.
  const servers = otherServer(venue, account)
  if (venue && servers) flags.push({ code: 'venue_other_server', blocking: true, venue_id: venue.id, ...servers,
    reason: `${venue.name} is on ${servers.venue_host}, and this account posts on ${servers.account_host}. Aim it at a venue on ${servers.account_host}, or post from an account on ${servers.venue_host}.` })

  // Vote requests where the venue's platform bans them (STUMP-TRUTH-003.5).
  for (const finding of venue?.platform ? screenDraftForVenue(text, venue.platform) : []) {
    const act = bannedAct(finding.act)
    flags.push({ code: 'vote_request', blocking: true, rule: 'D-4', act: act.id, source: act.source_url, text: finding.text, start: finding.start, end: finding.end })
  }

  // Near-duplicates of what is queued or posted in the company's window (STUMP-TRUTH-004).
  const earlier = await earlierTexts(db, draft, now, brand.window_days)
  const repeat = nearDuplicates(text, earlier.texts, { window_days: brand.window_days, now: new Date(now).toISOString(),
    scope: { network: network ?? undefined, account_id: draft.account_id ?? undefined, venue_id: draft.venue_id ?? undefined, own_account: account?.owner_kind === 'company', group_id: draft.master_id ?? undefined } })
  // A published item and its own ledger entry are one earlier post: the entry, which carries the post's address, names it.
  const onLedger = new Set(repeat.matches.flatMap(match => earlier.kinds.get(match.id)?.item_id ?? []))
  const duplicates = repeat.held ? repeat.matches.filter(match => !(match.id.startsWith('item:') && onLedger.has(match.id.slice(5)))).map(match => {
    const [kind, id] = [earlier.kinds.get(match.id)!, match.id.slice(match.id.indexOf(':') + 1)]
    return { id, kind: kind.kind, score: Math.round(match.score * 1000) / 1000, url: kind.url, ...(kind.handoff_id ? { handoff_id: kind.handoff_id } : {}) }
  }) : []
  if (duplicates.length) flags.push({ code: 'near_duplicate', blocking: true, rule: 'STUMP-TRUTH-004', window_days: brand.window_days, matches: duplicates })

  // A draft passes when nothing stops it and every claim it makes is matched (STUMP-BRAND-004.1, .4): a statement only flagged for a
  // person to back leaves it free to be marked ready, but it has not passed until someone backs or removes it.
  return {
    passed: !flags.some(flag => flag.blocking) && claimCheck.claims.every(finding => finding.status === 'matched'), claims: claimCheck.claims, mentions, flags, counts: counts.counts,
    disclosure: { required: disclosure.required, status: disclosure.status, because: disclosure.because }, duplicates, claims_used: claimsUsed(claimCheck.claims), venue_hold: held,
  }
}

/** The check as both doors return it from stump.drafts.check run (V1: passed, claims, mentions, flags). */
export const checkView = (result: CheckResult) => JSON.parse(JSON.stringify({
  passed: result.passed, claims: result.claims, mentions: result.mentions, flags: result.flags, counts: result.counts, disclosure: result.disclosure, duplicates: result.duplicates,
})) as Pick<CheckResult, 'passed' | 'claims' | 'mentions' | 'flags' | 'counts' | 'disclosure' | 'duplicates'>
