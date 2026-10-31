import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { ActionError, explain, me, runAction } from '../stump/ui/api.ts'
import { Disc } from '../stump/drafting/disc.tsx'
import { Outcome, Tip, useLoaded, useRun, SelectField } from '../stump/ui/kit.tsx'
import { Icon } from '../stump/ui/icons.tsx'
import { countText, extractUrls, NETWORK_LIMITS, type Network } from '../stump/lib/text/index.ts'
import { accountLabel, claimRange, flagLine, networkName, proofLabel, spanAt, spanOf, type Account, type Check, type ClaimFinding, type ClaimView, type Count, type Flag, type MasterPreview, type Variant } from '../stump/drafting/view.ts'
import type { ItemRecord } from '../stump/drafting/records.ts'
import { openDrafts, venuesFor, type VenueChoice } from '../stump/drafting/drafts-list.ts'
import { earlierPosts, postsOf, type EarlierPost } from '../stump/drafting/repeats.ts'
import { US_ZONES, deviceZone, instantIn, nextHour, storeZone, storedZone, zoneName } from '../stump/ui/zones.ts'

// `master` opens a master post and its variants; `item` opens one draft that has no master; `fix` names the
// variant whose claim to select, so "Fix claim" (here or on Today) lands on the words to change.
type Search = { master?: string; item?: string; fix?: string }
export const Route = createFileRoute('/app/compose')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.master === 'string' ? { master: search.master } : typeof search.item === 'string' ? { item: search.item } : {}),
    ...(typeof search.fix === 'string' ? { fix: search.fix } : {}),
  }),
  component: ComposePage,
})

/** One draft with no master post, read as a variant so it edits and checks the same way. */
async function draftAlone(itemId: string, accounts: Account[]): Promise<Variant> {
  const [item, shown] = await Promise.all([runAction<ItemRecord>('stump.drafts.revise', { action: 'get', item_id: itemId }),
    runAction<{ items: Array<{ count: Count | null }>; sent_text: string | null }>('stump.drafts.preview', { action: 'item', item_id: itemId })])
  const account = accounts.find(entry => entry.id === item.account_id)
  const parts = item.parts as string[] | null
  return { item_id: item.id, network: item.network as string | null, account_id: item.account_id as string | null, venue_id: item.venue_id as string | null, product_id: item.product_id as string | null,
    handle: account?.handle ?? null, account_name: account?.display_name ?? null,
    text: parts?.length ? parts.join('\n\n') : String(item.text ?? ''), sent_text: shown.sent_text, count: shown.items[0]?.count ?? null, flags: item.flags as Flag[], state: String(item.state), revision: item.revision, differs_from_master: false }
}

const key = () => crypto.randomUUID()
const blocking = (flags: Flag[]) => flags.filter(flag => flag.blocking)

const graphemes = (value: string) => [...new Intl.Segmenter().segment(value)].length

/** States in which a variant has left Compose, in the words its card shows. */
const GONE: Record<string, string> = { scheduled: 'Scheduled', posting: 'Posting', posted: 'Posted', partly_posted: 'Partly posted', uncertain: 'Sent, not confirmed', cancelled: 'Cancelled' }
/** What already went out, for the bar: "Already posted", or "2 already scheduled or posted". */
function goneWords(gone: Variant[]): string {
  if (!gone.length) return ''
  const states = new Set(gone.map(variant => variant.state))
  const what = states.size === 1 && states.has('scheduled') ? 'scheduled' : states.size === 1 && states.has('posted') ? 'posted' : 'scheduled or posted'
  return gone.length === 1 ? `${networkName(gone[0]!.network)} already ${what}` : `${gone.length} already ${what}`
}
/** "a", "a and b", "a, b and c". */
const joined = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] ?? ''
/**
 * Which text goes out once a variant is edited, said under the master: an edited variant posts its own text, the rest post the
 * master's, and Checks read each variant ("Mastodon posts its edited variant below, not this text. Checks read the variant.").
 */
function followWords(variants: Variant[]): string | null {
  const edited = variants.filter(variant => variant.differs_from_master), rest = variants.filter(variant => !variant.differs_from_master)
  if (!edited.length) return null
  const names = (list: Variant[]) => joined([...new Set(list.map(variant => networkName(variant.network)))])
  const own = edited.length === 1 ? `${names(edited)} posts its edited variant below` : `${names(edited)} post their edited variants below`
  return rest.length ? `${own}; ${names(rest)} ${rest.length === 1 ? 'posts' : 'post'} this text. Checks read each variant.`
    : `${own}, not this text. Checks read ${edited.length === 1 ? 'the variant' : 'the variants'}.`
}
/** The title of a post every variant of which has left Compose: its one state ("Posted"), else "Scheduled and posted" or "Sent". */
function goneTitle(gone: Variant[]): string {
  const states = new Set(gone.map(variant => variant.state))
  if (states.size === 1) return GONE[gone[0]!.state]!
  return [...states].every(state => state === 'scheduled' || state === 'posted') ? 'Scheduled and posted' : 'Sent'
}

function ComposePage() {
  const { master: masterId, item: itemId, fix } = Route.useSearch()
  const navigate = useNavigate({ from: '/app/compose' })
  const { data, error, refresh } = useLoaded(async () => {
    const [who, targets, claims] = await Promise.all([me(), runAction<{ items: Account[] }>('stump.drafts.preview', { action: 'targets' }),
      runAction<{ items: ClaimView[] }>('stump.brand.manage', { action: 'claim_list' })])
    const preview = masterId ? await runAction<MasterPreview>('stump.drafts.preview', { action: 'master', master_id: masterId }) : null
    const alone = !masterId && itemId ? await draftAlone(itemId, targets.items) : null
    const checks = await Promise.all((preview?.items ?? (alone ? [alone] : [])).map(variant =>
      runAction<Check & { item_id: string }>('stump.drafts.check', { action: 'run', item_id: variant.item_id, idempotency_key: key() }).catch(() => null)))
    // With nothing open: the drafts waiting (an agent's among them) to open and review, and what a new post is for and where it goes.
    // Products and venues aim a new post, and re-aim an open one.
    const blank = !preview && !alone
    const [drafts, products, venues, ai, repeats] = await Promise.all([blank ? openDrafts() : [], runAction<{ items: Array<{ id: string; name: string }> }>('stump.brand.manage', { action: 'product_list' }),
      runAction<{ items: VenueChoice[] }>('stump.venues.manage', { action: 'list' }), blank ? runAction<{ source: string }>('stump.setup.ai', { action: 'get' }) : null,
      // The earlier posts a near-duplicate hold names, to link under it.
      earlierPosts((preview?.items ?? (alone ? [alone] : [])).flatMap(variant => variant.flags))])
    return { who, accounts: targets.items, claims: claims.items, preview, alone, checks: checks.filter((check): check is Check & { item_id: string } => !!check), drafts, products: products.items, venues: venues.items,
      noProvider: ai?.source === 'none', repeats }
  })
  useEffect(() => { void refresh() }, [masterId, itemId, refresh])
  // The variant and the claim selected for fixing: from the address on arrival (its first claim to fix), then from each "Fix claim".
  const [fixing, setFixing] = useState<{ item: string; at: number; flag?: Flag } | null>(fix ? { item: fix, at: 0 } : null)
  useEffect(() => { if (fix) setFixing({ item: fix, at: Date.now() }) }, [fix])
  const { busy, message, run } = useRun()
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  // What the new post is for, and the venue each account's variant is aimed at.
  const [product, setProduct] = useState('')
  const [aimed, setAimed] = useState<Record<string, string>>({})
  // A draft that names no account yet (an agent's, say) goes out from the account the person picks here.
  const [postFrom, setPostFrom] = useState('')
  // When it goes out: a wall-clock time in the zone the person schedules in (zones.ts), next hour by default.
  const [zone, setZone] = useState(deviceZone)
  const [when, setWhen] = useState(() => nextHour(deviceZone()))
  const [queueZones, setQueueZones] = useState<string[]>([])
  const zoneSet = useRef(false)
  function pickZone(next: string, remember = true) {
    zoneSet.current = true
    setZone(next)
    if (remember) storeZone(next)
  }
  useEffect(() => { const stored = storedZone(); if (stored) { pickZone(stored, false); setWhen(nextHour(stored)) } }, [])
  const [checksOpen, setChecksOpen] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const preview = data?.preview ?? null
  const alone = data?.alone ?? null
  const aloneAccount = alone ? alone.account_id ?? (postFrom || null) : null
  useEffect(() => { if (preview) setText(preview.master.text) }, [preview?.master.id, preview?.master.revision])
  useEffect(() => { if (preview?.master.sources[0]) setSource(preview.master.sources[0].url) }, [preview?.master.id])

  const accounts = data?.accounts ?? []
  const chosen = preview ? preview.master.account_ids : picked
  const allVariants = preview?.items ?? (alone ? [alone] : [])
  const open = !!(preview || alone)
  // A variant already scheduled or sent is not offered again: the bar acts on the rest, and says what already went out.
  const gone = allVariants.filter(variant => GONE[variant.state])
  const variants = allVariants.filter(variant => !GONE[variant.state])
  const held = variants.filter(variant => blocking(variant.flags).length)
  // Every variant has gone out: the page reads as the record of what went, with nothing left to edit.
  const sent = open && allVariants.length > 0 && !variants.length
  // The chosen accounts' own queue zones (Settings · Publishing) are offered too; with no remembered choice the first is the default.
  useEffect(() => {
    let live = true
    void Promise.all(chosen.map(id => runAction<{ time_zone: string | null }>('stump.calendar.plan', { action: 'slots', account_id: id }).then(slots => slots.time_zone, () => null))).then(found => {
      if (!live) return
      const zones = [...new Set(found.filter((value): value is string => !!value))]
      setQueueZones(zones)
      if (zones[0] && !zoneSet.current) { pickZone(zones[0], false); setWhen(nextHour(zones[0])) }
    })
    return () => { live = false }
  }, [chosen.join(',')])
  // The master is never posted itself: it counts quietly against the largest chosen network's limit, the way that network counts
  // (a link is 23 on Mastodon and X), so it reads the same as that network's variant; each variant card and Checks carry the over-limit signal.
  const largest = [...variants.flatMap(variant => variant.count ? [{ network: variant.count.network, limit: variant.count.limit }] : []),
    ...accounts.filter(account => chosen.includes(account.id)).map(account => ({ network: account.network, limit: NETWORK_LIMITS[account.network as Network] }))]
    .filter(target => target.network in NETWORK_LIMITS && Number.isInteger(target.limit) && target.limit > 0)
    .reduce<{ network: string; limit: number } | null>((best, target) => !best || target.limit > best.limit ? target : best, null)
  const masterCount = largest ? countText({ network: largest.network as Network, limit: largest.limit }, text).count : graphemes(text)

  const products = data?.products ?? []
  const productId = product || (products.length === 1 ? products[0]!.id : '')
  async function start() {
    const generate = !text.trim() && !!source.trim()
    const venues = picked.filter(id => aimed[id]).map(id => ({ account_id: id, venue_id: aimed[id]! }))
    const made = await run(() => runAction<{ master: { id: string } }>('stump.drafts.write', { action: 'master', account_ids: picked, ...(productId ? { product_id: productId } : {}), ...(venues.length ? { venues } : {}),
      ...(generate ? { generate: true, source_url: source.trim() } : { text, ...(source.trim() ? { source_url: source.trim() } : {}) }), idempotency_key: key() }))
    if (made) await navigate({ search: { master: made.master.id } })
  }
  async function saveMaster() {
    if (!preview || sent || text === preview.master.text || !text.trim()) return
    await run(() => runAction('stump.drafts.revise', { action: 'save_master', master_id: preview.master.id, text, expected_revision: preview.master.revision, idempotency_key: key() }), () => 'Saved')
    await refresh()
  }
  async function saveVariant(variant: Variant, next: string) {
    if (GONE[variant.state] || next === variant.text || !next.trim()) return
    await run(() => runAction('stump.drafts.revise', { action: 'save', item_id: variant.item_id, text: next, expected_revision: variant.revision, idempotency_key: key() }), () => 'Saved')
    await refresh()
  }
  // An open draft's venue and product change as a new revision of each variant, checked again where it now goes.
  async function aim(list: Variant[], change: { venue_id?: string; product_id?: string; clear?: Array<'venue' | 'product'> }) {
    await run(async () => { for (const variant of list) await runAction('stump.drafts.revise', { action: 'aim', item_id: variant.item_id, ...change, expected_revision: variant.revision, idempotency_key: key() }) }, () => 'Saved')
    await refresh()
  }
  /** The product and each variant's venue of an open draft, as the new-post form offers them. */
  function aimForm(list: Variant[]) {
    const productNow = list.find(variant => variant.product_id)?.product_id ?? ''
    const showProduct = products.length > 1 || (products.length === 1 && !productNow)
    const venues = data?.venues ?? []
    const rows = list.flatMap(variant => {
      const account = accounts.find(item => item.id === (variant.account_id ?? aloneAccount))
      const choices = venuesFor(venues, account), current = venues.find(venue => venue.id === variant.venue_id)
      const offered = current && !choices.includes(current) ? [current, ...choices] : choices
      return account && offered.length ? [{ variant, account, offered }] : []
    })
    if (!showProduct && !rows.length) return null
    return <div className="st-form st-compose-aim">
      {showProduct ? <SelectField label="Product" value={productNow} disabled={busy} onChange={event => void aim(list, event.target.value ? { product_id: event.target.value } : { clear: ['product'] })}>
        <option value="">No product</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField> : null}
      {rows.map(({ variant, account, offered }) => <SelectField key={variant.item_id} label={<>Venue for {accountLabel(account)}</>} value={variant.venue_id ?? ''} disabled={busy}
        onChange={event => void aim([variant], event.target.value ? { venue_id: event.target.value } : { clear: ['venue'] })}>
        <option value="">No venue</option>{offered.map(venue => <option key={venue.id} value={venue.id} disabled={!venue.routes.includes('publish') && venue.id !== variant.venue_id}>
          {venue.name}{venue.routes.includes('publish') ? '' : ' (no direct posts)'}</option>)}</SelectField>)}
    </div>
  }
  async function schedule(action: 'schedule_master' | 'queue') {
    if (!open) return
    setNote(null)
    try {
      const at = new Date(instantIn(when, zone)).toISOString()
      if (action === 'schedule_master' && preview) await runAction('stump.items.schedule', { action: 'schedule_master', master_id: preview.master.id, at, time_zone: zone, idempotency_key: key() })
      else if (action === 'schedule_master' && alone) await runAction('stump.items.schedule', { action: 'schedule', item_id: alone.item_id, account_id: aloneAccount, at, time_zone: zone, idempotency_key: key() })
      else await Promise.all(variants.filter(variant => !blocking(variant.flags).length).map(variant => runAction('stump.calendar.plan', { action: 'queue', item_id: variant.item_id, account_id: variant.account_id ?? aloneAccount, idempotency_key: key() })))
      setNote({ text: action === 'schedule_master' ? 'Scheduled.' : 'Added to the queue.', error: false })
    } catch (cause) {
      // The publishing tools answer here once they are installed; until then the refusal shows as it is.
      const missing = cause instanceof ActionError && (cause.code === 'unknown_tool' || cause.code === 'unknown_action')
      setNote({ text: missing ? 'Scheduling is not set up on this installation yet. Nothing was scheduled.' : explain(cause), error: true })
    }
    await refresh()
  }

  // Scheduling is editors' work; a contributor marks their variants ready for sign-off (STUMP-TEAM-001, STUMP-TEAM-002.7).
  const schedules = !!data && ['owner', 'admin', 'editor'].includes(data.who.person.role)
  async function markReady() {
    setNote(null)
    try {
      for (const variant of variants.filter(variant => variant.state === 'draft' && !blocking(variant.flags).length)) {
        await runAction('stump.drafts.revise', { action: 'mark_ready', item_id: variant.item_id, idempotency_key: key() })
      }
      setNote({ text: 'Marked ready for an editor to schedule.', error: false })
    } catch (cause) { setNote({ text: explain(cause), error: true }) }
    await refresh()
  }

  const matched = new Set(data?.checks.flatMap(check => check.claims.filter(claim => claim.status === 'matched').map(claim => claim.claim_id)) ?? [])
  const flagRows = new Map<string, { flag: Flag; item: string }>()
  // One row per thing to fix: a limit per variant, a sentence, an image or a venue rule once however many variants share it.
  for (const variant of variants) for (const flag of blocking(variant.flags)) {
    const id = flag.code === 'over_limit' ? `over:${variant.item_id}` : `${flag.code}:${String(flag.text ?? flag.media_id ?? flag.rule ?? '')}`
    if (!flagRows.has(id)) flagRows.set(id, { flag, item: variant.item_id })
  }
  // Sentences to back that do not stop the post: what the product does, with no number or comparison in it.
  const toBack = new Map<string, { flag: Flag; item: string }>()
  for (const variant of variants) for (const flag of variant.flags) if (!flag.blocking && flag.code === 'claim_unmatched' && !flagRows.has(`${flag.code}:${String(flag.text ?? '')}`)) toBack.set(String(flag.text ?? ''), { flag, item: variant.item_id })
  // Backing a claim opens Settings › Brand with the sentence as a new claim, and comes back here once it is recorded.
  const backTo = (item: string, flag: Flag) => ({ item, ...(preview ? { master: preview.master.id } : {}), ...(flag.code === 'claim_unmatched' && typeof flag.text === 'string' ? { claim: flag.text } : {}) })
  // The claim itself, as the check found it in its sentence ("50% faster"), not the whole sentence.
  const claimsOf = (itemId?: string): ClaimFinding[] => data?.checks.filter(check => !itemId || check.item_id === itemId).flatMap(check => check.claims) ?? []
  // Each variant's claims that differ from their proof, as ranges of its text to mark on the danger tint.
  const claimRanges = (variant: Variant) => blocking(variant.flags).filter(flag => flag.code === 'claim_number_mismatch')
    .map(flag => spanAt(variant.text, flag, claimsOf(variant.item_id))).filter((range): range is [number, number] => !!range)
  // The words "Fix claim" selects: that flag's own claim, or, arriving from Today, the variant's first claim to fix.
  const fixRange = (variant: Variant, flag?: Flag) => {
    const flags = flag ? [flag] : blocking(variant.flags).filter(item => item.code.startsWith('claim_')).sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0))
    for (const item of flags) { const range = claimRange(variant.text, item, claimsOf(variant.item_id)); if (range) return range }
    return null
  }
  const disclosure = data?.checks.find(check => check.disclosure.required)
  const repeats = variants.some(variant => variant.flags.some(flag => flag.code === 'near_duplicate'))

  // A tick says only what passed: claims matched shows once one has; with none, the summary names what is left to fix, or that checks pass.
  const claimsMatched = `${matched.size} ${matched.size === 1 ? 'claim' : 'claims'} matched`
  const summary = [matched.size ? claimsMatched : null, flagRows.size ? `${flagRows.size} to fix` : null].filter(Boolean).join(' · ') || 'Checks pass'
  const checks = <section className={checksOpen ? 'st-card st-checks open' : 'st-card st-checks'} aria-labelledby="checks-title">
    <button className="st-checks-toggle" type="button" aria-expanded={checksOpen} onClick={() => setChecksOpen(!checksOpen)}>
      <Disc icon={flagRows.size ? 'alert' : 'check'} tone={flagRows.size ? 'danger' : undefined} />
      <span>{summary}</span>
      <span className="st-chevron" aria-hidden="true"><Icon name="chevronRight" /></span>
    </button>
    <h2 className="st-card-head" id="checks-title"><Disc icon={flagRows.size ? 'alert' : 'check'} tone={flagRows.size ? 'danger' : undefined} />Checks</h2>
    <ul className="st-check-list">
      {matched.size ? <li className="st-check-matched"><Disc icon="check" /><span>{claimsMatched}</span></li> : null}
      {(data?.claims ?? []).filter(claim => matched.has(claim.id)).map(claim => <li key={claim.id} className="st-check-detail"><span>{claim.text}{proofLabel(claim.proof) ? ` · ${proofLabel(claim.proof)}` : ''}</span></li>)}
      {[...flagRows.values()].map(({ flag, item }) => <li key={`${flag.code}-${String(flag.text ?? flag.network)}`} className="danger"><Disc icon="alert" tone="danger" /><span>
        {flagLine(flag, spanOf(flag, claimsOf()))}
        {flag.code === 'near_duplicate' ? <Repeats posts={postsOf(flag, data?.repeats ?? new Map())} /> : null}
        {flag.code.startsWith('claim_') ? <span className="st-fix">
          <button className="st-pill" type="button" onClick={() => setFixing({ item, at: Date.now(), flag })}>Fix claim</button>
          {/* A banned claim has no proof to update: the words come out of the post. */}
          {flag.code === 'claim_banned' ? null : <Link className="st-quiet-link" to="/app/settings/brand" search={backTo(item, flag)}>Update the proof</Link>}
        </span> : null}
      </span></li>)}
      {[...toBack.values()].map(({ flag, item }) => <li key={`back-${String(flag.text ?? '')}`}><Disc icon="alert" tone="held" /><span>
        {flagLine(flag)}
        <Link className="st-pill" to="/app/settings/brand" search={backTo(item, flag)}>Back claim</Link>
      </span></li>)}
      {variants.length && !variants.some(variant => variant.flags.some(flag => flag.code.startsWith('disclosure_')))
        ? <li><Disc icon="check" /><span>Disclosure · {disclosure ? 'in place' : 'company accounts'}</span></li> : null}
      {variants.length && !repeats ? <li><Disc icon="check" /><span>No near-duplicates</span></li> : null}
    </ul>
  </section>

  // A card keeps its place while its own saves land, so typing carries on across them.
  const variantCards = allVariants.map(variant => <VariantCard key={variant.item_id} variant={variant} claims={claimRanges(variant)}
    select={fixing?.item === variant.item_id ? { range: fixRange(variant, fixing.flag), at: fixing.at } : null} onSelected={() => setFixing(null)}
    onSave={next => saveVariant(variant, next)} />)

  const variantsPanel = <section className="st-card" aria-labelledby="variants-title">
    <h2 className="st-card-head" id="variants-title"><Disc icon="grid" />Variants</h2>
    <div className="st-variants">{variantCards}</div>
  </section>
  // With nothing open, the drafts waiting to be opened take the side column beside One post, where Checks sits once a post is open.
  const drafts = !open && data?.drafts.length ? <section className="st-card st-compose-drafts" aria-labelledby="drafts-title">
    <h2 className="st-card-head" id="drafts-title"><Disc icon="doc" />Drafts</h2>
    <ul className="st-list">{data.drafts.map(draft => <li className="st-row" key={draft.key}>
      <Link className="st-compose-draft" to="/app/compose" search={draft.to}><span className="st-name">{draft.name}</span><span className="st-meta">{draft.meta}</span></Link>
    </li>)}</ul>
  </section> : null

  return <HydrationUnit>
    <section className="st-page st-drafting" aria-labelledby="compose-title">
      <h1 id="compose-title">{sent ? goneTitle(gone) : alone ? 'Edit post' : 'New post'}</h1>
      {error ? <p className="st-error">{error}</p> : null}
      {alone ? <div className="st-compose">
        <section className="st-card" aria-labelledby="variants-title">
          <h2 className="st-card-head" id="variants-title"><Disc icon="pencil" />{alone.handle ? accountLabel({ handle: alone.handle, network: alone.network ?? '', display_name: alone.account_name }) : alone.network ? `${networkName(alone.network)} post` : 'Draft'}</h2>
          {!alone.account_id && !GONE[alone.state] ? accounts.length ? <div className="st-form st-compose-from">
            <SelectField label="Post from" value={postFrom} onChange={event => setPostFrom(event.target.value)}>
              <option value="">Choose an account</option>{accounts.filter(account => !alone.network || account.network === alone.network).map(account => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}</SelectField>
          </div> : <p className="st-meta"><Link to="/app/settings/accounts">Connect an account</Link> to post it.</p> : null}
          {GONE[alone.state] ? null : aimForm([alone])}
          <div className="st-variants">{variantCards}</div>
        </section>
        {checks}
      </div> : sent && preview ? <div className="st-compose">
        {/* Everything went out: the page leads with what each account posted, not the master it started from. */}
        <section className="st-card" aria-labelledby="variants-title">
          <h2 className="st-card-head" id="variants-title"><Disc icon="grid" />{allVariants.every(variant => variant.state === 'posted') ? 'What went out' : 'What goes out'}{allVariants.length > 1 ? ', per account' : ''}</h2>
          <div className="st-variants">{variantCards}</div>
        </section>
        {checks}
      </div> : <div className="st-compose">
        <section className="st-card" aria-labelledby="one-post">
          <h2 className="st-card-head" id="one-post"><Disc icon="pencil" />One post</h2>
          <label className="st-sr" htmlFor="master-text">Post text</label>
          <div className="st-master">
            <textarea id="master-text" className="st-textarea large" value={text} rows={4} placeholder="Write the post once. Each account gets its own variant."
              onChange={event => setText(event.target.value)} onBlur={() => void saveMaster()} />
            <div className="st-chars">
              {masterCount.toLocaleString()}{largest ? ` / ${largest.limit.toLocaleString()}` : ''}
            </div>
          </div>
          {/* Once a variant is edited, the master is not every account's text: say which text each account posts and Checks reads. */}
          {preview && followWords(variants) ? <p className="st-meta st-compose-follow" role="status">{followWords(variants)}</p> : null}
          {preview ? source ? <div className="st-source-chip"><Disc icon="pencil" /><span><span className="st-meta">From a source</span><br />{source.replace(/^https?:\/\//, '')}</span></div> : null
            : <div className="st-source">
              <label className="st-field">From a source
                <input type="url" value={source} placeholder="Changelog or docs link" onChange={event => setSource(event.target.value)} />
              </label>
              {source ? <Tip label="Remove source"><button className="st-icon" type="button" aria-label="Remove source" onClick={() => setSource('')}>×</button></Tip> : null}
            </div>}
          {/* Drafting from a source needs the company's own AI provider: with none set, say where it is set before anyone presses. */}
          {!preview && data?.noProvider && source.trim() && !text.trim() ? <p className="st-meta st-compose-noai">{['owner', 'admin'].includes(data.who.person.role)
            ? <>No AI provider yet. <Link to="/app/settings/connections">Set one in Settings › Connections</Link> to draft from a source.</>
            : <>No AI provider yet. An owner or admin sets one in Settings › Connections to draft from a source.</>}</p> : null}
          <h3 className="st-sub"><Disc icon="people" />Accounts</h3>
          {/* Variants open per connected account, so with none the way to connect one is named where it is (docs/compose.md). */}
          {data && !accounts.length ? <p className="st-meta">No account yet. <Link to="/app/settings/accounts">Connect one in Settings › Accounts</Link> to open variants and post.</p> : null}
          <div className="st-chips">
            {accounts.filter(account => !preview || chosen.includes(account.id)).map(account =>
              <button key={account.id} className="st-chip" type="button" aria-pressed={chosen.includes(account.id)} disabled={!!preview}
                onClick={() => setPicked(picked.includes(account.id) ? picked.filter(item => item !== account.id) : [...picked, account.id])}>{chosen.includes(account.id) ? <Icon name="check" /> : null}{accountLabel(account)}</button>)}
          </div>
          {preview ? aimForm(variants) : null}
          {!preview && (products.length > 1 || picked.some(id => venuesFor(data?.venues ?? [], accounts.find(account => account.id === id)).length)) ? <div className="st-form st-compose-aim">
            {products.length > 1 ? <SelectField label="Product" value={product} onChange={event => setProduct(event.target.value)}>
              <option value="">No product</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField> : null}
            {picked.map(id => { const account = accounts.find(item => item.id === id), choices = venuesFor(data?.venues ?? [], account)
              return account && choices.length ? <SelectField key={id} label={<>Venue for {accountLabel(account)}</>} value={aimed[id] ?? ''} onChange={event => setAimed({ ...aimed, [id]: event.target.value })}>
                <option value="">No venue</option>{choices.map(venue => <option key={venue.id} value={venue.id} disabled={!venue.routes.includes('publish')}>
                  {venue.name}{venue.routes.includes('publish') ? '' : ' (no direct posts)'}</option>)}</SelectField> : null })}
          </div> : null}
          {!preview ? <div className="st-actions st-open">
            <button className="st-button primary" type="button" disabled={busy || !picked.length || (!text.trim() && !source.trim()) || (!text.trim() && !!data?.noProvider)} onClick={() => void start()}>
              {!text.trim() && source.trim() ? 'Draft from source' : 'Open variants'}
            </button>
          </div> : null}
        </section>
        {preview ? checks : drafts}
      </div>}
      {preview && !sent ? variantsPanel : null}
      {open && !(alone && !aloneAccount) && !variants.length ? <div className="st-bar st-bar-done">
        <Link className="st-quiet-link" to="/app/ledger">See the ledger</Link>
      </div> : null}
      {open && !(alone && !aloneAccount) && variants.length ? <div className="st-bar">
        {gone.length ? <span className="st-pill">{goneWords(gone)}</span> : null}
        {held.length === variants.length
          ? <span className="st-pill held st-bar-held">{variants.length === 1
            ? <><span className="st-held-long">The {networkName(held[0]!.network)} variant holds until fixed</span><span className="st-held-short" aria-hidden="true">{networkName(held[0]!.network)} held until fixed</span></>
            : <><span className="st-held-long">{variants.length === 2 ? 'Both variants hold' : `All ${variants.length} variants hold`} until fixed</span><span className="st-held-short" aria-hidden="true">{variants.length === 2 ? 'Both' : `All ${variants.length}`} held until fixed</span></>}</span>
          : !schedules ? <button className="st-button ink" type="button" disabled={busy} onClick={() => void markReady()}>Mark ready <Icon name="arrowRight" /></button>
          : <button className="st-button ink" type="button" disabled={busy} onClick={() => void schedule('schedule_master')}>
            {alone ? 'Schedule' : held.length ? `Schedule ${variants.length - held.length} ${variants.length - held.length === 1 ? 'post' : 'posts'}` : 'Schedule all'} <Icon name="arrowRight" />
          </button>}
        {schedules ? <WhenPicker value={when} zone={zone} zones={[...new Set([...queueZones, deviceZone(), ...US_ZONES.map(([id]) => id)])]} onChange={setWhen} onZone={pickZone} /> : null}
        {held.length === variants.length || !schedules ? null : held.length
          ? <span className="st-pill held">{held.length === 1 ? `${networkName(held[0]!.network)} variant holds alone` : `${held.length} variants hold`}</span>
          : <button className="st-button quiet" type="button" disabled={busy} onClick={() => void schedule('queue')}>Add to queue</button>}
      </div> : null}
      <Outcome message={note ?? message} />
    </section>
  </HydrationUnit>
}

/** How long typing rests before a variant saves and its checks run again. */
const SETTLE_MS = 900

function VariantCard({ variant, claims, select, onSelected, onSave }: { variant: Variant; claims: Array<[number, number]>; select: { range: [number, number] | null; at: number } | null; onSelected(): void; onSave: (text: string) => Promise<void> }) {
  const flags = blocking(variant.flags)
  // A flagged variant opens on what to fix; one that has gone out opens on the text it sends.
  const [open, setOpen] = useState(flags.length > 0 || !!GONE[variant.state])
  // Once it has left, the card shows the exact text the account sends: its links tagged, or as the network read it back.
  const [text, setText] = useState(variant.sent_text ?? variant.text)
  const field = useRef<HTMLTextAreaElement>(null)
  // The text saves once typing rests, and on leaving the field, so the checks follow the words without a click away. One save
  // runs at a time, each against the revision the last one made; a newer revision from elsewhere (the master, a re-aim) shows
  // here once the field is not being typed in.
  const latest = useRef({ text, onSave }), timer = useRef<ReturnType<typeof setTimeout> | null>(null), saving = useRef<Promise<void> | null>(null), queued = useRef(false)
  latest.current = { text, onSave }
  useEffect(() => { if (document.activeElement !== field.current) setText(variant.sent_text ?? variant.text) }, [variant.revision, variant.state])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  function save() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    // A save asked for while one runs waits for it, and for the card to read the revision it made.
    if (saving.current) {
      if (!queued.current) { queued.current = true; void saving.current.then(() => { timer.current = setTimeout(() => { queued.current = false; save() }, 50) }) }
      return
    }
    saving.current = latest.current.onSave(latest.current.text).finally(() => { saving.current = null })
  }
  function type(next: string) {
    setText(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(save, SETTLE_MS)
  }
  const over = variant.count ? variant.count.count > variant.count.limit : false
  // "Fix claim": open the card, put the cursor in its text and select the claim, so typing replaces it.
  useEffect(() => {
    if (!select) return
    setOpen(true)
    const frame = requestAnimationFrame(() => {
      const box = field.current
      if (!box) return
      box.focus({ preventScroll: true })
      if (select.range) box.setSelectionRange(select.range[0], select.range[1])
      box.scrollIntoView({ block: 'center', behavior: 'smooth' })
      onSelected()
    })
    return () => cancelAnimationFrame(frame)
  }, [select?.at])
  return <article className={flags.length ? 'st-variant flagged' : 'st-variant'} aria-label={variant.network ? `${networkName(variant.network)} variant` : 'Post'}>
    <button className="st-variant-head" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <strong>{variant.network ? networkName(variant.network) : 'Post'}</strong>
      {variant.differs_from_master ? <span className="st-pill">Edited</span> : null}
      {GONE[variant.state] ? <span className="st-pill">{GONE[variant.state]}</span> : null}
      {variant.count ? <span className={over ? 'st-chars over' : 'st-chars'}>{variant.count.count.toLocaleString()} / {variant.count.limit.toLocaleString()}</span> : null}
      <span className="st-chevron" aria-hidden="true"><Icon name="chevronRight" /></span>
    </button>
    <div className={open ? 'st-variant-body open' : 'st-variant-body'}>
      <label className="st-sr" htmlFor={`variant-${variant.item_id}`}>{variant.network ? `${networkName(variant.network)} text` : 'Post text'}</label>
      <div className="st-variant-field">
        <Marked text={text} network={variant.network} limit={over ? variant.count!.limit : null} claims={text === variant.text ? claims : []} />
        <textarea ref={field} id={`variant-${variant.item_id}`} value={text} rows={6} spellCheck readOnly={!!GONE[variant.state]} onChange={event => type(event.target.value)} onBlur={save} />
      </div>
    </div>
  </article>
}

/** The earlier posts a near-duplicate hold names, each opening where it lives: on its network once posted, else in Compose. */
function Repeats({ posts }: { posts: EarlierPost[] }) {
  if (!posts.length) return null
  const day = (iso: string | null) => iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso)) : null
  return <ul className="st-repeats">{posts.map(post => {
    const words = <>{[post.network, day(post.at)].filter(Boolean).join(' · ')}{post.words ? <> · <q>{post.words}</q></> : null}</>
    return <li key={post.key}>{post.to === null ? words : 'href' in post.to
      ? <a className="st-quiet-link" href={post.to.href} target="_blank" rel="noreferrer noopener">{words} ↗</a>
      : <Link className="st-quiet-link" to="/app/compose" search={post.to.compose}>{words}</Link>}</li>
  })}</ul>
}

/** Where a text first runs past its network's limit, counted the network's way (links at their own weight). */
function overAt(text: string, network: string, limit: number): number {
  const ends = [...new Intl.Segmenter().segment(text)].map(part => part.index + part.segment.length)
  let low = 0, high = ends.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (countText({ network: network as Network, limit }, text.slice(0, ends[mid - 1])).count <= limit) low = mid
    else high = mid - 1
  }
  const cut = low ? ends[low - 1]! : 0
  // A link counts whole, so one that runs over is marked from its start.
  return extractUrls(text).find(link => cut > link.start && cut < link.end)?.start ?? cut
}

/** The variant's text drawn under its field: links in emerald text, and the part past the limit and each claim that differs from its proof on the danger tint. */
function Marked({ text, network, limit, claims }: { text: string; network: string | null; limit: number | null; claims: Array<[number, number]> }) {
  const cut = limit !== null && network ? overAt(text, network, limit) : text.length
  const links = extractUrls(text)
  const stops = [...new Set([0, cut, text.length, ...links.flatMap(link => [link.start, link.end]), ...claims.flat()])].filter(at => at <= text.length).sort((a, b) => a - b)
  const parts = stops.slice(0, -1).map((start, index) => ({ start, end: stops[index + 1]! })).filter(part => part.end > part.start)
  return <div className="st-variant-marks" aria-hidden="true">{parts.map(part => {
    const piece = text.slice(part.start, part.end), link = links.some(item => part.start >= item.start && part.end <= item.end)
    const claim = claims.some(([start, end]) => part.start >= start && part.end <= end)
    const inner = link ? <span className="st-link">{piece}</span> : piece
    return part.start >= cut || claim ? <mark key={part.start}>{inner}</mark> : <span key={part.start}>{inner}</span>
  })}{'\n'}</div>
}

/**
 * The schedule time as a pill ("Tue, Nov 3 · 9:00 AM MT") that opens a day, time and time zone picker; the value is a
 * wall-clock "YYYY-MM-DDTHH:mm" in `zone`, so changing the zone keeps the time and moves the instant.
 */
function WhenPicker({ value, zone, zones, onChange, onZone }: { value: string; zone: string; zones: string[]; onChange(value: string): void; onZone(zone: string): void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const at = new Date(instantIn(value, zone))
  const abbr = (() => { try { return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortGeneric' }).formatToParts(at).find(part => part.type === 'timeZoneName')?.value ?? '' } catch { return '' } })()
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
  const day = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).format(at)
  const label = Number.isNaN(at.getTime()) ? 'Pick a time' : `${day({ weekday: 'short', month: 'short', day: 'numeric' })} · ${time.format(at)}${abbr ? ` ${abbr}` : ''}`
  // Under 600 px the bar shows the short form ("Oct 30 · 7:00 AM"), so the time always reads whole.
  const short = Number.isNaN(at.getTime()) ? label : `${day({ month: 'short', day: 'numeric' })} · ${time.format(at)}`
  // At 480 and under, a time on the hour drops its minutes ("Oct 30 · 10 AM"), so the bar keeps one row beside the held note.
  const tiny = Number.isNaN(at.getTime()) ? label : `${day({ month: 'short', day: 'numeric' })} · ${value.endsWith(':00') ? day({ hour: 'numeric' }) : time.format(at)}`
  const [dayPart, timePart] = value.split('T')
  return <div className="st-when" ref={box}>
    <button type="button" className="st-when-pill" aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
      <Icon name="calendar" /><span className="st-when-long">{label}</span><span className="st-when-short" aria-hidden="true">{short}</span><span className="st-when-tiny" aria-hidden="true">{tiny}</span><Icon name="chevronDown" />
    </button>
    {open ? <div className="st-when-pop" role="dialog" aria-label="When it goes out">
      <label className="st-field">Day<input type="date" value={dayPart ?? ''} onChange={event => event.target.value && onChange(`${event.target.value}T${timePart ?? '09:00'}`)} /></label>
      <label className="st-field">Time<input type="time" step={300} value={timePart ?? ''} onChange={event => event.target.value && onChange(`${dayPart}T${event.target.value}`)} /></label>
      <SelectField label="Time zone" value={zone} onChange={event => onZone(event.target.value)}>
        {zones.map(id => <option key={id} value={id}>{zoneName(id)}</option>)}</SelectField>
      <button type="button" className="st-button primary small" onClick={() => setOpen(false)}>Done</button>
    </div> : null}
  </div>
}
