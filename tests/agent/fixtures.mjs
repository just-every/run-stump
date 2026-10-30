import { randomBytes, randomUUID } from 'node:crypto'

// Fresh state for each conformance phase: a new address to invite, so every
// round's invitation is its own (Base modules/agent-door/ADOPTING.md, fixtures),
// and alert destinations derived at run time so no secret-shaped value is a literal.
export default async function prepare() {
  const id = randomUUID()
  return { values: {
    invitee: `synthetic-stump-${id}@example.com`,
    venue_url: `https://synthetic-stump-${id}.example/forum`,
    venue_handle: `synthetic-${id.slice(0, 8)}`,
    slack_webhook: `https://hooks.slack.com/services/T${randomBytes(4).toString('hex')}/B${randomBytes(4).toString('hex')}/${randomBytes(12).toString('hex')}`,
    webhook_secret: randomBytes(16).toString('hex'),
  } }
}
