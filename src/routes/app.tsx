import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import branding from '../branding.json'
import { me } from '../stump/ui/api.ts'
import { Icon, navIcon } from '../stump/ui/icons.tsx'
import { Tip, initialsOf, useLoaded } from '../stump/ui/kit.tsx'
import { navigation } from '../stump/ui/nav.ts'
import { PauseBanner, PauseControl } from '../stump/ui/pause.tsx'
import { appStyles } from '../stump/ui/styles.ts'

export const Route = createFileRoute('/app')({
  head: () => ({ meta: [{ title: branding.name }] }),
  component: AppLayout,
})

const work = navigation.filter(entry => entry.group === 'work')
const settings = navigation.filter(entry => entry.group === 'settings')
const isSettings = (path: string) => settings.some(entry => path === entry.to || path.startsWith(`${entry.to}/`))

/** The sidebar (SPEC §4.1): daily work, then Settings pinned at the bottom. Settings screens show as tabs, not rows. */
function Sidebar({ path, onNavigate }: { path: string; onNavigate(): void }) {
  const inSettings = isSettings(path)
  return <nav className="st-side" id="st-side" aria-label="Stump">
    <a className="st-brand" href="/app"><img src="/brand/stump-mark.svg" alt="" width="40" height="40" />{branding.name}</a>
    <div className="st-nav">
      {work.map(entry => <Link key={entry.to} to={entry.to} onClick={onNavigate} activeOptions={{ exact: entry.to === '/app' }} activeProps={{ 'aria-current': 'page' }}>
        <Icon name={navIcon(entry.to)} />{entry.label}</Link>)}
    </div>
    {settings.length ? <div className="st-nav st-nav-foot">
      <a href={settings[0]!.to} aria-current={inSettings ? 'page' : undefined} onClick={onNavigate}><Icon name="gear" />Settings</a>
    </div> : null}
  </nav>
}

/** The Settings title and its underline tabs over every settings screen. */
function SettingsHead({ path }: { path: string }) {
  return <div className="st-settings-head">
    <p className="st-settings-title">Settings</p>
    <nav className="st-tabs" aria-label="Settings">
      {settings.map(entry => <Link key={entry.to} to={entry.to}
        aria-current={path === entry.to || path.startsWith(`${entry.to}/`) ? 'page' : undefined}>{entry.label}</Link>)}
    </nav>
  </div>
}

/** The avatar and its menu: the person's name, Profile and Sign out. */
function Avatar({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const press = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', press)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', press) }
  }, [open])
  async function signOut() {
    await fetch('/auth/signout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
    window.location.assign('/signin')
  }
  return <div className="st-pop-anchor" ref={ref}>
    <Tip label="Your account" side="below" align="end">
      <button type="button" className="st-avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`${name}, account menu`} onClick={() => setOpen(!open)}>{initialsOf(name)}</button>
    </Tip>
    {open ? <div className="st-menu" role="menu">
      <div className="st-menu-name"><div className="st-name">{name}</div><div className="st-meta">{email}</div></div>
      <a role="menuitem" href="/app/settings/team">Profile</a>
      <button role="menuitem" type="button" onClick={() => void signOut()}>Sign out</button>
    </div> : null}
  </div>
}

function AppLayout() {
  const { data } = useLoaded(me)
  const path = useRouterState({ select: state => state.location.pathname })
  const [drawer, setDrawer] = useState(false)
  const closeDrawer = useCallback(() => setDrawer(false), [])
  useEffect(() => { setDrawer(false) }, [path])
  useEffect(() => {
    if (!drawer) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawer(false) }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [drawer])
  // First-run setup is its own paper page, outside the shell (SPEC §4.2).
  if (path === '/app/setup') return <><style>{appStyles}</style><Outlet /></>
  return <>
    <style>{appStyles}</style>
    <div className={drawer ? 'st-shell drawer-open' : 'st-shell'}>
      <HydrationUnit><Sidebar path={path} onNavigate={closeDrawer} /></HydrationUnit>
      <HydrationUnit><button type="button" className="st-scrim" aria-label="Close menu" tabIndex={-1} onClick={closeDrawer} /></HydrationUnit>
      <div className="st-frame">
        <HydrationUnit>
          <header className="st-topbar">
            <Tip label="Menu" side="below" className="st-menu-tip">
              <button type="button" className="st-icon-button st-menu-button" aria-label="Menu" aria-controls="st-side" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}><Icon name="menu" /></button>
            </Tip>
            <a className="st-topbar-brand" href="/app"><img src="/brand/stump-mark.svg" alt="" width="28" height="28" />{branding.name}</a>
            <PauseControl role={data?.person.role} personId={data?.person.id} />
            <span className="st-topbar-divider" aria-hidden="true" />
            {data ? <Avatar name={data.person.display_name} email={data.person.email} /> : <span className="st-avatar" aria-hidden="true" />}
          </header>
        </HydrationUnit>
        <main className={isSettings(path) ? 'st-main st-settings' : 'st-main'}>
          <HydrationUnit><PauseBanner /></HydrationUnit>
          {isSettings(path) ? <HydrationUnit><SettingsHead path={path} /></HydrationUnit> : null}
          <Outlet />
        </main>
      </div>
    </div>
  </>
}
