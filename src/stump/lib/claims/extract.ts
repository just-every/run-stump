// Which sentences of a draft state a factual product claim. This is rule-based: a
// sentence is a claim candidate when it carries a quantity, a comparison, a
// superlative or absolute, a compliance or certification statement, or a capability
// stated about a product or about "we". Questions, calls to action and plain
// announcements are not claims. Text in a draft is data (D-7): nothing here changes
// what the check does beyond which sentences it reads.

import { extractNumbers } from './numbers'
import type { FoundNumber } from './numbers'
import { foldText, sentenceSpans } from './sentences'
import type { Span } from './sentences'

export type CandidateReason = 'quantity' | 'comparison' | 'superlative' | 'compliance' | 'guarantee' | 'capability'

export interface ClaimCandidate extends Span {
  reasons: CandidateReason[]
  numbers: FoundNumber[]
  /** A competitor named in a comparison. */
  competitor?: string
}

export interface ExtractContext {
  /** Names of the company's products (and other names): a sentence naming one is about the product. */
  product_names: readonly string[]
  competitor_names: readonly string[]
}

const COMPLIANCE =
  /\b(soc\s?[123]|iso\s?\d{3,5}|hipaa|gdpr|ccpa|pci(?:[- ]dss)?|fedramp|hitrust|certified|certification|compliant|compliance|audited|accredited|approved by)\b/
const SUPERLATIVE =
  /\b(best|fastest|cheapest|easiest|simplest|smartest|safest|most (?:secure|reliable|powerful|accurate|popular|trusted|advanced|flexible|affordable)|only|first|leading|unmatched|unrivaled|unrivalled|world[- ]class|industry[- ]leading|number one|no\.? ?1|#1|top[- ]rated|award[- ]winning)\b/
const GUARANTEE =
  /\b(guarantee[sd]?|never (?:down|fails?|loses?|misses?|breaks?)|always (?:on|up|available|works?|free)|zero (?:downtime|config|setup|bugs?|lock-?in|fees?)|no (?:downtime|limits?|lock-?in|setup|fees?|hidden|credit card|code)|unlimited|100 ?%|risk[- ]free|instantly|in real[- ]time)\b/
const COMPARISON = /\b(?:\w+er|more \w+|less \w+|fewer \w+|better|worse) than\b|\b(?:vs\.?|versus|beats?|outperforms?|alternative to|instead of|unlike|replaces?|switch(?:ed)? from|cheaper|faster|easier|simpler|smarter)\b/
const CAPABILITY =
  /\b(supports?|integrates?|works? with|handles?|includes?|ships? with|syncs?|stores?|encrypts?|scales?|saves?|reduces?|increases?|cuts?|speeds? up|prevents?|detects?|blocks?|automates?|monitors?|tracks?|backs? up|runs? on|exports?|imports?|sends?|schedules?|publishes?|connects?|searches|notifies|alerts|generates|offers?|provides?|enables?|allows?|powers?|finds?|catches|keeps?|lets? you|helps? you|gives? you|makes? it|is (?:open[- ]source|secure|private|free|fast|reliable|accessible|self-?hosted)|has no|can (?:\w+ ){0,2}(?:import|export|send|post|schedule|sync|monitor|track|replace))\b/
const FIRST_PERSON_PLURAL = /\b(we|we're|we've|we'll|our|ours)\b/
const QUANT_CONTEXT_UNITS = new Set([
  'minute', 'hour', 'second', 'ms', 'millisecond', 'day', 'week', 'step', 'click', 'line', 'request', 'query', 'user', 'customer',
  'team', 'integration', 'connector', 'language', 'region', 'country', 'developer', 'engineer', 'company', 'seat', 'site', 'app', 'download', 'star',
])
const PRICE_WORDS = /\b(price|pricing|cost|costs|plan|plans|per|month|year|seat|save|saves|cheaper|free|from|starting|only|just)\b/

function mentionsAny(folded: string, names: readonly string[]): string | undefined {
  for (const n of names) {
    const f = foldText(n).trim()
    if (f === '') continue
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${f.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}(?![\\p{L}\\p{N}_])`, 'u')
    if (re.test(folded)) return n
  }
  return undefined
}

function wordCount(folded: string): number {
  return (folded.replace(/(?:https?:\/\/|www\.)\S+/g, ' ').replace(/[@#][\p{L}\p{N}_.]+/gu, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length
}

/** Does the sentence open with a pronoun that refers back to the previous sentence's subject? */
export function startsWithPronoun(sentence: string): boolean {
  return /^(?:it|its|this|that|they|these|those)\b/.test(foldText(sentence).trimStart())
}

/**
 * Read one sentence; `undefined` when it is not a claim. `pronounProduct` is the product the
 * previous sentence named, when this one opens with "It ..." or "This ...".
 */
export function readSentence(span: Span, ctx: ExtractContext, pronounProduct?: string): ClaimCandidate | undefined {
  const folded = foldText(span.text)
  if (span.text.endsWith('?')) return undefined
  if (wordCount(folded) < 3) return undefined

  const numbers = extractNumbers(span.text)
  const product = mentionsAny(folded, ctx.product_names) ?? pronounProduct
  const competitor = mentionsAny(folded, ctx.competitor_names)
  const firstPerson = FIRST_PERSON_PLURAL.test(folded)
  const anchored = product !== undefined || competitor !== undefined || firstPerson
  const reasons: CandidateReason[] = []

  const hasMetric = numbers.some(
    (n) =>
      n.kind === 'percent' ||
      n.kind === 'multiplier' ||
      (n.kind === 'money' && PRICE_WORDS.test(folded)) ||
      (n.kind === 'count' && QUANT_CONTEXT_UNITS.has(n.unit)),
  )
  if (hasMetric) reasons.push('quantity')
  if (COMPLIANCE.test(folded)) reasons.push('compliance')
  if (competitor !== undefined && COMPARISON.test(folded)) reasons.push('comparison')
  else if (/\b(?:\w+er|more \w+|less \w+|fewer \w+) than\b/.test(folded) && anchored) reasons.push('comparison')
  if (anchored && SUPERLATIVE.test(folded)) reasons.push('superlative')
  if (GUARANTEE.test(folded) && (anchored || hasMetric)) reasons.push('guarantee')
  if (product !== undefined || firstPerson) {
    if (CAPABILITY.test(folded)) reasons.push('capability')
  }
  if (reasons.length === 0) return undefined
  return { ...span, reasons, numbers, competitor: reasons.includes('comparison') ? competitor : undefined }
}

export function findClaimCandidates(text: string, ctx: ExtractContext): ClaimCandidate[] {
  const out: ClaimCandidate[] = []
  for (const span of sentenceSpans(text)) {
    const c = readSentence(span, ctx)
    if (c) out.push(c)
  }
  return out
}
