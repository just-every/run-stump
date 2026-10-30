/**
 * Relevance ranking with reasons. STUMP-WATCH-005.1, .2, .5.
 *
 * Score 0 to 100 from five factors, each reported with the points it gave, plus a bounded
 * adjustment learned from the person's marks:
 *   matched terms 30 : distinct watch terms and product names found, in the title or text
 *   question      30 : the thread asks something, and what it asks is something the company can answer
 *   venue fit     15 : the venue's recorded fit (supplied by the caller)
 *   standing      10 : the author's standing where the source gives one
 *   freshness     15 : half-life decay from the post time
 * Where the caller supplies no venue fit or standing, the factor sits at its midpoint and says so,
 * so missing data neither helps nor hurts one finding more than another.
 *
 * A finding's own text never changes its rank by instruction: see rank-text.ts.
 */
import { marksAdjustment, type MarksModel } from './marks.ts'
import { neutralise, questionSentences } from './rank-text.ts'
import { compileTerms, matchTerms, type CompiledTerms, type TermLogic } from './terms.ts'
import type { Finding, SourceKind } from './types.ts'

export type Factor = 'matched_terms' | 'question' | 'venue_fit' | 'author_standing' | 'freshness' | 'marks'

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
}

export interface RankContext {
  /** The watch's terms. */
  terms: TermLogic | CompiledTerms
  /** The company's product names and other names: a match counts extra. */
  product_terms?: string[]
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
  const instruction_like = title.instruction_like || body.instruction_like
  const hay = { title: title.text, text: body.text, links: f.links.join('\n') }
  const reasons: Reason[] = []

  // Matched terms: 12 for any positive match, +6 in the title, +6 for a product name, +3 each for up to two more distinct terms.
  const m = matchTerms(terms, hay)
  const productHit = matchTerms(products, hay)
  const positives = m.matched_terms.length
  let termPoints = 0
  const bits: string[] = []
  if (positives > 0 || m.unconstrained) {
    termPoints += 12
    if (positives > 0) bits.push(`matched ${m.matched_terms.slice(0, 4).map((t) => `"${t}"`).join(', ')}`)
    else bits.push('every item of this source')
    if (m.matched_in.includes('title')) {
      termPoints += 6
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

  // Question: 12 for asking something; +18 when the question touches a matched term, product or topic.
  const questions = questionSentences([title.text, body.text].filter(Boolean).join('\n'))
  let questionPoints = 0
  let answerable = false
  let questionLabel = 'no question asked'
  if (questions.length > 0) {
    questionPoints = 12
    questionLabel = 'asks a question'
    const touches = (s: string) =>
      matchTerms(terms, { text: s }).matched_terms.length > 0 ||
      matchTerms(products, { text: s }).matched_terms.length > 0 ||
      matchTerms(topics, { text: s }).matched_terms.length > 0
    // The question may be in a title that carries the term while the question sentence is generic ("Any recommendations?").
    const titleCarriesTerm = m.matched_in.includes('title') || matchTerms(topics, { text: title.text }).matched_terms.length > 0
    if (questions.some(touches) || (titleCarriesTerm && questions.length > 0)) {
      answerable = true
      questionPoints = 30
      questionLabel = 'asks a question the company can answer'
    }
  }
  reasons.push({ factor: 'question', label: questionLabel, points: questionPoints, max: WEIGHTS.question })

  const fit = ctx.venue_fit ? ctx.venue_fit(f) : null
  const fitPoints = fit === null ? WEIGHTS.venue_fit / 2 : (Math.max(0, Math.min(100, fit)) / 100) * WEIGHTS.venue_fit
  reasons.push({
    factor: 'venue_fit', points: round1(fitPoints), max: WEIGHTS.venue_fit,
    label: fit === null ? 'no venue fit recorded' : `venue fit ${Math.round(fit)} of 100`,
  })

  const standing = ctx.author_standing ? ctx.author_standing(f) : defaultStanding(f)
  const standingPoints = standing === null ? WEIGHTS.author_standing / 2 : Math.max(0, Math.min(1, standing)) * WEIGHTS.author_standing
  reasons.push({
    factor: 'author_standing', points: round1(standingPoints), max: WEIGHTS.author_standing,
    label: standing === null ? 'author standing unknown' : `author standing ${Math.round(standing * 100)} of 100`,
  })

  const now = ctx.now ?? Date.now()
  const ageH = Math.max(0, (now - Date.parse(f.published_at)) / 3_600_000)
  const half = ctx.half_life_hours?.[f.source] ?? DEFAULT_HALF_LIFE[f.source]
  const freshPoints = Number.isFinite(ageH) ? WEIGHTS.freshness * Math.pow(0.5, ageH / half) : 0
  reasons.push({
    factor: 'freshness', points: round1(freshPoints), max: WEIGHTS.freshness,
    label: ageH < 1 ? 'posted within the hour' : ageH < 48 ? `posted ${Math.round(ageH)} hours ago` : `posted ${Math.round(ageH / 24)} days ago`,
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
  }
}

/** Findings ranked best first; ties go to the newer, then to the source id, so the order is stable. */
export function rankFindings(findings: Finding[], ctx: RankContext): Ranked[] {
  return findings
    .map((f) => scoreFinding(f, ctx))
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        (a.finding.published_at < b.finding.published_at ? 1 : a.finding.published_at > b.finding.published_at ? -1 : 0) ||
        (a.finding.source_id < b.finding.source_id ? -1 : 1),
    )
}

/** Immediate alerts go out for ranked findings at or above the person's relevance, and never for backfill. */
export function qualifiesForImmediateAlert(ranked: Ranked, minRelevance: number, backfill: boolean): boolean {
  return !backfill && ranked.relevance >= minRelevance
}
