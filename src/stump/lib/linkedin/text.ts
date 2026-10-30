/**
 * Post text for LinkedIn's `little` text format and its length limit.
 *
 * Sources (read 30 Oct 2026):
 *  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
 *      reserved characters  |  {  }  @  [  ]  (  )  <  >  #  \  *  _  ~  must be escaped with a
 *      backslash to read as plain text; mentions are @[Name](urn); hashtags are #word or
 *      {hashtag|\#|word}.
 *  - docs/networks.md in the Stump repository: LinkedIn post length 3,000 characters (Share on LinkedIn).
 */

export const LINKEDIN_COMMENTARY_MAX = 3000

const RESERVED = /[|{}@[\]()<>#\\*_~]/g

/**
 * Escapes a person's text so LinkedIn shows it as typed. A `#` that starts a word is kept so
 * it stays a hashtag, which is what the person who typed it means; pass `hashtags: false` to
 * escape those too.
 */
export function escapeLinkedInText(text: string, opts: { hashtags?: boolean } = {}): string {
  const keepHashtags = opts.hashtags !== false
  return text.replace(RESERVED, (ch, offset: number, whole: string) => {
    if (ch === '#' && keepHashtags && /[\p{L}\p{N}]/u.test(whole.charAt(offset + 1)) && (offset === 0 || !/[\p{L}\p{N}]/u.test(whole.charAt(offset - 1)))) return ch
    return `\\${ch}`
  })
}

/** A mention in `little` format: the name must match the member or organization name exactly. */
export function linkedInMention(name: string, urn: string): string {
  return `@[${escapeLinkedInText(name, { hashtags: false })}](${urn})`
}

/** Turns stored `little` text back into plain text: mentions to their names, hashtag templates to #tag. */
export function unescapeLinkedInText(little: string): string {
  return little
    .replace(/@\[((?:\\.|[^\]\\])*)\]\(urn:li:[A-Za-z]+:[^)\s]+\)/g, (_m, name: string) => name)
    .replace(/\{hashtag\|\\?([#＃])\|((?:\\.|[^}\\])*)\}/g, (_m, sign: string, tag: string) => `${sign}${tag}`)
    .replace(/\\([|{}@[\]()<>#\\*_~])/g, '$1')
}

export interface LinkedInTextCheck {
  /** UTF-16 length, how LinkedIn's Java services count characters. */
  length: number
  limit: number
  valid: boolean
  over: number
}

/** Checks the person's text (before escaping) against the table's limit. Exactly the limit passes; one more fails. */
export function checkLinkedInText(text: string, limit: number = LINKEDIN_COMMENTARY_MAX): LinkedInTextCheck {
  const length = text.length
  const over = Math.max(0, length - limit)
  return { length, limit, valid: over === 0, over }
}
