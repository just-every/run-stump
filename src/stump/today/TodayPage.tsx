import { Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import type { ItemRecord } from '../drafting/records.ts'
import type { Account } from '../drafting/view.ts'
import type { Handoff } from '../handoffs/ui/words.ts'
import { CONTRIBUTORS, READERS, type Role } from '../people/roles.ts'
import { me, runAction } from '../ui/api.ts'
import { Icon } from '../ui/icons.tsx'
import { Chip, PanelTitle, useLoaded } from '../ui/kit.tsx'
import { JOB_WORDS, chipsFor, jobOf } from '../watches/finding-view.ts'
import type { FindingList, WatchList } from '../watches/ui-types.ts'
import { dayOf, dueToday, findingChips, goingOut, heldRows, worthAnswering, type Day, type Dest } from './sections.ts'

// Today (SPEC §4.2): what needs this person today, each row opening the screen
// that owns it. Every figure comes from the person door's existing reads.

const page = <T,>(tool: string, args: Record<string, unknown>) => runAction<{ items: T[]; total: number }>(tool, args)

async function loadWork() {
  const who = await me()
  const reader = READERS.includes(who.person.role as Role)
  const [queue, held, drafts, scheduled, paused, accounts, venues, products] = await Promise.all([
    page<Handoff>('stump.handoffs.manage', { action: 'queue' }),
    page<ItemRecord>('stump.drafts.revise', { action: 'list', state: 'held' }),
    page<ItemRecord>('stump.drafts.revise', { action: 'list', state: 'draft' }),
    page<ItemRecord>('stump.drafts.revise', { action: 'list', state: 'scheduled' }),
    page<ItemRecord>('stump.drafts.revise', { action: 'list', state: 'paused' }),
    page<Account>('stump.accounts.connect', { action: 'list' }),
    reader ? page<{ id: string; name: string }>('stump.venues.manage', { action: 'list' }) : null,
    page<{ id: string; name: string }>('stump.brand.manage', { action: 'product_list' }),
  ])
  return {
    who, queue: queue.items, items: [...held.items, ...drafts.items, ...scheduled.items, ...paused.items],
    accounts: new Map(accounts.items.map(account => [account.id, account])),
    venues: new Map((venues?.items ?? []).map(venue => [venue.id, venue.name])),
    products: new Map(products.items.map(product => [product.id, product.name])),
  }
}

async function loadFindings() {
  const who = await me()
  if (!READERS.includes(who.person.role as Role)) return null
  const [watches, products] = await Promise.all([runAction<WatchList>('stump.watches.manage', { action: 'list' }),
    runAction<{ items: Array<{ id: string; name: string }> }>('stump.brand.manage', { action: 'product_list' })])
  const lists = await Promise.all(watches.items.filter(watch => !watch.muted)
    .map(watch => runAction<FindingList>('stump.findings.work', { action: 'list', watch_id: watch.id, limit: 5 })))
  // Each finding carries Listening's own chips and job, so the two screens say the same thing about it.
  const byId = new Map(watches.items.map(watch => [watch.id, watch]))
  const items = worthAnswering(lists.map(list => list.items)).map(finding => ({ finding, chips: chipsFor(finding, byId.get(finding.watch_id), products.items),
    job: who.person.role === 'viewer' ? null : jobOf(finding) }))
  return { watches: watches.total, items }
}

/** The week's counts from the ledger: posts published and posts handed off and confirmed. */
async function loadWeek(day: Day) {
  const since = new Date(day.week).toISOString()
  const [posted, handed] = await Promise.all([
    page<unknown>('stump.ledger.search', { action: 'search', route: 'published', state: 'posted', from: since, limit: 1 }),
    page<unknown>('stump.ledger.search', { action: 'search', route: 'handed_off', state: 'posted', from: since, limit: 1 }),
  ])
  return { posted: posted.total, handed: handed.total }
}

function Go({ to, className, children }: { to: Dest; className?: string; children: ReactNode }) {
  switch (to.kind) {
    case 'handoff': return <Link className={className} to="/app/handoffs/$handoffId" params={{ handoffId: to.id }}>{children}</Link>
    case 'compose': return <Link className={className} to="/app/compose" search={{ ...(to.master ? { master: to.master } : {}), ...(to.item ? { item: to.item } : {}), ...(to.fix ? { fix: to.fix } : {}) }}>{children}</Link>
    case 'listening': return <Link className={className} to="/app/listening" search={{ watch: to.watch, finding: to.finding, ...(to.act ? { act: true as const } : {}) }}>{children}</Link>
  }
}

/** A held row's meta line, with the words that name a venue's thread linked to it; the address itself never shows. */
function Reason({ row }: { row: { meta: string; thread: { words: string; url: string } | null } }) {
  if (!row.thread) return <>{row.meta}</>
  const at = row.meta.indexOf(row.thread.words)
  return <>{row.meta.slice(0, at)}<a href={row.thread.url} target="_blank" rel="noopener noreferrer">{row.thread.words}</a>{row.meta.slice(at + row.thread.words.length)}</>
}

/** A plain warm line for a section with nothing in it, with the one place that fills it. */
function Nothing({ children }: { children: ReactNode }) {
  return <p className="st-today-empty">{children}</p>
}

function Failed({ error }: { error: string | null }) {
  return error ? <p className="st-error" role="alert">{error}</p> : null
}

export function TodayPage() {
  // The day is the viewer's own, read once in the browser, so the server's clock never shows.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => { setNow(Date.now()) }, [])
  const day = now === null ? null : dayOf(now)
  const work = useLoaded(loadWork)
  const findings = useLoaded(loadFindings)
  const week = useLoaded(async () => day ? loadWeek(day) : null)
  const weekRefresh = week.refresh
  useEffect(() => { if (day) void weekRefresh() }, [day?.week, weekRefresh])
  // Held shows three rows; the rest open in place, so the pair of cards stays short and even.
  const [allHeld, setAllHeld] = useState(false)

  const personId = work.data?.who.person.id ?? ''
  const due = work.data && day ? dueToday(work.data.queue, personId, day) : null
  const held = work.data ? heldRows(work.data.items, work.data.queue, personId, work.data.venues, work.data.accounts, work.data.products) : null
  const out = work.data && day ? goingOut(work.data.items, work.data.accounts, day) : null
  // A poster reads only their own work; Listening's findings are for the rest of the team.
  const reader = !work.data || READERS.includes(work.data.who.person.role as Role)
  const writer = !!work.data && CONTRIBUTORS.includes(work.data.who.person.role as Role)
  const [focal, ...moreDue] = due?.rows ?? []
  const shownHeld = held ? allHeld ? held : held.slice(0, 3) : []

  return <HydrationUnit>
    <section className="st-page st-today" aria-labelledby="today-title">
      <h1 id="today-title">Today</h1>
      <p className="st-lead">{now === null ? ' ' : new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(now))}</p>
      <div className="st-today-grid">
        <div className="st-today-main">
          <section className="st-panel focus" aria-labelledby="today-due">
            <PanelTitle icon="clock" id="today-due">Due today</PanelTitle>
            <Failed error={work.error} />
            {focal ? <>
              <p className="st-today-focal">{focal.title} · {focal.due}</p>
              <p className="st-today-who">{focal.who}</p>
              <Go className="st-button primary" to={{ kind: 'handoff', id: focal.id }}>Open brief <Icon name="arrowRight" /></Go>
              {moreDue.length ? <ul className="st-list st-today-more">
                {moreDue.map(row => <li className="st-row" key={row.id}>
                  <div className="st-row-main"><div className="st-name">{row.title} · {row.due}</div><div className="st-meta">{row.who}</div></div>
                  <Go className="st-button quiet small" to={{ kind: 'handoff', id: row.id }}>Open brief</Go>
                </li>)}
              </ul> : null}
            </> : due ? <Nothing>
              Nothing to post by hand today.{' '}
              {due.next ? <>Next up: <Go to={{ kind: 'handoff', id: due.next.id }}>{due.next.title}</Go>, due {due.next.when}.</> : <>When a members-only venue needs a post, it lands here for the person who belongs there.</>}
            </Nothing> : null}
          </section>

          <div className={reader ? 'st-today-pair' : 'st-today-pair single'}>
            <section className="st-panel" aria-labelledby="today-held">
              <PanelTitle icon="arrows" id="today-held">Held</PanelTitle>
              <Failed error={work.error} />
              {held && !held.length ? <Nothing>Nothing is held. Every draft is clear to go.</Nothing> : null}
              {shownHeld.length ? <ul className="st-list">
                {shownHeld.map(row => <li className="st-row" key={row.key}>
                  <div className="st-row-main"><div className="st-name">{row.name}</div><div className="st-meta st-today-reason"><Reason row={row} /></div></div>
                  <Go className="st-button quiet small" to={row.action.to}>{row.action.label}</Go>
                </li>)}
              </ul> : null}
              {held && held.length > 3 ? <button type="button" className="st-today-all" aria-expanded={allHeld} onClick={() => setAllHeld(!allHeld)}>
                {allHeld ? 'Show fewer' : `And ${held.length - shownHeld.length} more held`}</button> : null}
            </section>

            {reader ? <section className="st-panel" aria-labelledby="today-worth">
              <PanelTitle icon="speech" id="today-worth">Worth answering</PanelTitle>
              <Failed error={findings.error} />
              {findings.data && !findings.data.items.length ? <Nothing>
                {findings.data.watches ? 'No new threads worth answering. Your watches keep looking.' : <>Nothing to answer yet. <Link to="/app/listening">Add a watch</Link> and threads worth answering show up here.</>}
              </Nothing> : null}
              {findings.data?.items.map(({ finding, chips, job }, index) => <div className="st-today-finding" key={finding.id}>
                <Go className="st-today-finding-title" to={{ kind: 'listening', watch: finding.watch_id, finding: finding.id }}>{finding.title || finding.text.slice(0, 100)}</Go>
                <ul className="st-chips" aria-label="Why it is worth a look">{findingChips(chips, finding, now ?? Date.now()).map(chip => <li className="st-chip" key={chip}>{chip}</li>)}</ul>
                {/* The finding's own job, as Listening's focal row offers it; it opens there with the job started. */}
                {index === 0 ? <Go className="st-button primary small" to={{ kind: 'listening', watch: finding.watch_id, finding: finding.id, act: !!job }}>{job ? JOB_WORDS[job] : 'Open in Listening'} <Icon name="arrowRight" /></Go> : null}
              </div>)}
            </section> : null}
          </div>

          <section className="st-panel" aria-labelledby="today-out">
            <PanelTitle icon="send" id="today-out">Going out today</PanelTitle>
            <Failed error={work.error} />
            {out && !out.length ? <Nothing>Nothing scheduled for today.{writer ? <> <Link to="/app/compose">Write a post</Link> and pick a time.</> : ' Posts the team schedules for today show here.'}</Nothing> : null}
            {out?.length ? <ul className="st-list">
              {out.map(row => {
                const line = <><span className="st-today-out-line">{row.time} · {row.network}{row.who ? ` · ${row.who}` : ''}{row.text ? ` · ${row.text}` : ''}</span>{row.paused ? <Chip tone="held">Paused</Chip> : null}</>
                return <li className="st-row" key={row.id}><Go className="st-today-out" to={row.to}>{line}</Go></li>
              })}
            </ul> : null}
          </section>
        </div>

        <aside className="st-panel side st-today-week" aria-labelledby="today-week">
          <PanelTitle icon="chart" id="today-week">This week</PanelTitle>
          <ul>
            <li><Link className="st-today-count" to="/app/ledger"><span className="st-disc big">{week.data?.posted ?? ' '}</span>posted</Link></li>
            <li><span className="st-disc big">{week.data?.handed ?? ' '}</span>handed off</li>
          </ul>
        </aside>
      </div>
    </section>
  </HydrationUnit>
}

