// What an inbox post is, read from its form alone (D-7: its words never start an
// action). Whether its author engaged with the account first decides whether the
// account may answer it (D-4); whether they engaged with substance decides whether
// they are offered to Orbit (STUMP-STACK-002).

export interface Post { text: string; authorId: string | null; inReplyToUserId: string | null; referenced: { id: string; type: string }[] }

/** The author mentioned the account, replied to it, or quoted one of its posts. */
export function engagedFirst(post: Post, account: { userId: string; handle: string }, ownPostIds: ReadonlySet<string>): boolean {
  if (post.authorId && post.authorId === account.userId) return false
  if (post.inReplyToUserId === account.userId) return true
  if (post.referenced.some(ref => (ref.type === 'quoted' || ref.type === 'replied_to') && ownPostIds.has(ref.id))) return true
  const handle = account.handle.replace(/^@/, '').toLowerCase()
  return new RegExp(`(^|[^A-Za-z0-9_])@${handle.replace(/[^A-Za-z0-9_]/g, '')}(?![A-Za-z0-9_])`, 'i').test(post.text)
}

/** The kind of post: a reply to the account's post, a quote of it, or a mention. */
export function kindOf(post: Post, parentOwn: boolean): 'reply' | 'quote' | 'mention' {
  if (post.referenced.some(ref => ref.type === 'replied_to') && parentOwn) return 'reply'
  if (post.referenced.some(ref => ref.type === 'quoted')) return 'quote'
  return 'mention'
}

const INTENT = /\b(recommend(ation)?s?|alternatives?|vs\.?|versus|compar(e|ed|ing|ison)|evaluat(e|ing|ion)|looking for|switch(ing)? (from|to)|anyone (use|using|tried)|pricing|price|cost|trial|demo)\b/i
const REACTIONS = /^(thanks?( you)?|thx|ty|nice|cool|great|awesome|love (it|this)|congrats|congratulations|wow|yes|ok|okay|lol|this|same|\+1)[.!\s]*$/i

/**
 * Engagement with substance, or null for a passing reaction: a question, a
 * mention of the product with intent (asking for a recommendation, comparing,
 * evaluating), or a reply with more than a reaction.
 */
export function engagementOf(text: string): string | null {
  const plain = text.replace(/(^|\s)@[A-Za-z0-9_]+/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return null
  if (/\?/.test(plain)) return 'asked a question'
  if (INTENT.test(plain)) return 'mentioned the product with intent'
  const words = plain.split(' ').filter(word => /[\p{L}\p{N}]/u.test(word))
  if (words.length < 5 || REACTIONS.test(plain)) return null
  return 'replied'
}
