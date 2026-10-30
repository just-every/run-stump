// Venue rules and the routes they allow (STUMP-VENUE-002, D-3). A rule opens a
// route only with its source; a rule that restricts binds whether or not it is
// sourced. Every act on a venue reads the rules at the moment it runs.
import { refuse } from '../actions/refusals.ts'
import { normalizeVenueUrl } from '../lib/imports/index.ts'
import { moveItem, type ItemState, type Mover } from '../items/state.ts'
import { RULE_KEYS, rulesOf, type Rule, type RuleKey, type Rules, type VenueRow } from './model.ts'

export const ROUTES = ['publish', 'handoff_draft', 'handoff_brief'] as const
export type Route = typeof ROUTES[number]

const VALUES: Partial<Record<RuleKey, readonly string[]>> = {
  // 'api' and 'company_account' both let software post from the company's own account.
  posting: ['api', 'company_account', 'members_only'],
  ai_text: ['allowed', 'allowed_with_disclosure', 'banned'],
  self_promotion: ['allowed', 'thread', 'day', 'ratio', 'banned'],
  links: ['allowed', 'banned'],
}

const source = { type: ['string', 'null'], maxLength: 2048 }
const readAt = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const ruleSchema = (value: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: ['object', 'null'], additionalProperties: false, required: ['value'],
  properties: { value, source_url: source, read_at: readAt, sourced: { type: 'boolean' }, detail: { type: ['string', 'null'], maxLength: 300 }, ...extra },
})
/** The `rules` argument: any of the six rules, each {value, source_url, read_at}; null removes one. */
export const RULES_SCHEMA = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    posting: ruleSchema({ enum: VALUES.posting }),
    ai_text: ruleSchema({ enum: VALUES.ai_text }),
    // A rule that keeps self-promotion to one thread names that thread's address.
    self_promotion: ruleSchema({ enum: VALUES.self_promotion }, { thread_url: source }),
    links: ruleSchema({ enum: VALUES.links }),
    disclosure_line: ruleSchema({ type: 'string', minLength: 1, maxLength: 280 }),
    gates: ruleSchema({
      type: 'object', additionalProperties: false, minProperties: 1,
      properties: { karma: { type: 'integer', minimum: 0 }, account_age_days: { type: 'integer', minimum: 0 }, approval: { type: 'boolean' }, membership: { type: 'boolean' } },
    }),
  },
}

const httpUrl = (value: unknown) => { try { return typeof value === 'string' && ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } }
const realDate = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

/** One rule as stored: `sourced` is computed from its source URL and read date, never taken from the caller. */
export function normalizeRule(key: RuleKey, input: Record<string, unknown>): Rule {
  if (input.source_url != null && !httpUrl(input.source_url)) refuse('invalid_arguments', { field: `rules.${key}.source_url`, reason: 'Give the http(s) page the rule comes from.' })
  if (input.read_at != null && !realDate(input.read_at)) refuse('invalid_arguments', { field: `rules.${key}.read_at` })
  if (input.thread_url != null && !httpUrl(input.thread_url)) refuse('invalid_arguments', { field: `rules.${key}.thread_url`, reason: 'Give the http(s) address of the thread.' })
  const source_url = (input.source_url as string | null | undefined) ?? null, read_at = (input.read_at as string | null | undefined) ?? null
  const value = key === 'disclosure_line' ? String(input.value).trim() : input.value
  const thread_url = input.value === 'thread' && typeof input.thread_url === 'string' ? input.thread_url.trim() : null
  return { value, source_url, read_at, sourced: source_url !== null && read_at !== null, ...(input.detail ? { detail: String(input.detail).trim() } : {}), ...(thread_url ? { thread_url } : {}) }
}

const ruleWords = (rule: Rule | null) => rule === null ? 'none'
  : `${typeof rule.value === 'string' ? rule.value : JSON.stringify(rule.value)}${rule.thread_url ? ` in ${rule.thread_url}` : ''}${rule.sourced ? '' : ' (unsourced)'}`
const sameRule = (a: Rule | null, b: Rule | null) => JSON.stringify(a && { ...a, origin: undefined }) === JSON.stringify(b && { ...b, origin: undefined })

/** The rules that differ between two sets, each as "key: old -> new" (STUMP-VENUE-002.4). */
export function ruleChanges(before: Rules, after: Rules): string[] {
  return RULE_KEYS.filter(key => !sameRule(before[key], after[key])).map(key => `${key}: ${ruleWords(before[key])} -> ${ruleWords(after[key])}`)
}

/** The stored rules with the given ones replaced (null removes a rule). */
export function mergeRules(current: Rules, changes: Record<string, unknown>): Rules {
  const next = { ...current }
  for (const key of RULE_KEYS) {
    if (!Object.hasOwn(changes, key)) continue
    const change = changes[key]
    next[key] = change === null ? null : normalizeRule(key, change as Record<string, unknown>)
  }
  return next
}

export interface RouteReason { route: Route; open: boolean; rule: RuleKey | 'status' | 'archived' | null; because: string }
export interface RouteAnswer { venue_id: string; routes: Route[]; reasons: RouteReason[]; unsourced: RuleKey[] }

const said = (rule: Rule | null, ...values: string[]) => rule !== null && values.includes(String(rule.value))

/**
 * The routes an item to this venue may take, decided only from its rules
 * (STUMP-VENUE-002.1, .2): publishing needs a sourced rule that lets software
 * post from the company's account; a hand-off with a draft needs a sourced rule
 * that allows AI-written text; a hand-off with a brief and facts is always the
 * floor. A banned rule closes its route whether or not it is sourced.
 */
export function routesFor(venue: VenueRow): RouteAnswer {
  const rules = rulesOf(venue), reasons: RouteReason[] = []
  const unsourced = RULE_KEYS.filter(key => rules[key] !== null && !rules[key]!.sourced)
  const closeAll = (rule: RouteReason['rule'], because: string) => ROUTES.forEach(route => reasons.push({ route, open: false, rule, because }))
  if (venue.archived === 1) closeAll('archived', 'The venue is archived.')
  else if (venue.status === 'excluded') closeAll('status', 'The venue is excluded.')
  else if (said(rules.self_promotion, 'banned')) closeAll('self_promotion', 'The venue bans self-promotion.')
  else {
    const posting = rules.posting, ai = rules.ai_text
    reasons.push(said(posting, 'api', 'company_account') && posting!.sourced
      ? { route: 'publish', open: true, rule: 'posting', because: 'Software may post from the company account.' }
      : { route: 'publish', open: false, rule: 'posting', because: said(posting, 'members_only') ? 'Only members post here.' : posting ? 'The posting rule has no source.' : 'No posting rule is recorded.' })
    reasons.push(said(ai, 'allowed', 'allowed_with_disclosure') && ai!.sourced
      ? { route: 'handoff_draft', open: true, rule: 'ai_text', because: ai!.value === 'allowed' ? 'AI-written text is allowed.' : 'AI-written text is allowed with disclosure.' }
      : { route: 'handoff_draft', open: false, rule: 'ai_text', because: said(ai, 'banned') ? 'AI-written text is banned here.' : ai ? 'The AI text rule has no source.' : 'No AI text rule is recorded.' })
    reasons.push({ route: 'handoff_brief', open: true, rule: null, because: 'A member can always post in their own words from a brief and facts.' })
  }
  return { venue_id: venue.id, routes: reasons.filter(reason => reason.open).map(reason => reason.route), reasons, unsourced }
}

/** True when the venue's rules forbid generated text there (STUMP-VENUE-002.2): asking for it is refused and no AI call is made. */
export const generatedTextBanned = (venue: VenueRow) => !routesFor(venue).routes.includes('handoff_draft')

export interface ItemAtVenue { id: string; state: ItemState; format: string; account_id: string | null; text: string | null; parts: string | null; reply_to: string | null; options: string; routes: string; flags: string; hold: string | null }
export interface VenueHold { rule: RuleKey; reason: string; source_url: string | null }

const threadOf = (venue: VenueRow, item: ItemAtVenue) => {
  const reply = item.reply_to ? (JSON.parse(item.reply_to) as { url?: string }).url : undefined
  // A post's thread is its thread_url, or the post an imported entry is aimed at; the venue's own address is no thread.
  const options = JSON.parse(item.options) as { thread_url?: string | null; post_url?: string | null }
  const post = options.post_url && normalizeVenueUrl(options.post_url) !== venue.url_key ? options.post_url : null
  return reply ?? options.thread_url ?? post ?? null
}
/** The thread a URL sits in: a Reddit-style post id where there is one, else the canonical address itself. */
function threadKey(url: string): { host: string; post: string | null; path: string } | null {
  const canonical = normalizeVenueUrl(url)
  if (!canonical) return null
  const parsed = new URL(canonical.includes('://') ? canonical : `https://${canonical}`)
  return { host: parsed.hostname.replace(/^(www|old|new|np)\.reddit\.com$/, 'reddit.com'), post: /\/comments\/([a-z0-9]+)/i.exec(parsed.pathname)?.[1]?.toLowerCase() ?? null, path: parsed.pathname.replace(/\/+$/, '') }
}
/** Whether an item's thread is the venue's promotion thread, or a reply inside it. */
export function inThread(threadUrl: string, itemUrl: string): boolean {
  const thread = threadKey(threadUrl), item = threadKey(itemUrl)
  if (!thread || !item || thread.host !== item.host) return false
  if (thread.post) return thread.post === item.post
  return item.path === thread.path || item.path.startsWith(`${thread.path}/`)
}
const textOf = (item: ItemAtVenue) => [item.text ?? '', ...(item.parts ? JSON.parse(item.parts) as string[] : [])].join('\n')

/**
 * The rule that holds this item at this venue now, if any (STUMP-VENUE-002.3,
 * D-3): a post outside the venue's self-promotion thread, a link where links
 * are banned, or an item for the company's account where only members post.
 */
export function holdFor(venue: VenueRow, item: ItemAtVenue): VenueHold | null {
  const rules = rulesOf(venue), name = venue.name
  const hold = (rule: RuleKey, reason: string): VenueHold => ({ rule, reason, source_url: rules[rule]?.source_url ?? null })
  if (said(rules.self_promotion, 'thread')) {
    const rule = rules.self_promotion!, aimed = threadOf(venue, item)
    const where = rule.thread_url ?? rule.detail ?? 'its promotion thread'
    // With the thread's address recorded, anything outside that thread is held; without it, anything not in a thread at all.
    if (rule.thread_url ? !aimed || !inThread(rule.thread_url, aimed) : !aimed) return hold('self_promotion', `${name} allows self-promotion only in ${where}.`)
  }
  if (said(rules.links, 'banned') && /https?:\/\//i.test(textOf(item))) return hold('links', `${name} does not allow links.`)
  if (item.account_id && !routesFor(venue).routes.includes('publish')) return hold('posting', `${name} keeps posting for its members; hand it to a member instead.`)
  return null
}

const OPEN: readonly ItemState[] = ['draft', 'ready', 'scheduled', 'held', 'paused', 'failed']

/**
 * After the venue's rules change, every item not yet posted there gets the new
 * routes on its next read, with the change in its history; an item a rule now
 * holds moves to held with the rule named, and one only a rule held goes back
 * to draft (STUMP-VENUE-002.4).
 */
export async function refreshItems(db: D1Database, venue: VenueRow, mover: Mover, changes: string[] = []): Promise<D1PreparedStatement[]> {
  const items = (await db.prepare(`SELECT id,state,format,account_id,text,parts,reply_to,options,routes,flags,hold FROM stump_items
    WHERE venue_id=? AND state IN (SELECT value FROM json_each(?))`).bind(venue.id, JSON.stringify(OPEN)).all<ItemAtVenue>()).results
  const routes = routesFor(venue).routes, statements: D1PreparedStatement[] = []
  for (const item of items) {
    const before = JSON.parse(item.routes) as string[], hold = holdFor(venue, item)
    const flags = (JSON.parse(item.flags) as Array<{ code: string; venue_id?: string }>).filter(flag => !(flag.code === 'venue_rule' && flag.venue_id === venue.id))
    if (hold) flags.push({ code: 'venue_rule', venue_id: venue.id, blocking: true, ...hold } as never)
    const heldByRule = item.hold !== null && (JSON.parse(item.hold) as { venue_id?: string }).venue_id === venue.id
    const changed = before.join(',') !== routes.join(',')
    const set = { routes: JSON.stringify(routes), flags: JSON.stringify(flags) }
    if (hold && item.state !== 'held') {
      statements.push(...moveItem(mover, item, 'held', `${venue.name}: ${hold.reason}`, { ...set, hold: JSON.stringify({ owner_id: mover.person?.id ?? null, reason: hold.reason, rule: hold.rule, source_url: hold.source_url, venue_id: venue.id, next_attempt_at: null }) }))
    } else if (!hold && heldByRule) {
      statements.push(...moveItem(mover, item, 'draft', `${venue.name}: the rule that held it no longer applies`, { ...set, hold: null }))
    } else if (changed || set.flags !== item.flags) {
      statements.push(db.prepare('UPDATE stump_items SET routes=?,flags=?,updated_at=? WHERE id=? AND state=?').bind(set.routes, set.flags, mover.now(), item.id, item.state))
    }
    // The change itself goes in each open item's history: which rule moved and how, then the routes before and after.
    if (changed || changes.length) statements.push(db.prepare('INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), item.id, item.state, item.state, mover.person?.id ?? null, mover.agent?.id ?? null,
        `${venue.name} rules changed: ${[...changes, `routes ${before.join(', ') || 'none'} -> ${routes.join(', ') || 'none'}`].join('; ')}`, mover.now()))
  }
  return statements
}
