import { Link, createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import { runAction } from '../stump/ui/api.ts'
import { useLoaded } from '../stump/ui/kit.tsx'
import type { PauseState, Team } from '../stump/ui/types.ts'

export const Route = createFileRoute('/app/')({ component: Overview })

function Overview() {
  const { data } = useLoaded(async () => ({
    pause: await runAction<PauseState>('stump.calendar.pause', { action: 'state' }),
    team: await runAction<Team>('stump.team.manage', { action: 'list' }),
  }))
  const paused = data?.pause.paused.some(scope => scope.scope === 'all')
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="overview-title">
      <h1 id="overview-title">Overview</h1>
      <p className="st-lead">Your earned-channels desk. Venues, drafts and the ledger arrive here as they are built.</p>
      <div className="st-status">
        <div><span className={paused ? 'st-dot paused' : 'st-dot'} aria-hidden="true" /><strong>{data ? paused ? 'Publishing is paused' : 'Publishing is on' : ' '}</strong></div>
        <Link className="st-button" to="/app/settings/publishing">Publishing settings</Link>
      </div>
      <h2>Team</h2>
      <p>{data ? `${data.team.total} ${data.team.total === 1 ? 'person' : 'people'} on the team.` : ' '} <Link to="/app/settings/team">Open the team</Link></p>
    </section>
  </HydrationUnit>
}
