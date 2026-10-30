// The acts Stump never offers (D-4, STUMP-TRUTH-003), each with its rule and the page
// that states it. A request for one answers `act_refused` with the rule and the
// source under every company policy; there is no tool, route or automation for them.
//
// Sources, read on the dates in `read_at`:
//   X Automation rules:           https://help.x.com/en/rules-and-policies/x-automation
//   X Developer Policy:           https://docs.x.com/developer-terms/policy
//   LinkedIn prohibited software: https://www.linkedin.com/help/linkedin/answer/a1341387
//   Hacker News Guidelines:       https://news.ycombinator.com/newsguidelines.html
//   Show HN:                      https://news.ycombinator.com/showhn.html
//   Product Hunt launch guide:    https://www.producthunt.com/launch
//   FTC rule, 16 CFR Part 465:    https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465
// The X Automation rules page sits behind a bot check that blocks scripted fetches, so
// its text was read from the Internet Archive's 2025 copy of the same page; the other
// pages were read directly. `basis` tells a platform's own ban ("platform"), a federal
// rule ("law") from a line Stump draws beyond the platform's ("stump"), such as no
// software-initiated reposts, which X permits for informational accounts.

export type BannedActId =
  | 'x_keyword_reply'
  | 'x_unengaged_reply'
  | 'x_automated_like'
  | 'software_like'
  | 'software_repost'
  | 'linkedin_automated_engagement'
  | 'hn_software_participation'
  | 'hn_vote_request'
  | 'producthunt_vote_request'
  | 'fake_review'
  | 'bought_engagement'
  | 'signed_in_scraping'

export interface BannedAct {
  id: BannedActId
  title: string
  /** Networks or venues the rule is about; 'any' for a federal rule. */
  applies_to: readonly string[]
  /** The rule, in Stump's words. */
  rule: string
  source_url: string
  source_title: string
  /** YYYY-MM-DD. */
  read_at: string
  basis: 'platform' | 'law' | 'stump'
}

const READ = '2026-10-30'

const X_AUTOMATION = {
  source_url: 'https://help.x.com/en/rules-and-policies/x-automation',
  source_title: 'X Automation rules',
}
const LINKEDIN_PROHIBITED = {
  source_url: 'https://www.linkedin.com/help/linkedin/answer/a1341387',
  source_title: 'LinkedIn: Prohibited software and extensions',
}
const HN_GUIDELINES = {
  source_url: 'https://news.ycombinator.com/newsguidelines.html',
  source_title: 'Hacker News Guidelines',
}
const FTC_465 = (section: string, title: string) => ({
  source_url: `https://www.ecfr.gov/current/title-16/part-465/section-${section}`,
  source_title: `16 CFR ${section}, ${title}`,
})

export const BANNED_ACTS: readonly BannedAct[] = [
  {
    id: 'x_keyword_reply',
    title: 'Keyword-triggered replies on X',
    applies_to: ['x'],
    rule: 'X does not allow automated replies or mentions sent to people because their posts matched a keyword search; reaching many people who did not ask is unsolicited use of the reply function.',
    ...X_AUTOMATION,
    read_at: READ,
    basis: 'platform',
  },
  {
    id: 'x_unengaged_reply',
    title: 'API replies on X to an account that has not engaged first',
    applies_to: ['x'],
    rule: 'X allows an automated reply only to someone who asked or clearly signalled they want to hear from the account, for example by replying to its post or messaging it first. Stump sends an API reply on X only to an account that has engaged with the replying account.',
    ...X_AUTOMATION,
    read_at: READ,
    basis: 'platform',
  },
  {
    id: 'x_automated_like',
    title: 'Automated likes on X',
    applies_to: ['x'],
    rule: 'X does not allow liking posts in an automated manner.',
    ...X_AUTOMATION,
    read_at: READ,
    basis: 'platform',
  },
  {
    id: 'software_like',
    title: 'Likes of other people\'s posts that software initiates',
    applies_to: ['x', 'bluesky', 'mastodon', 'threads'],
    rule: 'X bans automated likes (x_automated_like). Stump applies the same line on every network: a like is a person\'s own act, never initiated by software, and a person likes from the inbox with their own click.',
    ...X_AUTOMATION,
    read_at: READ,
    basis: 'stump',
  },
  {
    id: 'software_repost',
    title: 'Reposts and quotes of other people\'s posts that software initiates',
    applies_to: ['x', 'bluesky', 'mastodon', 'threads'],
    rule: 'X warns that automated reposting leads to bad experiences and bans bulk, aggressive or spammy reposting. Stump goes further: a repost or quote of someone else\'s post is a person\'s own act, never initiated by software.',
    ...X_AUTOMATION,
    read_at: READ,
    basis: 'stump',
  },
  {
    id: 'linkedin_automated_engagement',
    title: 'Comments, likes or shares on other members\' LinkedIn posts by software',
    applies_to: ['linkedin'],
    rule: 'LinkedIn prohibits bots and other automated methods that act on the site, including automated comments, likes, shares and connection requests.',
    ...LINKEDIN_PROHIBITED,
    read_at: READ,
    basis: 'platform',
  },
  {
    id: 'hn_software_participation',
    title: 'Comments or submissions on Hacker News by software',
    applies_to: ['hacker_news'],
    rule: 'Hacker News is for conversation between humans: comments and submissions are written and posted by a person, not generated or posted by software.',
    ...HN_GUIDELINES,
    read_at: READ,
    basis: 'platform',
  },
  {
    id: 'hn_vote_request',
    title: 'Vote requests on Hacker News',
    applies_to: ['hacker_news'],
    rule: 'Hacker News does not allow asking for upvotes, comments or submissions, and a Show HN must not ask friends to upvote or comment.',
    source_url: 'https://news.ycombinator.com/showhn.html',
    source_title: 'Show HN (with the Hacker News Guidelines, news.ycombinator.com/newsguidelines.html)',
    read_at: READ,
    basis: 'platform',
  },
  {
    id: 'producthunt_vote_request',
    title: 'Vote requests on Product Hunt',
    applies_to: ['product_hunt'],
    rule: 'Product Hunt lets a maker share the launch link anywhere but does not allow asking people directly to upvote; ask them to visit the product and leave comments.',
    source_url: 'https://www.producthunt.com/launch',
    source_title: 'Product Hunt launch guide',
    read_at: READ,
    basis: 'platform',
  },
  {
    id: 'fake_review',
    title: 'Reviews or testimonials written for someone else to post',
    applies_to: ['any'],
    rule: 'A business may not write, create or sell a consumer review or testimonial that misrepresents that the reviewer exists, used the product, or what their experience was, nor procure one from its own staff or relatives that it knows is misleading.',
    ...FTC_465('465.2', 'Fake or false consumer reviews, consumer testimonials, or celebrity testimonials'),
    read_at: READ,
    basis: 'law',
  },
  {
    id: 'bought_engagement',
    title: 'Bought followers, votes or engagement',
    applies_to: ['any'],
    rule: 'It is an unfair or deceptive practice to buy, procure, sell or distribute fake indicators of social media influence (followers, likes, views, votes, reposts) that materially misrepresent influence for a commercial purpose.',
    ...FTC_465('465.8', 'Misuse of fake indicators of social media influence'),
    read_at: READ,
    basis: 'law',
  },
  {
    id: 'signed_in_scraping',
    title: 'Scraping or browser automation of a network\'s signed-in site',
    applies_to: ['linkedin', 'x'],
    rule: 'LinkedIn prohibits crawlers, bots and browser extensions that scrape the site or automate activity on it; Stump reaches a network only through its published API.',
    ...LINKEDIN_PROHIBITED,
    read_at: READ,
    basis: 'platform',
  },
]

const byId = new Map(BANNED_ACTS.map((a) => [a.id, a]))

export function bannedAct(id: BannedActId): BannedAct {
  const act = byId.get(id)
  if (!act) throw new RangeError(`unknown banned act ${id}`)
  return act
}

/** The refusal an `act_refused` answer carries. */
export interface ActRefusal {
  code: 'act_refused'
  act: BannedActId
  title: string
  rule: string
  source: string
  source_title: string
  read_at: string
  basis: BannedAct['basis']
}

export function refusalFor(act: BannedAct): ActRefusal {
  return {
    code: 'act_refused',
    act: act.id,
    title: act.title,
    rule: act.rule,
    source: act.source_url,
    source_title: act.source_title,
    read_at: act.read_at,
    basis: act.basis,
  }
}

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[\s-]+/g, '_')
}

const LIKE = new Set(['like', 'favorite', 'favourite', 'fave', 'heart', 'star'])
const REPOST = new Set(['repost', 'retweet', 'reblog', 'boost', 'quote', 'quote_post', 'quote_tweet', 'rt', 'amplify'])
const COMMENT = new Set(['comment', 'share', 'reshare', 'react', 'reaction', 'endorse'])
const VOTE = new Set(['upvote', 'vote', 'downvote', 'flag', 'save'])
const BUY = new Set(['buy_followers', 'buy_votes', 'buy_likes', 'buy_engagement', 'purchase_followers', 'purchase_engagement', 'boost_engagement', 'grow_followers', 'engagement_pod', 'follow_for_follow'])
const SCRAPE = new Set(['scrape', 'crawl', 'browser_automation', 'automate_browser', 'headless_browser', 'sign_in_scrape'])
const SUBMIT = new Set(['submit', 'post_story', 'submit_link'])

export interface ActRequest {
  /** The action named on a tool call, e.g. "like", "repost", "comment". */
  action: string
  /** The network of the post acted on. */
  network?: string
  /** The venue's platform (hacker_news, product_hunt, ...). */
  venue_platform?: string
}

/** The banned acts a requested action names. An empty list means the action is not a banned act. */
export function matchActionRequest(request: ActRequest): BannedAct[] {
  const action = norm(request.action)
  const network = norm(request.network ?? request.venue_platform)
  const acts: BannedActId[] = []
  if (LIKE.has(action)) acts.push(network === 'x' ? 'x_automated_like' : 'software_like')
  if (REPOST.has(action)) acts.push('software_repost')
  if (COMMENT.has(action)) {
    if (network === 'linkedin' || network === '') acts.push('linkedin_automated_engagement')
    if (network === 'hacker_news' || network === 'hn' || network === '') acts.push('hn_software_participation')
    if (network === 'x' || network === 'bluesky' || network === 'mastodon' || network === 'threads') {
      if (action === 'share' || action === 'reshare') acts.push('software_repost')
    }
  }
  if (SUBMIT.has(action) && (network === 'hacker_news' || network === 'hn' || network === '')) acts.push('hn_software_participation')
  if (VOTE.has(action)) {
    if (network === 'product_hunt') acts.push('producthunt_vote_request')
    else if (network === 'hacker_news' || network === 'hn') acts.push('hn_vote_request', 'hn_software_participation')
    else if (action === 'upvote' || action === 'vote' || action === 'downvote') acts.push('hn_vote_request', 'producthunt_vote_request')
  }
  if (BUY.has(action)) acts.push('bought_engagement')
  if (SCRAPE.has(action)) acts.push('signed_in_scraping')
  if (action === 'write_review' || action === 'post_review' || action === 'create_review' || action === 'rate' || action === 'testimonial') acts.push('fake_review')
  return [...new Set(acts)].map(bannedAct)
}

export type AutomationTrigger = 'keyword' | 'hashtag' | 'search' | 'mention' | 'reply_to_company' | 'schedule' | 'new_post' | string
export type AutomationAction = 'reply' | 'like' | 'repost' | 'quote' | 'comment' | 'share' | 'follow' | 'dm' | 'submit' | string

export interface AutomationSpec {
  network: string
  trigger: AutomationTrigger
  action: AutomationAction
}

/** An automation that would perform a banned act, e.g. reply on X whenever a keyword appears. */
export function matchAutomation(spec: AutomationSpec): BannedAct[] {
  const network = norm(spec.network)
  const trigger = norm(spec.trigger)
  const action = norm(spec.action)
  const acts: BannedActId[] = []
  const searchLike = trigger === 'keyword' || trigger === 'hashtag' || trigger === 'search' || trigger === 'new_post'
  if (network === 'x' && searchLike && (action === 'reply' || action === 'mention' || action === 'comment')) acts.push('x_keyword_reply')
  for (const a of matchActionRequest({ action: spec.action, network: spec.network })) acts.push(a.id)
  return [...new Set(acts)].map(bannedAct)
}

// --- Text screens ---------------------------------------------------------------

export interface TextFinding {
  act: BannedActId
  text: string
  start: number
  end: number
}

const VOTE_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:please\s+|pls\s+|kindly\s+)?(?:up-?vot(?:e|es|ed|ing))\b/giu,
  /\b(?:vote|voting)\s+(?:for|on)\s+(?:us|me|it|this|our|my|the launch|the product)\b/giu,
  /\b(?:give|show|send)\s+(?:us|me|it|this)\s+(?:an?\s+)?(?:up-?vote|vote|boost|push|bump)\b/giu,
  /\byour\s+(?:up-?)?vote\b/giu,
  /\b(?:hit|click|tap|smash|press)\s+(?:the\s+)?(?:up-?vote|arrow|triangle|up arrow|vote button)\b/giu,
  /\bhelp\s+(?:us\s+)?(?:climb|reach|get\s+(?:us\s+)?to|make\s+(?:it\s+)?to)\s+(?:the\s+)?(?:top|#1|number one|front page)\b/giu,
  /\b(?:support|back)\s+(?:us|our launch)\s+on\s+(?:product\s*hunt|hacker news|hn|ph)\b/giu,
]

/** Phrases in a draft that ask readers to vote. Venue-agnostic; the caller decides which venues care. */
export function findVoteRequests(text: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = []
  for (const re of VOTE_REQUEST_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0
      out.push({ text: m[0], start, end: start + m[0].length })
    }
  }
  out.sort((a, b) => a.start - b.start)
  return out.filter((m, i) => i === 0 || m.start >= (out[i - 1] as { end: number }).end)
}

/** Vote requests in a draft bound for a venue whose platform bans them (Hacker News, Product Hunt). */
export function screenDraftForVenue(text: string, venuePlatform: string): TextFinding[] {
  const platform = norm(venuePlatform)
  const act: BannedActId | undefined =
    platform === 'hacker_news' || platform === 'hn' || platform === 'show_hn'
      ? 'hn_vote_request'
      : platform === 'product_hunt' || platform === 'producthunt' || platform === 'ph'
        ? 'producthunt_vote_request'
        : undefined
  if (!act) return []
  return findVoteRequests(text).map((m) => ({ act, ...m }))
}

const REVIEW_NOUN = '(?:reviews?|testimonials?|ratings?|endorsements?)'
const WRITE_VERB = '(?:write|draft|generate|compose|create|produce|make|give\\s+me|come\\s+up\\s+with|fake|invent)'
const REVIEW_REQUEST = new RegExp(`\\b${WRITE_VERB}\\b[^.!?\\n]{0,60}\\b${REVIEW_NOUN}\\b`, 'iu')
const REPLY_TO_REVIEW = /\b(?:repl(?:y|ies|ying)|respon(?:d|se|ses|ding)|answer(?:ing)?|reacting)\s+(?:to|for)\b[^.!?\n]{0,30}\b(?:reviews?|testimonials?)\b/iu
const AS_SOMEONE = /\b(?:as|like|pretending\s+to\s+be|posing\s+as|from\s+the\s+perspective\s+of|on\s+behalf\s+of|in\s+the\s+voice\s+of)\s+(?:an?\s+|the\s+|one\s+of\s+our\s+)?(?:happy\s+|satisfied\s+|real\s+|verified\s+)?(?:customers?|users?|clients?|buyers?|reviewers?|people)\b|\bfrom\s+(?:an?\s+|the\s+)?(?:happy\s+|satisfied\s+)?(?:customers?|users?|clients?)\b|\b(?:[1-5]|five|four)[-\s]?stars?\b|\bfor\s+(?:my\s+|our\s+)?(?:friends?|employees|team|staff|customers|users|family)\s+to\s+(?:post|leave|submit|write)\b|\bto\s+(?:post|leave|submit)\s+(?:on|at)\s+(?:g2|capterra|trustpilot|google|yelp|amazon|app\s*store|play\s*store)\b/iu
const BUY_ENGAGEMENT = /\b(?:buy|purchase|pay\s+for|get\s+(?:me\s+)?(?:some\s+)?(?:\d[\d,]*\s+)?(?:fake|cheap))\b[^.!?\n]{0,40}\b(?:followers|likes|upvotes|votes|reposts|retweets|views|engagement)\b/iu

/**
 * Screen a drafting request (the instruction a person or agent gives) for the acts the
 * drafting refuses: a review or testimonial for someone else to post, a request for
 * votes, bought engagement. Replying to a review is not refused.
 */
export function screenDraftRequest(request: string): TextFinding[] {
  const out: TextFinding[] = []
  if (REVIEW_REQUEST.test(request) && !REPLY_TO_REVIEW.test(request) && AS_SOMEONE.test(request)) {
    const m = REVIEW_REQUEST.exec(request) as RegExpExecArray
    out.push({ act: 'fake_review', text: m[0], start: m.index, end: m.index + m[0].length })
  }
  for (const m of findVoteRequests(request)) {
    const forPlatform = /product\s*hunt|\bph\b/i.test(request) ? 'producthunt_vote_request' : 'hn_vote_request'
    out.push({ act: forPlatform, ...m })
  }
  const buy = BUY_ENGAGEMENT.exec(request)
  if (buy) out.push({ act: 'bought_engagement', text: buy[0], start: buy.index, end: buy.index + buy[0].length })
  return out
}

/** Text of a launch-plan step or any saved instruction asking friends or followers for votes: both platforms' rules. */
export function screenPlanStep(step: string): BannedAct[] {
  if (findVoteRequests(step).length === 0 && !/\b(?:ask|get|tell|have|rally|recruit|message|dm|email|text)\b[^.!?\n]{0,60}\b(?:upvote|up-vote|vote|votes)\b/iu.test(step)) return []
  const acts: BannedActId[] = []
  const mentionsHn = /hacker\s*news|\bhn\b|show\s*hn/i.test(step)
  const mentionsPh = /product\s*hunt|\bph\b/i.test(step)
  if (mentionsHn || !mentionsPh) acts.push('hn_vote_request')
  if (mentionsPh || !mentionsHn) acts.push('producthunt_vote_request')
  return acts.map(bannedAct)
}
