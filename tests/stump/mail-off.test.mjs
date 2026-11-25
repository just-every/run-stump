import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { ownerSigninDigest } from '../../src/modules/operator-auth/owner-signin-grant.mjs'
import { stump } from './instance.mjs'

test('a mail-off installation refuses email and accepts a one-time owner sign-in link', async t => {
  const app = await stump({ bindings: { MAIL_PROVIDER: 'none', MAIL_FROM: undefined, MAIL_API_KEY: undefined } })
  t.after(() => app.stop())
  const owner = await app.owner()
  const email = 'synthetic-stump-owner@example.com'
  const cannotSend = { status: 409, body: { error: 'mail_off' } }
  const headers = { 'CF-Connecting-IP': '192.0.2.1' }

  const signIn = await app.request('visitor', '/signin?notice=sent')
  assert.equal(signIn.status, 200)
  assert.doesNotMatch(await signIn.text(), /action="\/auth\/magic-link"/)
  assert.deepEqual(await app.json('visitor', '/auth/magic-link', { email }), cannotSend)
  const invitation = { email: app.email('member'), displayName: 'Riley Green' }
  assert.deepEqual(await app.json('owner', '/auth/invite', invitation), cannotSend)
  assert.deepEqual(await app.json('owner', '/auth/step-up', { action: 'email:change' }), cannotSend)
  assert.deepEqual(app.sentTo(email), [])
  assert.deepEqual(app.sentTo(invitation.email), [])

  // Put the grant in D1 as rer signin would through Cloudflare's D1 API.
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  await app.db.prepare(`INSERT INTO oa_owner_signins(id, token_hash, operator_id, operator_version, created_at, expires_at)
    SELECT ?, ?, id, version, ?, ? FROM oa_operators WHERE id = ?`)
    .bind(randomUUID(), await ownerSigninDigest(token), now, now + 60_000, owner.id).run()
  const preview = await app.request('visitor', `/auth/owner-signin?token=${token}`)
  assert.equal(preview.status, 200)
  assert.match(await preview.text(), /action="\/auth\/owner-signin"/)
  const confirm = { method: 'POST', headers, body: JSON.stringify({ token }) }
  assert.equal((await app.request('visitor', '/auth/owner-signin', confirm)).status, 303)
  assert.equal((await app.json('visitor', '/app/api/me')).body.person.id, owner.id)
  assert.equal((await app.request('replay', '/auth/owner-signin', confirm)).status, 400)
})
