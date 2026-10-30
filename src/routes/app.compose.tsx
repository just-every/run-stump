import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { ActionError, explain, me, runAction } from '../stump/ui/api.ts'
import { Disc } from '../stump/drafting/disc.tsx'
import { Outcome, Tip, useLoaded, useRun } from '../stump/ui/kit.tsx'
import { accountLabel, flagLine, networkName, proofLabel, type Account, type Check, type ClaimView, type Flag, type MasterPreview, type Variant } from '../stump/drafting/view.ts'

export const Route = createFileRoute('/app/compose')({
  validateSearch: (search: Record<string, unknown>): { master?: string } => typeof search.master === 'string' ? { master: search.master } : {},
  component: ComposePage,
})

const key = () => crypto.randomUUID()
const blocking = (flags: Flag[]) => flags.filter(flag => flag.blocking)

const graphemes = (value: string) => [...new Intl.Segmenter().segment(value)].length
const localNow = () => { const at = new Date(Date.now() + 3_600_000); at.setMinutes(0, 0, 0); return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }

function ComposePage() {
  const { master: masterId } = Route.useSearch()
  const navigate = useNavigate({ from: '/app/compose' })
  const { data, error, refresh } = useLoaded(async () => {
    const [who, targets, claims] = await Promise.all([me(), runAction<{ items: Account[] }>('stump.drafts.preview', { action: 'targets' }),
      runAction<{ items: ClaimView[] }>('stump.brand.manage', { action: 'claim_list' })])
    const preview = masterId ? await runAction<MasterPreview>('stump.drafts.preview', { action: 'master', master_id: masterId }) : null
    const checks = preview ? await Promise.all(preview.items.map(variant =>
      runAction<Check & { item_id: string }>('stump.drafts.check', { action: 'run', item_id: variant.item_id, idempotency_key: key() }).catch(() => null))) : []
    return { who, accounts: targets.items, claims: claims.items, preview, checks: checks.filter((check): check is Check & { item_id: string } => !!check) }
  })
  useEffect(() => { void refresh() }, [masterId, refresh])
  const { busy, message, run } = useRun()
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [when, setWhen] = useState(localNow)
  const [checksOpen, setChecksOpen] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const preview = data?.preview ?? null
  useEffect(() => { if (preview) setText(preview.master.text) }, [preview?.master.id, preview?.master.revision])
  useEffect(() => { if (preview?.master.sources[0]) setSource(preview.master.sources[0].url) }, [preview?.master.id])

  const accounts = data?.accounts ?? []
  const chosen = preview ? preview.master.account_ids : picked
  const variants = preview?.items ?? []
  const held = variants.filter(variant => blocking(variant.flags).length)
  const tightest = Math.min(...variants.map(variant => variant.count?.limit ?? Infinity), ...accounts.filter(account => chosen.includes(account.id)).map(account => ({ x: 280, bluesky: 300, mastodon: 500, linkedin: 3000 } as Record<string, number>)[account.network] ?? Infinity))

  async function open() {
    const generate = !text.trim() && !!source.trim()
    const made = await run(() => runAction<{ master: { id: string } }>('stump.drafts.write', { action: 'master', account_ids: picked, ...(generate ? { generate: true, source_url: source.trim() } : { text, ...(source.trim() ? { source_url: source.trim() } : {}) }), idempotency_key: key() }))
    if (made) await navigate({ search: { master: made.master.id } })
  }
  async function saveMaster() {
    if (!preview || text === preview.master.text || !text.trim()) return
    await run(() => runAction('stump.drafts.revise', { action: 'save_master', master_id: preview.master.id, text, expected_revision: preview.master.revision, idempotency_key: key() }), () => 'Saved')
    await refresh()
  }
  async function saveVariant(variant: Variant, next: string) {
    if (next === variant.text || !next.trim()) return
    await run(() => runAction('stump.drafts.revise', { action: 'save', item_id: variant.item_id, text: next, expected_revision: variant.revision, idempotency_key: key() }), () => 'Saved')
    await refresh()
  }
  async function schedule(action: 'schedule_master' | 'queue') {
    if (!preview) return
    setNote(null)
    try {
      if (action === 'schedule_master') await runAction('stump.items.schedule', { action: 'schedule_master', master_id: preview.master.id, at: new Date(when).toISOString(), idempotency_key: key() })
      else await Promise.all(variants.filter(variant => !blocking(variant.flags).length).map(variant => runAction('stump.calendar.plan', { action: 'queue', item_id: variant.item_id, account_id: variant.account_id, idempotency_key: key() })))
      setNote({ text: action === 'schedule_master' ? 'Scheduled.' : 'Added to the queue.', error: false })
    } catch (cause) {
      // The publishing tools answer here once they are installed; until then the refusal shows as it is.
      const missing = cause instanceof ActionError && (cause.code === 'unknown_tool' || cause.code === 'unknown_action')
      setNote({ text: missing ? 'Scheduling is not set up on this installation yet. Nothing was scheduled.' : explain(cause), error: true })
    }
    await refresh()
  }

  const matched = new Set(data?.checks.flatMap(check => check.claims.filter(claim => claim.status === 'matched').map(claim => claim.claim_id)) ?? [])
  const flagRows = new Map<string, Flag>()
  // One row per thing to fix: a limit per variant, a sentence, an image or a venue rule once however many variants share it.
  for (const variant of variants) for (const flag of blocking(variant.flags)) flagRows.set(flag.code === 'over_limit' ? `over:${variant.item_id}` : `${flag.code}:${String(flag.text ?? flag.media_id ?? flag.rule ?? '')}`, flag)
  // Sentences to back that do not stop the post: what the product does, with no number or comparison in it.
  const toBack = new Map<string, Flag>()
  for (const variant of variants) for (const flag of variant.flags) if (!flag.blocking && flag.code === 'claim_unmatched' && !flagRows.has(`${flag.code}:${String(flag.text ?? '')}`)) toBack.set(String(flag.text ?? ''), flag)
  const disclosure = data?.checks.find(check => check.disclosure.required)
  const repeats = variants.some(variant => variant.flags.some(flag => flag.code === 'near_duplicate'))

  const checks = <section className={checksOpen ? 'st-card st-checks open' : 'st-card st-checks'} aria-labelledby="checks-title">
    <button className="st-checks-toggle" type="button" aria-expanded={checksOpen} onClick={() => setChecksOpen(!checksOpen)}>
      <Disc icon={flagRows.size ? 'alert' : 'check'} tone={flagRows.size ? 'danger' : undefined} />
      <span>{matched.size} {matched.size === 1 ? 'claim' : 'claims'} matched{flagRows.size ? ` · ${flagRows.size} to fix` : ''}</span>
    </button>
    <h2 className="st-card-head" id="checks-title"><Disc icon="check" />Checks</h2>
    <ul className="st-check-list">
      <li><Disc icon="check" /><span>{matched.size} {matched.size === 1 ? 'claim' : 'claims'} matched</span></li>
      {(data?.claims ?? []).filter(claim => matched.has(claim.id)).map(claim => <li key={claim.id} className="st-check-detail"><span>{claim.text}{proofLabel(claim.proof) ? ` · ${proofLabel(claim.proof)}` : ''}</span></li>)}
      {[...flagRows.values()].map(flag => <li key={`${flag.code}-${String(flag.text ?? flag.network)}`} className="danger"><Disc icon="alert" tone="danger" /><span>
        {flagLine(flag)}
        {flag.code.startsWith('claim_') ? <Link className="st-pill" to="/app/settings/brand">Fix claim</Link> : null}
      </span></li>)}
      {[...toBack.values()].map(flag => <li key={`back-${String(flag.text ?? '')}`}><Disc icon="alert" /><span>
        {flagLine(flag)}
        <Link className="st-pill" to="/app/settings/brand">Back claim</Link>
      </span></li>)}
      {variants.length && !variants.some(variant => variant.flags.some(flag => flag.code.startsWith('disclosure_')))
        ? <li><Disc icon="check" /><span>Disclosure · {disclosure ? 'in place' : 'company accounts'}</span></li> : null}
      {variants.length && !repeats ? <li><Disc icon="check" /><span>No near-duplicates</span></li> : null}
    </ul>
  </section>

  return <HydrationUnit>
    <section className="st-page st-drafting" aria-labelledby="compose-title">
      <h1 id="compose-title">New post</h1>
      {error ? <p className="st-error">{error}</p> : null}
      <div className="st-compose">
        <section className="st-card" aria-labelledby="one-post">
          <h2 className="st-card-head" id="one-post"><Disc icon="pencil" />One post</h2>
          <label className="st-sr" htmlFor="master-text">Post text</label>
          <div className="st-master">
            <textarea id="master-text" className="st-textarea large" value={text} rows={4} placeholder="Write the post once. Each account gets its own variant."
              onChange={event => setText(event.target.value)} onBlur={() => void saveMaster()} />
            <div className={Number.isFinite(tightest) && graphemes(text) > tightest ? 'st-chars over' : 'st-chars'}>
              {graphemes(text).toLocaleString()}{Number.isFinite(tightest) ? ` / ${tightest.toLocaleString()}` : ''}
            </div>
          </div>
          {preview ? source ? <div className="st-source-chip"><Disc icon="pencil" /><span><span className="st-meta">From a source</span><br />{source.replace(/^https?:\/\//, '')}</span></div> : null
            : <div className="st-source">
              <label className="st-field">From a source
                <input type="url" value={source} placeholder="Changelog or docs link" onChange={event => setSource(event.target.value)} />
              </label>
              {source ? <Tip label="Remove source"><button className="st-icon" type="button" aria-label="Remove source" onClick={() => setSource('')}>×</button></Tip> : null}
            </div>}
          <h3 className="st-sub"><Disc icon="people" />Accounts</h3>
          {data && !accounts.length ? <p className="st-meta">Connect an account to post to it.</p> : null}
          <div className="st-chips">
            {accounts.filter(account => !preview || chosen.includes(account.id)).map(account =>
              <button key={account.id} className="st-chip" type="button" aria-pressed={chosen.includes(account.id)} disabled={!!preview}
                onClick={() => setPicked(picked.includes(account.id) ? picked.filter(item => item !== account.id) : [...picked, account.id])}>{accountLabel(account)}</button>)}
          </div>
          {!preview ? <div className="st-actions st-open">
            <button className="st-button primary" type="button" disabled={busy || !picked.length || (!text.trim() && !source.trim())} onClick={() => void open()}>
              {!text.trim() && source.trim() ? 'Draft from source' : 'Open variants'}
            </button>
          </div> : null}
        </section>
        {preview ? checks : null}
      </div>
      {preview ? <section className="st-card" aria-labelledby="variants-title">
        <h2 className="st-card-head" id="variants-title"><Disc icon="grid" />Variants</h2>
        <div className="st-variants">{variants.map(variant => <VariantCard key={`${variant.item_id}-${variant.revision}`} variant={variant} onSave={next => void saveVariant(variant, next)} />)}</div>
      </section> : null}
      {preview ? <div className="st-bar">
        <button className="st-button ink" type="button" disabled={busy || held.length === variants.length} onClick={() => void schedule('schedule_master')}>
          {held.length ? `Schedule ${variants.length - held.length} ${variants.length - held.length === 1 ? 'post' : 'posts'}` : 'Schedule all'} →
        </button>
        <label className="st-when"><span className="st-sr">Time</span><input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} /></label>
        {held.length ? <span className="st-pill quiet">{held.length === 1 ? `${networkName(held[0]!.network)} variant holds alone` : `${held.length} variants hold`}</span>
          : <button className="st-button quiet" type="button" disabled={busy} onClick={() => void schedule('queue')}>Add to queue</button>}
      </div> : null}
      <Outcome message={note ?? message} />
    </section>
  </HydrationUnit>
}

function VariantCard({ variant, onSave }: { variant: Variant; onSave: (text: string) => void }) {
  const flags = blocking(variant.flags)
  const [open, setOpen] = useState(flags.length > 0)
  const [text, setText] = useState(variant.text)
  const over = variant.count ? variant.count.count > variant.count.limit : false
  return <article className={flags.length ? 'st-variant flagged' : 'st-variant'} aria-label={`${networkName(variant.network)} variant`}>
    <button className="st-variant-head" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <strong>{networkName(variant.network)}</strong>
      {variant.differs_from_master ? <span className="st-pill">Edited</span> : null}
      {variant.count ? <span className={over ? 'st-chars over' : 'st-chars'}>{variant.count.count.toLocaleString()} / {variant.count.limit.toLocaleString()}</span> : null}
    </button>
    <div className={open ? 'st-variant-body open' : 'st-variant-body'}>
      <label className="st-sr" htmlFor={`variant-${variant.item_id}`}>{networkName(variant.network)} text</label>
      <textarea id={`variant-${variant.item_id}`} value={text} rows={6} onChange={event => setText(event.target.value)} onBlur={() => onSave(text)} />
      {flags.length ? <ul className="st-flag-list">{flags.map(flag => <li key={`${flag.code}-${String(flag.text ?? '')}`}>{flagLine(flag)}</li>)}</ul> : null}
    </div>
  </article>
}

