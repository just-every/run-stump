import run from '../run.json'

// Every address the run site's pages link to, in one place.
export const links = {
  home: '/',
  // Every "Run Stump" call to action opens the install doc (SPEC §2.1).
  run: '/docs/getting-started',
  docs: '/docs',
  doc: (slug: string) => `/docs/${slug}`,
  repository: run.repository,
} as const
