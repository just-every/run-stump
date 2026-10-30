import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

let app
before(async () => { app = await stump() })
after(() => app?.stop())

const autonomous = { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', rules: [{ id: 'all', class: '*', do: 'autonomous' }], spend: { none: true } }

test('people join only by invitation, with the invited role, through the person door', async () => {
  const owner = await app.owner()
  assert.equal(owner.role, 'owner')
  const refused = await app.action('owner', 'stump.team.manage', { action: 'create', email: app.email('persona'), display_name: 'Persona' })
  assert.equal(refused.status, 403); assert.equal(refused.body.code, 'act_refused'); assert.equal(refused.body.rule, 'D-1')
  const stranger = app.email('stranger')
  assert.equal((await app.json('stranger', '/auth/magic-link', { email: stranger })).status < 500, true)
  assert.equal(app.sentTo(stranger).length, 0, 'an uninvited email gets no way in')

  const email = app.email('friend')
  const invited = await app.action('owner', 'stump.team.manage', { action: 'invite', email, display_name: 'Synthetic Friend', role: 'contributor', connection: 'friend' })
  assert.equal(invited.status, 200); assert.equal(invited.body.result.status, 'invited')
  // The invited person has their id before they sign in; it is the one they keep.
  const id = invited.body.result.id
  // Nobody connects an account for someone who has not signed in (D-1).
  const forThem = await app.action('owner', 'stump.accounts.connect', { action: 'start', network: 'mastodon', owner: 'me', instance: 'mastodon.example', person_id: id })
  assert.deepEqual([forThem.status, forThem.body.code, forThem.body.rule], [403, 'act_refused', 'D-1'])
  assert.equal((await app.action('owner', 'stump.team.manage', { action: 'set_role', person_id: id, role: 'poster' })).body.result.role, 'poster')
  const team = async () => (await app.action('owner', 'stump.team.manage', { action: 'list' })).body.result.items.find(item => item.id === id)
  assert.equal((await team()).status, 'invited')
  // Signing in accepts the invitation at that moment, before they open Stump.
  assert.equal(await app.signIn('friend', email), 303)
  assert.equal((await team()).status, 'active')
  const me = await app.json('friend', '/app/api/me')
  assert.equal(me.body.person.id, id); assert.equal(me.body.person.role, 'poster'); assert.equal(me.body.person.connection, 'friend')

  const denied = await app.action('friend', 'stump.team.manage', { action: 'invite', email: app.email('other'), display_name: 'Other', role: 'viewer' })
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'forbidden')
  const banned = await app.action('friend', 'stump.team.manage', { action: 'like' })
  assert.equal(banned.body.code, 'act_refused'); assert.equal(banned.body.rule, 'D-4'); assert.ok(banned.body.source)
  const crossSite = await app.request('owner', '/app/api/actions/stump.team.manage', { method: 'POST', body: JSON.stringify({ action: 'list' }), headers: { origin: 'https://elsewhere.example' } })
  assert.equal(crossSite.status, 403)
})

test('the owner cannot be removed or demoted until ownership is transferred, and the transfer is recorded', async () => {
  const owner = await app.owner()
  const email = app.email('admin')
  await app.action('owner', 'stump.team.manage', { action: 'invite', email, display_name: 'Synthetic Admin', role: 'admin', connection: 'employee' })
  assert.equal(await app.signIn('admin', email), 303)
  const admin = (await app.json('admin', '/app/api/me')).body.person
  for (const args of [{ action: 'remove', person_id: owner.id }, { action: 'set_role', person_id: owner.id, role: 'viewer' }]) {
    const refused = await app.action('admin', 'stump.team.manage', args)
    assert.equal(refused.body.code, 'owner_protected', args.action)
  }
  const promoted = await app.action('admin', 'stump.team.manage', { action: 'set_role', person_id: admin.id, role: 'owner' })
  assert.equal(promoted.body.code, 'self_escalation')
  const transferred = await app.action('owner', 'stump.team.manage', { action: 'set_role', person_id: admin.id, role: 'owner' })
  assert.equal(transferred.body.result.role, 'owner')
  assert.equal((await app.json('owner', '/app/api/me')).body.person.role, 'admin')
  const back = await app.action('admin', 'stump.team.manage', { action: 'set_role', person_id: owner.id, role: 'owner' })
  assert.equal(back.body.result.role, 'owner')
})

test('an agent credential acts for its person with exactly their role, follows role changes and ends when revoked', async () => {
  await app.owner()
  assert.equal((await app.json('owner', '/agents/api/policy', { document: autonomous }, 'PUT')).status, 200)
  const email = app.email('contractor')
  await app.action('owner', 'stump.team.manage', { action: 'invite', email, display_name: 'Synthetic Contractor', role: 'contributor', connection: 'contractor' })
  assert.equal(await app.signIn('contractor', email), 303)
  const person = (await app.json('contractor', '/app/api/me')).body.person
  const issued = await app.json('contractor', '/app/api/agent-credentials', { name: 'Synthetic helper' })
  assert.equal(issued.status, 201); assert.match(issued.body.client_id, /\S/); assert.equal(issued.body.agent.id, issued.body.client_id)

  const listed = await app.mcp(issued.body.token)
  assert.ok(listed.result.tools.some(tool => tool.name === 'stump.team.manage'))
  const asContributor = await app.mcp(issued.body.token, 'stump.team.manage', { action: 'invite', email: app.email('x'), display_name: 'X', role: 'viewer' })
  assert.equal(asContributor.error?.code, 'forbidden')
  const team = await app.mcp(issued.body.token, 'stump.team.manage', { action: 'list' })
  assert.ok(team.result.structuredContent.items.some(item => item.id === person.id))
  const persona = await app.mcp(issued.body.token, 'stump.team.manage', { action: 'create', email: app.email('persona'), display_name: 'Persona' })
  assert.equal(persona.error?.code, 'act_refused'); assert.equal(persona.error?.rule, 'D-1')

  // An editor's agent cannot widen its own person, though an editor may not change roles at all.
  await app.action('owner', 'stump.team.manage', { action: 'set_role', person_id: person.id, role: 'editor' })
  const promoted = await app.mcp(issued.body.token, 'stump.team.manage', { action: 'set_role', person_id: person.id, role: 'admin' })
  assert.equal(promoted.error?.code, 'self_escalation')
  assert.equal((await app.json('contractor', '/app/api/me')).body.person.role, 'editor')

  await app.action('owner', 'stump.team.manage', { action: 'set_role', person_id: person.id, role: 'admin' })
  const asAdmin = await app.mcp(issued.body.token, 'stump.team.manage', { action: 'invite', email: app.email('y'), display_name: 'Y', role: 'viewer' })
  assert.ok(!asAdmin.result.isError, asAdmin.error?.code); assert.equal(asAdmin.result.structuredContent.status, 'invited')
  const connectFor = await app.mcp(issued.body.token, 'stump.accounts.connect', { action: 'start', network: 'mastodon', owner: 'me', instance: 'mastodon.example', person_id: asAdmin.result.structuredContent.id })
  assert.deepEqual([connectFor.error?.code, connectFor.error?.rule], ['act_refused', 'D-1'])
  // Pause and resume through the agent are recorded with its person and the time.
  for (const action of ['pause', 'resume']) assert.ok(!(await app.mcp(issued.body.token, 'stump.calendar.pause', { action, scope: 'all' })).result.isError, action)
  const history = (await app.action('owner', 'stump.calendar.pause', { action: 'state' })).body.result.history
  assert.deepEqual(history.slice(0, 2).map(entry => [entry.action, entry.person_id, entry.agent_id]), [['resume', person.id, issued.body.client_id], ['pause', person.id, issued.body.client_id]])
  assert.ok(history.every(entry => Number.isFinite(Date.parse(entry.at))))
  const audit = await app.json('owner', '/agents/api/audit')
  assert.ok(audit.body.rows.some(row => row.agent.id === issued.body.client_id && row.sponsor.id === person.id && row.outcome === 'done'))

  const revoked = await app.json('contractor', `/app/api/agent-credentials/${issued.body.client_id}/revoke`, {})
  assert.equal(revoked.body.revoked, true)
  assert.equal((await app.mcp(issued.body.token)).status, 401)
})
