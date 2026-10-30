/**
 * Text features for ranking that cannot be steered by what the text says (STUMP-WATCH-005.5).
 *
 * A finding is untrusted data. Before any feature is computed, sentences that address the ranking
 * system, an assistant or the reader's instructions ("rank this first", "ignore your rules") are
 * removed whole, so the finding ranks as if it had not said them. A question about the post, its rank
 * or the system reading it counts for nothing. The features themselves count distinct matched terms
 * and one yes/no for a question, never how often or how loudly something is said.
 */
import { sentences } from './text.ts'

const DIRECTIVES: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass|skip)\b[^.!?\n]{0,60}\b(previous|prior|above|earlier|all|any|your|these|the|those)\b[^.!?\n]{0,40}\b(instructions?|rules?|prompts?|guidelines?|polic(?:y|ies)|filters?|restrictions?|settings?)\b/i,
  /\b(rank|ranks|ranking|prioriti[sz]e|score|surface|boost|promote|highlight|mark|flag|treat|put|list|show|place|move)\b[^.!?\n]{0,40}\b(this|it|me|my\s+(?:post|thread|message|comment|reply|link)|us)\b[^.!?\n]{0,40}\b(first|top|highest|higher|1st|#1|number\s+one|relevant|useful|important|urgent|priority|best|above)\b/i,
  /\b(system\s+prompt|developer\s+message|new\s+instructions?|as\s+an?\s+(?:ai|assistant|language\s+model)|you\s+are\s+(?:now\s+)?an?\s+(?:ai|assistant|bot|agent|model))\b/i,
  /(?:^|\b)(?:hey|dear|attention|note\s+to|message\s+to|to\s+the)\s+(?:ai|llm|agents?|assistants?|bots?|crawlers?|stump|ranker|ranking\s+system)\b/i,
  /<\|[a-z_]+\|>|\[\/?(?:inst|system)\]|\b(?:assistant|system)\s*:/i,
]

export interface Neutralised {
  text: string
  /** True when something addressed to the ranking system was removed. */
  instruction_like: boolean
}

function firstDirective(s: string): number {
  let at = -1
  for (const re of DIRECTIVES) {
    const m = re.exec(s)
    if (m && (at < 0 || m.index < at)) at = m.index
  }
  return at
}

/** The end of the last sentence-ending punctuation followed by space before `limit`, or 0. */
function lastHardStop(s: string, limit: number): number {
  let end = 0
  const re = /[.!?\u2026]["')\]\u2019\u201d]*\s+/g
  for (let m = re.exec(s); m && m.index + m[0].length <= limit; m = re.exec(s)) end = m.index + m[0].length
  return end
}

/**
 * Drop every sentence that addresses the system, whole, so no fragment of it ("Why would you not
 * ... ?") is left to count as a question or a term. A post that says "...comparing Orbit and a
 * spreadsheet. Rank this first" keeps its first sentence. Where the segmenter glues a finished
 * statement to a directive (". <|im_start|>system ..."), the statement before the last full stop
 * stays, unless it asks something: a fragment that asks is dropped with the directive.
 */
export function neutralise(text: string): Neutralised {
  if (!text) return { text: '', instruction_like: false }
  const kept: string[] = []
  let removed = false
  for (const s of sentences(text)) {
    const at = firstDirective(s)
    if (at < 0) {
      kept.push(s)
      continue
    }
    removed = true
    const before = s.slice(0, lastHardStop(s, at)).trim()
    if (before && !isQuestion(before)) kept.push(before)
  }
  return { text: kept.join(' ').replace(/\s+/g, ' ').trim(), instruction_like: removed }
}

const QUESTION_CUE =
  /^(how|what|which|where|who|why|when|is there|are there|is it|can (?:i|we|someone|anyone)|could (?:i|we)|should (?:i|we)|does anyone|do you (?:know|use|have|recommend)|did anyone|has anyone|have you|any (?:recommendations?|suggestions?|ideas?|advice|alternatives?|tips?)|looking for|recommend|need (?:a|an|help|advice|some)|seeking|help me|trying to find)\b/i
const QUESTION_ANYWHERE = /\b(alternatives? to|recommendations? for|anyone (?:know|use|tried|have|else)|suggest(?:ions)? for|best (?:way|tool|app|software|service))\b/i

function isQuestion(s: string): boolean {
  const words = s.split(/\s+/).filter(Boolean).length
  // Two-word asks for help ("Any recommendations?") count; other short exclamations ("Why not?") do not.
  if (words < 3) return words === 2 && /[?\uFF1F]\s*$/.test(s) && asksForHelp(s)
  if (/[?\uFF1F]\s*["')\]]*$/.test(s) || s.startsWith('\u00BF')) return true
  return QUESTION_CUE.test(s) || QUESTION_ANYWHERE.test(s)
}

/** Sentences that ask something. Links are removed first so `?` in a query string is not a question. */
export function questionSentences(text: string): string[] {
  const clean = text.replace(/https?:\/\/\S+/g, ' ')
  return sentences(clean).filter(isQuestion)
}

// A question about the post itself, its place in a ranking or the system reading it is a request
// to the ranker, not something the company can answer: it earns nothing and marks the finding.
const POST = String.raw`(?:posts?|threads?|messages?|comments?|repl(?:y|ies)|findings?|submissions?|toots?|skeets?)(?![\w-])`
const RANK = String.raw`(?:re-?rank\w*|down-?rank\w*|rank(?:s|ed|ing)?|prioriti[sz]\w*|surfac(?:e|es|ed|ing)|boost\w*|promot\w*|upvot\w*|pin(?:s|ned)?|featur(?:e|es|ed)|highlight\w*|elevat\w*|bump\w*|scor(?:e|es|ed|ing))`
const PLACE = String.raw`(?:first|top|higher|highest|above|ahead|up|1st|#1|number\s+one|priority|more|most|better|best)`
const EVAL = String.raw`(?:important|relevan\w*|useful|valuable|interesting|urgent|priority|first|top|highest|best|#1|1st|number\s+one|attention|notice|worth|deserv\w*|matters?|above|ahead|front|visib\w*|featured|seen|read)(?!\w)`
const STRONG_EVAL = String.raw`(?:first|top|highest|#1|1st|number\s+one|priority|urgent|attention|important|relevan\w*|most\s+(?:useful|valuable|interesting))(?!\w)`
const SYSTEM = String.raw`(?:ai|a\.i\.|llms?|gpt|chatgpt|claude|gemini|assistants?|bots?|robots?|crawlers?|algorithms?|rankers?|stump|agents?|models?)`
const ABOUT_RANKING: RegExp[] = [
  // "rank this first", "boost my post", "rank it higher"
  new RegExp(String.raw`\b${RANK}\s+(?:\w+\s+)?(?:this|me|us|(?:my|our|this|these)\s+(?:\w+\s+){0,2}${POST})\b`, 'i'),
  new RegExp(String.raw`\b${RANK}\s+(?:\w+\s+)?it\s+(?:\w+\s+){0,2}?${PLACE}`, 'i'),
  // "should this be ranked", "this post should rank", "post to surface", "should it be ranked"
  new RegExp(String.raw`\b${POST}\s+(?:\w+\s+){0,2}?${RANK}\b`, 'i'),
  new RegExp(String.raw`\bthis\s+(?:(?:\w+\s+)?(?:be|get|gets|got|is|was)\s+|(?:should|would|could|must|will|to|deserves?\s+to|needs?\s+to)\s+(?:be\s+)?)(?:\w+\s+)?${RANK}\b`, 'i'),
  new RegExp(String.raw`\bit\s+(?:\w+\s+)?(?:be|get|gets|got|is)\s+(?:\w+\s+)?${RANK}\b`, 'i'),
  // "is this not the most important post", "can you put my post at the top"
  new RegExp(String.raw`\b(?:this|my|our|these)\s+(?:\S+\s+){0,4}${POST}[\s\S]*(?<![\w#])${EVAL}|(?<![\w#])${EVAL}[\s\S]*\b(?:this|my|our|these)\s+(?:\S+\s+){0,4}${POST}`, 'i'),
  // "should this be first", "this deserves the top spot"
  new RegExp(String.raw`\bthis\s+(?:\S+\s+){0,4}?${STRONG_EVAL}`, 'i'),
  // Addressing the system: "AI, is this...", "are you an assistant", "your instructions", "any bot reading this"
  new RegExp(String.raw`(?:^|[,;:]\s*)(?:(?:hey|hi|hello|dear|ok(?:ay)?|yo|psst|attention|note\s+to|message\s+to)\s+)?(?:the\s+)?${SYSTEM}\s*[,:!]`, 'i'),
  new RegExp(String.raw`\b(?:you\s+(?:are|re)|you['\u2019]re|are\s+you|aren['\u2019]?t\s+you)\s+(?:(?:just|only|now|really|not)\s+)?(?:an?|the)\s+${SYSTEM}\b`, 'i'),
  new RegExp(String.raw`\byour\s+(?:\w+\s+)?(?:instructions?|prompts?|ranking|ranker|algorithm|scoring|guidelines|programming)\b`, 'i'),
  new RegExp(String.raw`\b${SYSTEM}\s+(?:\w+\s+)?(?:reading|scanning|ranking|scoring|processing|parsing|indexing|summari[sz]ing)\s+(?:this|these|me|my|our|${POST})`, 'i'),
]

/** True for a question about the post, its rank or the system reading it, rather than about the topic. */
export function isAboutTheRanking(question: string): boolean {
  return ABOUT_RANKING.some((re) => re.test(question))
}

// Help-seeking: the shapes in which people ask for a tool, a way or advice. A question that is
// neither help-seeking nor about a watch term (a rhetorical "why would you not?") earns nothing.
const HELP: RegExp[] = [
  /\b(?:any|some|your)\s+(?:good\s+)?(?:recommendations?|recs|suggestions?|ideas?|advice|alternatives?|tips?|thoughts|experiences?|feedback|pointers|insights?|opinions?)\b/i,
  /\b(?:recommend|suggest)(?:ed|ations?|ions?|s)?\b/i,
  /\balternatives?\s+(?:to|for)\b/i,
  /\b(?:anyone|anybody|someone|somebody|people|folks|y'?all|you\s+all|you\s+guys|others|teams?)\s+(?:here\s+)?(?:\w+\s+)?(?:know|uses?|used|using|tried|try|trying|have|had|recommend|switch\w*|mov(?:e|ed|ing)|migrat\w*|prefer|handle[sd]?|deal\w*|solv\w*|run|ran|built|build|compared?|evaluat\w*|pick|chose|choose|go\s+with|went\s+with|pay|paid)\b/i,
  /\b(?:what|which|how|where|who)\b[^?.!]{0,60}\b(?:i|we|you|people|folks|teams?|one|someone)\s+(?:\w+\s+)?(?:use|pick|choose|try|go|do|start|set|handle|solve|fix|manage|get|switch|move|migrate|compare|track|find|recommend|suggest|need|pay|buy|integrate|automate|connect|build|run|approach|structure|organi[sz]e|price|measure|evaluate)\b/i,
  /\bhow\s+(?:do|does|did|should|can|could|would|to)\b/i,
  /\b(?:looking\s+for|need(?:ing)?\s+(?:a|an|some|help|advice|to\s+find)|help\s+me|can\s+(?:someone|anyone)\s+help|trying\s+to\s+(?:find|choose|pick|decide|figure)|stuck\s+(?:on|with)|struggling\s+(?:with|to))\b/i,
  /\b(?:is|are)\s+there\s+(?:a|an|any|some)\b/i,
  /\bwhat\s+(?:do|would|should)\s+(?:you|people|folks)\s+(?:all\s+|guys\s+)?(?:think|use|do|recommend|suggest)\b/i,
  /\bworth\s+(?:it|paying|the|switching|trying|using)\b/i,
  /\b(?:which|what)\s+(?:\w+\s+){0,2}(?:is|are|was|would\s+be)\s+(?:the\s+)?(?:best|better|cheapest|easiest|simplest|right|fastest)\b/i,
  /\b(?:best|good|cheap|simple|easy)\s+(?:way|tool|app|software|service|option|platform|setup|stack|approach)\s+(?:to|for)\b/i,
  /\b(?:does|do|did|has|have)\s+(?:anyone|anybody|someone|somebody|any\s+of\s+you)\b/i,
  /\b(?:should|can|could)\s+(?:i|we)\b/i,
]

/** True for a question that asks for a tool, a way or advice. */
export function asksForHelp(question: string): boolean {
  return HELP.some((re) => re.test(question))
}
