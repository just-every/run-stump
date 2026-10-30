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
    // A key the provider does not know is refused in OpenAI's own shape, quoting it.
    if (/wrong/.test(request.headers.get('authorization') ?? '')) return Response.json({ error: { message: `Incorrect API key provided: ${request.headers.get('authorization').slice(7)}.`, type: 'invalid_request_error', code: 'invalid_api_key' } }, { status: 401 })
    const body = await request.json(), brief = JSON.parse(body.messages.at(-1).content)
    sent.push(brief)
    const content = JSON.stringify({ text: `Recurring bookings are here: set a pattern once and every visit books itself. ${brief.source?.url ?? ''}`.trim() })
    return Response.json({ object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content } }], usage: { prompt_tokens: 90, completion_tokens: 20, cost: 0.0003 } })
  }
  if (request.url === CHANGELOG) return new Response('<html><head><title>3.2</title></head><body><main><h1>Brightwell 3.2</h1><p>Recurring bookings: set a pattern once.</p></main></body></html>', { headers: { 'content-type': 'text/html' } })
  return null
}

let app, records
before(async () => { app = await stump({ bindings: { AI_ENABLED: 'true', AI_BASE_URL: `${AI}/v1`, AI_API_KEY: `synthetic-stump-${Date.now()}`, AI_MODEL: 'synthetic-stump-model' }, edge }); records = await brand() })
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
  // An agent's draft speaks for its own person without naming them, and a feature no claim backs is flagged and keeps it from passing.
  const own = (await app.mcp(agent.token, 'stump.drafts.write', { action: 'create', format: 'post', network: 'bluesky', product_id: product.id, text: 'Brightwell adds a weekly summary email: every Monday you get your bookings per room.' })).result.structuredContent
  assert.equal(own.person_id, sam.id)
  assert.equal(own.check.passed, false)
  assert.ok(own.check.claims.some(claim => claim.status === 'unmatched' && /weekly summary email/.test(claim.text)), JSON.stringify(own.check.claims))

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

  // The provider an admin saves in Settings drafts instead of the installation's: a refused key shows the provider's own words without the key, and leaves no draft.
  const wrong = `synthetic-stump-wrong-${Date.now()}`
  const saved = ok(await app.action('owner', 'stump.setup.ai', { action: 'set', base_url: `${AI}/v1`, model: 'synthetic-settings-model', api_key: wrong }))
  assert.deepEqual([saved.source, saved.model, saved.host], ['settings', 'synthetic-settings-model', 'ai.synthetic-stump.example'])
  assert.doesNotMatch(JSON.stringify(saved), new RegExp(wrong), 'the key is never answered back')
  const refusedKey = await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, network: 'bluesky', generate: true, prompt: 'Announce recurring bookings.' })
  assert.deepEqual([refusedKey.body.code, refusedKey.body.provider_code], ['ai_failed', 'upstream_auth'])
  assert.match(refusedKey.body.provider_message, /Incorrect API key/); assert.doesNotMatch(JSON.stringify(refusedKey.body), new RegExp(wrong))
  assert.equal(await count(), before)
  ok(await app.action('owner', 'stump.setup.ai', { action: 'set', base_url: `${AI}/v1`, model: 'synthetic-settings-model', api_key: `synthetic-stump-right-${Date.now()}` }))
  const viaSettings = ok(await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, network: 'bluesky', generate: true, prompt: 'Announce recurring bookings.' }))
  assert.equal(viaSettings.ai.model, 'synthetic-settings-model')
  assert.equal(ok(await app.action('owner', 'stump.setup.ai', { action: 'clear' })).source, 'installation')
})

test('an avoided word and an image without alt text keep an item from ready, each named, until they are fixed', async () => {
  const { owner } = records
  const product = ok(await app.action('owner', 'stump.brand.manage', { action: 'product_create', name: 'Brightwell Desk', words_use: ['visit'], words_avoid: ['revolutionary'], tone: 'plain' }))
  assert.deepEqual([product.words_use, product.words_avoid], [['visit'], ['revolutionary']])
  const item = ok(await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, network: 'mastodon', product_id: product.id, text: 'A revolutionary booking screen.' }))
  const word = await app.action('owner', 'stump.drafts.revise', { action: 'mark_ready', item_id: item.id })
  assert.equal(word.body.code, 'checks_failed'); assert.deepEqual(word.body.words, ['revolutionary'])
  ok(await app.action('owner', 'stump.drafts.revise', { action: 'save', item_id: item.id, expected_revision: 1, text: 'The new booking screen.' }))
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const media = ok(await app.action('owner', 'stump.items.media', { action: 'attach', item_id: item.id, file: { name: 'screen.png', type: 'image/png', base64: png } })).media
  const alt = await app.action('owner', 'stump.drafts.revise', { action: 'mark_ready', item_id: item.id })
  assert.equal(alt.body.code, 'checks_failed'); assert.ok(alt.body.flags.some(flag => flag.code === 'alt_text_missing' && flag.media_id === media.id))
  ok(await app.action('owner', 'stump.items.media', { action: 'set_alt', media_id: media.id, alt: 'The weekly booking screen.' }))
  assert.equal(ok(await app.action('owner', 'stump.drafts.revise', { action: 'mark_ready', item_id: item.id })).state, 'ready')
})

test('a venue that keeps self-promotion to its weekly thread holds an item outside it, naming the rule, and lets one in the thread be marked ready', async () => {
  const { owner } = records
  const venue = ok(await app.action('owner', 'stump.venues.manage', { action: 'create', kind: 'subreddit', name: 'r/smallclinics', url: 'https://www.reddit.com/r/smallclinics', platform: 'reddit', status: 'ready' }))
  const thread = 'https://www.reddit.com/r/smallclinics/comments/wk44/weekly_self_promotion_thread/', source = 'https://www.reddit.com/r/smallclinics/wiki/rules'
  ok(await app.action('owner', 'stump.venues.rules', { action: 'set', venue_id: venue.id, rules: { self_promotion: { value: 'thread', thread_url: thread, source_url: source, read_at: '2026-10-28' } } }))
  const outside = ok(await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, venue_id: venue.id, network: 'reddit', text: 'I made a scheduling tool for front desks.' }))
  assert.equal(outside.state, 'held'); assert.equal(outside.hold.reason, 'self_promotion'); assert.equal(outside.hold.source_url, source)
  const refused = await app.action('owner', 'stump.drafts.revise', { action: 'mark_ready', item_id: outside.id })
  assert.equal(refused.body.code, 'held'); assert.equal(refused.body.rule, 'self_promotion')
  const inside = ok(await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'reply', person_id: owner.id, venue_id: venue.id, network: 'reddit', reply_to: { url: thread }, text: 'I made a scheduling tool for front desks; ask me anything here.' }))
  assert.equal(inside.state, 'draft')
  assert.equal(ok(await app.action('owner', 'stump.drafts.revise', { action: 'mark_ready', item_id: inside.id })).state, 'ready')
})
