import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// The two network fakes verify what Orbit's and Vane's own doors verify: Orbit's signed signal
// (X-Orbit-Timestamp, X-Orbit-Signature over "<timestamp>.<body>") and Vane's bearer annotation.
const orbitSecret = randomBytes(24).toString('hex'), vaneSecret = `vane_ah_${randomBytes(32).toString('hex')}`
const signals = [], annotations = []
async function outbound(request) {
  const url = new URL(request.url)
  if (!['https://orbit.example.test', 'https://vane.example.test'].includes(url.origin)) return null
  const body = await request.text()
  if (url.origin === 'https://orbit.example.test' && url.pathname === '/api/v1/signals/stump') {
    const stamp = request.headers.get('x-orbit-timestamp') ?? ''
    const expected = createHmac('sha256', orbitSecret).update(`${stamp}.${body}`).digest('hex')
    if (!/^\d{10}$/.test(stamp) || Math.abs(Date.now() - Number(stamp) * 1000) > 300000 || request.headers.get('x-orbit-signature') !== expected) return Response.json({ error: 'Source signature is missing, invalid or expired.' }, { status: 401 })
    const event = JSON.parse(body)
    if (!event.type.startsWith('stump:')) return Response.json({ error: 'Invalid event type or future occurred time.' }, { status: 400 })
    const known = signals.find(item => item.eventId === event.eventId)
    if (!known) signals.push(event)
    return Response.json({ id: `sig-${signals.length}`, ...(known ? { replayed: true } : { linked: false }) }, { status: 201 })
  }
  if (url.origin === 'https://vane.example.test' && url.pathname === '/api/vane/annotations') {
    if (request.headers.get('authorization') !== `Bearer ${vaneSecret}`) return Response.json({ error: 'unauthorized' }, { status: 401 })
    annotations.push(JSON.parse(body))
    return Response.json({ accepted: true }, { status: 201 })
  }
  return null
}

let app
before(async () => { app = await stump({ edge: outbound }) })
after(() => app?.stop())

const now = Date.now(), day = 86_400_000
const insertEntry = (id, fields) => app.db.prepare(`INSERT INTO stump_ledger(id,url,network,venue_id,person_id,by_label,text,route,state,confirmation,posted_at,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, fields.url ?? null, fields.network, fields.venue_id ?? null, fields.person_id, fields.by, fields.text, fields.route, fields.state ?? 'posted', fields.confirmation ?? null, fields.posted_at ?? now, now, now).run()

test('the ledger is searched with combined filters, corrected into versions, marked removed and exported as the rows on screen', async () => {
  const owner = await app.owner()
  await insertEntry('l-bsky', { network: 'bluesky', person_id: owner.id, by: `Synthetic agent for ${owner.display_name}`, text: 'Recurring bookings are live.', route: 'published', confirmation: 'network', url: 'https://bsky.app/p/1', posted_at: now - day })
  await insertEntry('l-reddit', { network: 'reddit', venue_id: 'v-1', person_id: owner.id, by: owner.display_name, text: 'Thread answer, with a comma.', route: 'handed_off', confirmation: 'person', posted_at: now - 2 * day })
  await insertEntry('l-failed', { network: 'x', person_id: owner.id, by: owner.display_name, text: 'Refused by X.', route: 'published', state: 'failed' })
  const ledger = (args, tool = 'stump.ledger.search') => app.action('owner', tool, args)

  const all = (await ledger({ action: 'search' })).body.result
  assert.equal(all.total, 3)
  assert.equal(all.items.find(item => item.id === 'l-failed').state, 'failed')
  assert.equal((await ledger({ action: 'search', route: 'published', state: 'posted' })).body.result.items.map(item => item.id).join(), 'l-bsky')
  assert.equal((await ledger({ action: 'search', q: 'recurring', network: 'bluesky' })).body.result.total, 1)
  assert.equal(all.items.find(item => item.id === 'l-bsky').by, `Synthetic agent for ${owner.display_name}`)

  const corrected = (await ledger({ action: 'correct', entry_id: 'l-bsky', note: 'Fixed wording', text: 'Recurring bookings are live today.' }, 'stump.ledger.correct')).body.result
  assert.equal(corrected.versions.length, 2); assert.equal(corrected.versions[0].text, 'Recurring bookings are live.'); assert.equal(corrected.text, 'Recurring bookings are live today.')
  const removed = (await ledger({ action: 'mark_removed', entry_id: 'l-reddit', reason: 'Removed by moderators' }, 'stump.ledger.correct')).body.result
  assert.equal(removed.state, 'removed'); assert.equal(removed.removal.reason, 'Removed by moderators')
  assert.equal((await ledger({ action: 'history', venue_id: 'v-1' })).body.result.items[0].state, 'removed')
  assert.equal((await ledger({ action: 'mark_removed', entry_id: 'l-failed', reason: 'x' }, 'stump.ledger.correct')).body.code, 'conflict')

  const csv = (await ledger({ action: 'export_csv', network: 'reddit' })).body.result.csv.trim().split('\n')
  assert.equal(csv.length, 2); assert.ok(csv[1].startsWith('l-reddit,')); assert.ok(csv[1].includes('"Thread answer, with a comma."'))

  const friend = app.email('poster')
  await app.action('owner', 'stump.team.manage', { action: 'invite', email: friend, display_name: 'Synthetic Poster', role: 'poster', connection: 'friend' })
  assert.equal(await app.signIn('poster', friend), 303)
  assert.equal((await app.action('poster', 'stump.ledger.search', { action: 'search' })).body.result.total, 0)
  assert.equal((await app.action('poster', 'stump.ledger.correct', { action: 'correct', entry_id: 'l-bsky', note: 'x' })).body.code, 'forbidden')
})

test('link tags go on the company\'s own links only, and engagers and annotations reach Orbit and Vane signed, sealed and recorded', async () => {
  const owner = await app.owner()
  const set = args => app.action('owner', 'stump.links.manage', args)
  await set({ action: 'set_rules', own_domains: ['example.com'], mediums: { published: 'social', handoff: 'community' } })
  const tagged = (await set({ action: 'preview', text: 'See https://example.com/a and https://elsewhere.org/b', route: 'published', source: 'bluesky', campaign: 'launch', content: 'item-1' })).body.result
  assert.equal(tagged.text, 'See https://example.com/a?utm_source=bluesky&utm_medium=social&utm_campaign=launch&utm_content=item-1 and https://elsewhere.org/b')

  const connect = args => app.action('owner', 'stump.stack.connect', { action: 'connect', ...args })
  const orbit = await connect({ seed: 'orbit', origin: 'https://orbit.example.test', source_id: 'stump', secret: orbitSecret })
  assert.equal(orbit.body.result.state, 'connected'); assert.ok(!JSON.stringify(orbit.body).includes(orbitSecret))
  assert.equal((await connect({ seed: 'vane', origin: 'https://vane.example.test', site_id: 'site-1', secret: vaneSecret })).status, 200)
  const stored = await app.db.prepare('SELECT secret_sealed FROM stump_stack_connections').all()
  assert.ok(stored.results.every(row => !row.secret_sealed.includes(orbitSecret) && !row.secret_sealed.includes(vaneSecret)))

  const offer = (id, handle, email) => app.db.prepare(`INSERT INTO stump_stack_offers(id,seed,kind,state,network,handle,post_url,engagement,public_email,occurred_at,created_at)
    VALUES(?,'orbit','engager','offered','bluesky',?,?,'asked about pricing',?,?,?)`).bind(id, handle, `https://bsky.app/profile/${handle}/post/${id}`, email, now - 3600_000, now).run()
  await offer('o-1', 'drlinh.example', null); await offer('o-2', 'drlinh.example', null); await offer('o-3', 'ana.example', 'ana@clinic.example')
  const send = id => app.action('owner', 'stump.stack.send', { action: 'send', offer_id: id })
  assert.equal((await send('o-1')).body.result.state, 'sent')
  assert.equal((await send('o-1')).body.result.already_sent, true); assert.equal(signals.length, 1)
  await send('o-2'); await send('o-3')
  assert.equal(signals[0].type, 'stump:social-engagement'); assert.ok(!('email' in signals[0])); assert.equal(signals[2].email, 'ana@clinic.example')
  assert.equal(signals[0].identityBasis, signals[1].identityBasis); assert.notEqual(signals[0].identityBasis, signals[2].identityBasis)

  await app.db.prepare(`INSERT INTO stump_stack_offers(id,seed,kind,state,ledger_id,network,post_url,occurred_at,created_at) VALUES('a-1','vane','annotation','offered','l-vane','bluesky','https://bsky.app/p/9',?,?)`).bind(now - day, now).run()
  await insertEntry('l-vane', { network: 'bluesky', person_id: owner.id, by: owner.display_name, text: 'Annotated post', route: 'published', url: 'https://bsky.app/p/9', posted_at: now - day })
  assert.equal((await send('a-1')).body.result.state, 'sent')
  assert.equal(annotations.length, 1); assert.deepEqual(Object.keys(annotations[0]).sort(), ['at', 'id', 'kind', 'siteId', 'title', 'url'])
  assert.equal(annotations[0].kind, 'campaign'); assert.equal(annotations[0].url, 'https://bsky.app/p/9')

  assert.equal((await app.action('owner', 'stump.stack.connect', { action: 'disconnect', seed: 'orbit' })).body.result.state, 'disconnected')
  await offer('o-4', 'late.example', null)
  assert.equal((await send('o-4')).body.code, 'not_connected'); assert.equal(signals.length, 3)
})
