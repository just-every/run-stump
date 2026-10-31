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
  // Base's own account routes follow Stump's roles: accounts change only through the team, and installation settings are the owner's.
  const baseRefusals = async (who, other) => [
    (await app.json(who, '/auth/operator/status', { operatorId: other, status: 'inactive' })).status,
    (await app.json(who, '/auth/operator/role', { operatorId: who === 'admin' ? admin.id : owner.id, role: 'admin' })).status,
    (await app.json(who, `/auth/sessions?operatorId=${other}`)).status,
    (await app.json(who, '/auth/settings/identity')).status,
  ]
  assert.deepEqual(await baseRefusals('admin', owner.id), [403, 403, 403, 403])
  const transferred = await app.action('owner', 'stump.team.manage', { action: 'set_role', person_id: admin.id, role: 'owner' })
  assert.equal(transferred.body.result.role, 'owner'); assert.equal(transferred.body.result.sign_in_again, true)
  // Sign-in ownership moves with the transfer, and both people sign in again.
  assert.equal((await app.json('owner', '/app/api/me')).status, 401)
  const signInAgain = async () => {
    for (const [who, address] of [['owner', owner.email], ['admin', email]]) {
      assert.equal((await app.json(who, '/auth/magic-link', { email: address })).status, 202)
      assert.equal(await app.signIn(who, address), 303)
    }
  }
  await signInAgain()
  assert.equal((await app.json('owner', '/app/api/me')).body.person.role, 'admin')
  assert.equal((await app.json('admin', '/auth/settings/identity')).status, 200)
  assert.deepEqual(await baseRefusals('owner', admin.id), [403, 403, 403, 403])
  assert.equal((await app.json('admin', '/app/api/me')).status, 200, 'the new owner keeps every door')
  const back = await app.action('admin', 'stump.team.manage', { action: 'set_role', person_id: owner.id, role: 'owner' })
  assert.equal(back.body.result.role, 'owner')
  await signInAgain()
  assert.equal((await app.json('owner', '/auth/settings/identity')).status, 200)
})

test('a contributor drafts but cannot schedule or publish, and a poster sees only their own accounts and drafts', async () => {
  const owner = await app.owner()
  const people = {}
  for (const [label, role, connection] of [['writer', 'contributor', 'employee'], ['poster', 'poster', 'friend']]) {
    const email = app.email(label)
    people[label] = (await app.action('owner', 'stump.team.manage', { action: 'invite', email, display_name: `Synthetic ${label}`, role, connection })).body.result
    assert.equal(await app.signIn(label, email), 303)
  }
  // Connected accounts as the connection flows record them: the company's, and one each for the writer and the poster.
  const account = async (handle, person) => {
    const id = crypto.randomUUID(), now = Date.now()
    await app.db.prepare(`INSERT INTO stump_accounts(id,network,handle,display_name,owner_kind,owner_person_id,connected_by,connected_at,state,created_at,updated_at)
      VALUES(?,'bluesky',?,?,?,?,?,?,'connected',?,?)`).bind(id, `${handle}.bsky.social`, handle, person ? 'person' : 'company', person ?? null, person ?? owner.id, now, now, now).run()
    return id
  }
  const company = await account('synthetic-company'), writer = await account('synthetic-writer', people.writer.id), poster = await account('synthetic-poster', people.poster.id)

  const draft = (await app.action('writer', 'stump.drafts.write', { action: 'create', format: 'post', person_id: people.writer.id, account_id: writer, network: 'bluesky', text: 'A note from my own account.' })).body.result
  for (const [tool, args] of [['stump.items.schedule', { action: 'publish', item_id: draft.id, account_id: writer }], ['stump.items.schedule', { action: 'schedule', item_id: draft.id, account_id: writer, at: new Date(Date.now() + 86_400_000).toISOString() }],
    ['stump.calendar.plan', { action: 'queue', item_id: draft.id, account_id: writer }]]) {
    const refused = await app.action('writer', tool, args)
    assert.deepEqual([refused.status, refused.body.code], [403, 'forbidden'], args.action)
  }
  assert.equal((await app.action('writer', 'stump.drafts.revise', { action: 'mark_ready', item_id: draft.id })).body.result.state, 'ready')

  const opened = (await app.action('owner', 'stump.drafts.write', { action: 'master', account_ids: [company, poster], text: 'Unpublished company words.' })).body.result
  const shown = (await app.action('poster', 'stump.drafts.preview', { action: 'master', master_id: opened.master.id })).body.result
  assert.deepEqual([shown.total, shown.items.map(item => item.account_id), shown.master.account_ids], [1, [poster], [poster]])
  const elsewhere = (await app.action('owner', 'stump.drafts.write', { action: 'master', account_ids: [company], text: 'Only the company.' })).body.result
  assert.equal((await app.action('poster', 'stump.drafts.preview', { action: 'master', master_id: elsewhere.master.id })).status, 404)
  const targets = (await app.action('poster', 'stump.drafts.preview', { action: 'targets' })).body.result.items.map(item => item.id)
  const listed = (await app.action('poster', 'stump.accounts.connect', { action: 'list' })).body.result.items.map(item => item.id)
  assert.deepEqual([targets, listed], [[poster], [poster]])
  for (const id of [company, writer]) assert.equal((await app.action('poster', 'stump.calendar.plan', { action: 'slots', account_id: id })).status, 404)
  assert.equal((await app.action('owner', 'stump.calendar.pause', { action: 'pause', scope: 'account', account_id: writer })).status, 200)
  const pauses = (await app.action('poster', 'stump.calendar.pause', { action: 'state' })).body.result
  assert.ok(![...pauses.paused, ...pauses.history].some(entry => entry.account_id === writer))
  assert.equal((await app.action('owner', 'stump.calendar.pause', { action: 'resume', scope: 'account', account_id: writer })).status, 200)
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
