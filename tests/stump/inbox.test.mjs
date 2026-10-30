import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// X API v2 (OAuth token, the account, its mentions timeline, post reads and post
// creation) and Orbit's signed signal door, faked at the network edge in their
// published shapes. Everything else runs through Stump's own doors.
const COMPANY = { id: '1500000000000000001', username: 'synthetic_co', name: 'Synthetic Co' }
const PEOPLE = {
  linh: { id: '1600000000000000001', username: 'synthetic_linh', name: 'Synthetic Linh' },
  bo: { id: '1600000000000000002', username: 'synthetic_bo', name: 'Synthetic Bo', description: 'Front desk lead. Write to bo@synthetic-clinic.test about scheduling.' },
  ana: { id: '1600000000000000003', username: 'synthetic_ana', name: 'Synthetic Ana' },
  kit: { id: '1600000000000000004', username: 'synthetic_kit', name: 'Synthetic Kit' },
}
const x = { tokens: new Set(), posts: new Map(), mentions: [], created: [], mentionReads: 0, next: 1900000000000000100n }
const orbitSecret = randomBytes(32).toString('hex'), signals = []
let orbitDown = false

const post = (author, text, fields = {}) => { const id = String(x.next++); const value = { id, text, author_id: author.id, created_at: new Date().toISOString(), conversation_id: fields.conversation_id ?? id, edit_history_tweet_ids: [id], ...fields }; x.posts.set(id, value); return value }
// X returns only the user fields a read asks for (user.fields), beside the id.
const users = url => { const fields = (url.searchParams.get('user.fields') ?? '').split(','); return [COMPANY, ...Object.values(PEOPLE)].map(user => Object.fromEntries(Object.entries(user).filter(([key]) => key === 'id' || fields.includes(key)))) }
const longer = (a, b) => a.length !== b.length ? a.length > b.length : a > b

async function edge(request) {
  const url = new URL(request.url)
  if (url.origin === 'https://orbit.example.test') {
    const body = await request.text(), stamp = request.headers.get('x-orbit-timestamp') ?? ''
    if (request.headers.get('x-orbit-signature') !== createHmac('sha256', orbitSecret).update(`${stamp}.${body}`).digest('hex')) return Response.json({ error: 'Source signature is missing, invalid or expired.' }, { status: 401 })
    if (orbitDown) return Response.json({ error: 'Orbit is restarting.' }, { status: 503 })
    signals.push(JSON.parse(body))
    return Response.json({ id: `sig-${signals.length}`, linked: false }, { status: 201 })
  }
  if (url.origin !== 'https://api.x.com') return null
  if (url.pathname === '/2/oauth2/token') {
    const token = randomBytes(16).toString('hex'); x.tokens.add(token)
    return Response.json({ token_type: 'bearer', expires_in: 7200, access_token: token, refresh_token: randomBytes(16).toString('hex'), scope: 'tweet.read tweet.write users.read offline.access' })
  }
  if (!x.tokens.has(request.headers.get('authorization')?.slice(7))) return Response.json({ title: 'Unauthorized', status: 401 }, { status: 401 })
  if (url.pathname === '/2/users/me') return Response.json({ data: COMPANY })
  if (url.pathname === `/2/users/${COMPANY.id}/mentions`) {
    x.mentionReads++
    const since = url.searchParams.get('since_id')
    const data = x.mentions.filter(item => !since || longer(item.id, since)).sort((a, b) => longer(a.id, b.id) ? -1 : 1)
    if (!data.length) return Response.json({ meta: { result_count: 0 } })
    return Response.json({ data, includes: { users: users(url) }, meta: { result_count: data.length, newest_id: data[0].id, oldest_id: data.at(-1).id } })
  }
  if (url.pathname === '/2/tweets' && request.method === 'POST') {
    const body = await request.json(), created = post(COMPANY, body.text, body.reply ? { referenced_tweets: [{ type: 'replied_to', id: body.reply.in_reply_to_tweet_id }] } : {})
    x.created.push(body)
    return Response.json({ data: { id: created.id, text: created.text, edit_history_tweet_ids: [created.id] } }, { status: 201 })
  }
  const read = /^\/2\/tweets\/(\d+)$/.exec(url.pathname)
  if (read && x.posts.has(read[1])) return Response.json({ data: x.posts.get(read[1]), includes: { users: users(url) } })
  return Response.json({ title: 'Not Found Error', status: 404, detail: `Could not find ${url.pathname}` }, { status: 404 })
}

let app, account, agent
before(async () => {
  app = await stump({ edge })
  await app.owner()
  await app.action('owner', 'stump.setup.apps', { action: 'set', network: 'x', client_id: 'synthetic-stump-client', client_secret: randomBytes(20).toString('hex') })
  const started = await app.action('owner', 'stump.accounts.connect', { action: 'start', network: 'x', owner: 'company' })
  const back = await app.request('owner', `/app/connected/x?${new URLSearchParams({ state: new URL(started.body.result.consent_url).searchParams.get('state'), code: 'synthetic-code' })}`)
  const shown = await app.action('owner', 'stump.accounts.connect', { action: 'list', connection_id: new URL(back.headers.get('location'), app.origin).searchParams.get('connection') })
  account = shown.body.result.items.find(item => item.id === shown.body.result.connection.outcome.account_id)
  const autonomous = { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', rules: [{ id: 'all', class: '*', do: 'autonomous' }], spend: { none: true } }
  assert.equal((await app.json('owner', '/agents/api/policy', { document: autonomous }, 'PUT')).status, 200)
  agent = (await app.json('owner', '/app/api/agent-credentials', { name: 'Synthetic inbox agent' })).body
})
after(() => app?.stop())

const ok = answer => { assert.equal(answer.status, 200, JSON.stringify(answer.body)); return answer.body.result }
const inbox = (tool, args) => app.action('owner', tool, args)

test('the company reads its X mentions once at its read price, answers only people who engaged first, once each, and holds a near-duplicate', async () => {
  const launch = post(COMPANY, 'Recurring bookings are live in 3.2.')
  const stranger = post(PEOPLE.ana, 'Which booking tool handles a clinic with three rooms?')
  x.mentions.push(
    post(PEOPLE.linh, `@${COMPANY.username} Does 3.2 handle every-other-week?`, { in_reply_to_user_id: COMPANY.id, referenced_tweets: [{ type: 'replied_to', id: launch.id }], conversation_id: launch.id }),
    post(PEOPLE.bo, `@${PEOPLE.ana.username} @${COMPANY.username} might fit what you need there`, { in_reply_to_user_id: PEOPLE.ana.id, referenced_tweets: [{ type: 'replied_to', id: stranger.id }], conversation_id: stranger.id }),
    post(PEOPLE.kit, `@${COMPANY.username} thanks!`),
  )

  // An agent reads the inbox: policy weighs the most a read can cost, and the answer carries what it did cost.
  const polled = await app.mcp(agent.token, 'stump.inbox.read', { action: 'poll', account_id: account.id })
  assert.deepEqual(polled.result._meta['com.runeditrun/decision'].classes.find(entry => entry.class === 'money').facts, { measure: 1, currency: 'usd', counterparty: 'x' })
  // Three mentions and the stranger's thread post at $0.005 a post read, and the company's own post they answered at $0.001.
  assert.deepEqual([polled.result.structuredContent.reads, polled.result.structuredContent.charge_usd, polled.result.structuredContent.added], [5, 0.021, 5])
  const again = ok(await inbox('stump.inbox.read', { action: 'poll', account_id: account.id }))
  assert.deepEqual([again.reads, again.charge_usd, again.added], [0, 0, 0])

  const listed = ok(await inbox('stump.inbox.read', { action: 'list', account_id: account.id }))
  assert.equal(listed.total, 5)
  const of = handle => listed.items.find(item => item.author === handle && item.kind !== 'thread')
  const linh = of(PEOPLE.linh.username), bo = of(PEOPLE.bo.username), ana = listed.items.find(item => item.kind === 'thread' && item.author === PEOPLE.ana.username)
  assert.deepEqual([linh.engaged_first, linh.kind, linh.company_post.network_id, linh.company_post.text, linh.url],
    [true, 'reply', launch.id, launch.text, `https://x.com/${PEOPLE.linh.username}/status/${linh.network_id}`])
  assert.deepEqual([linh.thread.network_id, linh.thread.own, linh.thread.author, linh.thread.text], [launch.id, true, COMPANY.username, launch.text])
  assert.deepEqual([bo.engaged_first, bo.thread.inbox_item_id, ana.engaged_first, ana.author, ana.may_reply], [true, ana.id, false, PEOPLE.ana.username, false])

  // The stranger in the public thread never engaged with the account: no reply, through either door.
  const refused = await inbox('stump.inbox.reply', { action: 'reply', inbox_item_id: ana.id, account_id: account.id, text: 'We built a three-room calendar for clinics.' })
  assert.deepEqual([refused.status, refused.body.code, refused.body.rule, refused.body.source], [403, 'act_refused', 'D-4', 'https://help.x.com/en/rules-and-policies/x-automation'])
  assert.equal((await app.mcp(agent.token, 'stump.inbox.reply', { action: 'reply', inbox_item_id: ana.id, account_id: account.id, text: 'We built it.' })).error.code, 'act_refused')
  for (const act of ['like', 'repost', 'follow', 'dm']) {
    const asked = await inbox('stump.inbox.reply', { action: act, inbox_item_id: linh.id, account_id: account.id })
    assert.deepEqual([asked.body.code, asked.body.rule, typeof asked.body.source], ['act_refused', 'D-4', 'string'], act)
  }
  assert.equal(x.created.length, 0)

  // Someone who engaged first gets one reply: it posts in their thread, reads back and lands on the ledger with its charge.
  const text = 'Yes. Pick every other week when you set the pattern, and each visit books itself.'
  const replied = ok(await inbox('stump.inbox.reply', { action: 'reply', inbox_item_id: linh.id, account_id: account.id, text }))
  assert.deepEqual([replied.state, replied.posted, x.created.length, x.created[0].reply.in_reply_to_tweet_id], ['posted', true, 1, linh.network_id])
  const { entry } = ok(await inbox('stump.ledger.search', { action: 'get', entry_id: replied.ledger_id }))
  assert.deepEqual([entry.url, entry.text, entry.route, entry.state, entry.confirmation, entry.charge_usd], [replied.url, text, 'published', 'posted', 'network', 0.015])
  const second = await inbox('stump.inbox.reply', { action: 'reply', inbox_item_id: linh.id, account_id: account.id, text: 'One more thing about patterns.' })
  assert.deepEqual([second.body.code, second.body.act, second.body.reply_item_id], ['act_refused', 'x_one_reply_per_interaction', replied.item_id])

  // The same words to the next person are held, naming the reply they repeat; only a rewrite sends it.
  const repeat = ok(await inbox('stump.inbox.reply', { action: 'reply', inbox_item_id: bo.id, account_id: account.id, text: text.replace('Yes. ', 'Yes! ') }))
  assert.deepEqual([repeat.state, repeat.posted, repeat.hold.reason, x.created.length], ['held', false, 'near_duplicate', 1])
  assert.ok(repeat.hold.matches.some(match => match.id === replied.item_id || match.id === replied.ledger_id))
  const rewritten = ok(await inbox('stump.inbox.reply', { action: 'reply', inbox_item_id: bo.id, account_id: account.id, text: 'Thanks for pointing Ana our way.' }))
  assert.deepEqual([rewritten.item_id, rewritten.state, x.created.length], [repeat.item_id, 'posted', 2])
})

test('people who engaged first with substance become offers to Orbit, signed, with only a publicly shown email and one identity each; a failed send stays offered', async () => {
  const offers = ok(await inbox('stump.stack.send', { action: 'offers', seed: 'orbit' }))
  // A question and a reply with substance are offered; a passing "thanks!" and the stranger who never engaged are not.
  assert.deepEqual(offers.items.map(offer => offer.handle).sort(), [PEOPLE.bo.username, PEOPLE.linh.username])
  // Only an email the person shows on their own profile travels with them.
  assert.deepEqual(offers.items.map(offer => [offer.handle, offer.email]).sort(), [[PEOPLE.bo.username, 'bo@synthetic-clinic.test'], [PEOPLE.linh.username, null]])
  const linh = offers.items.find(offer => offer.handle === PEOPLE.linh.username)
  assert.equal((await inbox('stump.stack.send', { action: 'send', offer_id: linh.id })).body.code, 'not_connected')
  ok(await inbox('stump.stack.connect', { action: 'connect', seed: 'orbit', origin: 'https://orbit.example.test', source_id: 'stump', secret: orbitSecret }))

  orbitDown = true
  const failed = ok(await inbox('stump.stack.send', { action: 'send', offer_id: linh.id }))
  assert.deepEqual([failed.sent, failed.state, failed.outcome.error], [false, 'offered', 'Orbit is restarting.'])
  orbitDown = false
  const sent = ok(await inbox('stump.stack.send', { action: 'send', offer_id: linh.id }))
  assert.deepEqual([sent.sent, sent.state, signals.length], [true, 'sent', 1])
  const [signal] = signals
  assert.equal(signal.type, 'stump:social-engagement'); assert.ok(!('email' in signal))
  assert.equal(signal.identityBasis, `stump:engager:x:id:${PEOPLE.linh.id}`)
  assert.equal(signal.data.handle, PEOPLE.linh.username); assert.match(signal.data.post_url, /^https:\/\/x\.com\/synthetic_linh\/status\/\d+$/)

  // The same person engaging again is a new offer with the same identity in Orbit.
  x.mentions.push(post(PEOPLE.linh, `@${COMPANY.username} Can a pattern skip holidays?`))
  assert.equal(ok(await inbox('stump.inbox.read', { action: 'poll', account_id: account.id })).offered, 1)
  const later = ok(await inbox('stump.stack.send', { action: 'offers', seed: 'orbit', state: 'offered' })).items.find(offer => offer.handle === PEOPLE.linh.username)
  ok(await inbox('stump.stack.send', { action: 'send', offer_id: later.id }))
  assert.equal(signals[1].identityBasis, signal.identityBasis); assert.notEqual(signals[1].eventId, signal.eventId)

  // Someone who shows an email on their profile reaches Orbit with it, so Orbit can judge contactability from what they made public.
  ok(await inbox('stump.stack.send', { action: 'send', offer_id: offers.items.find(offer => offer.handle === PEOPLE.bo.username).id }))
  assert.deepEqual([signals[2].email, signals[2].identityBasis], ['bo@synthetic-clinic.test', `stump:engager:x:id:${PEOPLE.bo.id}`])
})
