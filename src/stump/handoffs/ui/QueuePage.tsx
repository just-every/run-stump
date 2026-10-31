import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { HydrationUnit } from '../../../base/hydration/unit'
import { me, runAction } from '../../ui/api.ts'
import { Chip, Empty, useLoaded } from '../../ui/kit.tsx'
import { handoffStyles } from './styles.ts'
import { rowTitle, shortWhen, STATE, type Handoff } from './words.ts'

/** Hand-offs still to post: the ones a tab counts. */
const WAITING = ['open', 'join_first', 'held']

/**
 * The hand-off queue (SPEC §4.2), ordered by due date; a poster sees only theirs. An owner or admin, who watches the whole
 * team's, opens on Everyone; anyone else on their own. Each tab counts the hand-offs still to post in it.
 */
export function QueuePage() {
  const { data, error } = useLoaded(async () => {
    const [who, queue] = await Promise.all([me(), runAction<{ items: Handoff[]; total: number; mine: number }>('stump.handoffs.manage', { action: 'queue' })])
    return { who, queue }
  })
  const [chosen, setScope] = useState<'mine' | 'everyone' | null>(null)
  const poster = data?.who.person.role === 'poster'
  const scope = chosen ?? (data && ['owner', 'admin'].includes(data.who.person.role) ? 'everyone' : 'mine')
  const mine = data ? data.queue.items.filter(item => item.person_id === data.who.person.id) : []
  const items = data ? poster || scope === 'mine' ? mine : data.queue.items : []
  const waiting = (list: Handoff[]) => list.filter(item => WAITING.includes(item.state)).length
  return <HydrationUnit>
    <style>{handoffStyles}</style>
    <section className="st-page st-handoffs" aria-labelledby="handoffs-title">
      <h1 id="handoffs-title">Hand-offs</h1>
      {error ? <p className="st-error" role="alert">{error}</p> : null}
      {data && !poster ? <div className="st-ho-toolbar">
        <div className="st-segmented" role="group" aria-label="Whose hand-offs">
          <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>Mine<span className="st-ho-tab-count">{waiting(mine)}</span></button>
          <button type="button" aria-pressed={scope === 'everyone'} onClick={() => setScope('everyone')}>Everyone<span className="st-ho-tab-count">{waiting(data.queue.items)}</span></button>
        </div>
      </div> : null}
      {data && !items.length ? <Empty title={scope === 'mine' || poster ? 'Nothing to post by hand' : 'No hand-offs yet'}>
        When a venue keeps posting for its members, the post comes here for the person who belongs there.
      </Empty> : null}
      {items.length ? <ul className="st-ho-list" aria-label="Hand-offs">
        {items.map(item => <li className="st-ho-row" key={item.id}>
          <Link to="/app/handoffs/$handoffId" params={{ handoffId: item.id }}>
            <div className="st-ho-main">
              <div className="st-ho-name">{rowTitle(item)}</div>
              <div className="st-ho-meta">{shortWhen(item)} · {item.person_name ?? 'Someone who left'}</div>
            </div>
            <Chip tone={STATE[item.state]!.tone} tick={STATE[item.state]!.tick}>{STATE[item.state]!.tick ? null : <span className="st-dot" aria-hidden="true" style={item.state === 'open' ? undefined : { background: 'currentColor' }} />}{STATE[item.state]!.label}</Chip>
          </Link>
        </li>)}
      </ul> : null}
    </section>
  </HydrationUnit>
}
