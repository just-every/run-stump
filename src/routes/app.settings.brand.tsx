import { createFileRoute } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Outcome, Saved, pageName, useLoaded, useRun, useSaved, words } from '../stump/ui/kit.tsx'
import type { Team } from '../stump/ui/types.ts'
import { Disc } from '../stump/drafting/disc.tsx'
import type { ClaimView, Product, VoiceView } from '../stump/drafting/view.ts'

export const Route = createFileRoute('/app/settings/brand')({ component: BrandPage })

const key = () => crypto.randomUUID()
const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean)
/** "Jan 15, 2027", its parts joined by no-break spaces so a date never breaks across lines; a date within the next 12 months drops its year ("Jan 15"). */
const shortDate = (value: string | null, soon = false) => {
  if (!value) return ''
  const at = new Date(`${value}T00:00:00Z`), now = new Date(), inAYear = new Date(now); inAYear.setFullYear(now.getFullYear() + 1)
  const year = !(soon && at >= new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z') && at < inAYear)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(at).replace(/ /g, '\u00a0')
}
const bare = (value: string) => value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
/** A proof in a few words: its own label, else its number and where it lives. */
const proofText = (proof: unknown) => {
  if (typeof proof === 'string') return /^https?:\/\//.test(proof) ? pageName(proof) : bare(proof)
  if (!proof || typeof proof !== 'object') return ''
  const { text, document, number, unit, url, date } = proof as Record<string, string | number | undefined>
  const amount = number === undefined ? undefined : unit === undefined ? number : /^[$€£¥]$/u.test(String(unit)) ? `${unit}${number}` : /^(%|x|×)$/iu.test(String(unit)) ? `${number}${unit}` : `${number} ${unit}`
  return [text ?? document, amount, text || document ? null : url ? pageName(String(url)) : null, date].filter(item => item !== undefined && item !== null && item !== '').join(' · ')
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
  const { shown, saved } = useSaved()
  const editor = data ? ['owner', 'admin', 'editor'].includes(data.who.person.role) : false
  const writer = data ? data.who.person.role !== 'viewer' : false
  const name = (id: string) => data?.team.find(person => person.id === id)?.display_name ?? 'Someone who left'

  async function act(args: Record<string, unknown>, done?: string) {
    const result = await run(() => runAction('stump.brand.manage', { ...args, idempotency_key: key() }), () => done)
    if (result !== undefined) saved()
    await refresh()
    return result
  }

  return <HydrationUnit>
    <section className="st-page st-drafting" aria-labelledby="brand-title">
      <h1 id="brand-title" className="st-sr">Brand</h1>
      {error ? <p className="st-error">{error}</p> : null}

      <section className="st-card st-brand-products" aria-labelledby="products-title">
        <h2 className="st-card-head" id="products-title"><Disc icon="box" />Products</h2>
        <ul className="st-list">{data?.products.map(product => <li className="st-kv" key={product.id}>
          <div className="st-name">{product.name}{product.other_names.length ? <div className="st-meta">also {product.other_names.join(', ')}</div> : null}</div>
          {editor ? <ProductProfile product={product} save={args => act({ action: 'product_update', product_id: product.id, ...args })} /> : <span className="st-meta">tone: {product.tone || 'not set'}{product.words_use.length ? ` · use: ${product.words_use.join(', ')}` : ''}{product.words_avoid.length ? ` · avoid: ${product.words_avoid.join(', ')}` : ''}</span>}
        </li>)}</ul>
        {editor ? <ProductForm open={data !== null && !data.products.length} busy={busy} onAdd={args => act({ action: 'product_create', ...args }, 'Product added')} /> : null}
      </section>

      <section className="st-card" aria-labelledby="claims-title">
        <h2 className="st-card-head" id="claims-title"><Disc icon="doc" />Claims</h2>
        {data && !data.claims.length ? <p className="st-meta">No claims yet. Drafts flag every product claim until one here backs it.</p> : null}
        <ul className="st-list">{data?.claims.map(claim => <li className="st-kv" key={claim.id}>
          <div className="st-name">{claim.kind === 'banned' ? <span className="st-pill danger">banned</span> : claim.stale ? <span className="st-pill danger">stale</span> : null}{claim.text}</div>
          <div className="st-meta">{claim.kind === 'banned' ? `reason: ${claim.reason ?? ''}`
            : claim.kind === 'comparative' ? `vs ${claim.competitor ?? ''} · source ${shortDate(claim.source_date)} · owner ${name(claim.owner_id)} · review ${shortDate(claim.review_on, true)}`
            : `proof: ${proofText(claim.proof)} · owner ${name(claim.owner_id)} · review ${shortDate(claim.review_on, true)}`}</div>
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
      <div className="st-saved"><Outcome message={message?.error || (message && message.text !== 'Saved') ? message : null} /><Saved shown={shown && !busy} /></div>
    </section>
  </HydrationUnit>
}

/**
 * A product's voice in one line (H15): its tone, then a quiet "Add words" that opens the words to use and to avoid. The lists show
 * under the tone once they hold words.
 */
function ProductProfile({ product, save }: { product: Product; save: (args: Record<string, unknown>) => unknown }) {
  const [open, setOpen] = useState(false)
  const words = open || product.words_use.length > 0 || product.words_avoid.length > 0
  return <div className="st-profile">
    <div className="st-profile-tone">
      <ProfileField label="tone" product={product.name} value={product.tone} onSave={tone => save({ tone })} />
      {words ? null : <button className="st-add-words st-add-words-inline" type="button" onClick={() => setOpen(true)}>Add words</button>}
    </div>
    {words ? <>
      <ProfileField label="use" product={product.name} value={product.words_use.join(', ')} focus={open && !product.words_use.length} allowEmpty onSave={value => save({ words_use: list(value) })} />
      <ProfileField label="avoid" product={product.name} value={product.words_avoid.join(', ')} allowEmpty onSave={value => save({ words_avoid: list(value) })} />
    </> : null}
  </div>
}

/** One profile field edited in place: it saves when the field loses focus, with no Save button. An empty one is an "Add words" action, never a hint that reads as a value. */
function ProfileField({ label, product, value, focus = false, allowEmpty = false, onSave }: { label: string; product: string; value: string; focus?: boolean; allowEmpty?: boolean; onSave: (value: string) => unknown }) {
  return <label className="st-inline">{label}:
    <input defaultValue={value} aria-label={`${product} ${label}`} autoFocus={focus}
      onBlur={event => { const next = event.target.value.trim(); if (next !== value && (next || allowEmpty)) void onSave(next) }} />
  </label>
}

function Adder({ open, label, children }: { open: boolean; label: string; children: (close: () => void) => ReactNode }) {
  const [shown, setShown] = useState(open)
  if (!shown && !open) return <button className="st-button st-add" type="button" onClick={() => setShown(true)}>{label}</button>
  return <div className="st-adder">{children(() => setShown(false))}</div>
}

function ProductForm({ open, busy, onAdd }: { open: boolean; busy: boolean; onAdd: (args: Record<string, unknown>) => Promise<unknown> }) {
  const empty = { name: '', other_names: '', tone: '', competitors: '', words_use: '', words_avoid: '' }
  const [form, setForm] = useState(empty)
  const field = (name: keyof typeof form, label: string, placeholder = '') => <label className="st-field">{label}
    <input value={form[name]} placeholder={placeholder} onChange={event => setForm({ ...form, [name]: event.target.value })} /></label>
  return <Adder open={open} label="Add product">{close => <form className="st-form" onSubmit={async event => {
    event.preventDefault()
    const done = await onAdd({ name: form.name.trim(), ...(form.tone.trim() ? { tone: form.tone.trim() } : {}), other_names: list(form.other_names), competitors: list(form.competitors),
      words_use: list(form.words_use), words_avoid: list(form.words_avoid) })
    if (done) { setForm(empty); close() }
  }}>
    {field('name', 'Name')}{field('tone', 'Tone', 'plain, warm, exact')}{field('other_names', 'Other names', 'comma separated')}
    {field('competitors', 'Compared with', 'comma separated')}{field('words_use', 'Words to use', 'comma separated')}{field('words_avoid', 'Words to avoid', 'comma separated')}
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
