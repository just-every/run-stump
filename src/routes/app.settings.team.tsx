import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Outcome, useLoaded, useRun, when, words } from '../stump/ui/kit.tsx'
import type { Team, TeamPerson } from '../stump/ui/types.ts'

export const Route = createFileRoute('/app/settings/team')({ component: TeamPage })

const ROLES = ['admin', 'editor', 'contributor', 'poster', 'viewer'] as const
const CONNECTIONS = ['founder', 'employee', 'contractor', 'investor', 'advisor', 'friend', 'family'] as const
const key = () => crypto.randomUUID()

function TeamPage() {
  const { data, error, refresh } = useLoaded(async () => ({ me: await me(), team: await runAction<Team>('stump.team.manage', { action: 'list' }) }))
  const [inviting, setInviting] = useState(false)
  const manage = data ? ['owner', 'admin'].includes(data.me.person.role) : false
  const members = data?.team.items.filter(person => person.status === 'active') ?? []
  const invited = data?.team.items.filter(person => person.status === 'invited') ?? []
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="team-title">
      <h1 id="team-title">Team</h1>
      <p className="st-lead">Everyone who works in Stump, with their role and their connection to the company.</p>
      {error ? <p className="st-error">{error}</p> : null}
      {manage && !inviting ? <button className="st-button primary" type="button" onClick={() => setInviting(true)}>Invite someone</button> : null}
      {manage && inviting ? <Invite onDone={() => { setInviting(false); void refresh() }} onCancel={() => setInviting(false)} /> : null}
      <h2>People</h2>
      <ul className="st-list">
        {data ? members.map(person => <Person key={person.id} person={person} manage={manage} owner={data.me.person.role === 'owner'} self={person.id === data.me.person.id} onChange={refresh} />) : null}
      </ul>
      {invited.length ? <>
        <h2>Waiting to sign in</h2>
        <ul className="st-list">{invited.map(person => <Pending key={person.id} person={person} manage={manage} onChange={refresh} />)}</ul>
      </> : null}
    </section>
  </HydrationUnit>
}

function Invite({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const { busy, message, run } = useRun()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const line = String(form.get('disclosure') ?? '').trim()
    const done = await run(() => runAction('stump.team.manage', { action: 'invite', idempotency_key: key(), email: form.get('email'), display_name: form.get('name'),
      role: form.get('role'), connection: form.get('connection'), ...(line ? { disclosure_lines: [line] } : {}) }))
    if (done) onDone()
  }
  return <form className="st-panel" onSubmit={submit} aria-label="Invite someone">
    <div className="st-form">
      <label className="st-field">Name<input name="name" required maxLength={120} autoComplete="off" /></label>
      <label className="st-field">Email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <label className="st-field">Role<select name="role" defaultValue="contributor">{ROLES.map(role => <option key={role} value={role}>{words(role)}</option>)}</select></label>
      <label className="st-field">Connection to the company<select name="connection" defaultValue="employee">{CONNECTIONS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="st-field">Disclosure line (optional)<input name="disclosure" maxLength={280} placeholder="I work on this product." /></label>
    </div>
    <Outcome message={message} />
    <div className="st-actions">
      <button className="st-button primary" type="submit" disabled={busy}>Send invitation</button>
      <button className="st-button" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>
}

function Person({ person, manage, owner, self, onChange }: { person: TeamPerson; manage: boolean; owner: boolean; self: boolean; onChange(): void }) {
  const { busy, message, run } = useRun()
  const [confirming, setConfirming] = useState(false)
  const choices = owner && !self ? ['owner', ...ROLES] : ROLES
  const meta = [words(person.role), person.connection, person.email].filter(Boolean).join(' · ')
  return <li className="st-row">
    <div className="st-row-main">
      <div className="st-name">{person.display_name}{self ? ' (you)' : ''}</div>
      <div className="st-meta">{meta}</div>
      <Outcome message={message} />
    </div>
    {manage && person.role !== 'owner' ? <div className="st-actions">
      <select className="st-select" aria-label={`Role for ${person.display_name}`} value={person.role} disabled={busy}
        onChange={event => void run(() => runAction('stump.team.manage', { action: 'set_role', idempotency_key: key(), person_id: person.id, role: event.target.value })).then(onChange)}>
        {choices.map(role => <option key={role} value={role}>{role === 'owner' ? 'owner (transfer)' : words(role)}</option>)}
      </select>
      {confirming
        ? <button className="st-button danger" type="button" disabled={busy} onClick={() => void run(() => runAction('stump.team.manage', { action: 'remove', idempotency_key: key(), person_id: person.id })).then(onChange)}>Confirm removal</button>
        : <button className="st-button danger" type="button" onClick={() => setConfirming(true)}>Remove</button>}
    </div> : null}
  </li>
}

function Pending({ person, manage, onChange }: { person: TeamPerson; manage: boolean; onChange(): void }) {
  const { busy, message, run } = useRun()
  return <li className="st-row">
    <div className="st-row-main">
      <div className="st-name">{person.display_name}</div>
      <div className="st-meta">{[words(person.role), person.connection, person.email, person.invited_at ? `invited ${when(person.invited_at)}` : null].filter(Boolean).join(' · ')}</div>
      <Outcome message={message} />
    </div>
    {manage ? <button className="st-button danger" type="button" disabled={busy}
      onClick={() => void run(() => runAction('stump.team.manage', { action: 'remove', idempotency_key: key(), person_id: person.id })).then(onChange)}>Cancel invitation</button> : null}
  </li>
}
