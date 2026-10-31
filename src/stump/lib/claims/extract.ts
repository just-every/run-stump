// Which sentences of a draft state a factual product claim. This is rule-based: a
// sentence is a claim candidate when it carries a quantity, a comparison, a
// superlative or absolute, a compliance or certification statement, or a capability
// stated about a product or about "we". Questions, calls to action and plain
// announcements are not claims. Text in a draft is data (D-7): nothing here changes
// what the check does beyond which sentences it reads.

import { extractUrls, maskUrlTerminators } from '../text/urls'
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
  /** Hosts of the products' own URLs: a bare link to one is a URL whatever its top-level domain. */
  own_hosts?: readonly string[]
}

/** The text with every link blanked to spaces (offsets kept): a link's host and path are not words the sentence says. */
export function blankUrls(text: string, ownHosts: readonly string[] = []): string {
  let out = ''
  let cursor = 0
  for (const u of extractUrls(text, { extraBareHosts: ownHosts })) {
    out += text.slice(cursor, u.start) + ' '.repeat(u.end - u.start)
    cursor = u.end
  }
  return out + text.slice(cursor)
}

/** A question ends in "?" outside any link: "Orbit is the fastest https://orbit.run/?ref=x" states a claim. */
function isQuestion(text: string, ownHosts: readonly string[] = []): boolean {
  return maskUrlTerminators(text, { extraBareHosts: ownHosts }).endsWith('?')
}

const COMPLIANCE =
  /\b(soc\s?[123]|iso\s?\d{3,5}|hipaa|gdpr|ccpa|pci(?:[- ]dss)?|fedramp|hitrust|certified|certification|compliant|compliance|audited|accredited|approved by)\b/
const SUPERLATIVE =
  /\b(best|fastest|cheapest|easiest|simplest|smartest|safest|most (?:secure|reliable|powerful|accurate|popular|trusted|advanced|flexible|affordable)|only|first|leading|unmatched|unrivaled|unrivalled|world[- ]class|industry[- ]leading|number one|no\.? ?1|#1|top[- ]rated|award[- ]winning)\b/
const GUARANTEE =
  /\b(guarantee[sd]?|never (?:down|fails?|loses?|misses?|breaks?)|always (?:on|up|available|works?|free)|zero (?:downtime|config|setup|bugs?|lock-?in|fees?)|no (?:downtime|limits?|lock-?in|setup|fees?|hidden|credit card|code)|unlimited|100 ?%|risk[- ]free|instantly|in real[- ]time)\b/
const COMPARISON = /\b(?:\w+er|more \w+|less \w+|fewer \w+|better|worse) than\b|\b(?:vs\.?|versus|beats?|outperforms?|alternative to|instead of|unlike|replaces?|switch(?:ed)? from|cheaper|faster|easier|simpler|smarter)\b/
const CAPABILITY =
  /\b(supports?|integrates?|works? with|handles?|includes?|ships? with|syncs?|stores?|encrypts?|scales?|saves?|reduces?|increases?|cuts?|speeds? up|prevents?|detects?|blocks?|automates?|monitors?|tracks?|backs? up|runs? on|exports?|imports?|sends?|schedules?|publishes?|connects?|searches|notifies|alerts|generates|offers?|provides?|enables?|allows?|powers?|finds?|catches|keeps?|lets? you|helps? you|gives? you|makes? it|is (?:open[- ]source|secure|private|free|fast|reliable|accessible|self-?hosted)|has no|can (?:\w+ ){0,2}(?:import|export|send|post|schedule|sync|monitor|track|replace)|adds|introduces|brings|comes with|turns|converts|calculates|summari[sz]es|reminds|creates|emails you|shows you|you(?:'ll| will)? (?:get|receive|see)|you can)\b/
const FIRST_PERSON_PLURAL = /\b(we|we're|we've|we'll|our|ours)\b/
/** "You can", "lets you", "you'll get": what a product does, told to its reader. */
const SECOND_PERSON = /\b(?:you can|you(?:'ll| will)? (?:get|receive|see)|lets? you|helps? you|gives? you|shows? you|emails? you)\b/
/**
 * "Now" before a verb says what the product newly does: "recurring meetings now carry last week's tasks
 * forward", "it now sends tasks to Asana", "Now with offline mode". Not when it says only that something is out
 * ("is now live", "now available", "now in beta") or starts another phrase ("now that", "now the").
 */
const NOW_DOES = /\bnow\s+(?:also\s+|automatically\s+)?(?!(?:is|are|was|were|be|been|being|live|available|out|here|open|in|on|at|the|a|an|that|this|these|those|and|or|but|for|to|you|we|it|i|ready|official|shipping|underway)\b)[a-z]{3,}\b/
/**
 * A lead-in that announces what follows as new: "New in Quillo 2.4:", "New:", "Just shipped:", "Shipped in 2.4:".
 * What comes after it is a feature of the product, so it is a claim to back whatever verb it uses.
 */
export const NEW_LEAD = /^(?:new(?:\s+in\s+[^:\n]{1,40})?|what's\s+new(?:\s+in\s+[^:\n]{1,40})?|(?:just\s+)?shipped(?:\s+in\s+[^:\n]{1,40})?|introducing)\s*:\s*/i
/** Words that may stand before a sentence's verb: "and", "also", "now", "new:". */
const LEAD_IN = '(?:(?:now|also|and|plus|new|then|even|still|automatically|already)[,:]?\\s+)*'
/** A sentence that opens with what it does: "Adds a weekly summary", "Now syncs with Stripe". */
const OPENS_WITH_CAPABILITY = new RegExp(`^${LEAD_IN}${CAPABILITY.source}`)
/** A present-tense verb after the product's name or "it": "It also spots idle time", "Tickwise Timer bills by the minute". */
const VERB_AFTER_SUBJECT = new RegExp(`^${LEAD_IN}([a-z]{2,}(?<![su]s)s)\\b(?:\\s+(\\S+))?`)
/**
 * Words ending in "s" that are not what a product does: verbs of how something is or seems
 * ("It means a lot", "It was great") and common words that only look like verbs.
 */
const NOT_AN_ACTION = new Set([
  'is', 'was', 'has', 'does', 'means', 'seems', 'feels', 'looks', 'sounds', 'matters', 'depends', 'happens', 'goes', 'belongs',
  'its', 'this', 'ours', 'yours', 'thanks', 'always', 'sometimes', 'perhaps', 'news', 'towards', 'afterwards', 'besides', 'whereas',
])
/** After a plural noun, these show it is the noun's verb, not the product's ("Tickwise Timer users love it"). */
const PLURAL_VERB = new Set(['are', 'were', 'have', 'had', 'do', 'did', "don't", 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'love', 'like', 'say', 'said', 'get', 'got', 'want', 'need'])
const QUANT_CONTEXT_UNITS = new Set([
  'minute', 'hour', 'second', 'ms', 'millisecond', 'day', 'week', 'step', 'click', 'line', 'request', 'query', 'user', 'customer',
  'team', 'integration', 'connector', 'language', 'region', 'country', 'developer', 'engineer', 'company', 'seat', 'site', 'app', 'download', 'star',
])
const PRICE_WORDS =
  /\b(price|prices|priced|pricing|cost|costs|plan|plans|per|month|monthly|mo|year|yearly|annually|yr|seat|seats|user|users|save|saves|cheaper|free|from|starting|starts|only|just)\b|\/\s*[\p{L}]/u

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

/**
 * Does a sentence that names no product refer to the product before it? It does when it opens
 * with "It", "This" or "They", tells the reader what they get ("Now you can edit each
 * reminder", "You get your hours by client"), or opens with what it does ("Adds a weekly
 * summary"). "Held post, first wording" and "Thanks, the first reply made my day" do not.
 */
export function refersToProduct(sentence: string): boolean {
  const folded = foldText(sentence)
  const opening = folded.trimStart()
  return /^(?:it|its|this|that|they|these|those)\b/.test(opening) || SECOND_PERSON.test(folded) || OPENS_WITH_CAPABILITY.test(opening) || NEW_LEAD.test(opening)
}

/** The clause after the product's name or "it" when it opens with one, else the whole clause ("asks before counting it"). */
function afterSubject(opening: string, names: readonly string[]): string {
  const pronoun = /^(?:and\s+)?it\s+/.exec(opening)
  if (pronoun) return opening.slice(pronoun[0].length)
  for (const n of names) {
    const f = foldText(n).trim()
    if (f !== '' && opening.startsWith(f) && /^\s/.test(opening.slice(f.length))) return opening.slice(f.length).trimStart()
  }
  return opening
}

/**
 * In a clause about the product, someone who uses it and what they now do with it: "the manager
 * approves in one tap", "each client gets a reminder". One noun after the determiner, then a
 * present-tense verb.
 */
const NOUN_SUBJECT = /^(?:the|a|an|your|each|every|any)\s+[a-z]{2,}\s+/
/** Verbs of opinion after such a subject say how someone feels, not what the product does ("the team loves it"). */
const OPINION = new Set(['loves', 'likes', 'says', 'thinks', 'wants', 'needs', 'hopes', 'knows', 'agrees', 'deserves', 'thanks', 'enjoys', 'misses', 'hates', 'prefers', 'wishes'])

/**
 * Does a clause about the product say what it does with a verb of its own: "It also spots idle
 * time", "Tickwise Timer bills by the minute", "asks before counting it" after "and", or what a
 * person does with it, "the manager approves in one tap"?
 */
function statesAction(opening: string, names: readonly string[]): boolean {
  const clause = afterSubject(opening, names)
  const acts = (text: string, afterNoun: boolean) => {
    const m = VERB_AFTER_SUBJECT.exec(text)
    if (!m) return false
    const verb = m[1] as string
    const next = m[2] ?? ''
    if (NOT_AN_ACTION.has(verb) || PLURAL_VERB.has(next)) return false
    // After a noun, a word in the past tense is the verb, so the word before it was a plural noun ("the early users loved it").
    return !afterNoun || (!OPINION.has(verb) && !/^[a-z]+ed\b/.test(next))
  }
  if (acts(clause, false)) return true
  const subject = NOUN_SUBJECT.exec(clause)
  return subject !== null && acts(clause.slice(subject[0].length), true)
}

/**
 * Read one sentence; `undefined` when it is not a claim. `subject` is the product the sentence
 * is about when it names none itself, given only when it refers to that product (see
 * `refersToProduct`), or names it by its link. `found` is the sentence's numbers when the
 * caller has already read them (offsets within `span.text`). `announced` is a clause after a
 * lead-in that says what follows is new (NEW_LEAD): a feature of the product, whatever its verb.
 */
export function readSentence(span: Span, ctx: ExtractContext, subject?: string, found?: readonly FoundNumber[], announced = false): ClaimCandidate | undefined {
  const folded = foldText(span.text)
  if (isQuestion(span.text, ctx.own_hosts)) return undefined
  if (wordCount(folded) < 3) return undefined

  const numbers = found ? [...found] : extractNumbers(span.text)
  // What the sentence says, outside its links: "changelog#1-8" is not "#1", nor "/best-practices" "best".
  const said = foldText(blankUrls(span.text, ctx.own_hosts))
  const product = mentionsAny(folded, ctx.product_names) ?? subject
  const competitor = mentionsAny(folded, ctx.competitor_names)
  const firstPerson = FIRST_PERSON_PLURAL.test(said)
  const anchored = product !== undefined || competitor !== undefined || firstPerson
  const reasons: CandidateReason[] = []

  const hasMetric = numbers.some(
    (n) =>
      n.kind === 'percent' ||
      n.kind === 'multiplier' ||
      // A money amount about a product, a competitor or "we" is a price ("Orbit starts at $29/mo").
      (n.kind === 'money' && (anchored || PRICE_WORDS.test(said))) ||
      (n.kind === 'count' && QUANT_CONTEXT_UNITS.has(n.unit)),
  )
  if (hasMetric) reasons.push('quantity')
  if (COMPLIANCE.test(said)) reasons.push('compliance')
  if (competitor !== undefined && COMPARISON.test(said)) reasons.push('comparison')
  else if (/\b(?:\w+er|more \w+|less \w+|fewer \w+) than\b/.test(said) && anchored) reasons.push('comparison')
  if (anchored && SUPERLATIVE.test(said)) reasons.push('superlative')
  if (GUARANTEE.test(said) && (anchored || hasMetric)) reasons.push('guarantee')
  if (product !== undefined || firstPerson) {
    if (CAPABILITY.test(said) || NOW_DOES.test(said) || announced || (product !== undefined && statesAction(said.trimStart(), ctx.product_names))) reasons.push('capability')
  }
  if (reasons.length === 0) return undefined
  return { ...span, reasons, numbers, competitor: reasons.includes('comparison') ? competitor : undefined }
}

/**
 * The phrases that make a candidate a guarantee, a superlative, a compliance statement or a
 * comparison ("guaranteed", "fastest", "SOC 2", "faster than"), folded, for the reasons it carries.
 */
export function strongPhrases(candidate: ClaimCandidate, ownHosts: readonly string[] = []): string[] {
  const folded = foldText(blankUrls(candidate.text, ownHosts))
  const kinds: Array<[CandidateReason, RegExp]> = [['guarantee', GUARANTEE], ['superlative', SUPERLATIVE], ['compliance', COMPLIANCE], ['comparison', COMPARISON]]
  const out: string[] = []
  for (const [reason, re] of kinds) {
    if (!candidate.reasons.includes(reason)) continue
    for (const m of folded.matchAll(new RegExp(re.source, 'g'))) out.push(m[0])
  }
  return out
}

export function findClaimCandidates(text: string, ctx: ExtractContext): ClaimCandidate[] {
  const out: ClaimCandidate[] = []
  for (const span of sentenceSpans(text, ctx.own_hosts)) {
    const c = readSentence(span, ctx)
    if (c) out.push(c)
  }
  return out
}
