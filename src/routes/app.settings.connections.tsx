import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { AiProviderPanel } from '../stump/drafting/AiProviderPanel.tsx'
import { screenStyles } from '../stump/ledger/screen-styles.ts'
import type { ConnectionView, OfferView, PreviewView, RulesView } from '../stump/stack/view.ts'
import { me, runAction } from '../stump/ui/api.ts'
import { Outcome, PanelTitle, Saved, handleWord, networkWord, useLoaded, useRun, useSaved, when, SelectField } from '../stump/ui/kit.tsx'
import { docsUrl } from '../stump/docs.ts'

export const Route = createFileRoute('/app/settings/connections')({ component: ConnectionsPage })

const key = () => crypto.randomUUID()
const MEDIUMS = ['social', 'community', 'referral', 'email', 'press'] as const
const NAMES = { orbit: 'Orbit', vane: 'Vane' } as const

function ConnectionsPage() {
  const { data, error, refresh } = useLoaded(async () => {
    const who = await me()
    const admin = ['owner', 'admin'].includes(who.person.role), editor = admin || who.person.role === 'editor'
    const [connections, offers, rules] = await Promise.all([
      editor ? runAction<{ items: ConnectionView[] }>('stump.stack.connect', { action: 'list' }) : Promise.resolve({ items: [] as ConnectionView[] }),
      editor ? runAction<{ items: OfferView[]; total: number }>('stump.stack.send', { action: 'offers' }) : Promise.resolve({ items: [] as OfferView[], total: 0 }),
      runAction<RulesView>('stump.links.manage', { action: 'rules' }),
    ])
    return { who, admin, editor, connections: connections.items, offers: offers.items, rules }
  })
  return <HydrationUnit>
    <style>{screenStyles}</style>
    {/* Every section is one hairline panel with its heading inside, as on Brand (src/stump/ui/styles.ts .st-conn). */}
    <section className="st-page st-ledger-screen st-conn" aria-labelledby="connections-title">
      <h1 id="connections-title" className="st-sr">Connections</h1>
      {error ? <p className="st-error">{error}</p> : null}
      {data ? <>
        <AiProviderPanel admin={data.admin} />
        {data.editor ? <>
          <Seed seed="orbit" connection={data.connections.find(item => item.seed === 'orbit')} admin={data.admin} offers={data.offers.filter(offer => offer.seed === 'orbit')} onChange={refresh}
            line="People who ask a question or reply to you reach Orbit as a contact signal with their public handle and the link to their post." />
          <Seed seed="vane" connection={data.connections.find(item => item.seed === 'vane')} admin={data.admin} offers={data.offers.filter(offer => offer.seed === 'vane')} onChange={refresh}
            line="Each post that goes out is marked on its day in Vane, linked to its ledger entry." />
        </> : null}
        <Links rules={data.rules} admin={data.admin} onChange={refresh} />
      </> : null}
    </section>
  </HydrationUnit>
}

function Seed({ seed, connection, admin, offers, line, onChange }: { seed: 'orbit' | 'vane'; connection: ConnectionView | undefined; admin: boolean; offers: OfferView[]; line: string; onChange(): Promise<void> }) {
  const { busy, message, run } = useRun()
  const [editing, setEditing] = useState(false)
  const connected = connection?.state === 'connected'
  // Newest first, as Inbox lists them: when the person engaged, else when the offer was made.
  const at = (offer: OfferView) => Date.parse(String(offer.occurred_at ?? offer.created_at ?? '')) || 0
  const waiting = offers.filter(offer => offer.state === 'offered' || offer.state === 'failed').sort((a, b) => at(b) - at(a))
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const saved = await run(() => runAction('stump.stack.connect', { action: 'connect', idempotency_key: key(), seed, origin: String(form.get('origin')).trim(),
      ...(seed === 'orbit' ? { source_id: String(form.get('id')).trim() } : { site_id: String(form.get('id')).trim() }), secret: String(form.get('secret')).trim() }), () => `${NAMES[seed]} connected.`)
    if (saved) { setEditing(false); await onChange() }
  }
  return <section className="st-panel" aria-labelledby={`conn-${seed}`}>
    <PanelTitle icon={seed === 'orbit' ? 'people' : 'chart'} id={`conn-${seed}`}>{NAMES[seed]}</PanelTitle>
    {/* Where the address, ID and secret come from is in the docs, one link from the line that says what the connection does. */}
    <p className="st-meta st-conn-line">{line} <a href={docsUrl('stack')} target="_blank" rel="noreferrer noopener">Where to find these</a></p>
    {connection && connected && !editing ? <div className="st-row">
      <div className="st-row-main">
        <div className="st-name">{connection.origin}</div>
        <div className="st-meta">{seed === 'orbit' ? `Source ${connection.source_id}` : `Site ${connection.site_id}`} · connected {when(connection.connected_at)}{connection.last_sent_at ? ` · last send ${when(connection.last_sent_at)}` : ''}</div>
        {connection.last_error ? <div className="st-error">Last send failed: {connection.last_error}</div> : null}
      </div>
      {admin ? <div className="st-actions">
        <button className="st-button" type="button" onClick={() => setEditing(true)}>Change</button>
        <button className="st-button danger" type="button" disabled={busy} onClick={() => void run(() => runAction('stump.stack.connect', { action: 'disconnect', idempotency_key: key(), seed }), () => `${NAMES[seed]} disconnected. Nothing is sent to it.`).then(onChange)}>Disconnect</button>
      </div> : null}
    </div> : null}
    {connection && !connected && !editing ? <p className="st-meta">Disconnected {when(connection.disconnected_at)}. Nothing is sent.</p> : null}
    {admin && (!connected || editing) ? <form className="st-conn-form" onSubmit={connect} aria-label={`Connect ${NAMES[seed]}`}>
      <div className="st-form">
        <label className="st-field">{NAMES[seed]} address<input name="origin" type="url" required maxLength={300} defaultValue={connection?.origin ?? ''} placeholder={`https://${seed}.example.com`} autoComplete="off" /></label>
        <label className="st-field">{seed === 'orbit' ? 'Signal source ID' : 'Site ID'}<input name="id" required maxLength={100} defaultValue={(seed === 'orbit' ? connection?.source_id : connection?.site_id) ?? ''} autoComplete="off" /></label>
        <label className="st-field">{seed === 'orbit' ? 'Source secret' : 'Annotation secret'}<input name="secret" type="password" required minLength={20} maxLength={256} autoComplete="new-password" /></label>
      </div>
      <Outcome message={message} />
      <div className="st-actions">
        <button className="st-button primary" type="submit" disabled={busy}>Connect {NAMES[seed]}</button>
        {editing ? <button className="st-button" type="button" onClick={() => setEditing(false)}>Cancel</button> : null}
      </div>
    </form> : <Outcome message={message} />}
    {connected && waiting.length ? <Waiting offers={waiting} onChange={onChange} /> : null}
  </section>
}

function Waiting({ offers, onChange }: { offers: OfferView[]; onChange(): Promise<void> }) {
  const { busy, message, run } = useRun()
  return <>
    <p className="st-meta">{offers.length} waiting to send</p>
    <ul className="st-list st-conn-offers">{offers.map(offer => <li className="st-row" key={offer.id}>
      <div className="st-row-main">
        <div className="st-name">{offer.kind === 'engager' ? [handleWord(String(offer.handle ?? ''), offer.network), networkWord(offer.network), offer.engagement ?? 'engaged'].filter(Boolean).join(' · ') : offer.post_url?.replace(/^https?:\/\/(www\.)?/, '') ?? 'A post'}</div>
        <div className="st-meta">{offer.kind === 'engager' ? when(offer.occurred_at ?? offer.created_at) : 'Annotation'}{(offer.outcome as { ok?: boolean } | null)?.ok === false ? ` · last send failed: ${(offer.outcome as { error?: string }).error ?? 'try again'}` : ''}</div>
      </div>
      <button className="st-button" type="button" disabled={busy} onClick={() => void run(() => runAction<{ sent: boolean; outcome: { error?: string } | null }>('stump.stack.send', { action: 'send', idempotency_key: key(), offer_id: offer.id }), done => done.sent ? 'Sent.' : `Not sent: ${done.outcome?.error ?? 'try again'}`).then(onChange)}>Send</button>
    </li>)}</ul>
    <Outcome message={message} />
  </>
}

function Links({ rules, admin, onChange }: { rules: RulesView; admin: boolean; onChange(): Promise<void> }) {
  const { busy, message, run } = useRun()
  const { shown, saved } = useSaved()
  const [sample, setSample] = useState<PreviewView | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const set = rules.mediums !== null
  /** Settings save as you go (L15): each change saves the rules as they now stand; a failed save keeps what was typed. */
  async function save() {
    const data = new FormData(form.current!)
    const own_domains = String(data.get('domains')).split(/[\s,]+/).filter(Boolean)
    if (!own_domains.length) return
    const done = await run(() => runAction('stump.links.manage', { action: 'set_rules', idempotency_key: key(), own_domains, mediums: { published: data.get('published'), handoff: data.get('handoff') } }))
    if (done !== undefined) { saved(); await onChange() }
  }
  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = await run(() => runAction<PreviewView>('stump.links.manage', { action: 'preview', text: form.get('text'), route: form.get('route'), source: form.get('source'), campaign: form.get('campaign') || undefined, content: 'preview' }))
    if (result) setSample(result)
  }
  return <>
    <section className="st-panel" aria-labelledby="conn-links">
    <PanelTitle icon="send" id="conn-links">Link tags</PanelTitle>
    {admin ? <form className="st-conn-form" ref={form} onSubmit={event => { event.preventDefault(); void save() }} aria-label="Link tagging rules">
      <div className="st-form">
        <label className="st-field">Your domains<input name="domains" required defaultValue={rules.own_domains.join(', ')} placeholder="example.com, docs.example.com" autoComplete="off"
          onBlur={event => { if (event.target.value.trim() !== rules.own_domains.join(', ')) void save() }} /></label>
        <SelectField label="Medium for posts Stump publishes" name="published" defaultValue={rules.mediums?.published ?? 'social'} onChange={() => void save()}>{MEDIUMS.map(item => <option key={item} value={item}>{item}</option>)}</SelectField>
        <SelectField label="Medium for hand-offs" name="handoff" defaultValue={rules.mediums?.handoff ?? 'community'} onChange={() => void save()}>{MEDIUMS.map(item => <option key={item} value={item}>{item}</option>)}</SelectField>
      </div>
      <div className="st-actions"><Outcome message={message?.error ? message : null} /><Saved shown={shown && !busy} /></div>
    </form> : set ? <p>{rules.own_domains.join(', ')} · posts {rules.mediums?.published}, hand-offs {rules.mediums?.handoff}</p> : <p className="st-meta">The company has not set its link rules yet.</p>}
    </section>
    {set ? <section className="st-panel" aria-labelledby="conn-try">
      <PanelTitle icon="check" id="conn-try">Try a link</PanelTitle>
      <form className="st-conn-form" onSubmit={preview} aria-label="Try a link">
        <div className="st-form">
          <label className="st-field">Text<input name="text" required defaultValue={`See https://${rules.own_domains[0] ?? 'example.com'}/pricing`} /></label>
          <label className="st-field">Goes to<input name="source" required defaultValue="bluesky" /></label>
          <SelectField label="Route" name="route" defaultValue="published"><option value="published">Published</option><option value="handoff">Hand-off</option></SelectField>
          <label className="st-field">Campaign<input name="campaign" placeholder="launch" /></label>
        </div>
        <div className="st-actions"><button className="st-button" type="submit" disabled={busy}>Show tags</button></div>
        {sample ? <>
          <div className="st-secret" style={{ marginTop: 12 }}>{sample.text}</div>
          <p className="st-meta">Links to {rules.own_domains.join(', ')} get utm_source (where it goes), utm_medium, utm_campaign and utm_content (the post). Links to other sites stay as they are.</p>
        </> : null}
      </form>
    </section> : null}
  </>
}
