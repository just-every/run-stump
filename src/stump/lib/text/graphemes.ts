// Grapheme, byte and newline helpers shared by the text counters.
// Intl.Segmenter is present in the Cloudflare Workers runtime; there is no
// fallback, so a runtime without it fails loudly instead of miscounting.

let graphemeSegmenter: Intl.Segmenter | null = null
let sentenceSegmenter: Intl.Segmenter | null = null
const encoder = new TextEncoder()

function graphemes_(): Intl.Segmenter {
  graphemeSegmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' })
  return graphemeSegmenter
}

function sentences_(): Intl.Segmenter {
  sentenceSegmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' })
  return sentenceSegmenter
}

/** Counting normalises line endings: a CRLF is one newline on every network. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function splitGraphemes(text: string): string[] {
  const out: string[] = []
  for (const part of graphemes_().segment(text)) out.push(part.segment)
  return out
}

export function graphemeCount(text: string): number {
  let n = 0
  for (const _ of graphemes_().segment(text)) n++
  return n
}

export function utf8Length(text: string): number {
  return encoder.encode(text).length
}

/** Sentences with their trailing whitespace kept, so joining them restores the text. */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  for (const part of sentences_().segment(text)) out.push(part.segment)
  return out
}

let emojiPattern: RegExp | null = null
/** True when the whole grapheme is one RGI emoji (flags, ZWJ families, skin tones, keycaps). */
export function isEmojiGrapheme(grapheme: string): boolean {
  emojiPattern ??= new RegExp('^\\p{RGI_Emoji}$', 'v')
  return emojiPattern.test(grapheme)
}
