import run from '../run.json'

// Every address the run site's pages link to, in one place.
export const links = {
  home: '/',
  run: '/run',
  docs: '/docs',
  doc: (slug: string) => `/docs/${slug}`,
  repository: run.repository,
} as const
