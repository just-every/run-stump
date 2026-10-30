import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Icon } from '../stump/ui/icons.tsx'
import { Chip, Initials, Outcome, useLoaded, useRun, when, words } from '../stump/ui/kit.tsx'
import type { RemovedPerson, RoleChange, Team, TeamPerson } from '../stump/ui/types.ts'

export const Route = createFileRoute('/app/settings/team')({ component: TeamPage })

const ROLES = ['admin', 'editor', 'contributor', 'poster', 'viewer'] as const
const CONNECTIONS = ['founder', 'employee', 'contractor', 'investor', 'advisor', 'friend', 'family'] as const
const key = () => crypto.randomUUID()

function TeamPage() {
  const { data, error, refresh } = useLoaded(async () => ({ me: await me(), team: await runAction<Team>('stump.team.manage', { action: 'list' }) }))
  const [inviting, setInviting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const changed = (text: string) => { setNote(text); void refresh() }
  const manage = data ? ['owner', 'admin'].includes(data.me.person.role) : false
  const members = data?.team.items.filter(person => person.status === 'active') ?? []
  const invited = data?.team.items.filter(person => person.status === 'invited') ?? []
  const label = (value: string) => value.charAt(0).toUpperCase() + words(value).slice(1)
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="team-title">
      <h1 id="team-title">Team</h1>
      <p className="st-lead">Everyone who works in Stump, with their role and their connection to the company.</p>
      {error ? <p className="st-error">{error}</p> : null}
      {note ? <p className="st-note" role="status">{note}</p> : null}
      <div className="st-panel">
        <div className="st-panel-head">
          <h2 className="st-panel-title" id="people-title">People</h2>
          {manage && !inviting ? <button className="st-button primary" type="button" onClick={() => { setNote(null); setInviting(true) }}><Icon name="plus" />Invite</button> : null}
        </div>
        {manage && inviting ? <Invite onDone={person => { setInviting(false); changed(`Invitation sent to ${person.email}.`) }} onCancel={() => setInviting(false)} /> : null}
        <table className="st-table" aria-labelledby="people-title">
          <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Connection</th>{manage ? <th scope="col"><span className="st-sr">Actions</span></th> : null}</tr></thead>
          <tbody>{data ? members.map(person => <Person key={person.id} person={person} manage={manage} owner={data.me.person.role === 'owner'} self={person.id === data.me.person.id} onChange={changed} label={label} />) : null}</tbody>
        </table>
      </div>
      {invited.length ? <div className="st-panel">
        <div className="st-panel-head"><h2 className="st-panel-title" id="waiting-title">Waiting to sign in</h2></div>
        <table className="st-table" aria-labelledby="waiting-title">
          <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Invited</th>{manage ? <th scope="col"><span className="st-sr">Actions</span></th> : null}</tr></thead>
          <tbody>{invited.map(person => <Pending key={person.id} person={person} manage={manage} onChange={changed} label={label} />)}</tbody>
        </table>
      </div> : null}
    </section>
  </HydrationUnit>
}

function Invite({ onDone, onCancel }: { onDone(person: TeamPerson): void; onCancel(): void }) {
  const { busy, message, run } = useRun()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const line = String(form.get('disclosure') ?? '').trim()
    const invited = await run(() => runAction<TeamPerson>('stump.team.manage', { action: 'invite', idempotency_key: key(), email: form.get('email'), display_name: form.get('name'),
      role: form.get('role'), connection: form.get('connection'), ...(line ? { disclosure_lines: [line] } : {}) }))
    if (invited) onDone(invited)
  }
  return <form className="st-panel side" onSubmit={submit} aria-label="Invite someone">
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

/** What a removal left to answer, read from the removed person's record. */
function removedNote(person: RemovedPerson) {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const left = [person.open_handoffs.length ? `${count(person.open_handoffs.length, 'open hand-off needs', 'open hand-offs need')} someone new` : null,
    person.unscheduled_items.length ? `${count(person.unscheduled_items.length, 'scheduled item is', 'scheduled items are')} back in draft` : null].filter(Boolean)
  return `${person.display_name} removed.${left.length ? ` ${left.join('; ')}.` : ''}`
}

function Person({ person, manage, owner, self, onChange, label }: { person: TeamPerson; manage: boolean; owner: boolean; self: boolean; onChange(note: string): void; label(value: string): string }) {
  const { busy, message, run } = useRun()
  const [confirming, setConfirming] = useState(false)
  const choices = owner && !self ? ['owner', ...ROLES] : ROLES
  const editable = manage && person.role !== 'owner'
  return <tr>
    <td><div className="st-cell-person"><Initials name={person.display_name} /><div className="st-row-main">
      <div className="st-name">{person.display_name}{self ? ' (you)' : ''}</div><div className="st-meta">{person.email}</div><Outcome message={message} />
    </div></div></td>
    <td>{editable
      ? <select className="st-select" aria-label={`Role for ${person.display_name}`} value={person.role} disabled={busy}
        onChange={event => void run(() => runAction<RoleChange>('stump.team.manage', { action: 'set_role', idempotency_key: key(), person_id: person.id, role: event.target.value }))
          .then(changed => { if (changed) onChange(`${changed.display_name} is now ${words(changed.role)}.`) })}>
        {choices.map(role => <option key={role} value={role}>{role === 'owner' ? 'Owner (transfer)' : label(role)}</option>)}
      </select>
      : <span><span className="st-dot" aria-hidden="true" />{label(person.role)}</span>}</td>
    <td>{person.connection ? <Chip>{label(person.connection)}</Chip> : <span className="st-meta">Not set</span>}</td>
    {manage ? <td>{editable ? confirming
      ? <button className="st-button danger small" type="button" disabled={busy} onClick={() => void run(() => runAction<RemovedPerson>('stump.team.manage', { action: 'remove', idempotency_key: key(), person_id: person.id }))
        .then(removed => { if (removed) onChange(removedNote(removed)) })}>Confirm removal</button>
      : <button className="st-button danger small" type="button" onClick={() => setConfirming(true)}>Remove</button> : null}</td> : null}
  </tr>
}

function Pending({ person, manage, onChange, label }: { person: TeamPerson; manage: boolean; onChange(note: string): void; label(value: string): string }) {
  const { busy, message, run } = useRun()
  return <tr>
    <td><div className="st-cell-person"><Initials name={person.display_name} /><div className="st-row-main">
      <div className="st-name">{person.display_name}</div><div className="st-meta">{[person.email, person.connection ? label(person.connection) : null].filter(Boolean).join(' · ')}</div><Outcome message={message} />
    </div></div></td>
    <td><span className="st-dot muted" aria-hidden="true" />{label(person.role)}</td>
    <td className="st-meta">{person.invited_at ? when(person.invited_at) : ''}</td>
    {manage ? <td><button className="st-button danger small" type="button" disabled={busy}
      onClick={() => void run(() => runAction<RemovedPerson>('stump.team.manage', { action: 'remove', idempotency_key: key(), person_id: person.id }))
        .then(removed => { if (removed) onChange(`Invitation to ${removed.email} cancelled.`) })}>Cancel invitation</button></td> : null}
  </tr>
}
