import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { HydrationUnit } from '../../../base/hydration/unit'
import { me, runAction } from '../../ui/api.ts'
import { useLoaded } from '../../ui/kit.tsx'
import { KIND_FIELDS, STATUS_LABELS } from '../kinds.ts'
import { ImportPanel } from './ImportPanel.tsx'
import { kindLabel, nextOpen, primaryRoute, statusLabel, statusTone } from './labels.ts'
import type { Venue, VenueList } from './types.ts'
import { VenueForm } from './VenueForm.tsx'

interface Filters { kind?: string; status?: string; priority?: string; product_id?: string; include_excluded?: boolean; include_archived?: boolean }
const FILTER_WORDS: Record<keyof Filters, (value: string, products: Map<string, string>) => string> = {
  kind: kindLabel, status: statusLabel, priority: value => `${value[0]!.toUpperCase()}${value.slice(1)} priority`,
  product_id: (value, products) => products.get(value) ?? 'Product', include_excluded: () => 'Excluded shown', include_archived: () => 'Archived shown',
}

function StatusChip({ status }: { status: string }) {
  const tone = statusTone(status)
  return <span className={`st-chip ${tone}`}><span className={`st-dot${tone === 'ok' ? '' : ' open'}`} aria-hidden="true" />{statusLabel(status)}</span>
}

/** The venue register: search, filters, the table, adding a venue and importing a list (STUMP-VENUE-001, -004). */
export function VenuesPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState(''), [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>({})
  const [panel, setPanel] = useState<'none' | 'filters' | 'add' | 'import'>('none')
  const { data, error, refresh } = useLoaded(async () => ({
    me: await me(),
    list: await runAction<VenueList>('stump.venues.manage', { action: 'list', ...filters, ...(search ? { q: search } : {}) }),
  }))
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 250); return () => clearTimeout(timer) }, [query])
  useEffect(() => { void refresh() }, [filters, search, refresh])
  const editor = data ? ['owner', 'admin', 'editor'].includes(data.me.person.role) : false
  const owner = data?.me.person.role === 'owner'
  const products = useMemo(() => new Map((data?.list.items ?? []).flatMap(venue => venue.products.map(item => [item.product_id, item.name ?? 'Product'] as const))), [data])
  const applied = Object.entries(filters).filter(([, value]) => value !== undefined && value !== false) as Array<[keyof Filters, string | boolean]>
  const empty = data && data.list.total === 0 && !applied.length && !search
  const set = (name: keyof Filters, value: string | boolean | undefined) => setFilters(current => ({ ...current, [name]: value === '' ? undefined : value }))
  const changed = () => { void refresh() }

  return <HydrationUnit>
    <section className="st-page" aria-labelledby="venues-title" style={{ maxWidth: 1120 }}>
      <h1 id="venues-title">Venues</h1>
      <p className="st-sub">Communities, newsletters, podcasts and journalists worth showing up in.</p>
      {error ? <p className="st-error" role="alert">{error}</p> : null}
      {empty && panel === 'none' ? <div className="st-empty">
        <h2>Add your first venue</h2>
        <p>Communities, newsletters, podcasts and journalists worth showing up in.</p>
        <div className="st-actions">
          {editor ? <button className="st-button primary pill" type="button" onClick={() => setPanel('add')}>Add your first venue</button> : null}
          {owner ? <button className="st-button pill outline" type="button" onClick={() => setPanel('import')}>Import a venue list</button> : null}
        </div>
      </div> : <>
        <div className="st-toolbar" role="search">
          <div className="st-grow"><input className="st-search" type="search" aria-label="Search venues" placeholder="Search venues…" value={query} onChange={event => setQuery(event.target.value)} /></div>
          <button className="st-button pill outline" type="button" aria-expanded={panel === 'filters'} onClick={() => setPanel(panel === 'filters' ? 'none' : 'filters')}>Filters{applied.length ? ` (${applied.length})` : ''}</button>
          {editor ? <button className="st-button primary pill st-end" type="button" onClick={() => setPanel('add')}>+ Add venue</button> : null}
        </div>
        {applied.length ? <div className="st-chips" aria-label="Applied filters">{applied.map(([name, value]) =>
          <button key={name} className="st-chip" type="button" aria-label={`Remove filter ${FILTER_WORDS[name](String(value), products)}`} onClick={() => set(name, undefined)}>{FILTER_WORDS[name](String(value), products)} ×</button>)}</div> : null}
        {panel === 'filters' ? <div className="st-card" aria-label="Filters">
          <div className="st-form">
            <label className="st-field">Kind<select value={filters.kind ?? ''} onChange={event => set('kind', event.target.value)}><option value="">Any kind</option>{Object.entries(KIND_FIELDS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
            <label className="st-field">Status<select value={filters.status ?? ''} onChange={event => set('status', event.target.value)}><option value="">Any status</option>{Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="st-field">Priority<select value={filters.priority ?? ''} onChange={event => set('priority', event.target.value)}><option value="">Any priority</option>{['top', 'high', 'medium', 'low'].map(item => <option key={item} value={item}>{item[0]!.toUpperCase() + item.slice(1)}</option>)}</select></label>
            <label className="st-field">Product<select value={filters.product_id ?? ''} onChange={event => set('product_id', event.target.value)}><option value="">Any product</option>{[...products].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          </div>
          <div className="st-actions" style={{ marginTop: 12 }}>
            <label><input type="checkbox" checked={filters.include_excluded === true} onChange={event => set('include_excluded', event.target.checked || undefined)} /> Show excluded</label>
            <label><input type="checkbox" checked={filters.include_archived === true} onChange={event => set('include_archived', event.target.checked || undefined)} /> Show archived</label>
          </div>
        </div> : null}
      </>}
      {panel === 'add' ? <VenueForm onDone={venue => { setPanel('none'); void navigate({ to: '/app/venues/$venueId', params: { venueId: venue.id } }) }} onCancel={() => setPanel('none')} onImport={owner ? () => setPanel('import') : undefined} /> : null}
      {panel === 'import' ? <ImportPanel onChanged={changed} onClose={() => setPanel('none')} /> : null}
      {data && !empty ? data.list.items.length ? <table className="st-table">
        <thead><tr><th>Venue</th><th className="st-cell">Kind</th><th className="st-cell">Status</th><th className="st-cell">Route</th><th className="st-cell">Next open</th></tr></thead>
        <tbody>{data.list.items.map(venue => <Row key={venue.id} venue={venue} open={() => void navigate({ to: '/app/venues/$venueId', params: { venueId: venue.id } })} />)}</tbody>
      </table> : <p className="st-note">No venues match.</p> : null}
      {data && !empty ? <p className="st-note">{data.list.total} {data.list.total === 1 ? 'venue' : 'venues'}{owner && panel !== 'import' ? <> · <button className="st-value" type="button" style={{ minHeight: 0, padding: 0, color: 'inherit' }} onClick={() => setPanel('import')}>Import a venue list</button></> : null}</p> : null}
    </section>
  </HydrationUnit>
}

function Row({ venue, open }: { venue: Venue; open(): void }) {
  const route = primaryRoute(venue), next = venue.shared_limit ? nextOpen(venue.next_open_at) : null
  return <tr onClick={open}>
    <td>
      <Link to="/app/venues/$venueId" params={{ venueId: venue.id }} onClick={event => event.stopPropagation()}>{venue.name}</Link>
      {venue.archived ? <span className="st-chip" style={{ marginLeft: 8 }}>Archived</span> : null}
      <div className="st-rowline">{[kindLabel(venue.kind), statusLabel(venue.status), route].filter(Boolean).join(' · ')}</div>
    </td>
    <td className="st-cell">{kindLabel(venue.kind)}</td>
    <td className="st-cell"><StatusChip status={venue.status} /></td>
    <td className="st-cell">{route ? <span className="st-chip ok">{route}</span> : '–'}</td>
    <td className="st-cell">{next ?? '–'}</td>
  </tr>
}
