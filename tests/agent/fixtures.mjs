import { randomInt, randomUUID } from 'node:crypto'

const WORDS = ['calendar', 'booking', 'weekly', 'reminder', 'invoice', 'clinic', 'studio', 'tutor', 'garden', 'repair', 'yoga', 'salon', 'pattern', 'visit', 'notice', 'export',
  'import', 'shift', 'season', 'morning', 'evening', 'client', 'team', 'queue', 'ledger', 'summer', 'winter', 'lesson', 'garage', 'bakery', 'harbor', 'meadow']
const sentence = (length = 14) => Array.from({ length }, () => WORDS[randomInt(WORDS.length)]).join(' ')

// Fresh state for each conformance phase: a new address to invite, so every
// round's invitation is its own (Base modules/agent-door/ADOPTING.md, fixtures),
// the company's X app keys made at run time, posts unlike any earlier round's,
// so no round's post reads as a near-duplicate of the last, a master text over
// X's 280 so its X variant holds with its flag, and a time ten days out.
export default async function prepare() {
  return { values: { invitee: `synthetic-stump-${randomUUID()}@example.com`, xClientId: `synthetic-${randomUUID().slice(0, 8)}`, xClientSecret: randomUUID().replaceAll('-', ''),
    xPost: `${sentence()} https://example.com/changelog`, xLong: sentence(60), scheduleAt: new Date(Date.now() + 10 * 86_400_000).toISOString() } }
}
