import { tagLinks, type Route, type TagResult } from '../lib/text/index.ts'
import { readRules } from './rules.ts'

export interface TagInput {
  /** The text of the item, before it goes out or to a person. */
  text: string
  /** published (Stump posts it) or handoff (a named member posts it by hand). */
  route: Route
  /** The network or the venue it goes to; becomes utm_source. */
  source: string
  /** The item's campaign; becomes utm_campaign. */
  campaign?: string | null
  /** The item (its id); becomes utm_content. */
  content: string
}

/**
 * The text with UTM tags on every link to the company's own domains, by the
 * naming rules the company set (STUMP-LINK-001). Links to other sites are left
 * exactly as written, and tags the author put on a link are kept. With no rules
 * set there is no list of own domains, so nothing is tagged.
 */
export async function tagOwnLinks(db: D1Database, input: TagInput): Promise<string> {
  return (await tagOwnLinksDetailed(db, input)).text
}

/** The same tagging, with each link and whether it was changed (the rules page shows this). */
export async function tagOwnLinksDetailed(db: D1Database, input: TagInput): Promise<TagResult & { rules_set: boolean }> {
  const rules = await readRules(db)
  if (!rules) return { text: input.text, links: [], rules_set: false }
  return { ...tagLinks(input.text, rules, { source: input.source, route: input.route, campaign: input.campaign ?? '', content: input.content }), rules_set: true }
}
