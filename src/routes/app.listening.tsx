import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { ActionError, explain, me, runAction } from '../stump/ui/api.ts'
import { Outcome, Tip, useLoaded, useRun } from '../stump/ui/kit.tsx'
import { listeningStyles } from '../stump/watches/styles.ts'
import type { BlockedAuthor, FindingList, FindingView, PollView, WatchList, WatchView } from '../stump/watches/ui-types.ts'

export const Route = createFileRoute('/app/listening')({
  validateSearch: (search: Record<string, unknown>): { watch?: string; finding?: string } => ({
    ...(typeof search.watch === 'string' ? { watch: search.watch } : {}), ...(typeof search.finding === 'string' ? { finding: search.finding } : {}),
  }),
  component: Listening,
})

const key = () => crypto.randomUUID()
const KINDS: Record<string, string> = { hn: 'Hacker News', rss: 'RSS', bluesky: 'Bluesky', mastodon: 'Mastodon' }
const ROUTES: Record<string, string> = { publish: 'Reply from an account', handoff_draft: 'Hand off with draft', handoff_brief: 'Hand off with brief' }
const kindsOf = (watch: WatchView) => [...new Set(watch.sources.map(source => KINDS[source.kind]))].join(', ') || 'No sources yet'

/** A refusal in its own words where the door gave them, else the app's plain words. */
const plain = (error: unknown) => error instanceof ActionError && typeof error.fields.reason === 'string' ? error.fields.reason : explain(error)

function ago(iso: string | null): string {
  if (!iso) return ''
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  if (minutes < 60 * 48) return 'yesterday'
  return `${Math.round(minutes / 1440)}d ago`
}
function until(iso: string | null): string {
  if (!iso) return 'soon'
  const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000))
  return minutes < 1 ? 'now' : minutes < 60 ? `in ${minutes} min` : `in ${Math.round(minutes / 60)} h`
}

function Listening() {
  const search = Route.useSearch(), navigate = useNavigate({ from: '/app/listening' })
  const watches = useLoaded(async () => ({ me: await me(), list: await runAction<WatchList>('stump.watches.manage', { action: 'list' }) }))
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null)
  const items = watches.data?.list.items ?? []
  const selected = items.find(watch => watch.id === search.watch) ?? items[0] ?? null
  const findings = useLoaded(async () => selected ? runAction<FindingList>('stump.findings.work', { action: 'list', watch_id: selected.id }) : null)
  const selectedId = selected?.id
  const refreshFindings = findings.refresh
  useEffect(() => { void refreshFindings() }, [selectedId, refreshFindings])
  const focused = search.finding, loaded = findings.data?.items.length ?? 0
  useEffect(() => { if (focused && loaded) document.getElementById(`finding-${focused}`)?.scrollIntoView({ block: 'center' }) }, [focused, loaded])
  const choose = (id: string) => { setEditing(null); void navigate({ search: { watch: id } }) }
  const reload = async () => { await watches.refresh(); await findings.refresh() }
  const role = watches.data?.me.person.role ?? 'viewer'
  const mayEdit = ['owner', 'admin', 'editor'].includes(role)
  return <HydrationUnit>
    <style>{listeningStyles}</style>
    <section className="st-page st-listen" aria-labelledby="listening-title">
      <h1 id="listening-title">Listening</h1>
      <p className="st-lead">Watches and findings</p>
      {watches.error ? <p className="st-error">{watches.error}</p> : null}
      <div className="st-listen-grid">
        <div className="st-card" aria-label="Your watches">
          <h2>Your watches</h2>
          <select className="st-pick" aria-label="Watch" value={selected?.id ?? ''} onChange={event => choose(event.target.value)}>
            {items.map(watch => <option key={watch.id} value={watch.id}>{watch.name}</option>)}
          </select>
          <ul className="st-watches st-watches-list">
            {items.map(watch => <li key={watch.id}>
              <button type="button" className="st-watch" aria-current={watch.id === selected?.id} onClick={() => choose(watch.id)}>
                <span className="st-tick" aria-hidden="true">{watch.id === selected?.id ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}</span>
                <span className="st-watch-main"><div className="st-watch-name">{watch.name}</div><div className="st-meta">{kindsOf(watch)}{watch.muted ? ' · muted' : ''}</div></span>
              </button>
            </li>)}
          </ul>
          {watches.data && !items.length ? <p className="st-empty">No watches yet. A watch follows Hacker News, feeds, Bluesky and Mastodon for threads you could answer.</p> : null}
          {mayEdit ? <button className="st-button primary" type="button" onClick={() => setEditing('new')}>+ New watch</button> : null}
        </div>
        <div className="st-card" aria-label={editing ? 'Watch' : 'Top findings'}>
          {editing === 'new' ? <Editor role={role} onDone={async id => { setEditing(null); await reload(); choose(id) }} onCancel={() => setEditing(null)} /> : null}
          {editing === 'edit' && selected ? <Editor role={role} watch={selected} blocked={watches.data?.list.blocked_authors ?? []} onDone={async () => { setEditing(null); await reload() }} onCancel={() => setEditing(null)} /> : null}
          {!editing ? <Findings watch={selected} data={findings.data?.watch.id === selected?.id ? findings.data : null} error={findings.error} focus={search.finding} may={mayEdit}
            onEdit={() => setEditing('edit')} onChange={reload} /> : null}
        </div>
      </div>
    </section>
  </HydrationUnit>
}

function Findings({ watch, data, error, focus, may, onEdit, onChange }: { watch: WatchView | null; data: FindingList | null; error: string | null; focus?: string; may: boolean; onEdit(): void; onChange(): Promise<void> }) {
  const { busy, message, run } = useRun()
  if (!watch) return <><h2>Top findings</h2><p className="st-empty">Create a watch to see the threads worth answering.</p></>
  async function checkNow() {
    await run(() => runAction<PollView>('stump.watches.manage', { action: 'poll', watch_id: watch!.id, idempotency_key: key() }),
      result => result.added ? `${result.added} new ${result.added === 1 ? 'finding' : 'findings'}.` : 'Nothing new.')
    await onChange()
  }
  const failing = watch.last_error
  return <>
    <div className="st-card-head">
      <h2>Top findings</h2>
      {may ? <div className="st-actions">
        <button className="st-button" type="button" disabled={busy} onClick={() => void checkNow()}>Check now</button>
        <button className="st-button" type="button" onClick={onEdit}>Edit watch</button>
      </div> : null}
    </div>
    <p className="st-meta" style={{ margin: '0 0 16px' }}>{watch.name} · {kindsOf(watch)} · {watch.muted ? 'muted, alerts are off' : `next check ${until(watch.next_poll_at)}`}</p>
    <Outcome message={message} />
    {failing ? <div className="st-banner error" role="status">The last check failed {ago(failing.at)}: {failing.message}. Earlier findings are kept.</div> : null}
    {error ? <p className="st-error">{error}</p> : null}
    {data && !data.items.length ? <p className="st-empty">No findings yet. Matches from the last 30 days and anything new will show here.</p> : null}
    {!data && !error ? <p className="st-empty">Loading findings.</p> : null}
    <ol className="st-findings">
      {data?.items.map((finding, index) => <Finding key={finding.id} finding={finding} rank={index + 1} watch={watch} focal={focus ? finding.id === focus : index === 0} may={may} onChange={onChange} />)}
    </ol>
  </>
}

/** The short reasons a row shows; the full sentence of each stays in its tooltip. */
function chipsFor(finding: FindingView): Array<{ label: string; title: string }> {
  const chips: Array<{ label: string; title: string }> = []
  for (const reason of finding.reason_details) {
    if (reason.factor === 'matched_terms' && reason.points > 0) chips.push({ label: finding.transcript_match && /episode transcript:/.test(reason.label) ? 'matches the transcript' : 'matches your terms', title: reason.label })
    else if (reason.factor === 'question' && reason.points > 0) chips.push({ label: reason.points >= reason.max ? 'asks a question' : 'asks for help', title: reason.label })
    else if (reason.factor === 'venue_fit' && !/no venue fit/.test(reason.label) && reason.points >= reason.max / 2) chips.push({ label: finding.venue ? `fits ${finding.venue.name}` : 'fits a venue', title: reason.label })
    else if (reason.factor === 'author_standing' && !/unknown/.test(reason.label) && reason.points >= reason.max * 0.6) chips.push({ label: 'known author', title: reason.label })
    else if (reason.factor === 'freshness' && reason.points >= reason.max * 0.6) chips.push({ label: 'fresh', title: reason.label })
  }
  for (const mention of finding.mentions.slice(0, 2)) chips.push({ label: `names ${mention.kind === 'product' ? mention.product : mention.matched}`, title: mention.kind === 'product' ? 'One of your products' : 'A competitor you track' })
  return chips
}

function Finding({ finding, rank, watch, focal, may, onChange }: { finding: FindingView; rank: number; watch: WatchView; focal: boolean; may: boolean; onChange(): Promise<void> }) {
  const { run } = useRun()
  return <li className={focal ? 'st-finding focal' : 'st-finding'} id={`finding-${finding.id}`}>
    <span className="st-numeral" aria-hidden="true">{rank}</span>
    <div className="st-finding-body">
      <h3>{finding.title || finding.text.slice(0, 100)}</h3>
      <div className="st-meta">{KINDS[finding.source] ?? finding.source} · {ago(finding.published_at)}{finding.author ? ` · ${finding.author}` : ''}{finding.points !== null && finding.source === 'hn' ? ` · ${finding.points} points` : ''}</div>
      <ul className="st-chips" aria-label="Why it ranks here">
        {chipsFor(finding).map(chip => <li className="st-chip" key={chip.label} title={chip.title}>{chip.label}</li>)}
        {finding.routes.filter(route => route !== 'dismiss').slice(0, 1).map(route => <li className="st-chip route" key={route}>{ROUTES[route]}</li>)}
        {finding.backfill ? <li className="st-chip quiet">from the last 30 days</li> : null}
      </ul>
      <div className="st-finding-actions">
        <a className={focal ? 'st-button primary st-open' : 'st-open-link'} href={finding.url} target="_blank" rel="noopener noreferrer">Open thread ↗</a>
      </div>
    </div>
    {may ? <MoreMenu items={[
      { label: watch.muted ? 'Unmute watch' : 'Mute watch', run: async () => { await run(() => runAction('stump.watches.manage', { action: 'mute', watch_id: watch.id, muted: !watch.muted, idempotency_key: key() })); await onChange() } },
      ...(finding.author ? [{ label: 'Block author', run: async () => { await run(() => runAction('stump.watches.manage', { action: 'block_author', watch_id: watch.id, handle: finding.author, source: finding.source, idempotency_key: key() })); await onChange() } }] : []),
      ...(finding.routes.includes('dismiss') ? [{ label: 'Dismiss', run: async () => { await run(() => runAction('stump.findings.work', { action: 'dismiss', finding_id: finding.id, idempotency_key: key() })); await onChange() } }] : []),
    ]} /> : <span />}
  </li>
}

/** The row's one menu (the design keeps Mute, Block author and Dismiss here, not printed in the row). */
function MoreMenu({ items }: { items: Array<{ label: string; run(): Promise<void> }> }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="st-more" ref={box}>
    <Tip label="More actions"><button type="button" className="st-more-button" aria-haspopup="menu" aria-expanded={open} aria-label="More actions" onClick={() => setOpen(!open)}>⋯</button></Tip>
    {open ? <div className="st-menu" role="menu">{items.map(item => <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); void item.run() }}>{item.label}</button>)}</div> : null}
  </div>
}

type HnTypes = 'both' | 'ask_show' | 'stories' | 'keep'
interface Draft {
  name: string; all: string; any: string; none: string
  hn: boolean; hnTypes: HnTypes; feeds: string; bluesky: boolean; mastodon: Array<{ instance: string; hashtags: string }>
  interval: number; minRelevance: number; slack: string; webhookUrl: string; webhookSecret: string
}
const list = (text: string) => text.split(/[,\n]/).map(item => item.trim()).filter(Boolean)
const same = (a: string[] | undefined, b: string[]) => !!a && a.length === b.length && b.every(item => a.includes(item))
function draftOf(watch?: WatchView): Draft {
  const hn = watch?.sources.find(source => source.kind === 'hn'), types = hn?.story_types
  return {
    name: watch?.name ?? '', all: (watch?.terms.all ?? []).join(', '), any: (watch?.terms.any ?? []).join(', '), none: (watch?.terms.none ?? []).join(', '),
    hn: watch ? !!hn : true, hnTypes: !types ? 'both' : same(types, ['ask_hn', 'show_hn']) ? 'ask_show' : same(types, ['story']) ? 'stories' : same(types, ['story', 'comment']) ? 'both' : 'keep',
    feeds: (watch?.sources.filter(source => source.kind === 'rss').map(source => source.url) ?? []).join('\n'), bluesky: watch ? watch.sources.some(source => source.kind === 'bluesky') : false,
    mastodon: watch?.sources.filter(source => source.kind === 'mastodon').map(source => ({ instance: source.instance ?? '', hashtags: (source.hashtags ?? []).join(', ') })) ?? [],
    interval: watch?.interval_minutes ?? 15, minRelevance: watch?.alerts?.immediate_min_relevance ?? 60, slack: '', webhookUrl: '', webhookSecret: '',
  }
}

function Editor({ watch, role, blocked = [], onDone, onCancel }: { watch?: WatchView; role: string; blocked?: BlockedAuthor[]; onDone(id: string): Promise<void>; onCancel(): void }) {
  const [draft, setDraft] = useState(() => draftOf(watch))
  const { busy, message, run } = useRun()
  const admin = role === 'owner' || role === 'admin'
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft(current => ({ ...current, [field]: value }))
  async function submit(event: FormEvent) {
    event.preventDefault()
    const original = watch?.sources.find(source => source.kind === 'hn')
    const sources = [
      ...(draft.hn ? [{ kind: 'hn', ...(draft.hnTypes === 'ask_show' ? { story_types: ['ask_hn', 'show_hn'] } : draft.hnTypes === 'stories' ? { story_types: ['story'] } : draft.hnTypes === 'keep' && original?.story_types ? { story_types: original.story_types } : {}) }] : []),
      ...list(draft.feeds).map(url => ({ kind: 'rss', url })),
      ...(draft.bluesky ? [{ kind: 'bluesky', ...(watch?.sources.find(source => source.kind === 'bluesky')?.lang ? { lang: watch.sources.find(source => source.kind === 'bluesky')!.lang } : {}) }] : []),
      ...draft.mastodon.filter(row => row.instance.trim()).map(row => ({ kind: 'mastodon', instance: row.instance.trim(), hashtags: list(row.hashtags) })),
    ]
    const terms = { all: list(draft.all), any: list(draft.any), none: list(draft.none) }
    const alerts = { immediate_min_relevance: draft.minRelevance,
      ...(admin && draft.slack.trim() ? { slack: { webhook_url: draft.slack.trim() } } : {}),
      ...(admin && (draft.webhookUrl.trim() || draft.webhookSecret) ? { webhook: { ...(draft.webhookUrl.trim() ? { url: draft.webhookUrl.trim() } : {}), ...(draft.webhookSecret ? { secret: draft.webhookSecret } : {}) } } : {}) }
    const saved = await run(() => runAction<WatchView>('stump.watches.manage', { action: watch ? 'update' : 'create', ...(watch ? { watch_id: watch.id } : {}), idempotency_key: key(), name: draft.name, terms, sources, alerts, interval_minutes: draft.interval }))
    if (saved) await onDone(saved.id)
  }
  async function remove(channel: 'slack' | 'webhook') {
    if (!watch) return
    const done = await run(() => runAction('stump.watches.manage', { action: 'update', watch_id: watch.id, idempotency_key: key(), alerts: { [channel]: {} } }), () => 'Removed.')
    if (done !== undefined) await onDone(watch.id)
  }
  async function unblock(author: BlockedAuthor) {
    if (!watch) return
    const done = await run(() => runAction('stump.watches.manage', { action: 'unblock_author', handle: author.handle, ...(author.source ? { source: author.source } : {}), idempotency_key: key() }), () => 'Unblocked. Their posts count from the next check.')
    if (done !== undefined) await onDone(watch.id)
  }
  return <form className="st-editor" onSubmit={submit} aria-label={watch ? 'Edit watch' : 'New watch'}>
    <div className="st-card-head"><h2>{watch ? 'Edit watch' : 'New watch'}</h2></div>
    <label className="st-field">Name<input value={draft.name} onChange={event => set('name', event.target.value)} required maxLength={120} autoComplete="off" /></label>
    <fieldset>
      <legend>What to look for</legend>
      <label className="st-field">Must include all of<input value={draft.all} onChange={event => set('all', event.target.value)} placeholder="orbit, crm" autoComplete="off" /></label>
      <label className="st-field">Include any of<input value={draft.any} onChange={event => set('any', event.target.value)} autoComplete="off" /></label>
      <label className="st-field">Never include<input value={draft.none} onChange={event => set('none', event.target.value)} placeholder="orbital" autoComplete="off" /></label>
      <span className="st-note">Separate terms with commas. A term with spaces is an exact phrase.</span>
    </fieldset>
    <fieldset>
      <legend>Where to look</legend>
      <div className="st-source-box">
        <label className="st-check"><input type="checkbox" checked={draft.hn} onChange={event => set('hn', event.target.checked)} />Hacker News</label>
        {draft.hn ? <label className="st-field">Which items<select value={draft.hnTypes} onChange={event => set('hnTypes', event.target.value as HnTypes)}>
          <option value="both">Stories and comments</option><option value="ask_show">Ask HN and Show HN stories only</option><option value="stories">Stories only</option>{draft.hnTypes === 'keep' ? <option value="keep">As set before</option> : null}
        </select></label> : null}
      </div>
      <div className="st-source-box">
        <label className="st-field">Feeds, one address per line<textarea value={draft.feeds} onChange={event => set('feeds', event.target.value)} rows={3} autoComplete="off" spellCheck={false}
          style={{ font: 'inherit', border: '1px solid var(--stump-field)', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box', width: '100%' }} /></label>
        <span className="st-note">Blogs, newsletters, podcasts, GitHub releases and Google Alerts feeds. Reddit is not a source.</span>
      </div>
      <div className="st-source-box"><label className="st-check"><input type="checkbox" checked={draft.bluesky} onChange={event => set('bluesky', event.target.checked)} />Bluesky search</label></div>
      <div className="st-source-box">
        <strong>Mastodon hashtags</strong>
        {draft.mastodon.map((row, index) => <div className="st-form" key={index}>
          <label className="st-field">Instance<input value={row.instance} placeholder="mastodon.social" onChange={event => set('mastodon', draft.mastodon.map((item, at) => at === index ? { ...item, instance: event.target.value } : item))} autoComplete="off" /></label>
          <label className="st-field">Hashtags<input value={row.hashtags} placeholder="crm, saas" onChange={event => set('mastodon', draft.mastodon.map((item, at) => at === index ? { ...item, hashtags: event.target.value } : item))} autoComplete="off" /></label>
          <button className="st-button" type="button" onClick={() => set('mastodon', draft.mastodon.filter((_, at) => at !== index))}>Remove instance</button>
        </div>)}
        <div><button className="st-button" type="button" onClick={() => set('mastodon', [...draft.mastodon, { instance: '', hashtags: '' }])}>Add an instance</button></div>
      </div>
    </fieldset>
    <fieldset>
      <legend>Alerts</legend>
      <div className="st-form">
        <label className="st-field">Alert right away from relevance<input type="number" min={0} max={100} value={draft.minRelevance} onChange={event => set('minRelevance', Number(event.target.value))} /></label>
        <label className="st-field">Check every<select value={draft.interval} onChange={event => set('interval', Number(event.target.value))}>{[5, 15, 30, 60, 240].map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`}</option>)}</select></label>
      </div>
      {admin ? <>
        {watch?.alerts?.slack ? <div className="st-actions"><span>Slack alerts go to {watch.alerts.slack.host}.</span><button className="st-button" type="button" disabled={busy} onClick={() => void remove('slack')}>Remove Slack alerts</button></div> : null}
        <label className="st-field">{watch?.alerts?.slack ? 'Replace the Slack incoming webhook' : 'Slack incoming webhook'}<input value={draft.slack} onChange={event => set('slack', event.target.value)} type="password" autoComplete="off" placeholder="https://hooks.slack.com/services/…" /></label>
        {watch?.alerts?.webhook ? <div className="st-actions"><span>Signed webhook alerts go to {watch.alerts.webhook.host}.</span><button className="st-button" type="button" disabled={busy} onClick={() => void remove('webhook')}>Remove webhook</button></div> : null}
        <div className="st-form">
          <label className="st-field">{watch?.alerts?.webhook ? 'Replace the webhook address' : 'Signed webhook address'}<input value={draft.webhookUrl} onChange={event => set('webhookUrl', event.target.value)} autoComplete="off" /></label>
          <label className="st-field">{watch?.alerts?.webhook ? 'Replace the signing secret' : 'Signing secret'}<input value={draft.webhookSecret} onChange={event => set('webhookSecret', event.target.value)} type="password" autoComplete="new-password" /></label>
        </div>
        <span className="st-note">Addresses and secrets are stored sealed and never shown again.</span>
      </> : <span className="st-note">Owners and admins set Slack and webhook alerts.</span>}
    </fieldset>
    {watch && blocked.length ? <fieldset>
      <legend>Blocked authors</legend>
      <span className="st-note">Blocked on every watch.</span>
      <div className="st-blocked">{blocked.map(author => <button className="st-button" type="button" key={`${author.source ?? ''}:${author.handle}`} disabled={busy} onClick={() => void unblock(author)}>{author.handle}{author.source ? ` on ${KINDS[author.source]}` : ''} · Unblock</button>)}</div>
    </fieldset> : null}
    <Outcome message={message} />
    <div className="st-actions">
      <button className="st-button primary" type="submit" disabled={busy}>{watch ? 'Save watch' : 'Create watch'}</button>
      <button className="st-button" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>
}
