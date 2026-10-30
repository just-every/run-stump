// Settings · Agents (U17, L15): connect an agent, and the company's agent policy, Pause and recent activity in the
// app shell, each a hairline panel with its disc. Every policy choice saves as it changes; Base's own /agents page
// sends here, and its approval pages stay where Base keeps them.
import { useState, type FormEvent } from 'react'
import { HydrationUnit } from '../../../base/hydration/unit'
import { ActionError, credentials, explain, issueCredential, me, revokeCredential } from '../../ui/api.ts'
import { Icon } from '../../ui/icons.tsx'
import { Outcome, PanelTitle, Saved, useLoaded, useRun, useSaved, when } from '../../ui/kit.tsx'
import {
  ANSWERS, actionName, agentOverview, agentState, answerOf, approvals, classHelp, className, decisionName, markReview, narrower, outcomeWords, policyClasses, principal,
  recentActivity, reviews, savePolicy, setPaused, withAnswer, type Disposition, type PolicyDocument,
} from './policy.ts'

export function AgentsSettings() {
  const { data, error, refresh } = useLoaded(async () => {
    const who = await me()
    // Base's state, policy and audit doors answer only the people who answer for agents; everyone else sees their own agents and approvals.
    const role = who.person.role, owner = role === 'owner', auditor = owner || role === 'admin' || role === 'editor'
    const [creds, state, overview, waiting, toReview, activity] = await Promise.all([
      credentials(), auditor ? agentState() : Promise.resolve(null), auditor ? agentOverview() : Promise.resolve(null),
      approvals().then(answer => answer.approvals.filter(item => item.state === 'pending')),
      reviews().then(answer => answer.reviews.filter(item => item.state === 'open' || item.state === 'flagged')),
      auditor ? recentActivity() : Promise.resolve(null),
    ])
    return { owner, creds, state, overview, waiting, toReview, activity }
  })
  return <HydrationUnit>
    <section className="st-page st-agents" aria-labelledby="agents-title">
      <h1 id="agents-title" className="st-sr">Agents</h1>
      {error ? <p className="st-error">{error}</p> : null}
      <Connect items={data?.creds.items ?? null} refresh={refresh} />
      {data?.state ? <Policy owner={data.owner} state={data.state} document={data.overview?.document ?? null} refresh={refresh} /> : null}
      {data?.state ? <PausePanel owner={data.owner} paused={data.state.paused} refresh={refresh} /> : null}
      {data && (data.waiting.length || data.toReview.length) ? <Waiting approvals={data.waiting} reviews={data.toReview} refresh={refresh} /> : null}
      {data?.activity ? <section className="st-panel" aria-labelledby="activity-title">
        <PanelTitle icon="clock" id="activity-title">Recent activity</PanelTitle>
        {data.activity.length ? <ul className="st-list">{data.activity.map(row => <li className="st-row" key={row.id}>
          <div className="st-row-main">
            <div className="st-name">{row.approval ? <a href={`/agents/approvals/${encodeURIComponent(row.approval.id)}`}>{actionName(row.tool)}</a> : actionName(row.tool)}</div>
            <div className="st-meta">{row.agent.name} for {row.sponsor.name} · {outcomeWords(row)} · {when(row.at)}</div>
          </div>
        </li>)}</ul> : <p className="st-meta">No agent activity yet.</p>}
      </section> : null}
      {data?.overview?.week.counts.length ? <section className="st-panel" aria-labelledby="week-title">
        <PanelTitle icon="clock" id="week-title">This week</PanelTitle>
        <table className="st-table" aria-labelledby="week-title">
          <thead><tr><th scope="col">Kind of action</th><th scope="col">Handled</th><th scope="col">Calls</th></tr></thead>
          <tbody>{data.overview.week.counts.map(row => <tr key={`${row.class}:${row.decision}`}>
            <td><span className="st-name">{className(row.class)}</span></td><td className="st-meta">{decisionName(row.decision)}</td><td>{row.count}</td>
          </tr>)}</tbody>
        </table>
      </section> : null}
    </section>
  </HydrationUnit>
}

function Connect({ items, refresh }: { items: Array<{ client_id: string; name: string; created_at: string; revoked_at: string | null }> | null; refresh(): Promise<void> }) {
  const { busy, message, run } = useRun()
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget, name = String(new FormData(form).get('name') ?? '')
    const result = await run(() => issueCredential(name))
    if (result) { setIssued({ name, token: result.token }); form.reset(); await refresh() }
  }
  const live = items?.filter(item => !item.revoked_at) ?? []
  return <>
    <form className="st-panel" onSubmit={submit} aria-labelledby="connect-title">
      <div className="st-panel-head"><PanelTitle icon="key" id="connect-title">Connect an agent</PanelTitle></div>
      <div className="st-form">
        <label className="st-field">Agent name<input name="name" required maxLength={80} placeholder="Release writer" autoComplete="off" /></label>
        <div><button className="st-button primary" type="submit" disabled={busy}><Icon name="key" />Create credential</button></div>
      </div>
      <p className="st-meta st-agents-note">It acts for you, with exactly your role, under the company's policy below.</p>
      <Outcome message={message} />
      {issued ? <div className="st-panel side">
        <p className="st-name">Give this token to {issued.name}.</p>
        <p className="st-meta">It is shown once. It works as a Bearer token for <code>POST /mcp</code>.</p>
        <div className="st-secret">{issued.token}</div>
      </div> : null}
    </form>
    <section className="st-panel" aria-labelledby="connected-title">
      <div className="st-panel-head"><PanelTitle icon="people" id="connected-title">Connected agents</PanelTitle></div>
      {items && !live.length ? <p className="st-meta">No agent acts for you yet.</p> : null}
      {live.length ? <table className="st-table" aria-labelledby="connected-title">
        <thead><tr><th scope="col">Name</th><th scope="col">Created</th><th scope="col"><span className="st-sr">Actions</span></th></tr></thead>
        <tbody>{live.map(item => <tr key={item.client_id}>
          <td><span className="st-name">{item.name}</span></td>
          <td className="st-meta">{when(item.created_at)}</td>
          <td><button className="st-button danger small" type="button" disabled={busy} onClick={() => void run(() => revokeCredential(item.client_id), () => `${item.name} can no longer act.`).then(refresh)}>Revoke</button></td>
        </tr>)}</tbody>
      </table> : null}
    </section>
  </>
}

/** What agents may do, one answer per kind of action. Each answer saves as it changes; agents wait until every kind has one. */
function Policy({ owner, state, document, refresh }: { owner: boolean; state: Awaited<ReturnType<typeof agentState>>; document: PolicyDocument | null; refresh(): Promise<void> }) {
  const [pending, setPending] = useState<Record<string, Disposition>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { shown, saved } = useSaved()
  const classes = policyClasses(document, state.policy.unanswered)
  const answer = (cls: string) => pending[cls] ?? answerOf(document, cls)
  const left = classes.filter(cls => !answer(cls)).length
  const business = state.policy.source === 'business'
  async function choose(cls: string, value: Disposition) {
    const next = { ...pending, [cls]: value }
    setPending(next); setFailure(null)
    if (classes.some(item => !(next[item] ?? answerOf(document, item)))) return
    setBusy(true)
    try { await savePolicy(withAnswer(document, next)); setPending({}); saved(); await refresh() }
    catch (cause) { setFailure(explain(cause)) }
    finally { setBusy(false) }
  }
  return <section className="st-panel st-agents-policy" aria-labelledby="policy-title">
    <div className="st-panel-head">
      <PanelTitle icon="list" id="policy-title">What agents may do</PanelTitle>
      <Saved shown={shown && !busy} />
    </div>
    <p className="st-meta">{business ? 'Managed in Business.' : left ? `Agents wait until every kind has an answer, and the answers save then: ${left} left.` : 'Every kind of action has an answer. Each change saves at once.'}</p>
    <ul className="st-list">{classes.map(cls => {
      const value = answer(cls)
      return <li className="st-row" key={cls}>
        <div className="st-row-main"><div className="st-name" id={`class-${cls}`}>{className(cls)}</div><div className="st-meta">{classHelp(cls)}</div></div>
        {owner && !business
          ? <select className="st-select" aria-labelledby={`class-${cls}`} value={value} disabled={busy} onChange={event => event.target.value && void choose(cls, event.target.value as Disposition)}>
            {value ? null : <option value="">Choose an answer</option>}
            {(Object.keys(ANSWERS) as Disposition[]).map(item => <option key={item} value={item}>{ANSWERS[item]}</option>)}
          </select>
          : <span className="st-agents-answer">{value ? ANSWERS[value] : 'Not answered'}</span>}
      </li>
    })}</ul>
    {narrower(document) ? <p className="st-meta">The policy also has {narrower(document)} narrower {narrower(document) === 1 ? 'rule' : 'rules'} for particular agents or amounts.</p> : null}
    {owner && !business ? <p className="st-meta st-agents-foot">Ask first goes to the owner, who has a day to answer. Agents use no paid AI.</p> : null}
    {failure ? <p className="st-error" role="alert">{failure}</p> : null}
    {owner && !business ? <PolicyDocumentEditor document={document} refresh={refresh} /> : null}
  </section>
}

/** The whole policy document, for rules the answers above cannot say: reviewers, approvers, waits and narrower rules for particular agents or amounts. */
function PolicyDocumentEditor({ document, refresh }: { document: PolicyDocument | null; refresh(): Promise<void> }) {
  const { busy, message, run } = useRun()
  const text = JSON.stringify(document ?? withAnswer(null, {}), null, 2)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const source = String(new FormData(event.currentTarget).get('document') ?? '')
    const saved = await run(() => {
      let parsed: PolicyDocument
      // Text that is not JSON is refused as Base refuses a document it cannot read.
      try { parsed = JSON.parse(source) as PolicyDocument } catch { throw new ActionError('policy_document_invalid', { path: '$' }, 400) }
      return savePolicy(parsed)
    }, () => 'Policy saved.')
    if (saved) await refresh()
  }
  return <details className="st-agents-document">
    <summary className="st-meta">Edit policy document</summary>
    <form className="st-form" onSubmit={submit}>
      <label className="st-field">Policy document<textarea key={text} name="document" rows={16} spellCheck={false} defaultValue={text} required /></label>
      <div><button className="st-button" type="submit" disabled={busy}>Save policy document</button></div>
      <Outcome message={message} />
    </form>
  </details>
}

function PausePanel({ owner, paused, refresh }: { owner: boolean; paused: { business: boolean; local: boolean }; refresh(): Promise<void> }) {
  const { busy, message, run } = useRun()
  const off = paused.business || paused.local
  return <section className="st-panel" aria-labelledby="agents-pause-title">
    <div className="st-panel-head">
      <PanelTitle icon="pause" id="agents-pause-title">Pause agents</PanelTitle>
      {owner ? <button className={paused.local ? 'st-button primary' : 'st-button'} type="button" disabled={busy}
        onClick={() => void run(() => setPaused(!paused.local), () => paused.local ? 'Agents are on again.' : 'Agents are paused.').then(refresh)}>{paused.local ? 'Resume agents' : 'Pause agents'}</button> : null}
    </div>
    <p className="st-meta" data-agents-state>{off ? 'Agents are paused. Every agent call waits until they resume.' : 'Agents are on. Pausing stops every agent call at once; people keep working.'}{paused.business ? ' Paused in Business.' : ''}</p>
    <Outcome message={message} />
  </section>
}

function Waiting({ approvals: asks, reviews: marks, refresh }: { approvals: Awaited<ReturnType<typeof approvals>>['approvals']; reviews: Awaited<ReturnType<typeof reviews>>['reviews']; refresh(): Promise<void> }) {
  const { busy, message, run } = useRun()
  return <section className="st-panel" aria-labelledby="agents-waiting-title">
    <PanelTitle icon="check" id="agents-waiting-title">Waiting for you</PanelTitle>
    <ul className="st-list">
      {asks.map(item => <li className="st-row" key={item.id}>
        <div className="st-row-main"><div className="st-name">{actionName(item.tool)}</div>
          <div className="st-meta">{principal(item.prepared_by.agent)} for {principal(item.prepared_by.for)} · expires {when(item.expires_at)}</div></div>
        <a className="st-button small" href={`/agents/approvals/${encodeURIComponent(item.id)}`}>Open</a>
      </li>)}
      {marks.map(item => <li className="st-row" key={item.id}>
        <div className="st-row-main"><div className="st-name">{actionName(item.tool)}{item.state === 'flagged' ? ' · Flagged' : ''}</div>
          <div className="st-meta">{principal(item.prepared_by.agent)} for {principal(item.prepared_by.for)} · done, to review</div></div>
        <div className="st-actions">
          <button className="st-button small primary" type="button" disabled={busy} onClick={() => void run(() => markReview(item.id, 'reviewed'), () => 'Marked reviewed.').then(refresh)}>Mark reviewed</button>
          {item.state === 'flagged' ? null : <button className="st-button small" type="button" disabled={busy} onClick={() => void run(() => markReview(item.id, 'flag'), () => 'Flagged.').then(refresh)}>Flag</button>}
        </div>
      </li>)}
    </ul>
    <Outcome message={message} />
  </section>
}
