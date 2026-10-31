import { createFileRoute } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { me, runAction } from '../stump/ui/api.ts'
import { Icon } from '../stump/ui/icons.tsx'
import { Outcome, SelectField, networkWord, useLoaded, useRun } from '../stump/ui/kit.tsx'

// First-run setup (SPEC §4.2): after the owner confirms their account on Base's
// /setup, Stump asks only what must be answered (L6): the company and the owner's
// connection to it (which decides their disclosure line), its product, one account
// and the venues. The company site prefills the names (L5); every value stays
// editable and saves as you go, each with its own quiet mark under it.
export const Route = createFileRoute('/app/setup')({ head: () => ({ meta: [{ title: 'Set up Stump' }] }), component: SetupPage })

const key = () => crypto.randomUUID()
const CONNECTIONS = ['founder', 'employee', 'contractor', 'investor', 'advisor', 'friend', 'family'] as const
/** "a", "a and b", "a, b and c". */
const joined = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] ?? ''
interface Product { id: string; name: string; urls: string[] }
interface Account { id: string; network: string; handle: string; display_name: string | null; state: string }
interface LinkRules { own_domains: string[]; mediums: { published: string; handoff: string } | null }
/** The site's own domain, as Connections · Link tags lists it: "brightwell.com" from "https://www.brightwell.com/about". */
function domainOf(value: string): string | null {
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, '').toLowerCase() || null } catch { return null }
}

/** A step's stored value, read back from Stump after it saved: what Today and the rest of the app now use. */
const Stored = ({ children }: { children: ReactNode }) => <p className="st-setup-done"><span className="st-tick" aria-hidden="true"><Icon name="check" /></span><span>{children}</span></p>

function SetupPage() {
  const { data, refresh } = useLoaded(async () => {
    const who = await me()
    const may = (tool: string) => who.actions.includes(tool)
    const [products, accounts, venues, links] = await Promise.all([
      runAction<{ items: Product[]; company_names: string[] }>('stump.brand.manage', { action: 'product_list' }),
      may('stump.accounts.connect') ? runAction<{ items: Account[] }>('stump.accounts.connect', { action: 'list' }) : Promise.resolve({ items: [] as Account[] }),
      runAction<{ total: number }>('stump.venues.manage', { action: 'list' }),
      runAction<LinkRules>('stump.links.manage', { action: 'rules' }),
    ])
    return { who, products: products.items, company: products.company_names[0] ?? '', accounts: accounts.items.filter(account => account.state === 'connected'), venues: venues.total, links }
  })
  const { message, run } = useRun()
  // The company site is kept as the company's own domain (Settings · Connections, Link tags), so setup shows it when it reopens.
  const [typed, setSite] = useState<string | null>(null)
  const site = typed ?? data?.links.own_domains[0] ?? ''
  const [names, setNames] = useState<{ company: string; product: string } | null>(null)
  const [siteNote, setSiteNote] = useState<string | null>(null)
  const product = data?.products[0] ?? null
  const company = names?.company ?? data?.company ?? ''
  const productName = names?.product ?? product?.name ?? ''

  async function saveCompany(value: string) {
    if (!value || value === data?.company) return
    if (await run(() => runAction('stump.brand.manage', { action: 'company_update', company_names: [value], idempotency_key: key() }))) { await refresh() }
  }
  async function saveProduct(value: string, url?: string) {
    if (!value || (value === product?.name && !url)) return
    const urls = url ? [...new Set([...(product?.urls ?? []), url])] : undefined
    const done = await run(() => product
      ? runAction('stump.brand.manage', { action: 'product_update', product_id: product.id, name: value, ...(urls ? { urls } : {}), idempotency_key: key() })
      : runAction('stump.brand.manage', { action: 'product_create', name: value, ...(urls ? { urls } : {}), idempotency_key: key() }))
    if (done) { await refresh() }
  }
  async function saveDomain(domain: string) {
    const rules = data?.links
    if (!rules || rules.own_domains.includes(domain) || !['owner', 'admin'].includes(data.who.person.role)) return true
    return !!await run(() => runAction('stump.links.manage', { action: 'set_rules', own_domains: [domain, ...rules.own_domains].slice(0, 20),
      mediums: rules.mediums ?? { published: 'social', handoff: 'community' }, idempotency_key: key() }))
  }
  /** The owner's own connection to the company (STUMP-TEAM-001): the plain disclosure line their hand-offs carry follows from it. */
  async function saveConnection(value: string) {
    if (!data || !value || value === data.who.person.connection) return
    if (await run(() => runAction('stump.team.manage', { action: 'update', person_id: data.who.person.id, connection: value, idempotency_key: key() }))) await refresh()
  }
  /** URL first: the site's own name fills the company and the product where they are still empty, and stays editable. */
  async function readSite() {
    if (!site.trim() || typed === null) return
    const domain = domainOf(site.trim())
    if (!domain) return
    if (await saveDomain(domain)) { setSite(null); await refresh() }
    // A site Stump cannot read leaves the names to the owner: a quiet line says so, never a refusal code.
    setSiteNote(null)
    const read = await runAction<{ url: string; name: string | null }>('stump.brand.manage', { action: 'site_read', url: site.trim() }).catch(() => null)
    if (!read?.name) { setSiteNote(`Stump could not read ${domain}. Type the names below.`); return }
    const next = { company: data?.company || read.name, product: product?.name || read.name }
    setNames(next)
    if (!data?.company) await saveCompany(next.company)
    await saveProduct(next.product, read.url)
  }

  return <HydrationUnit>
    <div className="st-setup">
      <a className="st-setup-brand" href="/app"><img src="/brand/stump-mark.svg" alt="" width="40" height="40" />Stump</a>
      <img className="st-setup-plate" src="/art/stump-small.webp" alt="" width="180" height="116" />
      <h1>Set up Stump</h1>
      <section className="st-setup-card" aria-label="Setup steps">
        <ol className="st-setup-steps">
          <li>
            <span className="st-setup-num" aria-hidden="true">1</span>
            <div className="st-setup-fields">
              <h2>Company</h2>
              {/* URL first (L5): the site fills the names below, which stay editable. */}
              <label className="st-field">Company site
                <input value={site} placeholder="yourcompany.com" inputMode="url" autoComplete="url" maxLength={2048}
                  onChange={event => setSite(event.target.value)} onBlur={() => void readSite()} onKeyDown={event => { if (event.key === 'Enter') void readSite() }} />
              </label>
              {siteNote ? <p className="st-setup-note">{siteNote}</p> : null}
              <label className="st-field">Company name
                <input key={`c-${company}`} defaultValue={company} maxLength={120} autoComplete="organization" onBlur={event => void saveCompany(event.target.value.trim())} />
              </label>
              {data?.company ? <Stored>{data.company} saved</Stored> : null}
            </div>
          </li>
          <li>
            <span className="st-setup-num" aria-hidden="true">2</span>
            <div className="st-setup-fields">
              <h2>Product</h2>
              <label className="st-field">Product name
                <input key={`p-${productName}`} defaultValue={productName} maxLength={120} onBlur={event => void saveProduct(event.target.value.trim())} />
              </label>
              {product ? <Stored>{product.name} saved</Stored> : null}
              {/* The owner's connection names the company itself, so it reads the same here beside the product, and the steps keep Open Today in
                  the first screen. The select shows the stored value itself, so it needs no saved mark. */}
              {data && ['owner', 'admin'].includes(data.who.person.role) ? <>
                <SelectField label={`Your connection to ${company || 'the company'}`} value={data.who.person.connection ?? ''} onChange={event => void saveConnection(event.target.value)}>
                  {data.who.person.connection ? null : <option value="" disabled>Choose one</option>}
                  {CONNECTIONS.map(item => <option key={item} value={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</option>)}
                </SelectField>
              </> : null}
            </div>
          </li>
          <li>
            <span className="st-setup-num" aria-hidden="true">3</span>
            <div>
              <h2>Connect an account</h2>
              {/* One line: the networks connected, by name ("Mastodon and X connected"); Settings · Accounts lists each account. */}
              {data?.accounts.length ? <Stored>{joined([...new Set(data.accounts.map(account => networkWord(account.network)))])} connected</Stored> : null}
              <div className="st-setup-pills">
                <a className="st-setup-pill" href="/app/settings/accounts?connect=bluesky">Bluesky</a>
                <a className="st-setup-pill" href="/app/settings/accounts?connect=mastodon">Mastodon</a>
              </div>
            </div>
          </li>
          <li>
            <span className="st-setup-num" aria-hidden="true">4</span>
            <div>
              <h2>Bring your venues</h2>
              {data?.venues ? <Stored>{data.venues} {data.venues === 1 ? 'venue' : 'venues'}</Stored> : null}
              <div className="st-setup-pills">
                <span className="st-setup-pill-noted">
                  <a className="st-setup-pill" href="/app/venues?import=1">Import a venue list<span className="st-setup-pill-keep"> (Markdown or CSV)</span></a>
                  <span className="st-setup-pill-note" aria-hidden="true">Markdown or CSV</span>
                </span>
                <a className="st-setup-pill" href="/app/settings/import">Switch from Buffer</a>
              </div>
            </div>
          </li>
        </ol>
        <div className="st-setup-foot">
          <Outcome message={message?.error ? message : null} />
          <a className="st-button primary large" href="/app">Open Today <Icon name="arrowRight" /></a>
        </div>
      </section>
    </div>
  </HydrationUnit>
}
