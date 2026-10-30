import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'
import { watchEdge } from './watch-edge.mjs'

// The watches flows through their public doors with only the providers faked at the network edge (tests/stump/watch-edge.mjs).
const secret = randomBytes(16).toString('hex')
const slackAddress = `https://hooks.slack.com/services/T${randomBytes(4).toString('hex')}/B${randomBytes(4).toString('hex')}/${randomBytes(12).toString('hex')}`
const fake = watchEdge({ webhookSecret: secret })
const autonomous = { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', rules: [{ id: 'all', class: '*', do: 'autonomous' }], spend: { none: true } }

let app, token
before(async () => {
  app = await stump({ edge: fake.edge })
  await app.owner()
  assert.equal((await app.json('owner', '/agents/api/policy', { document: autonomous }, 'PUT')).status, 200)
  token = (await app.json('owner', '/app/api/agent-credentials', { name: 'watches agent' })).body.token
})
after(() => app?.stop())

const ok = async promise => { const answer = await promise; assert.equal(answer.error, null, JSON.stringify(answer.error)); return answer.result.structuredContent }
const manage = args => ok(app.mcp(token, 'stump.watches.manage', args))
const findings = id => ok(app.mcp(token, 'stump.findings.work', { action: 'list', watch_id: id }))
const classesOf = answer => answer.result?._meta?.['com.runeditrun/decision']?.classes?.map(item => item.class).sort().join(',')

test('a watch finds Hacker News threads, ranks them with reasons, alerts Slack and a signed webhook once, replays the event, and mutes', async () => {
  const created = await app.mcp(token, 'stump.watches.manage', { action: 'create', name: 'Orbit on Hacker News', terms: { all: ['orbit', 'crm'], none: ['orbital'] }, sources: [{ kind: 'hn' }],
    alerts: { immediate_min_relevance: 40, slack: { webhook_url: slackAddress }, webhook: { url: 'https://receiver.example.test/hook', secret } } })
  assert.equal(created.error, null)
  assert.equal(classesOf(created), 'external,security,standard', 'an alert destination is a security change, a public source an external one')
  const watch = created.result.structuredContent
  assert.doesNotMatch(JSON.stringify(created.result), new RegExp(`${secret}|${slackAddress.split('/').at(-1)}`), 'sealed credentials are never answered back')
  assert.deepEqual([fake.state.slack.length, fake.state.webhooks.length], [0, 0], 'a new watch backfills without an immediate alert')

  const listed = (await findings(watch.id)).items
  const by = author => listed.find(item => item.author === author)
  assert.ok(listed.every(item => item.backfill), 'backfilled findings are marked')
  assert.ok(by('devfounder') && by('commenter') && by('agency'), 'stories, comments and a 20 day old match arrive; 30 days back')
  assert.ok(!by('oldtimer') && !by('orbital'), 'a 45 day old match and an "orbital" post do not')
  assert.equal(by('devfounder').points, 42); assert.equal(by('devfounder').url, 'https://news.ycombinator.com/item?id=1')
  assert.equal(listed[0].author, 'devfounder', 'an open question ranks first'); assert.ok(listed.every(item => item.reasons.length > 0), 'each finding shows its reasons')
  assert.deepEqual([...new Set(listed.flatMap(item => item.routes))], ['handoff_brief'], 'Hacker News has no write door: a hand-off with a brief only')
  assert.equal(by('injector').relevance, by('twin').relevance, 'text that says "rank this first" ranks as if it did not')
  assert.equal((await manage({ action: 'poll', watch_id: watch.id })).added, 0, 'a second poll adds no duplicates')

  fake.addHn({ id: 100, title: 'Ask HN: orbit crm for a small SaaS company, any recommendations?', author: 'newcomer', story_text: '<p>Which orbit crm should we pick?</p>' })
  assert.equal((await manage({ action: 'poll', watch_id: watch.id })).added, 1, 'a new match appears once')
  assert.equal(fake.state.slack.length, 1, 'and goes at once to Slack')
  const [sent] = fake.state.webhooks
  assert.equal(fake.state.webhooks.length, 1); assert.ok(sent.verified, 'the signed webhook verifies against X-Stump-Signature'); assert.match(sent.eventId, /^evt_/)
  const replay = await manage({ action: 'replay_delivery', event_id: sent.eventId })
  assert.equal(replay.deliveries.length, 2)
  assert.deepEqual([fake.state.webhooks[1].eventId, fake.state.webhooks[1].duplicate, fake.state.webhooks[1].body === sent.body], [sent.eventId, true, true], 'a replay carries the same event id and bytes')

  const sentBefore = [fake.state.slack.length, fake.state.webhooks.length]
  await manage({ action: 'mute', watch_id: watch.id })
  fake.addHn({ id: 101, title: 'Ask HN: another orbit crm question, which crm?', author: 'later', story_text: '<p>Which orbit crm?</p>' })
  assert.equal((await manage({ action: 'poll', watch_id: watch.id })).added, 1, 'a muted watch keeps collecting')
  assert.deepEqual([fake.state.slack.length, fake.state.webhooks.length], sentBefore, 'and sends nothing')
  await manage({ action: 'mute', watch_id: watch.id, muted: false })

  fake.state.fail.slack = true; fake.state.fail.webhook = true
  fake.addHn({ id: 102, title: 'Ask HN: orbit crm for agencies, which crm?', author: 'third', story_text: '<p>Which orbit crm?</p>' })
  await manage({ action: 'poll', watch_id: watch.id })
  const failing = await manage({ action: 'get', watch_id: watch.id })
  assert.ok(failing.alerts.slack.last_error.at && failing.alerts.webhook.last_error.at, 'delivery failures are recorded with last_error')
  fake.state.fail.slack = fake.state.fail.webhook = false

  const before = (await findings(watch.id)).total
  fake.state.fail.hn = true
  await manage({ action: 'poll', watch_id: watch.id })
  const down = await manage({ action: 'get', watch_id: watch.id })
  assert.ok(down.last_error.at && down.last_error.status === 500, 'an API failure shows on the watch with its time'); assert.ok(down.next_poll_at)
  assert.equal((await findings(watch.id)).total, before, 'earlier findings stay'); fake.state.fail.hn = false

  const limited = await manage({ action: 'create', name: 'Ask and Show', terms: { all: ['orbit', 'crm'] }, sources: [{ kind: 'hn', story_types: ['ask_hn', 'show_hn'] }] })
  assert.ok((await findings(limited.id)).items.every(item => ['ask_hn', 'show_hn'].includes(item.kind)), 'story types narrow the source')
  const guarded = await manage({ action: 'create', name: 'Blocked first', terms: { all: ['orbit', 'crm'] }, sources: [] })
  await manage({ action: 'block_author', watch_id: guarded.id, author: '@BlockedBob' })
  await manage({ action: 'add_source', watch_id: guarded.id, source: { kind: 'hn' } })
  assert.ok(!(await findings(guarded.id)).items.some(item => item.author === 'blockedbob'), 'a blocked author never becomes a finding')
  await manage({ action: 'unblock_author', watch_id: guarded.id, author: 'blockedbob' })
  assert.ok(!(await findings(guarded.id)).items.some(item => item.author === 'blockedbob'), 'unblocking applies from the next poll')
  await manage({ action: 'poll', watch_id: guarded.id })
  assert.ok((await findings(guarded.id)).items.some(item => item.author === 'blockedbob'))
})

test('feeds, Bluesky and Mastodon become findings once, honour caching and rate limits, and refuse what is not a source', async () => {
  const F = 'https://feeds.example.test'
  const created = await app.action('owner', 'stump.watches.manage', { action: 'create', name: 'Feeds', terms: { all: ['orbit', 'crm'] },
    sources: ['blog', 'mirror', 'atom', 'alerts', 'podcast'].map(name => ({ kind: 'rss', url: `${F}/${name}.xml` })) })
  assert.equal(created.status, 200); const watch = created.body.result
  const items = (await app.action('owner', 'stump.findings.work', { action: 'list', watch_id: watch.id })).body.result.items
  const at = part => items.find(item => item.url.includes(part))
  assert.ok(at('orbit-crm-small-team') && at('atom-orbit-crm') && at('podcast.example.test/ep12') && !at('ep11') && !at('/release'), 'matching items arrive with title, link and author; others do not')
  assert.equal(items.filter(item => item.url.includes('orbit-crm-small-team')).length, 1, 'an item reached through two feeds is one finding')
  assert.ok(at('news.example.test/orbit-crm-review') && !items.some(item => item.url.includes('google.com')), 'a Google Alerts item links to the alerted page')
  assert.equal(at('ep12').transcript_url, `${F}/ep12.vtt`, 'a transcript match links the episode')
  assert.ok(items.every(item => !/[<>]|onerror|onclick/i.test(item.text + item.title)), 'markup in a feed item reaches no screen as HTML')
  assert.equal((await app.action('owner', 'stump.watches.manage', { action: 'poll', watch_id: watch.id })).body.result.added, 0)
  assert.ok(fake.state.conditional >= 4, 'an unchanged feed is fetched with its ETag and adds nothing')
  const reddit = await app.action('owner', 'stump.watches.manage', { action: 'add_source', watch_id: watch.id, source: { kind: 'rss', url: 'https://www.reddit.com/r/saas/.rss' } })
  assert.equal(reddit.body.code, 'reddit_not_a_source'); assert.match(reddit.body.reason, /licensed data supplier/)
  const total = (await app.action('owner', 'stump.findings.work', { action: 'list', watch_id: watch.id })).body.result.total
  fake.state.fail['malformed:/atom.xml'] = true
  await app.action('owner', 'stump.watches.manage', { action: 'poll', watch_id: watch.id })
  const broken = (await app.action('owner', 'stump.watches.manage', { action: 'get', watch_id: watch.id })).body.result
  assert.equal(broken.last_error.kind, 'parse', 'a malformed feed shows its error on the watch')
  assert.equal((await app.action('owner', 'stump.findings.work', { action: 'list', watch_id: watch.id })).body.result.total, total, 'earlier findings stay')

  const social = await app.action('owner', 'stump.watches.manage', { action: 'create', name: 'Social', terms: { any: ['crm'] },
    sources: [{ kind: 'bluesky' }, { kind: 'mastodon', instance: 'mastodon.social', hashtags: ['crm'] }, { kind: 'mastodon', instance: 'fosstodon.org', hashtags: ['crm'] }] })
  const posts = (await app.action('owner', 'stump.findings.work', { action: 'list', watch_id: social.body.result.id })).body.result.items
  assert.ok(posts.some(item => item.author === 'sara.bsky.example' && item.url === 'https://bsky.app/profile/sara.bsky.example/post/3kaaa'), 'a Bluesky post with handle and link')
  const toots = posts.filter(item => item.source === 'mastodon')
  assert.deepEqual(toots.map(item => item.author).sort(), [['oss_dev', 'fosstodon.org'], ['priya', 'mastodon.social']].map(account => account.join('@')), 'a Mastodon watch limited to two instances and one hashtag')
  assert.equal((await app.action('owner', 'stump.watches.manage', { action: 'poll', watch_id: social.body.result.id })).body.result.added, 0, 'repeated polls add no duplicates')
  fake.state.fail.bluesky_retry_after = 120
  const requests = fake.state.requests.length
  const first = await app.action('owner', 'stump.watches.manage', { action: 'poll', watch_id: social.body.result.id, source_key: 'bluesky' })
  const next = Date.parse((await app.action('owner', 'stump.watches.manage', { action: 'get', watch_id: social.body.result.id })).body.result.next_poll_at) - Date.now()
  assert.equal(first.body.result.sources[0].error.kind, 'rate_limited'); assert.ok(next > 100_000 && next < 130_000, 'the watch shows when it will poll next')
  await app.action('owner', 'stump.watches.manage', { action: 'poll', watch_id: social.body.result.id, source_key: 'bluesky' })
  assert.equal(fake.state.requests.length, requests + 1, 'a rate limit is honoured: no second request inside the window')
  fake.state.fail.bluesky_retry_after = 0

  const grown = await app.action('owner', 'stump.watches.manage', { action: 'create', name: 'Grown', terms: { all: ['orbit', 'crm'] }, sources: [{ kind: 'hn' }] })
  fake.state.requests.length = 0
  const added = await app.action('owner', 'stump.watches.manage', { action: 'add_source', watch_id: grown.body.result.id, source: { kind: 'bluesky' } })
  assert.ok(added.body.result.poll.added > 0 && fake.state.requests.every(request => request.startsWith('https://api.bsky.app')), 'adding a source backfills that source only')
  assert.equal((await app.action('owner', 'stump.watches.manage', { action: 'backfill', watch_id: grown.body.result.id })).body.result.added, 0, 'a second backfill adds no duplicates')
  const count = (await app.action('owner', 'stump.findings.work', { action: 'list', watch_id: grown.body.result.id })).body.result.total
  await app.action('owner', 'stump.watches.manage', { action: 'update', watch_id: grown.body.result.id, terms: { all: ['orbit', 'crm', 'recommendations'] } })
  assert.equal((await app.action('owner', 'stump.findings.work', { action: 'list', watch_id: grown.body.result.id })).body.result.total, count, 'changing a filter leaves earlier findings in place')
})
