import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Outcome, Saved, proofText, useLoaded, useRun, useSaved, words, SelectField } from '../stump/ui/kit.tsx'
import type { Team } from '../stump/ui/types.ts'
import { Disc } from '../stump/drafting/disc.tsx'
import type { ClaimView, Product, VoiceView } from '../stump/drafting/view.ts'

// From Compose's "Back claim" or "Update the proof": `item` (and `master`) is the draft to return to, `claim` the sentence to record as a claim.
type Search = { item?: string; master?: string; claim?: string }
export const Route = createFileRoute('/app/settings/brand')({
  validateSearch: (search: Record<string, unknown>): Search => Object.fromEntries((['item', 'master', 'claim'] as const)
    .filter(name => typeof search[name] === 'string' && search[name]).map(name => [name, search[name] as string])),
  component: BrandPage,
})

const key = () => crypto.randomUUID()
const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean)
/** "Jan 15, 2027", its parts joined by no-break spaces so a date never breaks across lines; a date in this calendar year drops its year ("Mar 3"). */
const shortDate = (value: string | null) => {
  if (!value) return ''
  const at = new Date(`${value}T00:00:00Z`), year = at.getUTCFullYear() !== new Date().getFullYear()
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(at).replace(/ /g, '\u00a0')
}
const bare = (value: string) => value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
/**
 * A proof as the claims list shows it: its own words (label, number, date, or the note typed after a link), then the page
 * that backs it as its address ("brightwell.app/changelog/3-2"), linked, so the reader sees which page it is and can open it.
 */
function Proof({ proof }: { proof: unknown }) {
  const isUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value)
  let words = '', url: string | null = null
  if (typeof proof === 'string') ({ url, words } = proofText(proof))
  else if (proof && typeof proof === 'object') {
    const { text, document, number, unit, url: page, date } = proof as Record<string, string | number | undefined>
    const amount = number === undefined ? undefined : unit === undefined ? number : /^[$€£¥]$/u.test(String(unit)) ? `${unit}${number}` : /^(%|x|×)$/iu.test(String(unit)) ? `${number}${unit}` : `${number} ${unit}`
    words = [text ?? document, amount, date].filter(item => item !== undefined && item !== null && item !== '').join(' · ')
    url = isUrl(page) ? page : null
  }
  return <>{words}{words && url ? ' · ' : ''}{url ? <a className="st-proof-link" href={url} target="_blank" rel="noreferrer noopener">{bare(url)}</a> : null}</>
}

function BrandPage() {
  const { item, master, claim: sentence } = Route.useSearch()
  const navigate = useNavigate()
  const { data, error, refresh } = useLoaded(async () => {
    const [who, products, claims, voices, team, draft] = await Promise.all([
      me(), runAction<{ items: Product[] }>('stump.brand.manage', { action: 'product_list' }), runAction<{ items: ClaimView[] }>('stump.brand.manage', { action: 'claim_list' }),
      runAction<{ items: VoiceView[] }>('stump.brand.manage', { action: 'voice_list' }), runAction<Team>('stump.team.manage', { action: 'list' }),
      item ? runAction<{ product_id: string | null }>('stump.drafts.revise', { action: 'get', item_id: item }) : null,
    ])
    return { who, products: products.items, claims: claims.items, voices: voices.items, team: team.items, draftProduct: draft?.product_id ?? null }
  })
  const draft = item ? { ...(master ? { master } : { item }) } : null
  /** A claim recorded from a draft's sentence backs that sentence (its wording joins the claim's), then the draft opens again with its check run. */
  async function backAndReturn(claimId: string) {
    if (!item || !draft) return
    const backed = sentence ? await run(() => runAction('stump.drafts.check', { action: 'back', item_id: item, claim_id: claimId, text: sentence, idempotency_key: key() })) : true
    if (backed !== undefined) await navigate({ to: '/app/compose', search: draft })
  }
  const { busy, message, run } = useRun()
  const { shown, saved } = useSaved()
  const editor = data ? ['owner', 'admin', 'editor'].includes(data.who.person.role) : false
  const writer = data ? data.who.person.role !== 'viewer' : false
  const name = (id: string) => data?.team.find(person => person.id === id)?.display_name ?? 'Someone who left'
  /** The product a claim backs, first on its line: one product's name, or "Every product" for a claim recorded for all of them. */
  const productOf = (claim: ClaimView) => claim.product_id === null ? 'Every product' : data?.products.find(product => product.id === claim.product_id)?.name ?? null

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
        {draft ? <p className="st-meta"><Link className="st-quiet-link" to="/app/compose" search={draft}>Back to the draft</Link></p> : null}
        {data && !data.claims.length ? <p className="st-meta">No claims yet. Drafts flag every product claim until one here backs it.</p> : null}
        <ul className="st-list">{data?.claims.map(claim => <li className="st-kv" key={claim.id}>
          <div className="st-name">{claim.kind === 'banned' ? <span className="st-pill danger">banned</span> : claim.stale ? <span className="st-pill danger">stale</span> : null}{claim.text}</div>
          <div className="st-meta">{productOf(claim) ? `${productOf(claim)} · ` : ''}{claim.kind === 'banned' ? `reason: ${claim.reason ?? ''}`
            : claim.kind === 'comparative' ? `vs ${claim.competitor ?? ''} · source ${shortDate(claim.source_date)} · owner ${name(claim.owner_id)} · review ${shortDate(claim.review_on)}`
            : <>proof: <Proof proof={claim.proof} /> · owner {name(claim.owner_id)} · review {shortDate(claim.review_on)}</>}</div>
        </li>)}</ul>
        {writer && data ? <ClaimForm key={sentence ?? ''} open={!data.claims.length || !!sentence} busy={busy} team={data.team.filter(person => person.status === 'active')} me={data.who.person.id} products={data.products}
          initial={sentence ? { text: sentence, product_id: data.draftProduct ?? '' } : null}
          onAdd={async args => { const made = await act({ action: 'claim_create', ...args }, 'Claim added') as { id: string } | undefined; if (made && draft) await backAndReturn(made.id); return made }} /> : null}
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
  // What the product is, who it is for, where it lives and what it is compared with: what each AI request and the claim check read
  // (STUMP-BRAND-001). Only the ones that hold a value show; one quiet button names the empty ones and opens just those (H15).
  const details = [
    { label: 'what it is', ask: 'what it is', value: product.description ?? '', hint: 'What it does, in a sentence', save: (value: string) => save({ description: value || null }) },
    { label: 'for', ask: "who it's for", value: product.audience ?? '', hint: 'Who it is for', save: (value: string) => save({ audience: value || null }) },
    { label: 'links', ask: 'links', value: product.urls.join(', '), hint: 'https://…', save: (value: string) => save({ urls: list(value) }) },
    { label: 'compared with', ask: 'comparisons', value: product.competitors.join(', '), hint: 'Competitors', save: (value: string) => save({ competitors: list(value) }) },
    { label: 'also called', ask: 'other names', value: product.other_names.join(', '), hint: 'Other names', save: (value: string) => save({ other_names: list(value) }) },
  ]
  const [revealed, setRevealed] = useState<string[]>([])
  const shown = details.filter(field => field.value || revealed.includes(field.label))
  const missing = details.filter(field => !shown.includes(field))
  const described = details.some(field => field.value)
  return <div className="st-profile">
    <div className="st-profile-tone">
      <ProfileField label="tone" product={product.name} value={product.tone} hint="How it sounds" onSave={tone => save({ tone })} />
      {words ? null : <button className="st-add-words st-add-words-inline" type="button" onClick={() => setOpen(true)}>Add words</button>}
    </div>
    {words ? <>
      <ProfileField label="use" product={product.name} value={product.words_use.join(', ')} hint="Words to use" focus={open && !product.words_use.length} allowEmpty onSave={value => save({ words_use: list(value) })} />
      <ProfileField label="avoid" product={product.name} value={product.words_avoid.join(', ')} hint="Words to avoid" allowEmpty onSave={value => save({ words_avoid: list(value) })} />
    </> : null}
    {shown.map(field => <ProfileField key={field.label} label={field.label} product={product.name} value={field.value} hint={field.hint} focus={revealed[0] === field.label} allowEmpty onSave={field.save} />)}
    {missing.length ? <button className="st-add-words" type="button" onClick={() => setRevealed(missing.map(field => field.label))}>
      {described ? `Add ${joined(missing.map(field => field.ask))}` : 'Add description, audience and links'}</button> : null}
  </div>
}

/** "a, b and c". */
const joined = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] ?? ''

/**
 * One profile field edited in place: it saves when the field loses focus (or on Enter), with no Save button. A field holding a value
 * reads as text and wraps onto as many lines as it needs at any width; an empty one is drawn as a field (SPEC 3.4) with a hint, so it
 * reads as a place to type, never as a value. Each value is one line of text, so a line break typed or pasted becomes a space.
 */
function ProfileField({ label, product, value, hint, focus = false, allowEmpty = false, onSave }: { label: string; product: string; value: string; hint: string; focus?: boolean; allowEmpty?: boolean; onSave: (value: string) => unknown }) {
  return <label className="st-inline">{label}:
    <textarea className={value ? undefined : 'st-profile-empty'} rows={1} defaultValue={value} placeholder={hint} aria-label={`${product} ${label}`} autoFocus={focus}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}
      onBlur={event => { const next = event.target.value.replace(/\s*\n\s*/g, ' ').trim(); if (next !== value && (next || allowEmpty)) void onSave(next) }} />
  </label>
}

function Adder({ open, label, children }: { open: boolean; label: string; children: (close: () => void) => ReactNode }) {
  const [shown, setShown] = useState(open)
  if (!shown && !open) return <button className="st-button st-add" type="button" onClick={() => setShown(true)}>{label}</button>
  return <div className="st-adder">{children(() => setShown(false))}</div>
}

function ProductForm({ open, busy, onAdd }: { open: boolean; busy: boolean; onAdd: (args: Record<string, unknown>) => Promise<unknown> }) {
  const empty = { name: '', description: '', audience: '', urls: '', other_names: '', tone: '', competitors: '', words_use: '', words_avoid: '' }
  const [form, setForm] = useState(empty)
  const field = (name: keyof typeof form, label: string, placeholder = '') => <label className="st-field">{label}
    <input value={form[name]} placeholder={placeholder} onChange={event => setForm({ ...form, [name]: event.target.value })} /></label>
  return <Adder open={open} label="Add product">{close => <form className="st-form" onSubmit={async event => {
    event.preventDefault()
    const done = await onAdd({ name: form.name.trim(), ...(form.tone.trim() ? { tone: form.tone.trim() } : {}), ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.audience.trim() ? { audience: form.audience.trim() } : {}), urls: list(form.urls), other_names: list(form.other_names), competitors: list(form.competitors),
      words_use: list(form.words_use), words_avoid: list(form.words_avoid) })
    if (done) { setForm(empty); close() }
  }}>
    {field('name', 'Name')}{field('description', 'What it is', 'Invoicing for freelancers')}{field('audience', 'Who it is for', 'US freelancers and small studios')}
    {field('urls', 'Links', 'https://example.com, comma separated')}{field('tone', 'Tone', 'plain, warm, exact')}{field('other_names', 'Other names', 'comma separated')}
    {field('competitors', 'Compared with', 'comma separated')}{field('words_use', 'Words to use', 'comma separated')}{field('words_avoid', 'Words to avoid', 'comma separated')}
    <button className="st-button primary" type="submit" disabled={busy || !form.name.trim()}>Add product</button>
  </form>}</Adder>
}

function ClaimForm({ open, busy, team, me: self, products, initial, onAdd }: { open: boolean; busy: boolean; team: Team['items']; me: string; products: Product[]; initial: { text: string; product_id: string } | null; onAdd: (args: Record<string, unknown>) => Promise<unknown> }) {
  const empty = { text: '', kind: 'allowed', proof: '', owner_id: self, review_on: '', reason: '', competitor: '', source_url: '', source_date: '', product_id: '' }
  const [form, setForm] = useState(initial ? { ...empty, ...initial } : empty)
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [name]: event.target.value })
  return <Adder open={open} label="Add claim">{close => <form className="st-form" onSubmit={async event => {
    event.preventDefault()
    const args: Record<string, unknown> = { text: form.text.trim(), kind: form.kind, owner_id: form.owner_id, ...(form.product_id ? { product_id: form.product_id } : {}) }
    if (form.kind === 'banned') args.reason = form.reason.trim()
    else { args.review_on = form.review_on; if (form.kind === 'allowed') args.proof = form.proof.trim(); else Object.assign(args, { competitor: form.competitor.trim(), source_url: form.source_url.trim(), source_date: form.source_date }) }
    if (await onAdd(args)) { setForm(empty); close() }
  }}>
    <label className="st-field">Claim<input value={form.text} placeholder="Recurring bookings" onChange={set('text')} /></label>
    <SelectField label="Kind" value={form.kind} onChange={set('kind')}><option value="allowed">May say, with proof</option><option value="banned">Must not say</option><option value="comparative">Comparison</option></SelectField>
    {products.length ? <SelectField label="Product" value={form.product_id} onChange={set('product_id')}><option value="">Every product</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectField> : null}
    {form.kind === 'banned' ? <label className="st-field">Reason<input value={form.reason} onChange={set('reason')} /></label> : <>
      {form.kind === 'allowed' ? <label className="st-field">Proof<input value={form.proof} placeholder="Link, document or number" onChange={set('proof')} /></label> : <>
        <label className="st-field">Competitor<input value={form.competitor} onChange={set('competitor')} /></label>
        <label className="st-field">Source<input type="url" value={form.source_url} onChange={set('source_url')} /></label>
        <label className="st-field">Source date<input type="date" value={form.source_date} onChange={set('source_date')} /></label>
      </>}
      <label className="st-field">Review on<input type="date" value={form.review_on} onChange={set('review_on')} /></label>
    </>}
    <SelectField label="Owner" value={form.owner_id} onChange={set('owner_id')}>{team.map(person => <option key={person.id} value={person.id}>{person.display_name}</option>)}</SelectField>
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
    <SelectField label="Person" value={form.person_id} onChange={event => setForm({ ...form, person_id: event.target.value })}>{people.map(person => <option key={person.id} value={person.id}>{person.display_name}</option>)}</SelectField>
    <label className="st-field">Do<input value={form.do} placeholder="short, plain" onChange={event => setForm({ ...form, do: event.target.value })} /></label>
    <label className="st-field">Don't<input value={form.dont} placeholder="exclamation marks" onChange={event => setForm({ ...form, dont: event.target.value })} /></label>
    <label className="st-field st-span">Their own posts, a blank line between each ({samples.length})
      <textarea className="st-textarea" value={form.samples} rows={6} onChange={event => setForm({ ...form, samples: event.target.value })} /></label>
    <button className="st-button primary" type="submit" disabled={busy || !samples.length || !form.person_id}>Add voice</button>
  </form>}</Adder>
}
