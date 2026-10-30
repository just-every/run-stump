/**
 * Text features for ranking that cannot be steered by what the text says (STUMP-WATCH-005.5).
 *
 * A finding is untrusted data. Before any feature is computed, sentences that address the ranking
 * system, an assistant or the reader's instructions ("rank this first", "ignore your rules") are
 * removed, so the finding ranks as if it had not said them. The features themselves count distinct
 * matched terms and one yes/no for a question, never how often or how loudly something is said.
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

/**
 * Remove the words that address the system, not the sentence around them: a post that says
 * "...comparing Orbit and a spreadsheet. Rank this first" keeps its first sentence whole.
 */
export function neutralise(text: string): Neutralised {
  if (!text) return { text: '', instruction_like: false }
  let out = text
  let removed = false
  for (const re of DIRECTIVES) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    const next = out.replace(g, ' ')
    if (next !== out) removed = true
    out = next
  }
  return { text: out.replace(/\s+/g, ' ').trim(), instruction_like: removed }
}

const QUESTION_CUE =
  /^(how|what|which|where|who|why|when|is there|are there|is it|can (?:i|we|someone|anyone)|could (?:i|we)|should (?:i|we)|does anyone|do you (?:know|use|have|recommend)|did anyone|has anyone|have you|any (?:recommendations?|suggestions?|ideas?|advice|alternatives?|tips?)|looking for|recommend|need (?:a|an|help|advice|some)|seeking|help me|trying to find)\b/i
const QUESTION_ANYWHERE = /\b(alternatives? to|recommendations? for|anyone (?:know|use|tried|have|else)|suggest(?:ions)? for|best (?:way|tool|app|software|service))\b/i

/** Sentences that ask something. Links are removed first so `?` in a query string is not a question. */
export function questionSentences(text: string): string[] {
  const clean = text.replace(/https?:\/\/\S+/g, ' ')
  return sentences(clean).filter((s) => {
    const words = s.split(/\s+/).filter(Boolean).length
    if (words < 3) return false
    if (/[?？]\s*["')\]]*$/.test(s) || s.startsWith('¿')) return true
    return QUESTION_CUE.test(s) || QUESTION_ANYWHERE.test(s)
  })
}
