import { Link, createFileRoute } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Outcome, useLoaded, useRun, words } from '../stump/ui/kit.tsx'
import { navigation } from '../stump/ui/nav.ts'
import type { Team } from '../stump/ui/types.ts'
import { Disc } from '../stump/drafting/disc.tsx'
import type { ClaimView, Product, VoiceView } from '../stump/drafting/view.ts'

export const Route = createFileRoute('/app/settings/brand')({ component: BrandPage })

const key = () => crypto.randomUUID()
const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean)
const shortDate = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : ''
const bare = (value: string) => value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
/** A proof in a few words: its own label, else its number and where it lives. */
const proofText = (proof: unknown) => {
  if (typeof proof === 'string') return bare(proof)
  if (!proof || typeof proof !== 'object') return ''
  const { text, document, number, unit, url, date } = proof as Record<string, string | number | undefined>
  const amount = number === undefined ? undefined : unit === undefined ? number : /^[$€£¥]$/u.test(String(unit)) ? `${unit}${number}` : /^(%|x|×)$/iu.test(String(unit)) ? `${number}${unit}` : `${number} ${unit}`
  return [text ?? document, amount, text || document ? null : url ? bare(String(url)) : null, date].filter(item => item !== undefined && item !== null && item !== '').join(' · ')
}

/** The Settings tabs: the settings screens that exist, so no tab opens a missing page. */
function SettingsTabs({ active }: { active: string }) {
  return <nav className="st-tabs" aria-label="Settings">
    {navigation.filter(entry => entry.group === 'settings').map(entry =>
      <Link key={entry.to} to={entry.to} aria-current={entry.to === active ? 'page' : undefined}>{entry.label}</Link>)}
  </nav>
}

function BrandPage() {
  const { data, error, refresh } = useLoaded(async () => {
    const [who, products, claims, voices, team] = await Promise.all([
      me(), runAction<{ items: Product[] }>('stump.brand.manage', { action: 'product_list' }), runAction<{ items: ClaimView[] }>('stump.brand.manage', { action: 'claim_list' }),
      runAction<{ items: VoiceView[] }>('stump.brand.manage', { action: 'voice_list' }), runAction<Team>('stump.team.manage', { action: 'list' }),
    ])
    return { who, products: products.items, claims: claims.items, voices: voices.items, team: team.items }
  })
  const { busy, message, run } = useRun()
  const editor = data ? ['owner', 'admin', 'editor'].includes(data.who.person.role) : false
  const writer = data ? data.who.person.role !== 'viewer' : false
  const name = (id: string) => data?.team.find(person => person.id === id)?.display_name ?? 'Someone who left'

  async function act(args: Record<string, unknown>, done = 'Saved') {
    const result = await run(() => runAction('stump.brand.manage', { ...args, idempotency_key: key() }), () => done)
    await refresh()
    return result
  }

  return <HydrationUnit>
    <section className="st-page st-wide" aria-labelledby="settings-title">
      <h1 id="settings-title">Settings</h1>
      <SettingsTabs active="/app/settings/brand" />
      {error ? <p className="st-error">{error}</p> : null}

      <section className="st-card" aria-labelledby="products-title">
        <h2 className="st-card-head" id="products-title"><Disc icon="box" />Products</h2>
        <ul className="st-list">{data?.products.map(product => <li className="st-kv" key={product.id}>
          <div className="st-name">{product.name}{product.other_names.length ? <div className="st-meta">also {product.other_names.join(', ')}</div> : null}</div>
          {editor ? <label className="st-inline">tone:
            <input defaultValue={product.tone} aria-label={`${product.name} tone`} onBlur={event => { if (event.target.value.trim() && event.target.value !== product.tone) void act({ action: 'product_update', product_id: product.id, tone: event.target.value.trim() }) }} />
          </label> : <span className="st-meta">tone: {product.tone || 'not set'}</span>}
        </li>)}</ul>
        {editor ? <ProductForm open={data !== null && !data.products.length} busy={busy} onAdd={args => act({ action: 'product_create', ...args }, 'Product added')} /> : null}
      </section>

      <section className="st-card" aria-labelledby="claims-title">
        <h2 className="st-card-head" id="claims-title"><Disc icon="doc" />Claims</h2>
        {data && !data.claims.length ? <p className="st-meta">No claims yet. Drafts flag every product claim until one here backs it.</p> : null}
        <ul className="st-list">{data?.claims.map(claim => <li className="st-kv" key={claim.id}>
          <div className="st-name">{claim.kind === 'banned' ? <span className="st-pill danger">banned</span> : claim.stale ? <span className="st-pill danger">stale</span> : null}{claim.text}</div>
          <div className="st-meta">{claim.kind === 'banned' ? `reason: ${claim.reason ?? ''}`
            : claim.kind === 'comparative' ? `vs ${claim.competitor ?? ''} · source ${shortDate(claim.source_date)} · owner ${name(claim.owner_id)} · review ${shortDate(claim.review_on)}`
            : `proof: ${proofText(claim.proof)} · owner ${name(claim.owner_id)} · review ${shortDate(claim.review_on)}`}</div>
        </li>)}</ul>
        {writer && data ? <ClaimForm open={!data.claims.length} busy={busy} team={data.team.filter(person => person.status === 'active')} me={data.who.person.id} products={data.products}
          onAdd={args => act({ action: 'claim_create', ...args }, 'Claim added')} /> : null}
      </section>

      <section className="st-card" aria-labelledby="voices-title">
        <h2 className="st-card-head" id="voices-title"><Disc icon="person" />Voices</h2>
        <ul className="st-list">{data?.voices.map(voice => <li className="st-kv" key={voice.id}>
          <div className="st-name">{voice.state !== 'active' ? <span className="st-pill">{words(voice.state)}</span> : null}{voice.name}</div>
          <div className="st-meta">{voice.sample_count} {voice.sample_count === 1 ? 'post' : 'posts'}{voice.do.length ? ` · Do: ${voice.do.join(', ')}` : ''}{voice.dont.length ? ` · Don't: ${voice.dont.join(', ')}` : ''}</div>
        </li>)}</ul>
        {writer && data ? <VoiceForm open={!data.voices.length} busy={busy} people={editor ? data.team.filter(person => person.status === 'active') : data.team.filter(person => person.id === data.who.person.id)}
          onAdd={args => act({ action: 'voice_create', ...args }, 'Voice added')} /> : null}
      </section>
      <div className="st-saved"><Outcome message={message} /></div>
    </section>
  </HydrationUnit>
}

function Adder({ open, label, children }: { open: boolean; label: string; children: (close: () => void) => ReactNode }) {
  const [shown, setShown] = useState(open)
  if (!shown && !open) return <button className="st-button st-add" type="button" onClick={() => setShown(true)}>{label}</button>
  return <div className="st-adder">{children(() => setShown(false))}</div>
}

function ProductForm({ open, busy, onAdd }: { open: boolean; busy: boolean; onAdd: (args: Record<string, unknown>) => Promise<unknown> }) {
  const [form, setForm] = useState({ name: '', other_names: '', tone: '', competitors: '', avoid_words: '' })
  const field = (name: keyof typeof form, label: string, placeholder = '') => <label className="st-field">{label}
    <input value={form[name]} placeholder={placeholder} onChange={event => setForm({ ...form, [name]: event.target.value })} /></label>
  return <Adder open={open} label="Add product">{close => <form className="st-form" onSubmit={async event => {
    event.preventDefault()
    const done = await onAdd({ name: form.name.trim(), ...(form.tone.trim() ? { tone: form.tone.trim() } : {}), other_names: list(form.other_names), competitors: list(form.competitors), avoid_words: list(form.avoid_words) })
    if (done) { setForm({ name: '', other_names: '', tone: '', competitors: '', avoid_words: '' }); close() }
  }}>
    {field('name', 'Name')}{field('tone', 'Tone', 'plain, warm, exact')}{field('other_names', 'Other names', 'comma separated')}
    {field('competitors', 'Compared with', 'comma separated')}{field('avoid_words', 'Words to avoid', 'comma separated')}
    <button className="st-button primary" type="submit" disabled={busy || !form.name.trim()}>Add product</button>
  </form>}</Adder>
}

function ClaimForm({ open, busy, team, me: self, products, onAdd }: { open: boolean; busy: boolean; team: Team['items']; me: string; products: Product[]; onAdd: (args: Record<string, unknown>) => Promise<unknown> }) {
  const empty = { text: '', kind: 'allowed', proof: '', owner_id: self, review_on: '', reason: '', competitor: '', source_url: '', source_date: '', product_id: '' }
  const [form, setForm] = useState(empty)
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [name]: event.target.value })
  return <Adder open={open} label="Add claim">{close => <form className="st-form" onSubmit={async event => {
    event.preventDefault()
    const args: Record<string, unknown> = { text: form.text.trim(), kind: form.kind, owner_id: form.owner_id, ...(form.product_id ? { product_id: form.product_id } : {}) }
    if (form.kind === 'banned') args.reason = form.reason.trim()
    else { args.review_on = form.review_on; if (form.kind === 'allowed') args.proof = form.proof.trim(); else Object.assign(args, { competitor: form.competitor.trim(), source_url: form.source_url.trim(), source_date: form.source_date }) }
    if (await onAdd(args)) { setForm(empty); close() }
  }}>
    <label className="st-field">Claim<input value={form.text} placeholder="Recurring bookings" onChange={set('text')} /></label>
    <label className="st-field">Kind<select value={form.kind} onChange={set('kind')}><option value="allowed">May say, with proof</option><option value="banned">Must not say</option><option value="comparative">Comparison</option></select></label>
    {products.length ? <label className="st-field">Product<select value={form.product_id} onChange={set('product_id')}><option value="">Every product</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label> : null}
    {form.kind === 'banned' ? <label className="st-field">Reason<input value={form.reason} onChange={set('reason')} /></label> : <>
      {form.kind === 'allowed' ? <label className="st-field">Proof<input value={form.proof} placeholder="Link, document or number" onChange={set('proof')} /></label> : <>
        <label className="st-field">Competitor<input value={form.competitor} onChange={set('competitor')} /></label>
        <label className="st-field">Source<input type="url" value={form.source_url} onChange={set('source_url')} /></label>
        <label className="st-field">Source date<input type="date" value={form.source_date} onChange={set('source_date')} /></label>
      </>}
      <label className="st-field">Review on<input type="date" value={form.review_on} onChange={set('review_on')} /></label>
    </>}
    <label className="st-field">Owner<select value={form.owner_id} onChange={set('owner_id')}>{team.map(person => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select></label>
    <button className="st-button primary" type="submit" disabled={busy || !form.text.trim()}>Add claim</button>
  </form>}</Adder>
}

function VoiceForm({ open, busy, people, onAdd }: { open: boolean; busy: boolean; people: Team['items']; onAdd: (args: Record<string, unknown>) => Promise<unknown> }) {
  const empty = { person_id: people[0]?.id ?? '', samples: '', do: '', dont: '' }
  const [form, setForm] = useState(empty)
  const samples = form.samples.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean)
  return <Adder open={open} label="Add voice">{close => <form className="st-form st-form-wide" onSubmit={async event => {
    event.preventDefault()
    if (await onAdd({ person_id: form.person_id, samples, do: list(form.do), dont: list(form.dont) })) { setForm(empty); close() }
  }}>
    <label className="st-field">Person<select value={form.person_id} onChange={event => setForm({ ...form, person_id: event.target.value })}>{people.map(person => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select></label>
    <label className="st-field">Do<input value={form.do} placeholder="short, plain" onChange={event => setForm({ ...form, do: event.target.value })} /></label>
    <label className="st-field">Don't<input value={form.dont} placeholder="exclamation marks" onChange={event => setForm({ ...form, dont: event.target.value })} /></label>
    <label className="st-field st-span">Their own posts, a blank line between each ({samples.length})
      <textarea className="st-textarea" value={form.samples} rows={6} onChange={event => setForm({ ...form, samples: event.target.value })} /></label>
    <button className="st-button primary" type="submit" disabled={busy || !samples.length || !form.person_id}>Add voice</button>
  </form>}</Adder>
}
