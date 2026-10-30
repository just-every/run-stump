/**
 * LinkedIn's per-member daily request limit and when it resets.
 *
 * Source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 * "Rate Limits": Member 150 requests a day, Application 100,000, counted per UTC day.
 * docs/networks.md carries the same figures; callers pass the table's value.
 */
import { nextUtcMidnight } from './errors'

export const LINKEDIN_MEMBER_DAILY_LIMIT = 150

/** The UTC day `now` falls in. */
export function linkedInDayWindow(now: number): { startsAt: string; resetsAt: string } {
  const d = new Date(now)
  return { startsAt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString(), resetsAt: nextUtcMidnight(now) }
}

/**
 * Counts every HTTP call a post makes to LinkedIn, so the daily budget errs on the side of
 * holding: 1 for the post, 2 per image (start the upload, send the bytes), and the same for
 * an article thumbnail. LinkedIn's page says "requests" without breaking this down.
 */
export function estimateLinkedInRequests(input: { images?: number; thumbnail?: boolean }): number {
  return 1 + 2 * (input.images ?? 0) + (input.thumbnail ? 2 : 0)
}

export interface LinkedInQuotaDecision {
  allowed: boolean
  remaining: number
  /** ISO time to hold the item to when it does not fit today. */
  holdUntil: string | null
  reason: string | null
}

/**
 * Decides whether `wanted` more requests fit in this member's UTC day. `used` is how many the
 * company already made for the member since 00:00 UTC. A post that does not fit is held to the
 * next UTC midnight with the reason.
 */
export function evaluateLinkedInDailyQuota(input: { used: number; wanted?: number; limit?: number; now?: number }): LinkedInQuotaDecision {
  const limit = input.limit ?? LINKEDIN_MEMBER_DAILY_LIMIT
  const wanted = input.wanted ?? 1
  const now = input.now ?? Date.now()
  const remaining = Math.max(0, limit - input.used)
  if (wanted <= remaining) return { allowed: true, remaining: remaining - wanted, holdUntil: null, reason: null }
  const holdUntil = nextUtcMidnight(now)
  return {
    allowed: false,
    remaining,
    holdUntil,
    reason: `LinkedIn allows ${limit} requests per member each UTC day and ${input.used} are used; the limit resets at ${holdUntil}.`,
  }
}
