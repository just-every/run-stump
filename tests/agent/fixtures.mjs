import { randomBytes, randomInt, randomUUID } from 'node:crypto'

const WORDS = ['calendar', 'booking', 'weekly', 'reminder', 'invoice', 'clinic', 'studio', 'tutor', 'garden', 'repair', 'yoga', 'salon', 'pattern', 'visit', 'notice', 'export',
  'import', 'shift', 'season', 'morning', 'evening', 'client', 'team', 'queue', 'ledger', 'summer', 'winter', 'lesson', 'garage', 'bakery', 'harbor', 'meadow']
const sentence = (length = 14) => Array.from({ length }, () => WORDS[randomInt(WORDS.length)]).join(' ')

// Fresh state for each conformance phase: a new address to invite, so every
// round's invitation is its own (Base modules/agent-door/ADOPTING.md, fixtures);
// alert destinations and the company's X app keys derived at run time, so no
// secret-shaped value is a literal; posts unlike any earlier round's, so no
// round's post reads as a near-duplicate of the last, a master text over X's
// 280 so its X variant holds with its flag, a reply unlike any earlier round's,
// a time ten days out, and a Bluesky community with a member's post for a
// hand-off's checked link.
export default async function prepare() {
  const id = randomUUID()
  return { values: {
    invitee: `synthetic-stump-${id}@example.com`,
    venue_url: `https://synthetic-stump-${id}.example/forum`,
    venue_handle: `synthetic-${id.slice(0, 8)}`,
    slack_webhook: `https://hooks.slack.com/services/T${randomBytes(4).toString('hex')}/B${randomBytes(4).toString('hex')}/${randomBytes(12).toString('hex')}`,
    webhook_secret: randomBytes(16).toString('hex'),
    orbitSecret: randomBytes(32).toString('hex'),
    xClientId: `synthetic-${randomUUID().slice(0, 8)}`,
    xClientSecret: randomUUID().replaceAll('-', ''),
    xPost: `${sentence()} https://example.com/changelog`,
    xLong: sentence(60),
    xReply: `${sentence(10)} every week`,
    scheduleAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    // A Bluesky community venue, the member's own handle there and the post they made, for the hand-off's checked link.
    bsky_venue: `https://bsky.app/profile/synthetic-builders-${id.slice(0, 8)}.bsky.social`,
    bsky_handle: `synthetic-${id.slice(0, 8)}.bsky.social`,
    bsky_post: `https://bsky.app/profile/synthetic-${id.slice(0, 8)}.bsky.social/post/3k${id.slice(0, 8)}`,
    handoff_text: sentence(),
    handoff_sky_text: sentence(),
  } }
}
