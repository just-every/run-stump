import type { DocsPage, DocsPageMeta, DocsSection, DocsTocEntry } from '../../../scripts/site/docs.mjs'
import { Footer } from '../shell/Footer'
import { Header } from '../shell/Header'
import { links } from '../shell/links'
import '../styles/site.css'
import '../styles/docs.css'

// The docs site (final design SPEC §5): the homepage header with Docs current,
// the section nav, the article and "On this page", on the landing's paper.

export const docsLead = 'Run Stump, load the venues worth showing up in, turn releases into posts in your own voice, hand members-only venues to the people who belong there, and see what each post brought.'

function NavList({ sections, current, prefix }: { sections: DocsSection[]; current?: string; prefix: string }) {
  return <>
    <a className="docs-nav-home" href={links.docs} aria-current={current ? undefined : 'page'}>All docs</a>
    {sections.map((section, index) => <div className="docs-nav-group" key={section.title}>
      <p className="docs-nav-section" id={`${prefix}-${index}`}>{section.title}</p>
      <ul aria-labelledby={`${prefix}-${index}`}>{section.pages.map(page => <li key={page.slug}>
        <a href={links.doc(page.slug)} aria-current={page.slug === current ? 'page' : undefined}>{page.title}</a>
      </li>)}</ul>
    </div>)}
  </>
}

function Sidebar({ sections, current }: { sections: DocsSection[]; current?: string }) {
  return <nav className="docs-sidebar" aria-label="Docs"><NavList sections={sections} current={current} prefix="docs-side" /></nav>
}

/** Below 900 px the nav is one outline pill that opens the whole list. */
function Menu({ sections, current, label }: { sections: DocsSection[]; current?: string; label: string }) {
  return <nav className="docs-menu" aria-label="Docs menu">
    <details><summary><span>Docs · {label}</span><Chevron /></summary><div className="docs-menu-list"><NavList sections={sections} current={current} prefix="docs-menu" /></div></details>
  </nav>
}

const Chevron = () => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>

type Group = DocsTocEntry & { children: DocsTocEntry[] }
const groups = (toc: DocsTocEntry[]) => toc.filter(entry => entry.depth === 2).length < 2 ? [] : toc.reduce<Group[]>((list, entry) => {
  if (entry.depth === 3 && list.length) list[list.length - 1]!.children.push(entry); else list.push({ ...entry, children: [] })
  return list
}, [])
function TocList({ toc }: { toc: DocsTocEntry[] }) {
  return <ul>{groups(toc).map(group => <li key={group.id}><a href={`#${group.id}`}>{group.text}</a>
    {group.children.length ? <ul>{group.children.map(entry => <li key={entry.id}><a href={`#${entry.id}`}>{entry.text}</a></li>)}</ul> : null}</li>)}</ul>
}

function Pager({ previous, next }: { previous?: DocsPageMeta; next?: DocsPageMeta }) {
  if (!previous && !next) return null
  return <nav className="docs-pager" aria-label="Previous and next pages">
    {previous ? <a className="docs-pager-card" href={links.doc(previous.slug)} rel="prev"><span className="docs-pager-label">← Previous</span><span className="docs-pager-title">{previous.title}</span></a> : <span />}
    {next ? <a className="docs-pager-card docs-pager-card--next" href={links.doc(next.slug)} rel="next"><span className="docs-pager-label">Next →</span><span className="docs-pager-title">{next.title}</span></a> : null}
  </nav>
}

const Sprout = () => <img className="docs-sprout" src="/art/sprout.webp" alt="" width="232" height="255" />

export function DocsArticle({ page, sections, previous, next }: { page: DocsPage; sections: DocsSection[]; previous?: DocsPageMeta; next?: DocsPageMeta }) {
  const toc = groups(page.toc).length > 0
  return <div className="site-page docs-page">
    <Header current="docs" />
    <div className={toc ? 'site-wrap docs-shell' : 'site-wrap docs-shell docs-shell--no-toc'}>
      <Sidebar sections={sections} current={page.slug} />
      <main id="main" className="docs-main">
        <Menu sections={sections} current={page.slug} label={page.title} />
        <article className="docs-article" aria-labelledby="docs-title">
          <header className="docs-head">
            <p className="docs-eyebrow">{page.section}</p>
            <h1 id="docs-title" className="docs-title">{page.title}</h1>
            {toc ? <details className="docs-toc-compact"><summary>On this page<Chevron /></summary><TocList toc={page.toc} /></details> : null}
            <Sprout />
          </header>
          <div className="docs-prose" dangerouslySetInnerHTML={{ __html: page.html }} />
        </article>
        <Pager previous={previous} next={next} />
      </main>
      {toc ? <nav className="docs-toc" aria-labelledby="docs-toc-title"><p className="docs-toc-title" id="docs-toc-title">On this page</p><TocList toc={page.toc} /></nav> : null}
    </div>
    <Footer />
  </div>
}

export function DocsIndex({ sections }: { sections: DocsSection[] }) {
  return <div className="site-page docs-page">
    <Header current="docs" />
    <div className="site-wrap docs-shell docs-shell--no-toc">
      <Sidebar sections={sections} />
      <main id="main" className="docs-main">
        <header className="docs-head">
          <p className="docs-eyebrow">Stump</p>
          <h1 className="docs-title">Docs</h1>
          <Sprout />
        </header>
        <p className="docs-lead">{docsLead}</p>
        {sections.map((section, index) => <section className="docs-index-section" key={section.title} aria-labelledby={`docs-index-${index}`}>
          <h2 className="docs-eyebrow" id={`docs-index-${index}`}>{section.title}</h2>
          <ul className="docs-index-grid">{section.pages.map(page => <li key={page.slug}><a className="docs-index-card" href={links.doc(page.slug)}>
            <span className="docs-index-card-title">{page.title}</span><span className="docs-index-card-summary">{page.summary}</span></a></li>)}</ul>
        </section>)}
      </main>
    </div>
    <Footer />
  </div>
}
