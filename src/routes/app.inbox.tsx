import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import type { Account, Flag } from '../stump/drafting/view.ts'
import { flagLine, networkName } from '../stump/drafting/view.ts'
import type { InboxView } from '../stump/inbox/store.ts'
import { inboxStyles } from '../stump/inbox/styles.ts'
import { ActionError, explain, me, runAction } from '../stump/ui/api.ts'
import { Icon } from '../stump/ui/icons.tsx'
import { Chip, Empty, Initials, Outcome, Tip, useLoaded, useRun } from '../stump/ui/kit.tsx'

export const Route = createFileRoute('/app/inbox')({
  validateSearch: (search: Record<string, unknown>): { account?: string; item?: string } => ({
    ...(typeof search.account === 'string' ? { account: search.account } : {}), ...(typeof search.item === 'string' ? { item: search.item } : {}),
  }),
  component: InboxPage,
})

interface Inbox { items: InboxView[]; total: number; last_poll: { at: string | null; reads: number; charge_usd: number; error: { message?: string } | null } | null }
interface Checked { passed: boolean; flags: Flag[]; may_reply: boolean; charge_usd: number }
interface Replied { state: string; posted: boolean; url: string | null; ledger_id: string | null; text: string | null; step?: string; hold: { reason?: string } | null; error: { message?: string } | null; flags: Flag[] }

const key = () => crypto.randomUUID()
const plain = (error: unknown) => error instanceof ActionError && typeof error.fields.reason === 'string' ? error.fields.reason : explain(error)
const at = (iso: string | null) => iso ? new Date(iso) : null
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** A time on today's posts, "Yesterday", else the date. */
function shortTime(iso: string | null) {
  const date = at(iso)
  if (!date) return ''
  const now = new Date(), yesterday = new Date(now.getTime() - 86_400_000)
  if (sameDay(date, now)) return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date)
  if (sameDay(date, yesterday)) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}
/** An open item's time: "12:10 PM" today, "Yesterday, 4:10 PM", else "Oct 28, 4:10 PM". */
function longTime(iso: string | null) {
  const date = at(iso)
  if (!date) return ''
  const now = new Date(), clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  if (sameDay(date, now)) return clock
  if (sameDay(date, new Date(now.getTime() - 86_400_000))) return `Yesterday, ${clock}`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}
const handle = (value: string | null) => value ? `@${value}` : 'Someone'
const usd = (value: number) => Math.round(value * 100) === value * 100 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`
/** The post as a person reads it: X writes a reply's leading @handles before its words. */
const shown = (text: string) => text.replace(/^(?:@[A-Za-z0-9_]+\s+)+/, '') || text
const did = (item: InboxView) => item.kind === 'reply' ? 'Replied' : item.kind === 'quote' ? 'Quoted you' : 'Mentioned you'

function InboxPage() {
  const search = Route.useSearch(), navigate = useNavigate({ from: '/app/inbox' })
  const context = useLoaded(async () => {
    const [who, accounts] = await Promise.all([me(), runAction<{ items: Account[] }>('stump.accounts.connect', { action: 'list' })])
    return { who, accounts: accounts.items.filter(account => account.network === 'x' && account.state === 'connected') }
  })
  const accounts = context.data?.accounts ?? []
  const account = accounts.find(item => item.id === search.account) ?? accounts[0] ?? null
  const inbox = useLoaded(async () => account ? runAction<Inbox>('stump.inbox.read', { action: 'list', account_id: account.id }) : null)
  const accountId = account?.id, refreshInbox = inbox.refresh
  useEffect(() => { void refreshInbox() }, [accountId, refreshInbox])
  const { busy, message, run } = useRun()
  const role = context.data?.who.person.role ?? 'viewer'
  const mayAct = ['owner', 'admin', 'editor'].includes(role)
  const items = (inbox.data?.items ?? []).filter(item => item.kind !== 'thread')
  const open = items.find(item => item.id === search.item) ?? null
  const current = open ?? items[0] ?? null
  const choose = (id: string | null) => void navigate({ search: { ...(account ? { account: account.id } : {}), ...(id ? { item: id } : {}) } })

  async function poll() {
    if (!account) return
    await run(() => runAction<{ added: number; reads: number; charge_usd: number }>('stump.inbox.read', { action: 'poll', account_id: account.id, idempotency_key: key() }),
      done => done.added ? `${done.added} new · read ${done.reads} ${done.reads === 1 ? 'post' : 'posts'} for ${usd(done.charge_usd)}` : `Nothing new · ${done.reads ? `read ${done.reads} for ${usd(done.charge_usd)}` : 'no charge'}`)
    await inbox.refresh()
  }

  const last = inbox.data?.last_poll
  return <HydrationUnit>
    <style>{inboxStyles}</style>
    <section className={open ? 'st-page st-inbox reading' : 'st-page st-inbox'} aria-labelledby="inbox-title">
      <h1 id="inbox-title">Inbox</h1>
      <p className="st-lead">Replies and mentions across your accounts</p>
      {context.error ? <p className="st-error">{context.error}</p> : null}
      {context.data && !account ? <Empty title="Connect the company's X account" actions={<a className="st-button primary" href="/app/settings/accounts">Connect an account</a>}>
        Mentions of the account and replies to its posts arrive here, and you answer the people who engaged first.</Empty> : null}
      {account ? <>
        <div className="st-inbox-bar">
          <span className="st-meta">{accounts.length > 1
            ? <select className="st-select" aria-label="Account" value={account.id} onChange={event => void navigate({ search: { account: event.target.value } })}>
              {accounts.map(item => <option key={item.id} value={item.id}>@{item.handle} · {networkName(item.network)}</option>)}</select>
            : <>@{account.handle} · {networkName(account.network)}</>}
            {last?.at ? ` · checked ${shortTime(last.at)}` : ''}{last?.error?.message ? ` · last check stopped: ${last.error.message}` : ''}</span>
          {/* At phone width Check for new is a refresh icon at the meta line's right, with its words as the tooltip. */}
          {mayAct ? <button className="st-button quiet st-inbox-check" type="button" disabled={busy} onClick={() => void poll()}>Check for new</button> : null}
          {mayAct ? <Tip label="Check for new" align="end" className="st-inbox-check-icon"><button className="st-icon-button" type="button" aria-label="Check for new" disabled={busy} onClick={() => void poll()}><Icon name="refresh" /></button></Tip> : null}
        </div>
        <Outcome message={message} />
        {inbox.error ? <p className="st-error">{inbox.error}</p> : null}
        {inbox.data && !items.length ? <Empty title={`Nothing has reached @${account.handle} yet`}>Mentions and replies arrive here when you check for new ones.</Empty> : null}
        {items.length ? <div className="st-inbox-grid">
          <ul className="st-inbox-list" aria-label="Mentions and replies">{items.map(item => <li key={item.id}>
            {/* The item on the right is the selected row; with none opened, a phone shows the list alone and selects nothing. */}
            <button type="button" className={open ? 'st-inbox-row' : 'st-inbox-row st-inbox-first'} aria-current={current?.id === item.id ? 'true' : undefined} onClick={() => choose(item.id)}>
              <span className={item.may_reply && !item.reply ? 'st-dot' : 'st-dot off'} aria-hidden="true" />
              <span className="st-inbox-handle">{handle(item.author)}{item.may_reply && !item.reply ? <span className="st-visually-hidden">, waiting for a reply</span> : null}</span>
              <span className="st-inbox-time">{shortTime(item.occurred_at)}</span>
              <span className="st-inbox-line">{shown(item.text)}</span>
            </button>
          </li>)}</ul>
          {current ? <Item key={current.id} item={current} account={account} mayAct={mayAct} onBack={() => choose(null)} onChange={() => inbox.refresh()} /> : null}
        </div> : null}
      </> : null}
    </section>
  </HydrationUnit>
}

function Item({ item, account, mayAct, onBack, onChange }: { item: InboxView; account: Account; mayAct: boolean; onBack(): void; onChange(): Promise<void> }) {
  const reply = item.reply, posted = !!reply && ['posted', 'posting', 'scheduled', 'partly_posted', 'uncertain'].includes(reply.state)
  const [text, setText] = useState(reply && !posted ? reply.text ?? '' : '')
  const [checked, setChecked] = useState<Checked | null>(null)
  const { busy, message, run } = useRun()
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)

  // The claim, disclosure and near-duplicate checks as the person types, before anything is written.
  useEffect(() => {
    if (!mayAct || !item.may_reply || !text.trim()) { setChecked(null); return }
    const timer = setTimeout(() => {
      runAction<Checked>('stump.inbox.read', { action: 'check', inbox_item_id: item.id, account_id: account.id, text }).then(setChecked, () => setChecked(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [text, item.id, item.may_reply, account.id, mayAct])

  async function send(generate: boolean) {
    setNote(null)
    const done = await run(() => runAction<Replied>('stump.inbox.reply', { action: 'reply', inbox_item_id: item.id, account_id: account.id, idempotency_key: key(), ...(generate ? { generate: true } : { text }) }))
    if (!done) return
    if (done.step) { setText(done.text ?? ''); setNote({ text: 'X asks for its approval before an app posts AI-drafted replies, and it is not recorded for the company. Rewrite this in your own words, then reply.', error: false }) }
    else if (done.posted) { setText(''); setNote({ text: 'Replied. It is on the ledger.', error: false }) }
    else if (done.hold?.reason === 'near_duplicate') setNote({ text: 'Held: it nearly repeats an earlier post. Rewrite it to send.', error: true })
    else setNote({ text: done.error?.message ? `${networkName(account.network)} did not post it: ${done.error.message}` : `Not posted (${done.state}).`, error: true })
    await onChange()
  }
  async function toOrbit() {
    if (!item.offer) return
    await run(() => runAction<{ sent: boolean; outcome: { error?: string } | null }>('stump.stack.send', { action: 'send', offer_id: item.offer!.id, idempotency_key: key() }),
      done => done.sent ? `Sent ${handle(item.author)} to Orbit.` : `Not sent: ${done.outcome?.error ?? 'try again'}`)
    await onChange()
  }

  const blocking = checked?.flags.filter(flag => flag.blocking) ?? []
  const parent = item.company_post ?? null, thread = item.thread
  const offerError = (item.offer?.outcome as { ok?: boolean; error?: string } | null)
  return <article className="st-inbox-open" aria-labelledby={`inbox-${item.id}`}>
    <button type="button" className="st-inbox-back" onClick={onBack}><Icon name="arrowRight" />Inbox</button>
    <header className="st-inbox-who">
      <Initials name={item.author ?? '?'} />
      <div><div className="st-name" id={`inbox-${item.id}`}>{handle(item.author)}</div>
        <div className="st-meta">{did(item)} on {networkName(item.network)} · {longTime(item.occurred_at)}</div></div>
    </header>
    {parent ? <div className="st-inbox-quote">
      <div className="st-inbox-quote-head"><span className="st-name">@{account.handle}</span>{parent.url ? <a className="st-meta" href={parent.url} target="_blank" rel="noreferrer noopener">Your post ↗</a> : null}</div>
      <p>{parent.text ?? 'A post of the account\'s, from before Stump.'}</p>
    </div> : thread ? <div className="st-inbox-quote">
      <div className="st-inbox-quote-head"><span className="st-name">{handle(thread.author)}</span><span className="st-meta">In a thread they started</span></div>
      {thread.text ? <p>{thread.text}</p> : null}
    </div> : null}
    <p className="st-inbox-text">{shown(item.text)}</p>
    <div className="st-meta"><a href={item.url} target="_blank" rel="noreferrer noopener">View on {networkName(item.network)} ↗</a>{item.engagement ? ` · ${item.engagement}` : ''}</div>
    <hr className="st-inbox-rule" />
    {posted && reply ? <div className="st-inbox-reply">
      <div className="st-meta">Your reply · {reply.state === 'posted' ? 'posted' : reply.state.replace(/_/g, ' ')}{reply.charge_usd ? ` · ${usd(reply.charge_usd)}` : ''}</div>
      <p>{reply.text}</p>
      <div className="st-meta">{reply.url ? <a href={reply.url} target="_blank" rel="noreferrer noopener">View reply ↗</a> : null}{reply.ledger_id ? <> · <a href={`/app/ledger?entry=${encodeURIComponent(reply.ledger_id)}`}>On the ledger</a></> : null}</div>
    </div> : null}
    {!item.engaged_first ? <p className="st-note">{handle(item.author)} has not engaged with @{account.handle}, so the account does not reply here. Answer in the {networkName(item.network)} app yourself if it fits.</p> : null}
    {item.may_reply && mayAct ? <div className="st-inbox-compose">
      <label className="st-visually-hidden" htmlFor={`reply-${item.id}`}>Reply to {handle(item.author)}</label>
      <textarea id={`reply-${item.id}`} placeholder="Write a reply…" value={text} maxLength={4000} onChange={event => setText(event.target.value)} />
      {reply?.hold && !posted && reply.state === 'held' ? <p className="st-note">{reply.hold && (reply.hold as { reason?: string }).reason === 'near_duplicate' ? 'Held: it nearly repeats an earlier post. Rewrite it to send.' : 'Held at X\'s approval step for AI-drafted replies. Write your own reply to send.'}</p> : null}
      {checked ? <ul className="st-inbox-checks" aria-label="Checks">
        {blocking.length ? blocking.map((flag, index) => <li key={`${flag.code}-${index}`} className="bad">{flagLine(flag)}
          {/* A missing disclosure offers the person's line, added at the start of the reply in one click. */}
          {flag.code === 'disclosure_missing' && typeof flag.line === 'string'
            ? <button className="st-inbox-add-line" type="button" onClick={() => setText(`${String(flag.line)} ${text}`.trim())}>Add line</button> : null}</li>)
          : <li className="ok">Claims, disclosure and repeats check out{account.network === 'x' && checked.charge_usd ? ` · X charges ${usd(checked.charge_usd)}` : ''}</li>}
      </ul> : null}
      {text.length ? <span className="st-meta st-inbox-count">{[...new Intl.Segmenter().segment(text)].length}{'\u00a0'}characters</span> : null}
    </div> : null}
    {item.offer?.state === 'sent' ? <div><Chip tone="success" tick>Sent to Orbit</Chip></div> : null}
    {offerError?.ok === false && item.offer?.state !== 'sent' ? <p className="st-error">Last send to Orbit failed: {offerError.error ?? 'try again'}</p> : null}
    {mayAct && (item.may_reply || (item.offer && item.offer.state !== 'sent')) ? <div className="st-inbox-actions">
      {item.may_reply ? <button className="st-button primary" type="button" disabled={busy || !text.trim() || blocking.length > 0} onClick={() => void send(false)}>Reply</button> : null}
      {item.offer && item.offer.state !== 'sent' ? <button className="st-button quiet" type="button" disabled={busy} onClick={() => void toOrbit()}>Send to Orbit</button> : null}
      {item.may_reply ? <button className="st-button quiet st-inbox-ai" type="button" disabled={busy} onClick={() => void send(true)}>Draft with AI</button> : null}
    </div> : null}
    <Outcome message={note ?? message} />
  </article>
}
