import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// The company's AI provider and a changelog page, faked at the network edge in
// their published shapes. Everything else runs through Stump's own doors.
const AI = 'https://ai.synthetic-stump.example'
const CHANGELOG = 'https://brightwell.example/changelog/3-2'
const sent = []
let aiDown = false
async function edge(request) {
  if (request.url === `${AI}/v1/chat/completions`) {
    if (aiDown) return new Response('{}', { status: 503 })
    const body = await request.json(), brief = JSON.parse(body.messages.at(-1).content)
    sent.push(brief)
    const content = JSON.stringify({ text: `Recurring bookings are here: set a pattern once and every visit books itself. ${brief.source?.url ?? ''}`.trim() })
    return Response.json({ object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content } }], usage: { prompt_tokens: 90, completion_tokens: 20, cost: 0.0003 } })
  }
  if (request.url === CHANGELOG) return new Response('<html><head><title>3.2</title></head><body><main><h1>Brightwell 3.2</h1><p>Recurring bookings: set a pattern once.</p></main></body></html>', { headers: { 'content-type': 'text/html' } })
  return null
}

let app, records
before(async () => { app = await stump({ bindings: { AI_ENABLED: 'true', AI_BASE_URL: `${AI}/v1`, AI_API_KEY: `synthetic-stump-${Date.now()}`, AI_MODEL: 'synthetic-stump-model' }, outbound: edge }); records = await brand() })
after(() => app?.stop())

const autonomous = { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', rules: [{ id: 'all', class: '*', do: 'autonomous' }], spend: { none: true } }
const ok = answer => { assert.equal(answer.status, 200, JSON.stringify(answer.body)); return answer.body.result }

async function brand() {
  const owner = await app.owner()
  const product = ok(await app.action('owner', 'stump.brand.manage', { action: 'product_create', name: 'Brightwell', tone: 'plain, warm, exact' }))
  const claim = args => app.action('owner', 'stump.brand.manage', { action: 'claim_create', product_id: product.id, owner_id: owner.id, ...args })
  const recurring = ok(await claim({ text: 'Recurring bookings', kind: 'allowed', proof: { url: CHANGELOG }, review_on: '2099-01-01' }))
  const stale = ok(await claim({ text: 'Reminders cut no-shows', kind: 'allowed', proof: 'https://brightwell.example/no-shows', review_on: '2020-01-01' }))
  ok(await claim({ text: 'SOC 2 certified', kind: 'banned', reason: 'audit not finished' }))
  return { owner, product, recurring, stale }
}

test('the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent', async () => {
  const { owner, product } = records
  assert.equal((await app.json('owner', '/agents/api/policy', { document: autonomous }, 'PUT')).status, 200)
  const email = app.email('sam')
  const sam = ok(await app.action('owner', 'stump.team.manage', { action: 'invite', email, display_name: 'Synthetic Sam', role: 'editor', connection: 'employee' }))
  assert.equal(await app.signIn('sam', email), 303)
  const agent = (await app.json('sam', '/app/api/agent-credentials', { name: 'Sam agent' })).body

  // A banned claim stops the item for the person and the agent alike.
  const banned = ok(await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, network: 'bluesky', product_id: product.id, text: 'Brightwell is SOC 2 certified.' }))
  assert.equal(banned.check.claims[0].status, 'banned')
  assert.equal((await app.action('owner', 'stump.drafts.revise', { action: 'mark_ready', item_id: banned.id })).body.code, 'checks_failed')
  const viaAgent = await app.mcp(agent.token, 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, network: 'bluesky', product_id: product.id, text: 'Brightwell is SOC 2 certified.' })
  assert.deepEqual(viaAgent.result.structuredContent.flags.map(flag => flag.code), banned.flags.map(flag => flag.code))
  assert.equal(viaAgent.result._meta['com.runeditrun/decision'].classes[0].class, 'standard')

  // An employee naming the product outside the company's accounts discloses first (D-2), through both doors.
  const reply = ok(await app.action('sam', 'stump.drafts.write', { action: 'create', format: 'reply', person_id: sam.id, network: 'x', reply_to: { url: 'https://x.com/someone/status/1' }, text: 'Brightwell has recurring bookings for this.' }))
  const refused = await app.action('sam', 'stump.drafts.revise', { action: 'mark_ready', item_id: reply.id })
  assert.equal(refused.status, 403); assert.equal(refused.body.code, 'act_refused'); assert.equal(refused.body.rule, 'D-2')
  assert.equal((await app.mcp(agent.token, 'stump.drafts.revise', { action: 'mark_ready', item_id: reply.id })).error.rule, 'D-2')
  const stale = await app.mcp(agent.token, 'stump.drafts.revise', { action: 'save', item_id: reply.id, expected_revision: 2, text: 'A stale edit.' })
  assert.equal(stale.error.code, 'revision_conflict')
  const disclosed = ok(await app.action('sam', 'stump.drafts.revise', { action: 'save', item_id: reply.id, expected_revision: 1, text: 'We shipped recurring bookings in Brightwell for this.' }))
  assert.equal(disclosed.revision, 2)
  assert.equal(ok(await app.action('sam', 'stump.drafts.revise', { action: 'mark_ready', item_id: reply.id })).state, 'ready')

  // Nearly repeating what is queued holds the item, naming the match, until it is rewritten.
  const repeat = ok(await app.action('sam', 'stump.drafts.write', { action: 'create', format: 'reply', person_id: sam.id, network: 'x', reply_to: { url: 'https://x.com/other/status/2' }, text: 'We shipped recurring bookings in Brightwell for exactly this.' }))
  assert.equal(repeat.state, 'held'); assert.equal(repeat.hold.matches[0].id, reply.id)
  const rewritten = ok(await app.action('sam', 'stump.drafts.revise', { action: 'save', item_id: repeat.id, text: 'We added weekly patterns to Brightwell after clinics asked; glad to show your desk.' }))
  assert.equal(rewritten.state, 'draft')
  // Restoring revision 1 makes a new revision with its text, which is held again.
  const restored = ok(await app.action('sam', 'stump.drafts.revise', { action: 'restore', item_id: repeat.id, revision: 1 }))
  assert.equal(restored.revision, 3); assert.equal(restored.text, repeat.text); assert.equal(restored.state, 'held')
})

test('a draft from a changelog goes through the company\'s AI provider with the voice guide and current claims, and a failure leaves no draft', async () => {
  const { owner, product, recurring, stale } = records
  const voice = ok(await app.action('owner', 'stump.brand.manage', { action: 'voice_create', person_id: owner.id, samples: ['Shipped the calendar fix today.', 'Small change, real relief.'], do: ['short'], dont: ['exclamation marks'] }))
  const drafted = ok(await app.action('owner', 'stump.drafts.write', { action: 'from_source', source_url: CHANGELOG, targets: [{ network: 'bluesky', product_id: product.id }, { network: 'x', format: 'thread', product_id: product.id }] }))
  assert.equal(drafted.total, 2)
  for (const item of drafted.items) {
    assert.match(JSON.stringify(item.text ?? item.parts), /brightwell\.example\/changelog\/3-2/)
    assert.deepEqual(item.ai.host, 'ai.synthetic-stump.example'); assert.equal(item.ai.model, 'synthetic-stump-model'); assert.equal(item.ai.cost_usd, 0.0003)
    assert.ok(item.ai.fields_sent.includes('voice') && item.ai.fields_sent.includes('source'))
    assert.ok(item.claims_used.includes(recurring.id))
  }
  const brief = sent.at(-1)
  assert.deepEqual(brief.voice.do, voice.do)
  assert.ok(brief.claims.allowed.some(claim => claim.id === recurring.id))
  assert.ok(!brief.claims.allowed.some(claim => claim.id === stale.id), 'a stale claim is not offered to the model')

  const count = async () => (await app.action('owner', 'stump.drafts.revise', { action: 'list' })).body.result.total
  const before = await count()
  aiDown = true
  const failed = await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, network: 'bluesky', generate: true, prompt: 'Announce recurring bookings.' })
  aiDown = false
  assert.equal(failed.body.code, 'ai_failed'); assert.equal(failed.body.status, 503)
  const unreadable = await app.action('owner', 'stump.drafts.write', { action: 'from_source', source_url: 'https://brightwell.example/changelog/missing', targets: [{ network: 'bluesky' }] })
  assert.equal(unreadable.body.code, 'source_unreadable')
  assert.equal(await count(), before)
})
