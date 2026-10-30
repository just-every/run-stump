// LinkedIn commentary text.
//
// The Posts API reads `commentary` in LinkedIn's "little" text format, in which
// | { } @ [ ] ( ) < > # \ * _ ~ are reserved and must be escaped with a backslash
// to be plain text. A hashtag is written #word, a mention @[Name](urn:li:...).
//   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
//   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api#mentions-and-hashtags-using-posts-commentary
// The share endpoint a member uses (Share on LinkedIn, w_member_social) takes the
// same commentary string in `shareCommentary.text`:
//   https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin

const RESERVED = new Set(['|', '{', '}', '@', '[', ']', '(', ')', '<', '>', '#', '\\', '*', '_', '~'])
const HASHTAG_BODY = /[\p{L}\p{N}_]/u

/**
 * Escape plain text for the commentary field. A '#' that starts a hashtag
 * (followed by a letter, digit or underscore) is left as it is, because the
 * documented way to post a hashtag is the bare #word; every other reserved
 * character, including '@', is escaped so it reads as text.
 */
export function escapeLinkedInCommentary(text: string): string {
  let out = ''
  const chars = Array.from(text)
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string
    if (ch === '#') {
      const next = chars[i + 1]
      const before = chars[i - 1]
      const startsWord = before === undefined || !HASHTAG_BODY.test(before)
      if (next !== undefined && HASHTAG_BODY.test(next) && startsWord) {
        out += ch
        continue
      }
    }
    out += RESERVED.has(ch) ? `\\${ch}` : ch
  }
  return out
}
