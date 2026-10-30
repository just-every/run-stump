import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Outcome, useLoaded, useRun } from '../stump/ui/kit.tsx'
import type { Team } from '../stump/ui/types.ts'

export const Route = createFileRoute('/app/settings/accounts')({ component: AccountsPage })

const NAMES: Record<string, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon', x: 'X', linkedin: 'LinkedIn' }
const key = () => crypto.randomUUID()

interface Account {
  id: string; network: string; handle: string; display_name: string | null; owner: { kind: 'person' | 'company'; person_id: string | null }
  connected_by: string | null; connected_at: string | null; state: 'connected' | 'expired' | 'revoked' | 'disconnected'; reconnect_url: string | null
  instance: string | null; automated_label: boolean; operator_bio: string | null
}
interface App { network: string; state: 'not_needed' | 'not_created' | 'connected' }
interface Started { connection_id: string; consent_url?: string; needs?: 'app_password'; handle?: string | null }
interface Disconnected { unscheduled: Array<{ item_id: string }>; revoked: string }

const shortDate = (iso: string | null) => iso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso)) : ''

function AccountsPage() {
  const { data, error, refresh } = useLoaded(async () => ({
    me: await me(),
    accounts: await runAction<{ items: Account[] }>('stump.accounts.connect', { action: 'list' }),
    apps: await runAction<{ items: App[] }>('stump.setup.apps', { action: 'list' }),
    team: await runAction<Team>('stump.team.manage', { action: 'list' }).catch(() => ({ items: [], total: 0 }) as Team),
  }))
  const [connecting, setConnecting] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => { const wanted = new URLSearchParams(window.location.search).get('reconnect'); if (wanted) setOpen(wanted) }, [])
  const name = (id: string | null) => data?.team.items.find(person => person.id === id)?.display_name ?? 'someone who left'
  const admin = data ? ['owner', 'admin'].includes(data.me.person.role) : false
  const viewer = data?.me.person.role === 'viewer'
  const accounts = data?.accounts.items ?? []
  const showForm = connecting || (data !== null && !accounts.length && !viewer)
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="accounts-title">
      <h1 id="accounts-title">Accounts</h1>
      <p className="st-lead">The accounts Stump posts from. Each one belongs to one person or to the company.</p>
      {error ? <p className="st-error">{error}</p> : null}
      {note ? <p className="st-note" role="status">{note}</p> : null}
      {accounts.length ? <ul className="st-list st-box">
        {accounts.map(account => <AccountRow key={account.id} account={account} owner={account.owner.kind === 'company' ? 'Company' : name(account.owner.person_id)}
          connectedBy={name(account.connected_by)} open={open === account.id} onToggle={() => setOpen(open === account.id ? null : account.id)}
          mine={account.owner.kind === 'company' ? admin : account.owner.person_id === data?.me.person.id}
          onChange={text => { setNote(text); void refresh() }} />)}
      </ul> : null}
      {showForm && data ? <Connect admin={admin} apps={data.apps.items} onCancel={accounts.length ? () => setConnecting(false) : null} />
        : !viewer ? <p><button className="st-button primary" type="button" onClick={() => { setNote(null); setConnecting(true) }}>+ Connect an account</button></p> : null}
    </section>
  </HydrationUnit>
}

function status(account: Account, connectedBy: string) {
  if (account.state === 'connected') return { dot: 'st-dot', text: `connected by ${connectedBy}, ${shortDate(account.connected_at)}` }
  if (account.state === 'disconnected') return { dot: 'st-dot off', text: 'disconnected' }
  return { dot: 'st-dot paused', text: 'needs reconnecting' }
}

function AccountRow({ account, owner, connectedBy, open, mine, onToggle, onChange }: { account: Account; owner: string; connectedBy: string; open: boolean; mine: boolean; onToggle(): void; onChange(text: string): void }) {
  const { busy, message, run } = useRun()
  const [confirming, setConfirming] = useState(false)
  const state = status(account, connectedBy)
  async function reconnect() {
    const started = await run(() => runAction<Started>('stump.accounts.connect', { action: 'reconnect', account_id: account.id, idempotency_key: key() }))
    if (started?.consent_url) window.location.assign(started.consent_url)
  }
  async function disconnect() {
    const done = await run(() => runAction<Disconnected>('stump.accounts.connect', { action: 'disconnect', account_id: account.id, idempotency_key: key() }))
    if (done) onChange(`${account.handle} disconnected.${done.unscheduled.length ? ` ${done.unscheduled.length} scheduled ${done.unscheduled.length === 1 ? 'item is' : 'items are'} back in draft.` : ''}`)
  }
  async function label(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const saved = await run(() => runAction('stump.accounts.connect', { action: 'record_label', account_id: account.id, automated_label: form.get('label') === 'on',
      operator_bio: String(form.get('bio') ?? ''), idempotency_key: key() }), () => 'Saved')
    if (saved) onChange(`${account.handle}: X's Automated label recorded.`)
  }
  return <li className="st-row st-stack">
    <button className="st-row-toggle" type="button" aria-expanded={open} onClick={onToggle}>
      <span className="st-row-main">
        <span className="st-name st-handle">{account.handle}</span>
        <span className="st-meta">{NAMES[account.network] ?? account.network} · {owner}</span>
      </span>
      <span className="st-state"><span className={state.dot} aria-hidden="true" />{state.text}</span>
      <span className="st-chevron" aria-hidden="true">›</span>
    </button>
    {open ? <div className="st-panel">
      {account.instance ? <div className="st-meta">Server: {account.instance}</div> : null}
      {account.network === 'x' ? <div className="st-meta">{account.automated_label ? `Automated label recorded · operator: ${account.operator_bio}` : 'No Automated label recorded. Agents cannot publish here until it is.'}</div> : null}
      {mine ? <div className="st-actions st-spaced">
        {account.state !== 'connected' ? <button className="st-button primary" type="button" disabled={busy} onClick={() => void reconnect()}>Reconnect</button> : null}
        {account.state !== 'disconnected' ? confirming
          ? <button className="st-button danger" type="button" disabled={busy} onClick={() => void disconnect()}>Confirm disconnect</button>
          : <button className="st-button danger" type="button" onClick={() => setConfirming(true)}>Disconnect</button> : null}
      </div> : <p className="st-meta">Only {account.owner.kind === 'company' ? 'owners and admins' : 'its owner'} can change this account.</p>}
      {mine && account.network === 'x' && account.state === 'connected' ? <form className="st-spaced" onSubmit={label} aria-label="X's Automated label">
        <div className="st-form">
          <label className="st-field">Operator named in the bio<input name="bio" maxLength={500} defaultValue={account.operator_bio ?? ''} /></label>
          <label className="st-field st-check"><input type="checkbox" name="label" defaultChecked={account.automated_label} />The account carries X's Automated label</label>
        </div>
        <div className="st-actions st-spaced"><button className="st-button" type="submit" disabled={busy}>Record</button></div>
      </form> : null}
      <Outcome message={message} />
    </div> : null}
  </li>
}

function Connect({ admin, apps, onCancel }: { admin: boolean; apps: App[]; onCancel: (() => void) | null }) {
  const { busy, message, run } = useRun()
  const [network, setNetwork] = useState('bluesky')
  const [password, setPassword] = useState<Started | null>(null)
  const app = apps.find(item => item.network === network)
  const needsApp = app?.state === 'not_created'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (field: string) => String(form.get(field) ?? '').trim()
    const started = await run(() => runAction<Started>('stump.accounts.connect', { action: 'start', network, owner: form.get('owner') ?? 'me', idempotency_key: key(),
      ...(network === 'mastodon' ? { instance: text('instance') } : {}), ...(network === 'bluesky' ? { handle: text('handle'), ...(text('service') ? { service: text('service') } : {}) } : {}) }))
    if (started?.consent_url) window.location.assign(started.consent_url)
    else if (started?.needs === 'app_password') setPassword(started)
  }
  if (password) return <AppPassword started={password} onCancel={() => setPassword(null)} />
  return <form className="st-panel" onSubmit={submit} aria-label="Connect an account">
    <div className="st-form">
      <label className="st-field">Network<select name="network" value={network} onChange={event => setNetwork(event.target.value)}>
        {Object.entries(NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="st-field">Whose account<select name="owner" defaultValue="me"><option value="me">Mine</option>{admin ? <option value="company">The company's</option> : null}</select></label>
      {network === 'mastodon' ? <label className="st-field">Server<input name="instance" required maxLength={300} placeholder="mastodon.social" autoComplete="off" /></label> : null}
      {network === 'bluesky' ? <>
        <label className="st-field">Handle<input name="handle" required maxLength={300} placeholder="yourname.bsky.social" autoComplete="off" /></label>
        <label className="st-field">Server (if not bsky.social)<input name="service" maxLength={300} placeholder="https://bsky.social" autoComplete="off" /></label>
      </> : null}
    </div>
    {needsApp ? <p className="st-note">{NAMES[network]} needs the company's own app first. <a href="/app/settings/publishing">Set it up in Publishing</a>.</p> : null}
    <Outcome message={message} />
    <div className="st-actions st-spaced">
      <button className="st-button primary" type="submit" disabled={busy || needsApp}>Continue to {NAMES[network]}</button>
      {onCancel ? <button className="st-button" type="button" onClick={onCancel}>Cancel</button> : null}
    </div>
  </form>
}

function AppPassword({ started, onCancel }: { started: Started; onCancel(): void }) {
  const { busy, message, run } = useRun()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const done = await run(() => runAction('stump.accounts.connect', { action: 'complete', connection_id: started.connection_id,
      app_password: String(new FormData(event.currentTarget).get('password') ?? ''), idempotency_key: key() }))
    if (done) window.location.assign('/app/settings/accounts')
  }
  return <form className="st-panel" onSubmit={submit} aria-label="App password">
    <p>{started.handle ? `@${started.handle}` : 'This account'}'s server has no consent screen. In Bluesky's settings, create an app password for Stump and enter it here.</p>
    <label className="st-field">App password<input name="password" type="password" required maxLength={200} autoComplete="off" /></label>
    <Outcome message={message} />
    <div className="st-actions st-spaced">
      <button className="st-button primary" type="submit" disabled={busy}>Connect</button>
      <button className="st-button" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>
}

