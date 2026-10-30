import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import branding from '../branding.json'
import { me } from '../stump/ui/api.ts'
import { useLoaded, words } from '../stump/ui/kit.tsx'
import { navigation } from '../stump/ui/nav.ts'
import { appStyles } from '../stump/ui/styles.ts'

export const Route = createFileRoute('/app')({
  head: () => ({ meta: [{ title: branding.name }] }),
  component: AppLayout,
})

function Group({ group, label }: { group: 'work' | 'settings'; label?: string }) {
  return <div className="st-nav">
    {label ? <div className="st-nav-label">{label}</div> : null}
    {navigation.filter(entry => entry.group === group).map(entry =>
      <Link key={entry.to} to={entry.to} activeOptions={{ exact: true }} activeProps={{ 'aria-current': 'page' }}>{entry.label}</Link>)}
  </div>
}

function AppLayout() {
  const { data } = useLoaded(me)
  return <>
    <style>{appStyles}</style>
    <div className="st-shell">
      <HydrationUnit>
        <nav className="st-side" aria-label="Stump">
          <a className="st-brand" href="/app"><img src="/brand/mark.svg" alt="" />{branding.name}</a>
          <Group group="work" />
          <Group group="settings" label="Settings" />
          <div className="st-who">{data ? `${data.person.display_name} · ${words(data.person.role)}` : ' '}</div>
        </nav>
      </HydrationUnit>
      <main className="st-main"><Outlet /></main>
    </div>
  </>
}
