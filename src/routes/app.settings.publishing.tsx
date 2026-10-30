import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Outcome, useLoaded, useRun, when } from '../stump/ui/kit.tsx'
import type { PauseState, Resumed, Team } from '../stump/ui/types.ts'
import { shownHandle } from '../stump/accounts/handle.ts'
import { pauseChanged } from '../stump/ui/pause.tsx'

export const Route = createFileRoute('/app/settings/publishing')({ component: PublishingPage })

const key = () => crypto.randomUUID()
const NAMES: Record<string, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon', x: 'X', linkedin: 'LinkedIn' }
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']] as const
const PRICE_LABELS = [['post', 'Post'], ['post_with_url', 'Post with a link'], ['read', 'Post read'], ['owned_read', 'Own post read']] as const

type Prices = Record<'post' | 'post_with_url' | 'read' | 'owned_read', number>
interface App { network: string; name: string; state: 'not_needed' | 'not_created' | 'connected'; steps: string[]; callback_urls: string[]; scopes: string[]
  keys: { client_id: string; client_secret: string; updated_at: string } | null; prices?: Prices }
interface Account { id: string; network: string; handle: string; state: string }
interface Slots { account_id: string; time_zone: string | null; slots: Array<{ days: string[]; times: string[] }>; upcoming: Array<{ at: string; taken: boolean }> }

function PublishingPage() {
  const { data, error, refresh } = useLoaded(async () => {
    const accounts = await runAction<{ items: Account[] }>('stump.accounts.connect', { action: 'list' })
    return {
      me: await me(),
      state: await runAction<PauseState>('stump.calendar.pause', { action: 'state' }),
      team: await runAction<Team>('stump.team.manage', { action: 'list' }).catch(() => ({ items: [], total: 0 }) as Team),
      apps: await runAction<{ items: App[] }>('stump.setup.apps', { action: 'list' }),
      accounts: accounts.items,
      slots: await Promise.all(accounts.items.filter(account => account.state === 'connected').map(account => runAction<Slots>('stump.calendar.plan', { action: 'slots', account_id: account.id }))),
    }
  })
  const { busy, message, run } = useRun()
  const [resumed, setResumed] = useState<Resumed | null>(null)
  const all = data?.state.paused.find(scope => scope.scope === 'all')
  const paused = data?.state.paused.filter(scope => scope.scope === 'account') ?? []
  const role = data?.me.person.role ?? 'viewer'
  const may = ['owner', 'admin', 'editor'].includes(role), admin = ['owner', 'admin'].includes(role)
  const name = (id: string) => data?.team.items.find(person => person.id === id)?.display_name ?? 'Someone who left'
  const handle = (id: string | null) => { const found = data?.accounts.find(account => account.id === id); return found ? shownHandle(found) : 'An account' }
  async function pause() {
    setResumed(null)
    const done = await run(() => runAction<{ paused_at: string }>('stump.calendar.pause', { action: 'pause', scope: 'all', idempotency_key: key() }), () => 'Paused. Nothing posts until you resume.')
    if (done) pauseChanged({ scope: { scope: 'all', account_id: null, person_id: data?.me.person.id ?? '', at: done.paused_at } })
    await refresh()
  }
  async function resume(scope: 'all' | 'account', account?: string | null) {
    const result = await run(() => runAction<Resumed>('stump.calendar.pause', { action: 'resume', scope, ...(account ? { account_id: account } : {}), idempotency_key: key() }), () => 'Resumed.')
    if (result) { setResumed(result); if (scope === 'all') pauseChanged({ resumed: 'all' }) }
    await refresh()
  }
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="publishing-title">
      <h1 id="publishing-title">Publishing</h1>
      <p className="st-lead">Pause everything for an incident, set up each network's app, and keep each account's queue.</p>
      {error ? <p className="st-error">{error}</p> : null}
      <div className="st-status">
        <div>
          <span className={all ? 'st-dot paused' : 'st-dot'} aria-hidden="true" />
          <strong>{data ? all ? 'All publishing is paused' : 'Publishing is on' : ' '}</strong>
          {all ? <div className="st-meta">Paused by {name(all.person_id)}, {when(all.at)}</div> : null}
        </div>
        {may && data ? all
          ? <button className="st-button primary" type="button" disabled={busy} onClick={() => void resume('all')}>Resume publishing</button>
          : <button className="st-button primary" type="button" disabled={busy} onClick={() => void pause()}>Pause all publishing</button> : null}
      </div>
      <Outcome message={message} />
      {resumed ? <div className="st-panel">
        <strong>{resumed.will_post.length} {resumed.will_post.length === 1 ? 'post goes' : 'posts go'} out at {resumed.will_post.length === 1 ? 'its' : 'their'} time</strong>
        <ul className="st-list">{resumed.will_post.map(item => <li className="st-row" key={item.item_id}><span className="st-meta">{when(item.scheduled_at)} · {handle(item.account_id)}</span></li>)}</ul>
        {resumed.held_overdue.length ? <p>{resumed.held_overdue.length} overdue {resumed.held_overdue.length === 1 ? 'post stays' : 'posts stay'} held until rescheduled or dropped.</p> : null}
      </div> : null}
      {data?.accounts.length ? <>
        <h2>Accounts</h2>
        <ul className="st-list">{data.accounts.map(account => {
          const scope = paused.find(item => item.account_id === account.id)
          return <li className="st-row" key={account.id}>
            <div className="st-row-main"><div className="st-name">{shownHandle(account)}</div>
              <div className="st-meta">{NAMES[account.network]} · {scope ? `paused by ${name(scope.person_id)}, ${when(scope.at)}` : 'publishing'}</div></div>
            {may ? scope
              ? <button className="st-button" type="button" disabled={busy} onClick={() => void resume('account', account.id)}>Resume</button>
              : <button className="st-button" type="button" disabled={busy}
                onClick={() => void run(() => runAction('stump.calendar.pause', { action: 'pause', scope: 'account', account_id: account.id, idempotency_key: key() }), () => `${shownHandle(account)} paused.`).then(refresh)}>Pause</button> : null}
          </li>
        })}</ul>
      </> : null}
      <h2>Network apps</h2>
      <ul className="st-list st-box">{data?.apps.items.map(app => <AppRow key={app.network} app={app} admin={admin} onSaved={() => void refresh()} />)}</ul>
      {data ? <QueueSlots accounts={data.accounts} slots={data.slots} onSaved={() => void refresh()} /> : null}
      <h2>History</h2>
      {data && !data.state.history.length ? <p className="st-meta">Publishing has never been paused.</p> : null}
      <ul className="st-list">{data?.state.history.map((entry, index) => <li className="st-row" key={`${entry.at}-${index}`}>
        <div className="st-row-main">
          <div className="st-name">{entry.action === 'pause' ? 'Paused' : 'Resumed'} {entry.scope === 'all' ? 'all publishing' : handle(entry.account_id)}</div>
          <div className="st-meta">{name(entry.person_id)}{entry.agent_id ? ' through an agent' : ''} · {when(entry.at)}</div>
        </div>
      </li>)}</ul>
    </section>
  </HydrationUnit>
}

const STATE_WORDS = { not_needed: 'No app needed', not_created: 'Not set up', connected: 'App keys set' } as const

function AppRow({ app, admin, onSaved }: { app: App; admin: boolean; onSaved(): void }) {
  const [open, setOpen] = useState(false)
  const { busy, message, run } = useRun()
  async function keys(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget, form = new FormData(element)
    const saved = await run(() => runAction('stump.setup.apps', { action: 'set', network: app.network, client_id: form.get('client_id'), client_secret: form.get('client_secret'), idempotency_key: key() }), () => 'Saved')
    if (saved) { element.reset(); onSaved() }
  }
  async function price(field: keyof Prices, value: string) {
    if (!app.prices || Number(value) === app.prices[field] || value.trim() === '') return
    const saved = await run(() => runAction('stump.setup.apps', { action: 'set_prices', network: 'x', prices: { ...app.prices, [field]: Number(value) }, idempotency_key: key() }), () => 'Saved')
    if (saved) onSaved()
  }
  return <li className="st-row st-stack">
    <button className="st-row-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="st-row-main"><span className="st-name st-handle">{app.name}</span>
        <span className="st-meta">{app.keys ? `Client ID ${app.keys.client_id}` : app.state === 'not_needed' ? 'Each person connects on the network\'s own screen' : 'The company\'s own developer app'}</span></span>
      <span className="st-state"><span className={app.state === 'not_created' ? 'st-dot off' : 'st-dot'} aria-hidden="true" />{STATE_WORDS[app.state]}</span>
      <span className="st-chevron" aria-hidden="true">›</span>
    </button>
    {open ? <div className="st-panel">
      <ol>{app.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <div className="st-meta">Callback URL</div>
      {app.callback_urls.map(url => <div className="st-secret" key={url}>{url}</div>)}
      <div className="st-meta st-spaced">Scopes: {app.scopes.join(' ')}</div>
      {admin && app.state !== 'not_needed' ? <form className="st-spaced" onSubmit={keys} aria-label={`${app.name} app keys`}>
        <div className="st-form">
          <label className="st-field">Client ID<input name="client_id" required maxLength={300} autoComplete="off" /></label>
          <label className="st-field">Client Secret<input name="client_secret" type="password" required maxLength={300} autoComplete="off" /></label>
        </div>
        <div className="st-actions st-spaced"><button className="st-button primary" type="submit" disabled={busy}>{app.keys ? 'Replace keys' : 'Set keys'}</button></div>
      </form> : null}
      {app.prices ? <div className="st-spaced">
        <div className="st-name">Price per call (USD)</div>
        <div className="st-form">{PRICE_LABELS.map(([field, label]) => <label className="st-field" key={field}>{label}
          <input type="number" min={0} step="0.000001" defaultValue={app.prices![field]} disabled={!admin || busy} onBlur={event => void price(field, event.target.value)} /></label>)}</div>
      </div> : null}
      <Outcome message={message} />
    </div> : null}
  </li>
}

function zones(): string[] {
  try { return (Intl as unknown as { supportedValuesOf(kind: string): string[] }).supportedValuesOf('timeZone') } catch { return ['UTC'] }
}

function QueueSlots({ accounts, slots, onSaved }: { accounts: Account[]; slots: Slots[]; onSaved(): void }) {
  const connected = accounts.filter(account => account.state === 'connected')
  if (!connected.length) return null
  return <>
    <h2>Queue slots</h2>
    <ul className="st-list st-box">{connected.map(account => <SlotRow key={account.id} account={account} slots={slots.find(item => item.account_id === account.id) ?? null} onSaved={onSaved} />)}</ul>
  </>
}

function SlotRow({ account, slots, onSaved }: { account: Account; slots: Slots | null; onSaved(): void }) {
  const { busy, message, run } = useRun()
  const first = slots?.slots[0]
  const [days, setDays] = useState<string[]>(first?.days ?? ['mon', 'tue', 'wed', 'thu', 'fri'])
  const [times, setTimes] = useState(first?.times.join(', ') ?? '')
  const [zone, setZone] = useState(slots?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  async function save(next: { days?: string[]; times?: string; zone?: string }) {
    const chosenDays = next.days ?? days, chosenTimes = (next.times ?? times).split(/[\s,]+/).filter(Boolean), chosenZone = next.zone ?? zone
    if (!chosenDays.length || !chosenTimes.length) return
    const saved = await run(() => runAction<Slots & { moved: unknown[] }>('stump.calendar.plan', { action: 'set_slots', account_id: account.id, time_zone: chosenZone,
      slots: [{ days: chosenDays, times: chosenTimes }], idempotency_key: key() }), done => done.moved.length ? `Saved. ${done.moved.length} queued ${done.moved.length === 1 ? 'post moved' : 'posts moved'} to the next open slot.` : 'Saved')
    if (saved) onSaved()
  }
  const [open, setOpen] = useState(false)
  const next = slots?.upcoming.find(slot => !slot.taken)
  const DAY_NAMES = Object.fromEntries(DAYS) as Record<string, string>
  const summary = first ? `${first.days.length === 5 && !first.days.some(day => day === 'sat' || day === 'sun') ? 'Weekdays' : first.days.map(day => DAY_NAMES[day]).join(', ')} ${first.times.join(', ')} · ${slots?.time_zone}` : 'No queue slots yet'
  return <li className="st-row st-stack">
    <button className="st-row-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="st-row-main"><span className="st-name st-handle">{shownHandle(account)}</span><span className="st-meta">{NAMES[account.network]} · {summary}</span></span>
      <span className="st-state">{next ? `next open ${when(next.at)}` : ''}</span>
      <span className="st-chevron" aria-hidden="true">›</span>
    </button>
    {open ? <div className="st-panel">
      <div className="st-form">
        <div className="st-field">Days<div className="st-days">{DAYS.map(([value, label]) => <label key={value}>
          <input type="checkbox" checked={days.includes(value)} disabled={busy}
            onChange={event => { const chosen = event.target.checked ? [...days, value] : days.filter(day => day !== value); setDays(chosen); void save({ days: chosen }) }} />{label}</label>)}</div></div>
        <label className="st-field">Times<input value={times} placeholder="09:00, 14:00" disabled={busy} onChange={event => setTimes(event.target.value)} onBlur={() => void save({})} /></label>
        <label className="st-field">Time zone<select value={zone} disabled={busy} onChange={event => { setZone(event.target.value); void save({ zone: event.target.value }) }}>
          {zones().map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <Outcome message={message} />
    </div> : null}
  </li>
}
