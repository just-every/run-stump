import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// X's OAuth 2.0 token, users and posts endpoints at the network edge, in their published shapes.
const USER = { id: '1500000000000000001', username: 'synthetic_co', name: 'Synthetic Co' }
const x = { issued: new Set(), revoked: new Set(), posts: new Map(), next: 1900000000000000001n }
async function network(request) {
  const url = new URL(request.url)
  if (url.origin !== 'https://api.x.com') return null
  if (url.pathname === '/2/oauth2/token') {
    const form = new URLSearchParams(await request.text())
    if (!request.headers.get('authorization')?.startsWith('Basic ') || !form.get('code_verifier')) return Response.json({ error: 'invalid_request' }, { status: 400 })
    const token = randomBytes(16).toString('hex'); x.issued.add(token)
    return Response.json({ token_type: 'bearer', expires_in: 7200, access_token: token, refresh_token: randomBytes(16).toString('hex'), scope: 'tweet.read tweet.write users.read offline.access media.write' })
  }
  if (url.pathname === '/2/oauth2/revoke') { x.revoked.add(new URLSearchParams(await request.text()).get('token')); return Response.json({ revoked: true }) }
  if (!x.issued.has(request.headers.get('authorization')?.slice(7))) return Response.json({ title: 'Unauthorized', status: 401 }, { status: 401 })
  if (url.pathname === '/2/users/me') return Response.json({ data: USER })
  if (url.pathname === '/2/tweets' && request.method === 'POST') {
    const { text } = await request.json(), id = String(x.next++)
    x.posts.set(id, { id, text, author_id: USER.id, created_at: new Date().toISOString(), edit_history_tweet_ids: [id] })
    return Response.json({ data: { id, text, edit_history_tweet_ids: [id] } }, { status: 201 })
  }
  const read = /^\/2\/tweets\/(\d+)$/.exec(url.pathname)
  if (read && x.posts.has(read[1])) return Response.json({ data: x.posts.get(read[1]), includes: { users: [USER] } })
  return Response.json({ title: 'Not Found Error', status: 404 }, { status: 404 })
}

let app
before(async () => { app = await stump({ outbound: network }) })
after(() => app?.stop())

test('the company connects its X account through its own app, owned by the company, with no secret ever answered back', async () => {
  await app.owner()
  const secret = randomBytes(20).toString('hex')
  const set = await app.action('owner', 'stump.setup.apps', { action: 'set', network: 'x', client_id: 'synthetic-client-id', client_secret: secret })
  assert.equal(set.status, 200); assert.equal(set.body.result.app.state, 'connected')
  assert.ok(!JSON.stringify(set.body).includes(secret) && !JSON.stringify(set.body).includes('synthetic-client-id'))

  const editor = app.email('editor')
  await app.action('owner', 'stump.team.manage', { action: 'invite', email: editor, display_name: 'Synthetic Editor', role: 'editor', connection: 'employee' })
  assert.equal(await app.signIn('editor', editor), 303)
  assert.equal((await app.action('editor', 'stump.accounts.connect', { action: 'start', network: 'x', owner: 'company' })).status, 403, 'only owners and admins connect company accounts')

  const started = await app.action('owner', 'stump.accounts.connect', { action: 'start', network: 'x', owner: 'company' })
  const consent = new URL(started.body.result.consent_url)
  assert.equal(consent.origin + consent.pathname, 'https://x.com/i/oauth2/authorize'); assert.equal(consent.searchParams.get('code_challenge_method'), 'S256')
  const state = consent.searchParams.get('state')
  // X sends the person's browser back to the callback; the server finishes the consent, and only for the person who asked for it.
  const callback = `/app/connected/x?${new URLSearchParams({ state, code: 'synthetic-code' })}`
  const stolen = await app.request('editor', callback)
  assert.equal(stolen.status, 303); assert.equal(new URL(stolen.headers.get('location'), app.origin).searchParams.get('refused'), 'consent_not_yours')
  const back = await app.request('owner', callback)
  assert.equal(back.status, 303)
  const landed = new URL(back.headers.get('location'), app.origin)
  assert.equal(landed.pathname, '/app/connected/x'); assert.ok(!landed.searchParams.has('code'))
  const shown = await app.action('owner', 'stump.accounts.connect', { action: 'list', connection_id: landed.searchParams.get('connection') })
  assert.equal(shown.body.result.connection.outcome.ok, true)
  const account = shown.body.result.items.find(item => item.id === shown.body.result.connection.outcome.account_id)
  assert.equal(account.handle, 'synthetic_co'); assert.equal(account.owner.kind, 'company'); assert.equal(account.state, 'connected')
  assert.equal(account.connected_by, (await app.owner()).id); assert.ok(Date.parse(account.connected_at))
  assert.equal((await app.action('owner', 'stump.accounts.connect', { action: 'complete', state, code: 'synthetic-code' })).body.code, 'consent_used')

  const listed = JSON.stringify((await app.action('editor', 'stump.accounts.connect', { action: 'list', include_unconnected: true })).body)
  assert.ok(listed.includes('synthetic_co') && ![...x.issued].some(token => listed.includes(token)) && !/token|secret|password/i.test(listed))

  const off = await app.action('owner', 'stump.accounts.connect', { action: 'disconnect', account_id: account.id })
  assert.equal(off.body.result.account.state, 'disconnected'); assert.equal(off.body.result.revoked, 'revoked'); assert.equal(x.revoked.size, 1)
})

/** The company's X account, connected through the owner's consent at X. */
async function connectX() {
  const started = await app.action('owner', 'stump.accounts.connect', { action: 'start', network: 'x', owner: 'company' })
  const back = await app.request('owner', `/app/connected/x?${new URLSearchParams({ state: new URL(started.body.result.consent_url).searchParams.get('state'), code: 'synthetic-code' })}`)
  const shown = await app.action('owner', 'stump.accounts.connect', { action: 'list', connection_id: new URL(back.headers.get('location'), app.origin).searchParams.get('connection') })
  return shown.body.result.items.find(item => item.id === shown.body.result.connection.outcome.account_id)
}

test('an agent posts to the company X account within the owner\'s dollar limit: Pause holds it, it goes out once, reads back from X and lands on the ledger with its charge', async () => {
  const owner = await app.owner()
  const account = await connectX()
  assert.equal(account.state, 'connected')
  assert.equal((await app.action('owner', 'stump.accounts.connect', { action: 'record_label', account_id: account.id, automated_label: true, operator_bio: true })).status, 200)
  // Agents may spend up to a dollar a call on their own; anything larger is blocked.
  const rules = [{ id: 'all', class: '*', do: 'autonomous' }, { id: 'small-spend', class: 'money', do: 'autonomous', max: { amount: 1, currency: 'USD' } }, { id: 'spend', class: 'money', do: 'blocked' }]
  assert.equal((await app.json('owner', '/agents/api/policy', { document: { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', spend: { none: true }, rules } }, 'PUT')).status, 200)
  const agent = (await app.json('owner', '/app/api/agent-credentials', { name: 'Synthetic publisher' })).body
  const text = 'Recurring bookings are live: set a pattern once and every visit books itself. https://example.com/changelog'
  const draft = (await app.mcp(agent.token, 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, account_id: account.id, network: 'x', text })).result.structuredContent

  assert.equal((await app.action('owner', 'stump.calendar.pause', { action: 'pause', scope: 'all' })).status, 200)
  assert.equal((await app.mcp(agent.token, 'stump.items.schedule', { action: 'publish', item_id: draft.id, account_id: account.id })).error?.code, 'publishing_paused')
  assert.equal(x.posts.size, 0)
  assert.equal((await app.action('owner', 'stump.calendar.pause', { action: 'resume', scope: 'all' })).status, 200)

  const sent = await app.mcp(agent.token, 'stump.items.schedule', { action: 'publish', item_id: draft.id, account_id: account.id })
  const decision = sent.result._meta['com.runeditrun/decision']
  assert.equal(decision.disposition, 'autonomous')
  assert.deepEqual(decision.classes.find(entry => entry.class === 'money').facts, { measure: 1, currency: 'USD', counterparty: 'known' })
  const posted = sent.result.structuredContent
  assert.equal(posted.outcome, 'posted'); assert.equal(x.posts.size, 1)
  const [id] = x.posts.keys()
  assert.equal(posted.item.network_id, id); assert.equal(posted.item.url, `https://x.com/synthetic_co/status/${id}`)
  const entry = (await app.action('owner', 'stump.ledger.search', { action: 'search', network: 'x' })).body.result.items.find(item => item.network_id === id)
  assert.deepEqual([entry.url, entry.state, entry.text, entry.charge_usd, entry.by, entry.confirmation, entry.route, entry.account_id, entry.person_id],
    [posted.item.url, 'posted', text, 0.2, `Synthetic publisher for ${owner.display_name}`, 'network', 'published', account.id, owner.id])

  // Six posts with a link cost $1.20, over the limit: blocked before anything reaches X.
  const parts = ['calendar', 'reminders', 'invoices', 'clinics', 'studios', 'tutors'].map(word => `Recurring bookings for ${word} now follow one weekly pattern. https://example.com/changelog/${word}`)
  const thread = (await app.mcp(agent.token, 'stump.drafts.write', { action: 'create', format: 'thread', person_id: owner.id, account_id: account.id, network: 'x', parts })).result.structuredContent
  const blocked = await app.mcp(agent.token, 'stump.items.schedule', { action: 'publish', item_id: thread.id, account_id: account.id })
  assert.equal(blocked.error?.code, 'policy_blocked'); assert.equal(x.posts.size, 1)
})
