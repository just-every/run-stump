import { ToolRefusal } from '../../modules/agent-door/index.ts'
import type { ActionContext } from './types.ts'

/**
 * A refusal both doors return with the same code and fields: MCP as an error
 * result, the person door as a 4xx {code, ...fields}.
 */
export function refuse(code: string, fields: Record<string, unknown> = {}): never {
  throw new ToolRefusal(code, code, fields)
}

/** A product rule's source: the page it comes from and when it was read. */
export interface RuleSource { rule: string; source: string; read_at?: string }

/**
 * The one hook for product rules that stand outside the company policy (D-1 to
 * D-8): it records the refusal with its rule and source, apart from policy
 * decisions, and answers act_refused for people and agents alike.
 */
export async function refuseAct(ctx: Pick<ActionContext, 'db' | 'person' | 'agent' | 'door' | 'operationId' | 'now'>, tool: string, action: string,
  rule: RuleSource, fields: Record<string, unknown> = {}): Promise<never> {
  await ctx.db.prepare(`INSERT INTO stump_refusals(id,operation_id,tool,action,rule,source,person_id,agent_id,door,detail,at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(operation_id) DO NOTHING`)
    .bind(crypto.randomUUID(), ctx.operationId, tool, action, rule.rule, rule.source, ctx.person.id, ctx.agent?.id ?? null, ctx.door, JSON.stringify(fields), ctx.now()).run()
  return refuse('act_refused', { ...fields, rule: rule.rule, source: rule.source, ...(rule.read_at ? { read_at: rule.read_at } : {}) })
}

// The pages D-4 cites (STUMP-TRUTH-003), read on 30 Oct 2026; see CHANGELOG.md.
const READ_AT = '2026-10-30'
const SOURCES = {
  hn: 'https://news.ycombinator.com/newsguidelines.html',
  showhn: 'https://news.ycombinator.com/showhn.html',
  producthunt: 'https://www.producthunt.com/launch',
  x: 'https://docs.x.com/developer-guidelines',
  linkedin: 'https://www.linkedin.com/help/linkedin/answer/a1341387',
  ftc: 'https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465',
} as const

/**
 * Acts D-4 bans. No tool offers them; a request for one by name answers
 * act_refused with its rule and source instead of an unknown-action error.
 */
export const BANNED_ACTS: Readonly<Record<string, RuleSource>> = Object.fromEntries(Object.entries({
  like: { rule: 'D-4', source: SOURCES.x },
  repost: { rule: 'D-4', source: SOURCES.x },
  retweet: { rule: 'D-4', source: SOURCES.x },
  quote: { rule: 'D-4', source: SOURCES.x },
  follow: { rule: 'D-4', source: SOURCES.x },
  keyword_reply: { rule: 'D-4', source: SOURCES.x },
  auto_reply: { rule: 'D-4', source: SOURCES.x },
  comment_linkedin: { rule: 'D-4', source: SOURCES.linkedin },
  share_linkedin: { rule: 'D-4', source: SOURCES.linkedin },
  comment_hn: { rule: 'D-4', source: SOURCES.hn },
  submit_hn: { rule: 'D-4', source: SOURCES.showhn },
  upvote: { rule: 'D-4', source: SOURCES.hn },
  vote: { rule: 'D-4', source: SOURCES.producthunt },
  request_votes: { rule: 'D-4', source: SOURCES.producthunt },
  review_for: { rule: 'D-4', source: SOURCES.ftc },
  testimonial_for: { rule: 'D-4', source: SOURCES.ftc },
  buy_followers: { rule: 'D-4', source: SOURCES.ftc },
  buy_engagement: { rule: 'D-4', source: SOURCES.ftc },
  scrape: { rule: 'D-4', source: SOURCES.linkedin },
}).map(([act, rule]) => [act, { ...rule, read_at: READ_AT }]))

/** D-1: a person exists only through an accepted invitation and sign-in. */
export const NO_PERSONAS: RuleSource = { rule: 'D-1', source: 'STUMP-TRUTH-001' }
