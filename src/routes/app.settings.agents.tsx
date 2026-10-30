import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { credentials, issueCredential, revokeCredential } from '../stump/ui/api.ts'
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
      <form className="st-panel" onSubmit={submit} aria-label="Connect an agent">
        <div className="st-form">
          <label className="st-field">Agent name<input name="name" required maxLength={80} placeholder="Release writer" autoComplete="off" /></label>
          <div><button className="st-button primary" type="submit" disabled={busy}>Create credential</button></div>
        </div>
        <Outcome message={message} />
        {issued ? <div>
          <p>Give this token to {issued.name}. It is shown once; it works as a Bearer token for <code>POST /mcp</code>.</p>
          <div className="st-secret">{issued.token}</div>
        </div> : null}
      </form>
      <h2>Connected agents</h2>
      {data && !live.length ? <p className="st-meta">No agent acts for you yet.</p> : null}
      <ul className="st-list">{live.map(item => <li className="st-row" key={item.client_id}>
        <div className="st-row-main"><div className="st-name">{item.name}</div><div className="st-meta">Created {when(item.created_at)}</div></div>
        <button className="st-button danger" type="button" disabled={busy} onClick={() => void run(() => revokeCredential(item.client_id), () => `${item.name} can no longer act.`).then(refresh)}>Revoke</button>
      </li>)}</ul>
    </section>
  </HydrationUnit>
}
