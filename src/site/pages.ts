// The run site `rer build --site` writes (run-stump.com): the homepage, the
// docs built from docs/site.json and docs/*.md, /run, /contract and Base's
// hosting page from Base, and the not-found page. Nothing here reads
// installation data.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contractPageHtml } from '../base/contract-page'
import { hostingPageHtml } from '../base/hosting-page'
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { runPricing } from '../base/run-pricing'
import { identity } from '../identity'
import { buildDocs } from '../../scripts/site/docs.mjs'
import { DocsArticle, DocsIndex, docsLead } from './docs/Docs'
import { Landing } from './landing/Landing'
import { Header } from './shell/Header'
import { siteDocument } from './shell/document'
import run from './run.json'

const DESCRIPTION = 'Stump turns your changelog into posts for the communities worth showing up in, then shows which posts brought signups.'

export function sitePages({ contract, hosting, styles = [] }: Partial<SiteContext> = {}): SiteBuild {
  const data: RunData = { ...run, pricing: runPricing }
  const docs = buildDocs()
  const page = (path: string, title: string, description: string, element: ReturnType<typeof createElement>) =>
    ({ path, html: siteDocument({ title, description, path, styles, body: renderToStaticMarkup(element) }) })
  const pages = docs.pages
  // Base's /run, /contract, /docs/hosting and 404 pages wear the homepage header too.
  const homepage = { html: renderToStaticMarkup(createElement(Header)), styles }
  return {
    pages: [
      page('/', 'Stump · Be heard in your own voice', DESCRIPTION, createElement(Landing)),
      page('/docs', 'Docs · Stump', docsLead, createElement(DocsIndex, { sections: docs.sections })),
      ...pages.map((entry, index) => page(`/docs/${entry.slug}`, `${entry.title} · Stump docs`, entry.summary,
        createElement(DocsArticle, { page: entry, sections: docs.sections, previous: pages[index - 1], next: pages[index + 1] }))),
      { path: '/run', html: runPageHtml(identity, data, contract, homepage) },
      // rer supplies hosting (null when the seed does not deploy to Workers); a caller without it gets no hosting page.
      ...(hosting !== undefined ? [{ path: '/docs/hosting', html: hostingPageHtml(identity, data, hosting, contract, homepage) }] : []),
      ...(contract ? [{ path: '/contract', html: contractPageHtml(identity, data, contract, homepage) }] : []),
      { path: '/404', html: siteNotFoundHtml(identity, data, contract, homepage) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand', 'art', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
  }
}
