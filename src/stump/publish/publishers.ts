import { blueskyPublisher } from './bluesky.ts'
import { linkedinPublisher } from './linkedin.ts'
import { mastodonPublisher } from './mastodon.ts'
import type { Publisher } from './types.ts'
import { xPublisher } from './x.ts'

// One line per network. A due item for a network with no publisher here is held with that reason.
export const publishers: Readonly<Record<string, Publisher>> = {
  bluesky: blueskyPublisher,
  mastodon: mastodonPublisher,
  x: xPublisher,
  linkedin: linkedinPublisher,
}
