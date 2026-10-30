import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { ActionError, explain, me, runAction } from '../stump/ui/api.ts'
import { Icon } from '../stump/ui/icons.tsx'
import { MoreMenu, Outcome, accountWord, useLoaded, useRun } from '../stump/ui/kit.tsx'
import { flagLine, type Flag } from '../stump/drafting/view.ts'
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
  const watches = useLoaded(async () => {
    const who = await me()
    const [list, products, targets] = await Promise.all([runAction<WatchList>('stump.watches.manage', { action: 'list' }),
      runAction<{ items: Array<{ id: string; name: string }> }>('stump.brand.manage', { action: 'product_list' }).catch(() => ({ items: [] })),
      who.actions.includes('stump.drafts.preview') ? runAction<{ items: Account[] }>('stump.drafts.preview', { action: 'targets' }).catch(() => ({ items: [] as Account[] })) : Promise.resolve({ items: [] as Account[] })])
    return { me: who, list, products: products.items, accounts: targets.items }
  })
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
                <span className="st-watch-mark" aria-hidden="true">{watch.id === selected?.id ? <Icon name="check" /> : null}</span>
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
            context={{ me: watches.data?.me.person.id ?? '', role, products: watches.data?.products ?? [], accounts: watches.data?.accounts ?? [] }}
            onFocus={id => void navigate({ search: { ...(selected ? { watch: selected.id } : {}), finding: id } })}
            onEdit={() => setEditing('edit')} onChange={reload} /> : null}
        </div>
      </div>
    </section>
  </HydrationUnit>
}

interface Account { id: string; network: string; handle: string; display_name: string | null; state: string }
/** What a finding's action needs: who is acting, the products and the accounts that can reply. */
interface Context { me: string; role: string; products: Array<{ id: string; name: string }>; accounts: Account[] }

function Findings({ watch, data, error, focus, may, context, onFocus, onEdit, onChange }: { watch: WatchView | null; data: FindingList | null; error: string | null; focus?: string; may: boolean; context: Context; onFocus(id: string): void; onEdit(): void; onChange(): Promise<void> }) {
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
      {data?.items.map((finding, index) => <Finding key={finding.id} finding={finding} rank={index + 1} watch={watch} focal={focus ? finding.id === focus : index === 0} may={may} context={context}
        onFocus={() => onFocus(finding.id)} onChange={onChange} />)}
    </ol>
  </>
}

/** The reasons worth a chip (H16): a question, a fit with a product or venue, freshness, a product or competitor named. Matching the watch's terms and coming from the backfill are every finding's default, so they show nothing. */
function chipsFor(finding: FindingView, watch: WatchView, products: Context['products']): Array<{ label: string; title: string }> {
  const chips: Array<{ label: string; title: string }> = []
  const product = products.find(item => watch.product_ids.includes(item.id))
  for (const reason of finding.reason_details) {
    if (reason.factor === 'question' && reason.points > 0) chips.push({ label: reason.points >= reason.max ? 'asks a question' : 'asks for help', title: reason.label })
    else if (reason.factor === 'matched_terms' && reason.points > 0 && product) chips.push({ label: `fits ${product.name}`, title: reason.label })
    else if (reason.factor === 'venue_fit' && !/no venue fit/.test(reason.label) && reason.points >= reason.max / 2 && finding.venue) chips.push({ label: `fits ${finding.venue.name}`, title: reason.label })
    else if (reason.factor === 'freshness' && reason.points >= reason.max * 0.6) chips.push({ label: 'fresh', title: reason.label })
  }
  for (const mention of finding.mentions.slice(0, 2)) chips.push({ label: `names ${mention.kind === 'product' ? mention.product : mention.matched}`, title: mention.kind === 'product' ? 'One of your products' : 'A competitor you track' })
  const rank = (label: string) => /^asks/.test(label) ? 0 : /^fits/.test(label) ? 1 : label === 'fresh' ? 2 : 3
  return chips.filter((chip, index) => chips.findIndex(other => other.label === chip.label) === index).sort((a, b) => rank(a.label) - rank(b.label)).slice(0, 3)
}

/** A title cut at a word, never inside one. */
function wordClip(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const cut = clean.endsWith('…') ? clean.slice(0, -1).trimEnd() : clean
  if (cut.length <= max && !clean.endsWith('…')) return clean
  const head = cut.slice(0, max), space = head.lastIndexOf(' ')
  return `${(space > max * 0.5 ? head.slice(0, space) : head).replace(/[\s,.;:–—-]+$/, '')}…`
}

/** The one job a finding's route allows, as its primary action: reply from an account, or hand it to the member who posts there. */
const jobOf = (finding: FindingView) => finding.routes.includes('publish') ? 'reply' as const
  : finding.venue && finding.routes.includes('handoff_draft') ? 'handoff_draft' as const
  : finding.venue && finding.routes.includes('handoff_brief') ? 'handoff_brief' as const : null
const JOB_WORDS = { reply: 'Draft a reply', handoff_draft: 'Hand off with draft', handoff_brief: 'Hand off with brief' } as const

function Finding({ finding, rank, watch, focal, may, context, onFocus, onChange }: { finding: FindingView; rank: number; watch: WatchView; focal: boolean; may: boolean; context: Context; onFocus(): void; onChange(): Promise<void> }) {
  const { run } = useRun()
  const [working, setWorking] = useState(false)
  const job = context.role === 'viewer' ? null : jobOf(finding)
  const chips = chipsFor(finding, watch, context.products)
  const title = wordClip(finding.title || finding.text)
  return <li className={focal ? 'st-finding focal' : 'st-finding'} id={`finding-${finding.id}`}>
    <span className="st-numeral" aria-hidden="true">{rank}</span>
    <div className="st-finding-body">
      <h3>{focal ? title : <button type="button" className="st-finding-title" onClick={onFocus}>{title}</button>}</h3>
      <div className="st-meta">{KINDS[finding.source] ?? finding.source} · {ago(finding.published_at)}{finding.author ? ` · ${finding.author}` : ''}{finding.points !== null && finding.source === 'hn' ? ` · ${finding.points} points` : ''}</div>
      {chips.length ? <ul className="st-chips" aria-label="Why it ranks here">
        {chips.map(chip => <li className="st-chip" key={chip.label} title={chip.title}>{chip.label}</li>)}
      </ul> : null}
      <div className="st-finding-actions">
        {focal && job && !working ? <button type="button" className="st-button primary" onClick={() => setWorking(true)}>{JOB_WORDS[job]} <span aria-hidden="true">→</span></button> : null}
        <a className="st-open-link" href={finding.url} target="_blank" rel="noopener noreferrer">Open thread ↗</a>
      </div>
      {focal && working && job === 'reply' ? <ReplyForm finding={finding} context={context} onClose={() => setWorking(false)} /> : null}
      {focal && working && job && job !== 'reply' ? <HandOffForm finding={finding} watch={watch} context={context} onClose={() => setWorking(false)} /> : null}
    </div>
    {may ? <MoreMenu items={[
      { label: watch.muted ? 'Unmute watch' : 'Mute watch', run: async () => { await run(() => runAction('stump.watches.manage', { action: 'mute', watch_id: watch.id, muted: !watch.muted, idempotency_key: key() })); await onChange() } },
      ...(finding.author ? [{ label: 'Block author', run: async () => { await run(() => runAction('stump.watches.manage', { action: 'block_author', watch_id: watch.id, handle: finding.author, source: finding.source, idempotency_key: key() })); await onChange() } }] : []),
      ...(finding.routes.includes('dismiss') ? [{ label: 'Dismiss', run: async () => { await run(() => runAction('stump.findings.work', { action: 'dismiss', finding_id: finding.id, idempotency_key: key() })); await onChange() } }] : []),
    ]} /> : <span />}
  </li>
}

/** A reply from one of the company's accounts on the thread's network: drafted, checked, then posted (STUMP-DRAFT-001, the draft check, the publisher). */
function ReplyForm({ finding, context, onClose }: { finding: FindingView; context: Context; onClose(): void }) {
  const accounts = context.accounts.filter(account => account.network === finding.source && account.state === 'connected')
  const [account, setAccount] = useState(accounts[0]?.id ?? '')
  const [text, setText] = useState('')
  const [flags, setFlags] = useState<Flag[]>([])
  const [posted, setPosted] = useState<string | null>(null)
  const { busy, message, run } = useRun()
  if (!accounts.length) return <div className="st-finding-work"><p className="st-meta">Connect a {KINDS[finding.source]} account to reply from it. <a href={`/app/settings/accounts?connect=${finding.source}`}>Connect an account</a></p></div>
  async function send(event: FormEvent) {
    event.preventDefault()
    const chosen = accounts.find(item => item.id === account)!
    const draft = await run(() => runAction<{ id: string; flags: Flag[] }>('stump.drafts.write', { action: 'create', format: 'reply', person_id: context.me, account_id: chosen.id, network: chosen.network,
      reply_to: { url: finding.url }, text: text.trim(), ...(context.products[0] ? { product_id: context.products[0].id } : {}), idempotency_key: key() }))
    if (!draft) return
    const holding = draft.flags.filter(flag => flag.blocking)
    setFlags(holding)
    if (holding.length) return
    const out = await run(() => runAction<{ url?: string | null }>('stump.items.schedule', { action: 'publish', item_id: draft.id, account_id: chosen.id, idempotency_key: key() }), () => 'Replied. It is on the ledger.')
    if (out) setPosted(out.url ?? finding.url)
  }
  if (posted) return <div className="st-finding-work"><p className="st-note" role="status">Replied. It is on the <a href="/app/ledger">ledger</a>.</p></div>
  return <form className="st-finding-work" onSubmit={send} aria-label="Draft a reply">
    {accounts.length > 1 ? <label className="st-field">From<select value={account} onChange={event => setAccount(event.target.value)}>{accounts.map(item => <option key={item.id} value={item.id}>{accountWord(item)}</option>)}</select></label>
      : <p className="st-meta">From {accountWord(accounts[0]!)}</p>}
    <label className="st-field"><span className="st-sr">Your reply</span><textarea value={text} required maxLength={4000} rows={4} placeholder="Write a reply…" onChange={event => setText(event.target.value)} /></label>
    {flags.length ? <ul className="st-finding-flags">{flags.map((flag, index) => <li key={`${flag.code}-${index}`}>{flagLine(flag)}</li>)}</ul> : null}
    <Outcome message={message} />
    <div className="st-actions">
      <button className="st-button primary" type="submit" disabled={busy || !text.trim()}>Post reply</button>
      <button className="st-button quiet" type="button" onClick={onClose}>Cancel</button>
    </div>
  </form>
}

/** A hand-off to the venue's member who posts there by hand, with the thread and a due day; the brief opens next (STUMP-HANDOFF-001). */
function HandOffForm({ finding, watch, context, onClose }: { finding: FindingView; watch: WatchView; context: Context; onClose(): void }) {
  const venue = finding.venue!
  const navigate = useNavigate()
  const members = useLoaded(() => runAction<{ items: Array<{ person_id: string; display_name: string | null; eligible: boolean }> }>('stump.venues.members', { action: 'list', venue_id: venue.id }))
  const product = context.products.find(item => watch.product_ids.includes(item.id)) ?? context.products[0] ?? null
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const { busy, message, run } = useRun()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const due = new Date(`${String(form.get('due'))}T17:00:00`)
    const made = await run(() => runAction<{ id: string }>('stump.handoffs.prepare', { action: 'prepare', venue_id: venue.id, person_id: String(form.get('person')), product_id: product!.id,
      thread_url: finding.url, due_at: due.toISOString(), lapse: 'expire', idempotency_key: key() }))
    if (made) await navigate({ to: '/app/handoffs/$handoffId', params: { handoffId: made.id } })
  }
  if (!product) return <div className="st-finding-work"><p className="st-meta">Add your product first. <a href="/app/settings/brand">Brand</a></p></div>
  const people = members.data?.items ?? []
  if (members.data && !people.length) return <div className="st-finding-work"><p className="st-meta">No one on the team is a member of {venue.name} yet. <a href={`/app/venues/${venue.id}`}>Record a member</a></p></div>
  return <form className="st-finding-work" onSubmit={submit} aria-label="Hand off">
    <div className="st-form">
      <label className="st-field">Who posts in {venue.name}<select name="person" required defaultValue={people.find(person => person.eligible)?.person_id ?? people[0]?.person_id}>
        {people.map(person => <option key={person.person_id} value={person.person_id}>{person.display_name ?? 'Teammate'}{person.eligible ? '' : ' (not yet eligible)'}</option>)}</select></label>
      <label className="st-field">Due<input name="due" type="date" required defaultValue={tomorrow} min={new Date().toISOString().slice(0, 10)} /></label>
    </div>
    <Outcome message={message} />
    <div className="st-actions">
      <button className="st-button primary" type="submit" disabled={busy || !members.data}>Hand off <span aria-hidden="true">→</span></button>
      <button className="st-button quiet" type="button" onClick={onClose}>Cancel</button>
    </div>
  </form>
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
