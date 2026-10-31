// Where Stump's guides are read from the app and from the agent door's hints. Every link to a
// guide goes through docsUrl, so the guides can move (to the run site's /docs) by changing this
// one address. Today they are the Markdown pages in the repository's docs/ folder.
export const DOCS_BASE = 'https://github.com/just-every/run-stump/blob/main/docs/'

/** A guide by its page name (docs/<page>.md), optionally at one of its headings. */
export const docsUrl = (page: string, heading?: string) => `${DOCS_BASE}${page}.md${heading ? `#${heading}` : ''}`
