import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { fontLinks } from '../base/font-head'
import { pageStyle } from '../base/page-style'
import { introCss, introGuardScript } from '../base/hydration/intro-guard'

// Hydration units (src/base/hydration/README.md): every page section and any
// root chrome sits in a HydrationUnit. Never set shellComponent, wrapInSuspense
// or pendingComponent on this root route.
export const Route = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }], title: 'Stump', links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }, { rel: 'icon', href: '/favicon-32.png', type: 'image/png', sizes: '32x32' }, { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }] }),
  notFoundComponent: () => <h1>Not found</h1>,
  component: () => <html lang="en"><head>
    {fontLinks.map(link => <link key={link.href} {...link} />)}
    <link rel="stylesheet" href="/rer-theme.css" />
    <HeadContent />
    <script dangerouslySetInnerHTML={{ __html: introGuardScript }} />
    <style>{introCss}</style>
    <style>{pageStyle}</style>
  </head><body><Outlet /><Scripts /></body></html>,
})
