// A Mastodon venue lives on one server: a hashtag or group on hachyderm.io is that
// server's own. A variant posted from an account on another server goes out on that
// other server, so it is never aimed at, held for or filed under a venue on this one.
// Compose offers only the account's own server's venues, and the draft check holds
// a variant aimed across servers (venue_other_server).

export interface ServerVenue { platform: string | null; url: string | null }
export interface ServerAccount { network: string; instance?: string | null }

/** A server's host as the address names it ("hachyderm.io", "127.0.0.1:38501"); null when it names none. */
function hostOf(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`).host.toLowerCase() } catch { return null }
}

/** The two servers when a Mastodon account would post to a Mastodon venue on another one; null when they are the same or it cannot be told. */
export function otherServer(venue: ServerVenue | null | undefined, account: ServerAccount | null | undefined): { venue_host: string; account_host: string } | null {
  if (!venue || !account || account.network !== 'mastodon' || (venue.platform ?? '').trim().toLowerCase() !== 'mastodon') return null
  const venueHost = hostOf(venue.url), accountHost = hostOf(account.instance)
  return venueHost && accountHost && venueHost !== accountHost ? { venue_host: venueHost, account_host: accountHost } : null
}
