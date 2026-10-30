import { randomBytes, randomUUID } from 'node:crypto'

// Fresh state for each conformance phase: a new address to invite, so every
// round's invitation is its own (Base modules/agent-door/ADOPTING.md, fixtures).
export default async function prepare() {
  return { values: { invitee: `synthetic-stump-${randomUUID()}@example.com`, orbitSecret: randomBytes(32).toString('hex') } }
}
