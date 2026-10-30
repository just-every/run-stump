// The draft check every create and save runs (STUMP-BRAND-004, STUMP-DRAFT-001,
// STUMP-TRUTH-002, -003.5, -004). It reads only the item's text and the records
// it names, so a person and an agent submitting the same item get the same
// result, and stores its outcome in the item's flags as {code, blocking, ...facts}.
import { bannedAct, checkClaims, checkDisclosure, claimsUsed, screenDraftForVenue, type ClaimFinding, type MentionSet } from '../lib/claims/index.ts'
import { countText, nearDuplicates, type Network, type TextCount } from '../lib/text/index.ts'
import type { StumpPerson } from '../people/store.ts'
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
}
export interface Account { id: string; network: string; handle: string; display_name: string | null; owner_kind: 'person' | 'company'; owner_person_id: string | null }
interface Venue { id: string; name: string; platform: string | null; rules: Record<string, { value?: unknown } | undefined> }

export interface CheckResult {
  passed: boolean
  claims: ClaimFinding[]
  mentions: MentionSet
  flags: Flag[]
  counts: Array<TextCount & { part?: number }>
  disclosure: { required: boolean; status: string; because: string[] }
  duplicates: Array<{ id: string; kind: 'item' | 'ledger'; score: number; url: string | null }>
  claims_used: string[]
}

export const readAccount = (db: D1Database, id: string) =>
  db.prepare('SELECT id,network,handle,display_name,owner_kind,owner_person_id FROM stump_accounts WHERE id=?').bind(id).first<Account>()
async function readVenue(db: D1Database, id: string): Promise<Venue | null> {
  const row = await db.prepare('SELECT id,name,platform,rules FROM stump_venues WHERE id=?').bind(id).first<Row>()
  return row ? { id: String(row.id), name: String(row.name), platform: row.platform as string | null, rules: parse(row.rules, {}) } : null
}
export const venueDisclosureLine = (venue: { rules: Venue['rules'] } | null) => {
  const value = venue?.rules.disclosure_line?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Every company and product name the brand profile knows: what makes "we" and "our" a disclosure. */
export const brandTerms = (brand: Brand) => [...new Set([...brand.company_names, ...brand.products.flatMap(product => [product.name, ...product.other_names])].filter(Boolean))]

const QUEUED = "('ready','scheduled','posting','posted','partly_posted','paused','uncertain')"

/** Items queued or posted, and ledger entries, inside the company's window: what a new item must not nearly repeat. */
async function earlierTexts(db: D1Database, draft: Draft, now: number, windowDays: number) {
  const since = now - windowDays * 86_400_000
  const [items, ledger] = await db.batch([
    db.prepare(`SELECT i.id,i.text,i.parts,i.network,i.account_id,i.venue_id,i.master_id,COALESCE(i.posted_at,i.scheduled_at,i.updated_at) AS at,a.owner_kind
      FROM stump_items i LEFT JOIN stump_accounts a ON a.id=i.account_id
      WHERE i.state IN ${QUEUED} AND i.id<>? AND COALESCE(i.posted_at,i.scheduled_at,i.updated_at)>=?`).bind(draft.id ?? '', since),
    db.prepare(`SELECT l.id,l.text,l.network,l.account_id,l.venue_id,l.url,l.posted_at AS at,a.owner_kind FROM stump_ledger l LEFT JOIN stump_accounts a ON a.id=l.account_id
      WHERE l.state IN ('posted','uncertain') AND l.text IS NOT NULL AND COALESCE(l.item_id,'')<>? AND COALESCE(l.posted_at,l.created_at)>=?`).bind(draft.id ?? '', since),
  ])
  const scope = (row: Row) => ({ network: (row.network as string | null) ?? undefined, account_id: (row.account_id as string | null) ?? undefined,
    venue_id: (row.venue_id as string | null) ?? undefined, own_account: row.owner_kind === 'company', group_id: (row.master_id as string | null) ?? undefined })
  const kinds = new Map<string, { kind: 'item' | 'ledger'; url: string | null }>()
  const texts = [
    ...(items!.results as Row[]).map(row => { kinds.set(`item:${row.id}`, { kind: 'item', url: null }); return { id: `item:${row.id}`, text: itemText(row), at: new Date(Number(row.at)).toISOString(), scope: scope(row) } }),
    ...(ledger!.results as Row[]).map(row => { kinds.set(`ledger:${row.id}`, { kind: 'ledger', url: (row.url as string | null) ?? null }); return { id: `ledger:${row.id}`, text: String(row.text), at: new Date(Number(row.at)).toISOString(), scope: scope(row) } }),
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
  const [account, venue] = await Promise.all([draft.account_id ? readAccount(db, draft.account_id) : null, draft.venue_id ? readVenue(db, draft.venue_id) : null])
  const network = draft.network ?? account?.network ?? null
  const flags: Flag[] = []

  // Claims, avoided words and mentions (STUMP-BRAND-001.2-.3, STUMP-BRAND-004).
  const claimCheck = checkClaims({ text, claims: brand.claims.map(libClaim), products: brand.products.map(productProfile), company_names: brand.company_names,
    ...(draft.product_id ? { product_id: draft.product_id } : {}), today: today(now) })
  for (const flag of claimCheck.flags) flags.push({ ...flag, blocking: true })

  // Network limits, counted the network's way (STUMP-DRAFT-001.1-.2).
  const counts = countDraft({ network, text: draft.text, parts: draft.parts })
  flags.push(...counts.flags)

  // Disclosure (D-2, STUMP-TRUTH-002): a connected person, anywhere but the company's own accounts.
  const lines = [venueDisclosureLine(venue), ...(person?.disclosure_lines ?? [])].filter((line): line is string => !!line)
  const cut = network ? SEE_MORE_CUT[network] : undefined
  const disclosure = checkDisclosure({ text, mentions: claimCheck.mentions, connection: person?.connection ?? null, company_account: account?.owner_kind === 'company',
    lines, terms: brandTerms(brand), ...(cut ? { cut } : {}) })
  if (disclosure.status === 'missing') flags.push({ code: 'disclosure_missing', blocking: true, rule: 'D-2', because: disclosure.because, connection: person?.connection ?? null, ...(venueDisclosureLine(venue) ? { venue_line: venueDisclosureLine(venue) } : {}) })
  if (disclosure.status === 'below_cut') flags.push({ code: 'disclosure_below_cut', blocking: true, rule: 'D-2', cut, network })

  // Vote requests where the venue's platform bans them (STUMP-TRUTH-003.5).
  for (const finding of venue?.platform ? screenDraftForVenue(text, venue.platform) : []) {
    const act = bannedAct(finding.act)
    flags.push({ code: 'vote_request', blocking: true, rule: 'D-4', act: act.id, source: act.source_url, text: finding.text, start: finding.start, end: finding.end })
  }

  // Near-duplicates of what is queued or posted in the company's window (STUMP-TRUTH-004).
  const earlier = await earlierTexts(db, draft, now, brand.window_days)
  const repeat = nearDuplicates(text, earlier.texts, { window_days: brand.window_days, now: new Date(now).toISOString(),
    scope: { network: network ?? undefined, account_id: draft.account_id ?? undefined, venue_id: draft.venue_id ?? undefined, own_account: account?.owner_kind === 'company', group_id: draft.master_id ?? undefined } })
  const duplicates = repeat.held ? repeat.matches.map(match => {
    const [kind, id] = [earlier.kinds.get(match.id)!, match.id.slice(match.id.indexOf(':') + 1)]
    return { id, kind: kind.kind, score: Math.round(match.score * 1000) / 1000, url: kind.url }
  }) : []
  if (duplicates.length) flags.push({ code: 'near_duplicate', blocking: true, rule: 'STUMP-TRUTH-004', window_days: brand.window_days, matches: duplicates })

  return {
    passed: !flags.some(flag => flag.blocking), claims: claimCheck.claims, mentions: claimCheck.mentions, flags, counts: counts.counts,
    disclosure: { required: disclosure.required, status: disclosure.status, because: disclosure.because }, duplicates, claims_used: claimsUsed(claimCheck.claims),
  }
}

/** The check as both doors return it from stump.drafts.check run (V1: passed, claims, mentions, flags). */
export const checkView = (result: CheckResult) => JSON.parse(JSON.stringify({
  passed: result.passed, claims: result.claims, mentions: result.mentions, flags: result.flags, counts: result.counts, disclosure: result.disclosure, duplicates: result.duplicates,
})) as Pick<CheckResult, 'passed' | 'claims' | 'mentions' | 'flags' | 'counts' | 'disclosure' | 'duplicates'>
