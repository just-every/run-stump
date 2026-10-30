// Sentence spans and tokens used by the claim check. Intl.Segmenter is part of the
// Workers runtime; there is no fallback.

let segmenter: Intl.Segmenter | null = null

export interface Span {
  text: string
  start: number
  end: number
}

/** Sentences of a text with their offsets, trimmed of surrounding whitespace. */
export function sentenceSpans(text: string): Span[] {
  segmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' })
  const spans: Span[] = []
  for (const part of segmenter.segment(text)) {
    const raw = part.segment
    const lead = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (trimmed === '') continue
    spans.push({ text: trimmed, start: part.index + lead, end: part.index + lead + trimmed.length })
  }
  return spans
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const STOP = new Set(
  (
    'a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those ' +
    'we our ours you your they their them he she his her i me my so than then there here do does did has have had will would ' +
    'can could should may might just also very more most all any each every into onto over under up down out off not no nor ' +
    'about after before again too own same such what which who whom when where why how'
  ).split(' '),
)

function stem(word: string): string {
  let w = word
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`
  else if (w.length > 4 && w.endsWith('sses')) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2)
  else if (w.length > 5 && w.endsWith('est')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('er')) w = w.slice(0, -2)
  else if (w.length > 5 && w.endsWith('ly')) w = w.slice(0, -2)
  if (w.length > 3 && w.endsWith('i')) w = `${w.slice(0, -1)}y`
  return w
}

/** Lower-case NFKC text with straight quotes and a space between a letter and a following digit ("SOC2" -> "soc 2"). */
export function foldText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/(\p{L})(?=\d)/gu, '$1 ')
}

/** Content words of a text, stemmed, with stop words and numbers removed. */
export function contentTokens(text: string): string[] {
  const out: string[] = []
  for (const m of foldText(text).matchAll(/[\p{L}][\p{L}\p{N}]*/gu)) {
    const w = m[0]
    if (STOP.has(w)) continue
    out.push(stem(w))
  }
  return out
}
