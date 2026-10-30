import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Outcome, useLoaded, useRun, when } from '../stump/ui/kit.tsx'
import type { PauseState, Resumed, Team } from '../stump/ui/types.ts'

export const Route = createFileRoute('/app/settings/publishing')({ component: PublishingPage })

const key = () => crypto.randomUUID()

function PublishingPage() {
  const { data, error, refresh } = useLoaded(async () => ({
    me: await me(),
    state: await runAction<PauseState>('stump.calendar.pause', { action: 'state' }),
    team: await runAction<Team>('stump.team.manage', { action: 'list' }),
  }))
  const { busy, message, run } = useRun()
  const [resumed, setResumed] = useState<Resumed | null>(null)
  const all = data?.state.paused.find(scope => scope.scope === 'all')
  const accounts = data?.state.paused.filter(scope => scope.scope === 'account') ?? []
  const may = data ? ['owner', 'admin', 'editor'].includes(data.me.person.role) : false
  const name = (id: string) => data?.team.items.find(person => person.id === id)?.display_name ?? 'Someone who left'
  async function pause() {
    setResumed(null)
    await run(() => runAction('stump.calendar.pause', { action: 'pause', scope: 'all', idempotency_key: key() }), () => 'Paused. Nothing posts until you resume.')
    await refresh()
  }
  async function resume(scope: 'all' | 'account', account?: string | null) {
    const result = await run(() => runAction<Resumed>('stump.calendar.pause', { action: 'resume', scope, ...(account ? { account_id: account } : {}), idempotency_key: key() }), () => 'Resumed.')
    if (result) setResumed(result)
    await refresh()
  }
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="publishing-title">
      <h1 id="publishing-title">Publishing</h1>
      <p className="st-lead">One control stops every scheduled post, for an incident or bad news.</p>
      {error ? <p className="st-error">{error}</p> : null}
      <div className="st-status">
        <div>
          <span className={all ? 'st-dot paused' : 'st-dot'} aria-hidden="true" />
          <strong>{data ? all ? 'All publishing is paused' : 'Publishing is on' : ' '}</strong>
          {all ? <div className="st-meta">Paused by {name(all.person_id)}, {when(all.at)}</div> : null}
        </div>
        {may && data ? all
          ? <button className="st-button primary" type="button" disabled={busy} onClick={() => void resume('all')}>Resume publishing</button>
          : <button className="st-button primary" type="button" disabled={busy} onClick={() => void pause()}>Pause all publishing</button> : null}
      </div>
      <Outcome message={message} />
      {resumed ? <div className="st-panel">
        <strong>{resumed.will_post.length} {resumed.will_post.length === 1 ? 'post goes' : 'posts go'} out at {resumed.will_post.length === 1 ? 'its' : 'their'} time</strong>
        <ul className="st-list">{resumed.will_post.map(item => <li className="st-row" key={item.item_id}><span className="st-meta">{when(item.scheduled_at)} · {item.item_id}</span></li>)}</ul>
        {resumed.held_overdue.length ? <p>{resumed.held_overdue.length} overdue {resumed.held_overdue.length === 1 ? 'post stays' : 'posts stay'} held until rescheduled or dropped.</p> : null}
      </div> : null}
      {accounts.length ? <>
        <h2>Paused accounts</h2>
        <ul className="st-list">{accounts.map(scope => <li className="st-row" key={scope.account_id}>
          <div className="st-row-main"><div className="st-name">{scope.account_id}</div><div className="st-meta">Paused by {name(scope.person_id)}, {when(scope.at)}</div></div>
          {may ? <button className="st-button" type="button" disabled={busy} onClick={() => void resume('account', scope.account_id)}>Resume</button> : null}
        </li>)}</ul>
      </> : null}
      <h2>History</h2>
      {data && !data.state.history.length ? <p className="st-meta">Publishing has never been paused.</p> : null}
      <ul className="st-list">{data?.state.history.map((entry, index) => <li className="st-row" key={`${entry.at}-${index}`}>
        <div className="st-row-main">
          <div className="st-name">{entry.action === 'pause' ? 'Paused' : 'Resumed'} {entry.scope === 'all' ? 'all publishing' : 'one account'}</div>
          <div className="st-meta">{name(entry.person_id)}{entry.agent_id ? ' through an agent' : ''} · {when(entry.at)}</div>
        </div>
      </li>)}</ul>
    </section>
  </HydrationUnit>
}
