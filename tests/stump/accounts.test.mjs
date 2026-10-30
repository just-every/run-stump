import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// X's OAuth 2.0 token and users endpoints at the network edge, in their published shapes.
const x = { issued: new Set(), revoked: new Set() }
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
  if (url.pathname === '/2/users/me' && x.issued.has(request.headers.get('authorization')?.slice(7))) return Response.json({ data: { id: '1500000000000000001', username: 'synthetic_co', name: 'Synthetic Co' } })
  return Response.json({ title: 'Unauthorized', status: 401 }, { status: 401 })
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
