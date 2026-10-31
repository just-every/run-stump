import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// X's OAuth 2.0 token, users and posts endpoints and Vane's annotation door at the network edge, in their published shapes.
const USER = { id: '1500000000000000001', username: 'synthetic_co', name: 'Synthetic Co', public_metrics: { followers_count: 2400, following_count: 3, tweet_count: 9, listed_count: 0 } }
const x = { issued: new Set(), revoked: new Set(), posts: new Map(), deleted: [], refuse: false, limit: false, next: 1900000000000000001n, user: USER, users: new Map() }
const VANE = 'https://vane.synthetic-stump.example', annotations = []
async function network(request) {
  const url = new URL(request.url)
  if (url.origin === VANE && url.pathname === '/api/vane/annotations') { annotations.push(await request.json()); return Response.json({ accepted: true }, { status: 201 }) }
  if (url.origin !== 'https://api.x.com') return null
  if (url.pathname === '/2/oauth2/token') {
    const form = new URLSearchParams(await request.text())
    if (!request.headers.get('authorization')?.startsWith('Basic ') || !form.get('code_verifier')) return Response.json({ error: 'invalid_request' }, { status: 400 })
    // Each token belongs to the X user who consented when it was issued.
    const token = randomBytes(16).toString('hex'); x.issued.add(token); x.users.set(token, x.user)
    return Response.json({ token_type: 'bearer', expires_in: 7200, access_token: token, refresh_token: randomBytes(16).toString('hex'), scope: 'tweet.read tweet.write users.read offline.access media.write' })
  }
  if (url.pathname === '/2/oauth2/revoke') { x.revoked.add(new URLSearchParams(await request.text()).get('token')); return Response.json({ revoked: true }) }
  if (!x.issued.has(request.headers.get('authorization')?.slice(7))) return Response.json({ title: 'Unauthorized', status: 401 }, { status: 401 })
  if (url.pathname === '/2/users/me') return Response.json({ data: x.users.get(request.headers.get('authorization').slice(7)) })
  if (url.pathname === '/2/tweets' && request.method === 'POST') {
    // X refuses an access token the account's person revoked with a 401.
    if (x.refuse) return Response.json({ title: 'Unauthorized', type: 'about:blank', status: 401, detail: 'Unauthorized' }, { status: 401 })
    // X's rate limit answers 429 with the window's reset time.
    if (x.limit) return Response.json({ title: 'Too Many Requests', type: 'about:blank', status: 429, detail: 'Too Many Requests' }, { status: 429, headers: { 'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 900) } })
    const { text } = await request.json(), id = String(x.next++)
    x.posts.set(id, { id, text, author_id: USER.id, created_at: new Date().toISOString(), edit_history_tweet_ids: [id] })
    return Response.json({ data: { id, text, edit_history_tweet_ids: [id] } }, { status: 201 })
  }
  const read = /^\/2\/tweets\/(\d+)$/.exec(url.pathname)
  if (read && request.method === 'DELETE' && x.posts.delete(read[1])) { x.deleted.push(read[1]); return Response.json({ data: { deleted: true } }) }
  if (read && x.posts.has(read[1])) return Response.json({ data: x.posts.get(read[1]), includes: { users: [USER] } })
  return Response.json({ title: 'Not Found Error', status: 404 }, { status: 404 })
}

let app
before(async () => { app = await stump({ edge: network }) })
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
  assert.equal(off.body.result.account.state, 'disconnected'); assert.equal(off.body.result.revoked, 'revoked'); assert.ok([...x.issued].every(token => x.revoked.has(token)), 'every token X issued for the account is revoked')
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
  assert.equal(account.followers, 2400)
  assert.equal((await app.action('owner', 'stump.links.manage', { action: 'set_rules', own_domains: ['example.com'], mediums: { published: 'social', handoff: 'community' } })).status, 200)
  assert.equal((await app.action('owner', 'stump.stack.connect', { action: 'connect', seed: 'vane', origin: VANE, site_id: 'synthetic-site', secret: 'synthetic-stump-vane-secret' })).status, 200)
  assert.equal(account.state, 'connected')
  assert.equal((await app.action('owner', 'stump.accounts.connect', { action: 'record_label', account_id: account.id, automated_label: true, operator_bio: true })).status, 200)
  // Agents may spend up to a dollar a call on their own; anything larger is blocked.
  const rules = [{ id: 'all', class: '*', do: 'autonomous' }, { id: 'small-spend', class: 'money', do: 'autonomous', max: { amount: 1, currency: 'USD' } }, { id: 'spend', class: 'money', do: 'blocked' }]
  assert.equal((await app.json('owner', '/agents/api/policy', { document: { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', spend: { none: true }, rules } }, 'PUT')).status, 200)
  const agent = (await app.json('owner', '/app/api/agent-credentials', { name: 'Synthetic publisher' })).body
  const text = 'Recurring bookings are live: set a pattern once and every visit books itself. https://example.com/changelog and RFC 5545 https://www.rfc-editor.org/rfc/rfc5545'
  const draft = (await app.mcp(agent.token, 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, account_id: account.id, network: 'x', text })).result.structuredContent

  assert.equal((await app.action('owner', 'stump.calendar.pause', { action: 'pause', scope: 'all' })).status, 200)
  assert.equal((await app.mcp(agent.token, 'stump.items.schedule', { action: 'publish', item_id: draft.id, account_id: account.id })).error?.code, 'publishing_paused')
  assert.equal(x.posts.size, 0)
  assert.equal((await app.action('owner', 'stump.calendar.pause', { action: 'resume', scope: 'all' })).status, 200)

  const sent = await app.mcp(agent.token, 'stump.items.schedule', { action: 'publish', item_id: draft.id, account_id: account.id })
  const decision = sent.result._meta['com.runeditrun/decision']
  assert.equal(decision.disposition, 'autonomous')
  // The public the post reaches is the account's followers; X's price for this one call is counted once.
  assert.deepEqual(decision.classes.find(entry => entry.class === 'external').facts, { measure: 2400, counterparty: 'public' })
  assert.deepEqual(decision.classes.filter(entry => entry.class === 'money').map(entry => entry.facts), [{ measure: 0.2, currency: 'usd', counterparty: 'x' }])
  const posted = sent.result.structuredContent
  assert.equal(posted.outcome, 'posted'); assert.equal(x.posts.size, 1)
  const [id] = x.posts.keys()
  const sentText = x.posts.get(id).text
  assert.equal(sentText, text.replace('https://example.com/changelog', `https://example.com/changelog?utm_source=x&utm_medium=social&utm_content=${draft.id}`))
  assert.equal(posted.item.network_id, id); assert.equal(posted.item.url, `https://x.com/synthetic_co/status/${id}`)
  const entry = (await app.action('owner', 'stump.ledger.search', { action: 'search', network: 'x' })).body.result.items.find(item => item.network_id === id)
  assert.deepEqual([entry.url, entry.state, entry.text, entry.charge_usd, entry.by, entry.confirmation, entry.route, entry.account_id, entry.person_id],
    [posted.item.url, 'posted', sentText, 0.2, `Synthetic publisher for ${owner.display_name}`, 'network', 'published', account.id, owner.id])
  assert.deepEqual(annotations.map(note => [note.id, note.kind, note.url]), [[`stump-ledger-${entry.id}`, 'campaign', posted.item.url]])
  assert.equal(entry.annotation.status, 'sent')

  // Six posts with a link cost $1.20, over the limit: blocked before anything reaches X.
  const parts = ['calendar', 'reminders', 'invoices', 'clinics', 'studios', 'tutors'].map(word => `Recurring bookings for ${word} now follow one weekly pattern. https://example.com/changelog/${word}`)
  const thread = (await app.mcp(agent.token, 'stump.drafts.write', { action: 'create', format: 'thread', person_id: owner.id, account_id: account.id, network: 'x', parts })).result.structuredContent
  const blocked = await app.mcp(agent.token, 'stump.items.schedule', { action: 'publish', item_id: thread.id, account_id: account.id })
  assert.equal(blocked.error?.code, 'policy_blocked'); assert.equal(x.posts.size, 1)
})

/** The pending approval an agent's held call answers with, and the owner's decision on it. */
const approvalOf = call => call.result?.structuredContent?.approval ?? call.result?._meta?.['com.runeditrun/approval']
async function decide(id, verb) {
  const { approval } = (await app.json('owner', `/agents/api/approvals/${id}`)).body
  return (await app.json('owner', `/agents/api/approvals/${id}/${verb}`, { revision: approval.revision, summary_sha256: approval.summary_sha256 })).body.approval
}
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('an agent\'s held post goes out only as its approver saw it: words changed while it waits ask again, and an image added after approval sends it back to draft', async () => {
  const owner = await app.owner()
  const account = await connectX()
  assert.equal((await app.action('owner', 'stump.accounts.connect', { action: 'record_label', account_id: account.id, automated_label: true, operator_bio: true })).status, 200)
  const rules = [{ id: 'all', class: '*', do: 'autonomous' }, { id: 'publish', class: 'external', do: 'approval', approver: ['role:owner'], wait: 'P1D' }]
  assert.equal((await app.json('owner', '/agents/api/policy', { document: { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', spend: { none: true }, rules } }, 'PUT')).status, 200)
  const agent = (await app.json('owner', '/app/api/agent-credentials', { name: 'Synthetic scheduler' })).body
  const draft = (await app.mcp(agent.token, 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, account_id: account.id, network: 'x', text: 'Group bookings open on Monday.' })).result.structuredContent
  const posts = x.posts.size

  const asked = approvalOf(await app.mcp(agent.token, 'stump.items.schedule', { action: 'publish', item_id: draft.id, account_id: account.id }))
  assert.ok(asked?.id, 'publishing waits for the owner')
  assert.equal((await app.mcp(agent.token, 'stump.drafts.revise', { action: 'save', item_id: draft.id, text: 'Group bookings open on Monday, and every plan is half price.' })).result.structuredContent.revision, 2)
  const stale = await decide(asked.id, 'approve')
  assert.deepEqual([stale.state, stale.code], ['refused', 'approval_evidence_changed'])
  assert.equal(x.posts.size, posts, 'nothing the owner did not see reaches X')

  const at = new Date(Date.now() + 86_400_000).toISOString()
  const held = approvalOf(await app.mcp(agent.token, 'stump.items.schedule', { action: 'schedule', item_id: draft.id, account_id: account.id, at }))
  assert.equal((await decide(held.id, 'approve')).state, 'executed')
  const scheduled = (await app.action('owner', 'stump.drafts.revise', { action: 'get', item_id: draft.id })).body.result
  assert.deepEqual([scheduled.state, scheduled.revision], ['scheduled', 2])
  const attached = (await app.mcp(agent.token, 'stump.items.media', { action: 'attach', item_id: draft.id, file: { name: 'groups.png', type: 'image/png', base64: png }, alt: 'The group booking form.' })).result.structuredContent
  assert.deepEqual([attached.item.state, attached.item.revision, attached.item.scheduled_at], ['draft', 3, null])
})

test('a key an agent hands over through an approval rests sealed while it waits, and is gone once the owner decides', async () => {
  const rules = [{ id: 'all', class: '*', do: 'autonomous' }, { id: 'keys', class: 'security', do: 'approval', approver: ['role:owner'], wait: 'P1D' }]
  assert.equal((await app.json('owner', '/agents/api/policy', { document: { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', spend: { none: true }, rules } }, 'PUT')).status, 200)
  const agent = (await app.json('owner', '/app/api/agent-credentials', { name: 'Synthetic connector' })).body
  const secret = randomBytes(24).toString('hex')
  const asked = approvalOf(await app.mcp(agent.token, 'stump.stack.connect', { action: 'connect', seed: 'vane', origin: VANE, site_id: 'synthetic-sealed-site', secret }))
  assert.ok(asked?.id, 'the connection waits for the owner')
  const stored = async () => (await app.db.prepare('SELECT saved FROM agent_door_approvals WHERE id=?').bind(asked.id).first()).saved
  assert.ok(!(await stored()).includes(secret), 'the waiting call keeps no key in clear')
  assert.equal((await decide(asked.id, 'approve')).state, 'executed')
  assert.equal((await app.action('owner', 'stump.stack.connect', { action: 'list' })).body.result.items.find(item => item.seed === 'vane')?.state, 'connected')
  const decided = JSON.parse(await stored())
  assert.ok(!JSON.stringify(decided).includes(secret) && decided.sealed === undefined, 'nothing of the key stays with the decided approval')
})

test('X refusing the account\'s token marks it expired, holds its posts with the reconnect step, and only its owner\'s reconnect brings it back', async () => {
  const owner = await app.owner()
  const account = await connectX()
  const later = (await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, account_id: account.id, network: 'x', text: 'The weekly digest goes out on Friday.' })).body.result
  assert.equal((await app.action('owner', 'stump.items.schedule', { action: 'schedule', item_id: later.id, account_id: account.id, at: new Date(Date.now() + 86_400_000).toISOString() })).status, 200)
  const now = (await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, account_id: account.id, network: 'x', text: 'Invoices now follow the booking pattern too.' })).body.result
  x.refuse = true
  const sent = await app.action('owner', 'stump.items.schedule', { action: 'publish', item_id: now.id, account_id: account.id })
  x.refuse = false
  assert.equal(sent.body.result.outcome, 'held')
  const step = 'Reconnect @synthetic_co in Settings, Accounts: its access was revoked at the network.'
  assert.deepEqual([sent.body.result.item.state, sent.body.result.item.hold.reason], ['held', step])
  const listed = (await app.action('owner', 'stump.accounts.connect', { action: 'list' })).body.result.items.find(item => item.id === account.id)
  assert.equal(listed.state, 'expired'); assert.match(listed.state_reason, /revoked/); assert.ok(listed.reconnect_url.endsWith(`reconnect=${account.id}`))
  const queued = (await app.action('owner', 'stump.drafts.revise', { action: 'get', item_id: later.id })).body.result
  assert.deepEqual([queued.state, queued.hold.reason], ['held', step])
  assert.equal((await app.action('owner', 'stump.items.schedule', { action: 'publish', item_id: now.id, account_id: account.id })).body.code, 'account_not_connected')
  const back = await connectX()
  assert.deepEqual([back.id, back.state, back.state_reason], [account.id, 'connected', null])
  // Reconnecting restores nothing by itself: the owner re-queues what they choose.
  assert.equal((await app.action('owner', 'stump.drafts.revise', { action: 'get', item_id: later.id })).body.result.state, 'held')
})

test('removing a post the company\'s account made deletes it at the network and keeps the entry on the record, unless the entry is under legal hold', async () => {
  const owner = await app.owner()
  const account = await connectX()
  // A held entry keeps its post: the delete is refused and nothing reaches the network.
  const kept = (await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, account_id: account.id, network: 'x', text: 'Term bookings are under review.' })).body.result
  const out = (await app.action('owner', 'stump.items.schedule', { action: 'publish', item_id: kept.id, account_id: account.id })).body.result.item
  const held = (await app.action('owner', 'stump.ledger.search', { action: 'search', network: 'x' })).body.result.items.find(row => row.network_id === out.network_id)
  assert.equal((await app.action('owner', 'stump.ledger.correct', { action: 'legal_hold', entry_id: held.id, reason: 'Dispute on file' })).status, 200)
  const refused = await app.action('owner', 'stump.ledger.correct', { action: 'mark_removed', entry_id: held.id, reason: 'Posted too early' })
  assert.deepEqual([refused.status, refused.body.legal_hold], [409, 'Dispute on file'])
  assert.ok(!x.deleted.includes(out.network_id)); assert.equal((await app.action('owner', 'stump.ledger.search', { action: 'get', entry_id: held.id })).body.result.state, 'posted')
  const item = (await app.action('owner', 'stump.drafts.write', { action: 'create', format: 'post', person_id: owner.id, account_id: account.id, network: 'x', text: 'Clinics can now book a whole term at once.' })).body.result
  const posted = (await app.action('owner', 'stump.items.schedule', { action: 'publish', item_id: item.id, account_id: account.id })).body.result.item
  const entry = (await app.action('owner', 'stump.ledger.search', { action: 'search', network: 'x' })).body.result.items.find(row => row.network_id === posted.network_id)
  const removed = (await app.action('owner', 'stump.ledger.correct', { action: 'mark_removed', entry_id: entry.id, reason: 'Posted before the feature shipped' })).body.result
  assert.deepEqual([removed.state, removed.removal.reason, removed.removal.network_delete.outcome], ['removed', 'Posted before the feature shipped', 'deleted'])
  assert.ok(x.deleted.includes(posted.network_id)); assert.ok(!x.posts.has(posted.network_id))
})

test('removing a person disconnects their own X account at X and returns their posts waiting on a rate limit to draft', async () => {
  await app.owner()
  const email = app.email('leaver')
  const leaver = (await app.action('owner', 'stump.team.manage', { action: 'invite', email, display_name: 'Synthetic Leaver', role: 'editor', connection: 'employee' })).body.result
  assert.equal(await app.signIn('leaver', email), 303)
  x.user = { ...USER, id: '1500000000000000002', username: 'synthetic_leaver', name: 'Synthetic Leaver' }
  const started = await app.action('leaver', 'stump.accounts.connect', { action: 'start', network: 'x', owner: 'me' })
  const back = await app.request('leaver', `/app/connected/x?${new URLSearchParams({ state: new URL(started.body.result.consent_url).searchParams.get('state'), code: 'synthetic-code' })}`)
  x.user = USER
  const shown = (await app.action('leaver', 'stump.accounts.connect', { action: 'list', connection_id: new URL(back.headers.get('location'), app.origin).searchParams.get('connection') })).body.result
  const account = shown.items.find(item => item.id === shown.connection.outcome.account_id)
  assert.deepEqual([account.owner.kind, account.handle], ['person', 'synthetic_leaver'])

  const item = (await app.action('leaver', 'stump.drafts.write', { action: 'create', format: 'post', person_id: leaver.id, account_id: account.id, network: 'x', text: 'Booking a whole term at once is live.' })).body.result
  x.limit = true
  const sent = await app.action('leaver', 'stump.items.schedule', { action: 'publish', item_id: item.id, account_id: account.id })
  x.limit = false
  assert.deepEqual([sent.body.result.item.state, sent.body.result.item.hold.kind], ['held', 'rate_limit'])

  const revoked = x.revoked.size, posts = x.posts.size
  const removed = (await app.action('owner', 'stump.team.manage', { action: 'remove', person_id: leaver.id })).body.result
  assert.ok(removed.unscheduled_items.includes(item.id))
  assert.deepEqual(removed.disconnected_accounts.map(entry => [entry.account_id, entry.revoked]), [[account.id, 'revoked']])
  assert.equal(x.revoked.size, revoked + 1)
  const after = (await app.action('owner', 'stump.drafts.revise', { action: 'get', item_id: item.id })).body.result
  assert.deepEqual([after.state, after.hold], ['draft', null])
  const listed = (await app.action('owner', 'stump.accounts.connect', { action: 'list', include_unconnected: true })).body.result.items.find(entry => entry.id === account.id)
  assert.deepEqual([listed.state, listed.owner.kind], ['disconnected', 'person'])
  assert.equal((await app.action('owner', 'stump.items.schedule', { action: 'publish', item_id: item.id, account_id: account.id })).status >= 400, true)
  assert.equal(x.posts.size, posts)
})
