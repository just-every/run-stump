import { randomUUID } from 'node:crypto'

// Fresh state for each conformance phase: a new address to invite, so every
// round's invitation is its own (Base modules/agent-door/ADOPTING.md, fixtures).
export default async function prepare() {
  const id = randomUUID()
  return { values: { invitee: `synthetic-stump-${id}@example.com`, venue_url: `https://synthetic-stump-${id}.example/forum`, venue_handle: `synthetic-${id.slice(0, 8)}` } }
}
