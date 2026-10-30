import { randomInt, randomUUID } from 'node:crypto'

const WORDS = ['calendar', 'booking', 'weekly', 'reminder', 'invoice', 'clinic', 'studio', 'tutor', 'garden', 'repair', 'yoga', 'salon', 'pattern', 'visit', 'notice', 'export',
  'import', 'shift', 'season', 'morning', 'evening', 'client', 'team', 'queue', 'ledger', 'summer', 'winter', 'faster', 'quieter', 'clearer', 'simpler', 'sooner']
const sentence = () => Array.from({ length: 14 }, () => WORDS[randomInt(WORDS.length)]).join(' ')

// Fresh state for each conformance phase: a new address to invite, so every
// round's invitation is its own (Base modules/agent-door/ADOPTING.md, fixtures),
// the company's X app keys made at run time, and a post unlike any earlier
// round's, so no round's post reads as a near-duplicate of the last.
export default async function prepare() {
  return { values: { invitee: `synthetic-stump-${randomUUID()}@example.com`, xClientId: `synthetic-${randomUUID().slice(0, 8)}`, xClientSecret: randomUUID().replaceAll('-', ''),
    xPost: `${sentence()} https://example.com/changelog` } }
}
