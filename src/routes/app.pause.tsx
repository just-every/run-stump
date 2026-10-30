import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Chip, Outcome, PanelTitle, useLoaded, useRun } from '../stump/ui/kit.tsx'
import { mayPause, pauseAccount, pauseAll, pauseChanged, pausedLine, resume, ResumeOutcome, shortTime, usePause } from '../stump/ui/pause.tsx'
import type { Resumed } from '../stump/ui/types.ts'

export const Route = createFileRoute('/app/pause')({ head: () => ({ meta: [{ title: 'Pause · Stump' }] }), component: PausePage })

/** A connected account as stump.accounts.connect list answers it (V1 Account record). */
interface Account { id: string; network: string; handle: string; display_name: string | null; state: string }
const ACCOUNTS = 'stump.accounts.connect'

function PausePage() {
  const pause = usePause()
  // Accounts come from stump.accounts.connect; where the person may list them, each account can pause alone.
  const loaded = useLoaded(async () => {
    const person = await me()
    return { person, accounts: person.actions.includes(ACCOUNTS) ? (await runAction<{ items: Account[] }>(ACCOUNTS, { action: 'list' })).items : null }
  })
  const person = { data: loaded.data?.person }, accounts = { data: loaded.data?.accounts }
  const { busy, message, run } = useRun()
  const [resumed, setResumed] = useState<Resumed | null>(null)
  const may = mayPause(person.data?.person.role)
  const all = pause.all, state = pause.data?.state
  const pausedAccounts = state?.paused.filter(scope => scope.scope === 'account') ?? []
  const label = (id: string | null) => {
    const account = accounts.data?.find(item => item.id === id)
    return account ? `${account.handle} · ${account.network}` : id ?? 'An account'
  }
  async function act<T>(work: () => Promise<T>, after?: (value: T) => void) {
    setResumed(null)
    const value = await run(work)
    if (value !== undefined) { after?.(value); pauseChanged(); void loaded.refresh() }
  }
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="pause-title">
      <h1 id="pause-title">Pause</h1>
      <p className="st-lead">One press stops every scheduled post, for an incident or bad news. Queued posts hold until you resume.</p>
      {pause.error || loaded.error ? <p className="st-error">{pause.error ?? loaded.error}</p> : null}

      <div className="st-status">
        <div>
          <strong>{state ? all ? 'All publishing is paused' : 'Publishing is on' : ' '}</strong>
          <div className="st-meta">{all ? pausedLine(all, pause.name) : state ? 'Scheduled posts go out at their time.' : ' '}</div>
        </div>
        {may && state ? all
          ? <button className="st-button primary" type="button" disabled={busy} onClick={() => void act(() => resume('all'), setResumed)}>Resume publishing</button>
          : <button className="st-button primary" type="button" disabled={busy} onClick={() => void act(pauseAll)}>Pause all publishing</button> : null}
      </div>
      <Outcome message={message} />

      {resumed ? <div className="st-panel">
        <PanelTitle icon="play">Publishing resumed</PanelTitle>
        <ResumeOutcome resumed={resumed} />
      </div> : null}

      <div className="st-panel">
        <div className="st-panel-head"><PanelTitle>Accounts</PanelTitle></div>
        {accounts.data?.length ? <ul className="st-list">{accounts.data.map(account => {
          const paused = pausedAccounts.find(scope => scope.account_id === account.id)
          return <li className="st-row" key={account.id}>
            <div className="st-row-main"><div className="st-name">{account.handle}</div><div className="st-meta">{account.network}{paused ? ` · paused by ${pause.name(paused.person_id)}, ${shortTime(paused.at)}` : ''}</div></div>
            {paused ? <Chip tone="held">Paused</Chip> : null}
            {may ? paused
              ? <button className="st-button small" type="button" disabled={busy} onClick={() => void act(() => resume('account', account.id), setResumed)}>Resume</button>
              : <button className="st-button small" type="button" disabled={busy} onClick={() => void act(() => pauseAccount(account.id))}>Pause</button> : null}
          </li>
        })}</ul> : null}
        {!accounts.data?.length && pausedAccounts.length ? <ul className="st-list">{pausedAccounts.map(scope => <li className="st-row" key={scope.account_id}>
          <div className="st-row-main"><div className="st-name">{label(scope.account_id)}</div><div className="st-meta">Paused by {pause.name(scope.person_id)}, {shortTime(scope.at)}</div></div>
          <Chip tone="held">Paused</Chip>
          {may ? <button className="st-button small" type="button" disabled={busy} onClick={() => void act(() => resume('account', scope.account_id), setResumed)}>Resume</button> : null}
        </li>)}</ul> : null}
        {accounts.data && !accounts.data.length && !pausedAccounts.length ? <p className="st-meta">No account is connected yet.</p> : null}
        {!accounts.data && !pausedAccounts.length && state ? <p className="st-meta">No single account is paused.</p> : null}
      </div>

      <div className="st-panel">
        <div className="st-panel-head"><PanelTitle>History</PanelTitle></div>
        {state && !state.history.length ? <p className="st-meta">Publishing has never been paused.</p> : null}
        {state?.history.length ? <table className="st-table">
          <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Who</th></tr></thead>
          <tbody>{state.history.map((entry, index) => <tr key={`${entry.at}-${index}`}>
            <td className="st-meta">{shortTime(entry.at)}</td>
            <td><span className="st-name">{entry.action === 'pause' ? 'Paused' : 'Resumed'} {entry.scope === 'all' ? 'all publishing' : label(entry.account_id)}</span></td>
            <td className="st-meta">{pause.name(entry.person_id)}{entry.agent_id ? ' through an agent' : ''}</td>
          </tr>)}</tbody>
        </table> : null}
      </div>
    </section>
  </HydrationUnit>
}
