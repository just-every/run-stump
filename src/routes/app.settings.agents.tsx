import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { credentials, issueCredential, revokeCredential } from '../stump/ui/api.ts'
import { Icon } from '../stump/ui/icons.tsx'
import { Outcome, useLoaded, useRun, when } from '../stump/ui/kit.tsx'

export const Route = createFileRoute('/app/settings/agents')({ component: AgentsPage })

function AgentsPage() {
  const { data, error, refresh } = useLoaded(credentials)
  const { busy, message, run } = useRun()
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget, name = String(new FormData(form).get('name') ?? '')
    const result = await run(() => issueCredential(name))
    if (result) { setIssued({ name, token: result.token }); form.reset(); await refresh() }
  }
  const live = data?.items.filter(item => !item.revoked_at) ?? []
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="agents-title">
      <h1 id="agents-title">Agents</h1>
      <p className="st-lead">An agent you connect here acts for you, with exactly your role. The company policy, Pause and every agent's audit are on the <a href="/agents">Agents page</a>.</p>
      {error ? <p className="st-error">{error}</p> : null}
      <form className="st-panel" onSubmit={submit} aria-labelledby="connect-title">
        <div className="st-panel-head"><h2 className="st-panel-title" id="connect-title">Connect an agent</h2></div>
        <div className="st-form">
          <label className="st-field">Agent name<input name="name" required maxLength={80} placeholder="Release writer" autoComplete="off" /></label>
          <div><button className="st-button primary" type="submit" disabled={busy}><Icon name="key" />Create credential</button></div>
        </div>
        <Outcome message={message} />
        {issued ? <div className="st-panel side">
          <p className="st-name">Give this token to {issued.name}.</p>
          <p className="st-meta">It is shown once. It works as a Bearer token for <code>POST /mcp</code>.</p>
          <div className="st-secret">{issued.token}</div>
        </div> : null}
      </form>
      <div className="st-panel">
        <div className="st-panel-head"><h2 className="st-panel-title" id="connected-title">Connected agents</h2></div>
        {data && !live.length ? <p className="st-meta">No agent acts for you yet.</p> : null}
        {live.length ? <table className="st-table" aria-labelledby="connected-title">
          <thead><tr><th scope="col">Name</th><th scope="col">Created</th><th scope="col"><span className="st-sr">Actions</span></th></tr></thead>
          <tbody>{live.map(item => <tr key={item.client_id}>
            <td><span className="st-name">{item.name}</span></td>
            <td className="st-meta">{when(item.created_at)}</td>
            <td><button className="st-button danger small" type="button" disabled={busy} onClick={() => void run(() => revokeCredential(item.client_id), () => `${item.name} can no longer act.`).then(refresh)}>Revoke</button></td>
          </tr>)}</tbody>
        </table> : null}
      </div>
    </section>
  </HydrationUnit>
}
