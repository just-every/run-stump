/**
 * Relevance ranking with reasons. STUMP-WATCH-005.1, .2, .5.
 *
 * Score 0 to 100 from five factors, each reported with the points it gave, plus a bounded
 * adjustment learned from the person's marks:
 *   matched terms 30 : distinct watch terms and product names found. A term in the headline (the title, or the
 *                      post itself where a source has no titles) or a podcast transcript counts in full; one
 *                      found only deep in a titled thread's text counts little, since the thread is about something else
 *   question      30 : the thread asks for help, and what it asks is something the company can answer: in full when
 *                      the question or the headline carries a watch term; a little when only the text does
 *   venue fit     15 : the venue's recorded fit (supplied by the caller)
 *   standing      10 : the author's standing where the source gives one
 *   freshness     15 : half-life decay from the post time
 * Where the caller supplies no venue fit or standing, the factor sits at its midpoint and says so,
 * so missing data neither helps nor hurts one finding more than another. Venue fit, standing and freshness
 * say how good a thread is, not whether it is about the company: a finding whose terms and products appear
 * only deep in a titled thread's text (a comment under a story about something else) gets 40% of them, so a
 * fresh off-topic thread never outranks one that is about what the company does.
 * rankFindings lists a thread once at its rank: each further finding in the same thread counts half.
 *
 * A finding's own text never changes its rank by instruction: see rank-text.ts.
 */
import { marksAdjustment, type MarksModel } from './marks.ts'
import { asksForHelp, isAboutTheRanking, neutralise, questionSentences } from './rank-text.ts'
import { compileTerms, matchTerms, type CompiledTerms, type TermInput, type TermLogic } from './terms.ts'
import type { Finding, SourceKind } from './types.ts'

export type Factor = 'matched_terms' | 'question' | 'venue_fit' | 'author_standing' | 'freshness' | 'marks' | 'repeat_thread'

export interface Reason {
  factor: Factor
  /** Short human sentence. */
  label: string
  points: number
  max: number
}

export interface Ranked {
  finding: Finding
  /** 0 to 100, one decimal. */
  relevance: number
  reasons: Reason[]
  /** True when the finding asks something the company can answer. */
  answerable_question: boolean
  /** True when the finding contained sentences addressed to the ranking system; they were ignored. */
  instruction_like: boolean
  /**
   * True when its terms and product names appear only deep in a titled thread's text: a passing mention in a thread
   * about something else (a comment under an unrelated story), not a thread worth answering.
   */
  passing: boolean
}

export interface RankContext {
  /** The watch's terms. */
  terms: TermLogic | CompiledTerms
  /** The company's product names and other names: a match counts extra. A name that is also an everyday word may match only with its capitals. */
  product_terms?: TermInput[]
  /** Phrases for what the company can answer about (its categories), beyond the watch terms. */
  topic_terms?: string[]
  /** Fit of the venue this finding belongs to, 0 to 100, or null when none is recorded. */
  venue_fit?: (f: Finding) => number | null
  /** Author standing, 0 to 1, or null. Defaults to a follower-count curve where the source gives followers. */
  author_standing?: (f: Finding) => number | null
  model?: MarksModel
  now?: number
  /** Freshness half-life in hours by source. Defaults: 24 for social and HN, 72 for feeds. */
  half_life_hours?: Partial<Record<SourceKind, number>>
}

const WEIGHTS = { matched_terms: 30, question: 30, venue_fit: 15, author_standing: 10, freshness: 15 } as const
/** The share of venue fit, standing and freshness a finding keeps when its match is only deep in a thread about something else. */
const DEEP_SHARE = 0.4
const round1 = (n: number) => Math.round(n * 10) / 10
const DEFAULT_HALF_LIFE: Record<SourceKind, number> = { hn: 24, bluesky: 24, mastodon: 24, rss: 72 }

function defaultStanding(f: Finding): number | null {
  if (typeof f.author_followers !== 'number') return null
  return Math.min(1, Math.log10(1 + f.author_followers) / 5)
}

export function scoreFinding(f: Finding, ctx: RankContext): Ranked {
  const terms = compileTerms(ctx.terms)
  const products = compileTerms({ any: ctx.product_terms ?? [] })
  const topics = compileTerms({ any: ctx.topic_terms ?? [] })
  const title = neutralise(f.title)
  const body = neutralise(f.text)
  // What a podcast transcript matched counts as matched text, under the same neutralising.
  const spoken = neutralise(f.transcript_match?.excerpts.join('\n') ?? '')
  let instruction_like = title.instruction_like || body.instruction_like || spoken.instruction_like
  const hay = { title: title.text, text: body.text, links: f.links.join('\n'), transcript: spoken.text }
  const reasons: Reason[] = []

  // Matched terms: 12 for a match in the headline or a transcript and +12 more in a title; 4 for a match only deep in a
  // titled thread's text or links (a comment under a story about something else); +6 for a product name, +3 each for
  // up to two more distinct terms.
  const m = matchTerms(terms, hay)
  const productHit = matchTerms(products, hay)
  const positives = m.matched_terms.length
  const hasTitle = title.text.trim().length > 0
  const inHeadline = hasTitle ? m.matched_in.includes('title') : m.matched_in.includes('text')
  const inTranscript = m.matched_in.includes('transcript')
  let termPoints = 0
  const bits: string[] = []
  if (positives > 0 || m.unconstrained) {
    const named = m.matched_terms.slice(0, 4).map((t) => `"${t}"`).join(', ')
    if (positives > 0 && inTranscript && m.matched_in.length === 1) bits.push(`matches your terms in the episode transcript: ${named}`)
    else if (positives > 0) bits.push(`matched ${named}${inTranscript ? ', also in the episode transcript' : ''}`)
    else bits.push('every item of this source')
    if (m.unconstrained || inHeadline || inTranscript) termPoints += 12
    else {
      termPoints += 4
      bits.push('only in the text, under a title about something else')
    }
    if (positives > 0 && hasTitle && m.matched_in.includes('title')) {
      termPoints += 12
      bits.push('in the title')
    }
    termPoints += 3 * Math.min(2, Math.max(0, positives - 1))
  }
  if (productHit.matched_terms.length > 0) {
    termPoints += 6
    bits.push(`names ${productHit.matched_terms.slice(0, 2).join(', ')}`)
  }
  termPoints = Math.min(WEIGHTS.matched_terms, termPoints)
  reasons.push({ factor: 'matched_terms', label: bits.length ? bits.join('; ') : 'no watch term found in the text', points: termPoints, max: WEIGHTS.matched_terms })

  // Question: 30 when a question touches a matched term, product or topic, or when it asks for help
  // under a title that carries one ("Any recommendations?"); 12 for asking for help about something
  // else; nothing for a rhetorical question. Questions about the post, its rank or the system
  // reading it are requests to the ranker: they count for nothing and mark the finding.
  const asked = questionSentences([title.text, body.text].filter(Boolean).join('\n'))
  const questions = asked.filter((q) => !isAboutTheRanking(q))
  if (questions.length < asked.length) instruction_like = true
  const touches = (s: string) =>
    matchTerms(terms, { text: s }).matched_terms.length > 0 ||
    matchTerms(products, { text: s }).matched_terms.length > 0 ||
    matchTerms(topics, { text: s }).matched_terms.length > 0
  const helpSeeking = questions.filter(asksForHelp)
  const headline = hasTitle ? title.text : body.text
  const titleCarriesTerm = inHeadline || matchTerms(topics, { text: headline }).matched_terms.length > 0
  // A question asked in the headline itself (an "Ask HN" title, a short post) is what the thread is about.
  const headlineQuestions = new Set(questionSentences(headline).filter((q) => !isAboutTheRanking(q)))
  let questionPoints = 0
  let answerable = false
  let questionLabel = questions.length > 0 ? 'asks nothing the company can answer' : 'no question asked'
  if (questions.some((q) => touches(q) && (titleCarriesTerm || headlineQuestions.has(q))) || (titleCarriesTerm && helpSeeking.length > 0)) {
    answerable = true
    questionPoints = 30
    questionLabel = 'asks a question the company can answer'
  } else if (questions.some(touches)) {
    questionPoints = 8
    questionLabel = 'asks about a watch term deep in its text, under a headline about something else'
  } else if (helpSeeking.length > 0) {
    questionPoints = 4
    questionLabel = 'asks for help, not about a watch term'
  }
  reasons.push({ factor: 'question', label: questionLabel, points: questionPoints, max: WEIGHTS.question })

  // Matched only deep in a titled thread's text, by a watch term and by every product name it carries: the thread is about something else.
  const productInHeadline = productHit.matched_terms.length > 0 && (hasTitle ? productHit.matched_in.includes('title') : productHit.matched_in.includes('text'))
  const share = positives > 0 && !m.unconstrained && !inHeadline && !inTranscript && !productInHeadline ? DEEP_SHARE : 1
  const offTopic = share < 1 ? ', counted at 40%: the thread is about something else' : ''
  const fit = ctx.venue_fit ? ctx.venue_fit(f) : null
  const fitPoints = share * (fit === null ? WEIGHTS.venue_fit / 2 : (Math.max(0, Math.min(100, fit)) / 100) * WEIGHTS.venue_fit)
  reasons.push({
    factor: 'venue_fit', points: round1(fitPoints), max: WEIGHTS.venue_fit,
    label: `${fit === null ? 'no venue fit recorded' : `venue fit ${Math.round(fit)} of 100`}${offTopic}`,
  })

  const standing = ctx.author_standing ? ctx.author_standing(f) : defaultStanding(f)
  const standingPoints = share * (standing === null ? WEIGHTS.author_standing / 2 : Math.max(0, Math.min(1, standing)) * WEIGHTS.author_standing)
  reasons.push({
    factor: 'author_standing', points: round1(standingPoints), max: WEIGHTS.author_standing,
    label: `${standing === null ? 'author standing unknown' : `author standing ${Math.round(standing * 100)} of 100`}${offTopic}`,
  })

  const now = ctx.now ?? Date.now()
  const ageH = Math.max(0, (now - Date.parse(f.published_at)) / 3_600_000)
  const half = ctx.half_life_hours?.[f.source] ?? DEFAULT_HALF_LIFE[f.source]
  const freshPoints = Number.isFinite(ageH) ? share * WEIGHTS.freshness * Math.pow(0.5, ageH / half) : 0
  reasons.push({
    factor: 'freshness', points: round1(freshPoints), max: WEIGHTS.freshness,
    label: `${ageH < 1 ? 'posted within the hour' : ageH < 48 ? `posted ${Math.round(ageH)} hours ago` : `posted ${Math.round(ageH / 24)} days ago`}${offTopic}`,
  })

  let total = termPoints + questionPoints + fitPoints + standingPoints + freshPoints
  const adj = marksAdjustment(ctx.model, f)
  if (adj.points !== 0) {
    total += adj.points
    reasons.push({
      factor: 'marks', points: adj.points, max: 10,
      label: `${adj.points > 0 ? 'raised' : 'lowered'} by your marks: ${adj.detail ?? 'similar findings'}`,
    })
  }
  return {
    finding: f,
    relevance: round1(Math.max(0, Math.min(100, total))),
    reasons,
    answerable_question: answerable,
    instruction_like,
    passing: share < 1,
  }
}

const byRank = (a: Ranked, b: Ranked) =>
  b.relevance - a.relevance ||
  (a.finding.published_at < b.finding.published_at ? 1 : a.finding.published_at > b.finding.published_at ? -1 : 0) ||
  (a.finding.source_id < b.finding.source_id ? -1 : 1)

/** The thread a finding sits in: a comment's story, else the finding's own page. */
export const threadOf = (f: Pick<Finding, 'thread_url' | 'url'>) => f.thread_url ?? f.url

/**
 * Ranked findings with each thread listed once at its rank: every further finding in a thread already listed (three comments
 * under one story) counts half, with that reason, so one busy thread never fills the top of the list.
 */
export function spreadThreads(ranked: Ranked[]): Ranked[] {
  const seen = new Set<string>()
  return [...ranked].sort(byRank).map((r) => {
    const thread = threadOf(r.finding)
    if (!seen.has(thread)) { seen.add(thread); return r }
    return { ...r, relevance: round1(r.relevance / 2), reasons: [...r.reasons, { factor: 'repeat_thread' as const, label: 'another finding in a thread listed above, counted at half', points: round1(-r.relevance / 2), max: 0 }] }
  }).sort(byRank)
}

/** Findings ranked best first, each thread listed once at its rank; ties go to the newer, then to the source id, so the order is stable. */
export function rankFindings(findings: Finding[], ctx: RankContext): Ranked[] {
  return spreadThreads(findings.map((f) => scoreFinding(f, ctx)))
}

/** Immediate alerts go out for ranked findings at or above the person's relevance, and never for backfill. */
export function qualifiesForImmediateAlert(ranked: Ranked, minRelevance: number, backfill: boolean): boolean {
  return !backfill && ranked.relevance >= minRelevance
}
