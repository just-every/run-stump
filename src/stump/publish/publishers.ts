import type { Publisher } from './types.ts'

// One line per network, added by the publishing lane: `bluesky: blueskyPublisher,`.
// A due item for a network with no publisher here is held with that reason.
export const publishers: Readonly<Record<string, Publisher>> = {
}
