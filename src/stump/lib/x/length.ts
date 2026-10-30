/**
 * X's weighted post length.
 *
 * Source: https://docs.x.com/fundamentals/counting-characters (read 30 Oct 2026)
 * and the twitter-text weight ranges it points to: Latin text, punctuation and
 * common symbols weigh 1 (U+0000-U+10FF, U+2000-U+200D, U+2010-U+201F,
 * U+2032-U+2037); CJK, emoji and every other code point weigh 2; each URL weighs
 * 23; length is measured after NFC normalisation; a zero-width joiner inside an
 * emoji sequence adds nothing. The default limit is 280; accounts with a longer
 * limit pass theirs.
 */
import { extractUrls } from './urls'

export const X_DEFAULT_POST_LIMIT = 280
export const X_URL_WEIGHT = 23

// Emoji sequences count 2 as a whole: flags, keycaps, and pictographs joined by ZWJ.
const EMOJI_SEQ = new RegExp(
  String.raw`\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*`,
  'uy',
)

function isLight(cp: number): boolean {
  return (
    cp <= 0x10ff ||
    (cp >= 0x2000 && cp <= 0x200d) ||
    (cp >= 0x2010 && cp <= 0x201f) ||
    (cp >= 0x2032 && cp <= 0x2037)
  )
}

/** The weighted length of `text` as X counts it. */
export function xWeightedLength(text: string): number {
  const s = text.normalize('NFC')
  const urls = extractUrls(s)
  let weight = 0
  let i = 0
  let u = 0
  while (i < s.length) {
    const url = urls[u]
    if (url && i === url.start) {
      weight += X_URL_WEIGHT
      i = url.end
      u++
      continue
    }
    const cp = s.codePointAt(i) as number
    // Symbols below U+1100 such as (c) and (r) are emoji only with the emoji selector.
    EMOJI_SEQ.lastIndex = i
    const m = EMOJI_SEQ.exec(s)
    if (m && (cp >= 0x1100 || m[0].length > 1)) {
      weight += 2
      i += m[0].length
      continue
    }
    weight += isLight(cp) ? 1 : 2
    i += cp > 0xffff ? 2 : 1
  }
  return weight
}

export interface XLengthCheck {
  weightedLength: number
  limit: number
  valid: boolean
  /** Weight over the limit; 0 when valid. */
  over: number
}

/** Checks `text` against the account's weighted limit (280 unless the account has a longer one). */
export function checkXLength(text: string, limit: number = X_DEFAULT_POST_LIMIT): XLengthCheck {
  const weightedLength = xWeightedLength(text)
  const over = Math.max(0, weightedLength - limit)
  return { weightedLength, limit, valid: over === 0, over }
}
