// Settings · Connections · AI provider: where an owner or admin chooses the
// provider, model and key Stump drafts with (stump.setup.ai, STUMP-DRAFT-006).
import { useState, type FormEvent } from 'react'
import { runAction } from '../ui/api.ts'
import { Outcome, PanelTitle, useLoaded, useRun, when } from '../ui/kit.tsx'

interface Provider {
  source: 'settings' | 'installation' | 'none'; base_url: string | null; host: string | null; model: string | null
  key: string | null; key_needed: boolean; set_at: string | null; installation: { host: string; model: string | null } | null
}
const key = () => crypto.randomUUID()

export function AiProviderPanel({ admin }: { admin: boolean }) {
  const { data, refresh } = useLoaded(() => runAction<Provider>('stump.setup.ai', { action: 'get' }))
  const [editing, setEditing] = useState(false)
  const { busy, message, run } = useRun()
  const saved = data?.source === 'settings'
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget), apiKey = String(form.get('api_key') ?? '').trim()
    const done = await run(() => runAction('stump.setup.ai', { action: 'set', idempotency_key: key(), base_url: String(form.get('base_url')).trim(), model: String(form.get('model')).trim(),
      ...(apiKey ? { api_key: apiKey } : {}) }), () => 'Saved. Drafts from a source use it now.')
    if (done) { setEditing(false); await refresh() }
  }
  return <section className="st-panel" aria-labelledby="conn-ai">
    <PanelTitle icon="pencil" id="conn-ai">AI provider</PanelTitle>
    <p className="st-meta st-conn-line">Drafts from a source, a prompt or a reply go to your own provider and model with your key. Any OpenAI-compatible address works: OpenAI, OpenRouter, a Cloudflare AI Gateway or your own.</p>
    {data && !editing ? data.source === 'none'
      ? <p className="st-meta">No provider is set, so Stump cannot draft for you yet. {admin ? '' : 'An owner or admin sets one here.'}</p>
      : <div className="st-row">
        <div className="st-row-main">
          <div className="st-name">{data.model ?? 'No model'} · {data.host}</div>
          <div className="st-meta">{saved ? `Key ${data.key ?? 'missing'} · saved ${when(data.set_at)}` : 'Set by this installation\'s AI settings'}</div>
          {data.key_needed ? <div className="st-error">The key was not restored with the archive. Enter it again.</div> : null}
        </div>
        {admin ? <div className="st-actions">
          <button className="st-button" type="button" onClick={() => setEditing(true)}>{saved ? 'Change' : 'Use another'}</button>
          {saved ? <button className="st-button danger" type="button" disabled={busy}
            onClick={() => void run(() => runAction('stump.setup.ai', { action: 'clear', idempotency_key: key() }), () => 'Removed.').then(refresh)}>Remove</button> : null}
        </div> : null}
      </div> : null}
    {admin && data && (editing || data.source === 'none') ? <form className="st-conn-form" onSubmit={save} aria-label="Choose the AI provider">
      <div className="st-form">
        <label className="st-field">Provider address<input name="base_url" type="url" required maxLength={2048} defaultValue={data.base_url ?? 'https://api.openai.com/v1'} autoComplete="off" /></label>
        <label className="st-field">Model<input name="model" required maxLength={200} defaultValue={data.model ?? ''} placeholder="gpt-4.1-mini" autoComplete="off" /></label>
        <label className="st-field">Key{saved ? ' (leave empty to keep it)' : ''}<input name="api_key" type="password" required={!saved || data.key_needed} maxLength={4096} autoComplete="new-password" /></label>
      </div>
      <Outcome message={message} />
      <div className="st-actions">
        <button className="st-button primary" type="submit" disabled={busy}>Save provider</button>
        {editing ? <button className="st-button" type="button" onClick={() => setEditing(false)}>Cancel</button> : null}
      </div>
    </form> : <Outcome message={message} />}
  </section>
}
