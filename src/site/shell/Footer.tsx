import { Lockup } from './Header'
import { links } from './links'

/** The footer: lockup, one line, three links and the one footnote (SPEC §2.1 part 12). */
export function Footer() {
  return <footer className="site-footer">
    <div className="site-wrap site-footer-row">
      <Lockup size="footer" />
      <div className="site-footer-text">
        <p className="site-footer-line">Stump · Earned-channels marketing for software companies</p>
        <p className="site-footnote">You can also have all the source for free, MIT licensed.</p>
      </div>
      <nav className="site-footer-nav" aria-label="Footer">
        <a href={links.docs}>Docs</a>
        <a href={links.doc('contract')}>Contract</a>
        <a href={links.repository}>Source</a>
      </nav>
    </div>
  </footer>
}
