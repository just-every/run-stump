import { links } from './links'

/** The lockup: the mark and "Stump" as live text (SPEC §6). */
export function Lockup({ size = 'header' }: { size?: 'header' | 'footer' }) {
  return <a className={`site-lockup site-lockup--${size}`} href={links.home}>
    <img src="/brand/stump-mark.svg" alt="" width="40" height="46" /><span>Stump</span>
  </a>
}

/** The site header: the lockup, Docs, GitHub and the "Run Stump" pill (no pill on phones). */
export function Header({ current }: { current?: 'docs' }) {
  return <header className="site-header">
    <div className="site-wrap site-header-row">
      <Lockup />
      <nav className="site-header-nav" aria-label="Site">
        <a href={links.docs} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
        <a href={links.repository}>GitHub</a>
        <a className="site-pill site-pill--header" href={links.run}>Run Stump</a>
      </nav>
    </div>
  </header>
}
