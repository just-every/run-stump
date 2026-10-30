import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// The company's AI provider and Bluesky's public AppView, faked at the network
// edge in their published shapes; every request is kept so the test can see that
// none reached Reddit. Everything else runs through Stump's own doors.
const AI = 'https://ai.synthetic-stump.example'
const seen = []
const posts = new Map()
async function edge(request) {
  seen.push(request.url)
  if (request.url === `${AI}/v1/chat/completions`) {
    const body = await request.json(), brief = JSON.parse(body.messages.at(-1).content)
    const content = JSON.stringify({ text: `Recurring bookings landed in ${brief.product?.name ?? 'Brightwell'} 3.2. https://brightwell.example/changelog/3-2` })
    return Response.json({ object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content } }], usage: { prompt_tokens: 90, completion_tokens: 20 } })
  }
  const url = new URL(request.url)
  if (url.origin === 'https://public.api.bsky.app' && url.pathname === '/xrpc/app.bsky.feed.getPostThread') {
    const post = posts.get(url.searchParams.get('uri'))
    return post ? Response.json({ thread: { $type: 'app.bsky.feed.defs#threadViewPost', post } }) : Response.json({ error: 'NotFound', message: 'Post not found' }, { status: 400 })
  }
  return null
}

let app
before(async () => { app = await stump({ bindings: { AI_ENABLED: 'true', AI_BASE_URL: `${AI}/v1`, AI_API_KEY: `synthetic-stump-${Date.now()}`, AI_MODEL: 'synthetic-stump-model' }, edge }) })
after(() => app?.stop())

const autonomous = { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', rules: [{ id: 'all', class: '*', do: 'autonomous' }], spend: { none: true } }
const ok = answer => { assert.equal(answer.status, 200, JSON.stringify(answer.body)); return answer.body.result }
const sourced = value => ({ value, source_url: 'https://synthetic-stump-1.example/rules', read_at: '2026-10-28' })
const DAY = 86_400_000
const week = n => { const now = new Date(), monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ((now.getUTCDay() + 6) % 7) * DAY; return monday + n * 7 * DAY }

/** The owner, people who post by hand, a product with a claim, and the company's link rules. */
async function team(labels) {
  const owner = await app.owner()
  ok(await app.action('owner', 'stump.team.manage', { action: 'update', person_id: owner.id, connection: 'founder' }))
  const people = {}
  for (const [label, name, connection] of labels) {
    const email = app.email(label)
    people[label] = ok(await app.action('owner', 'stump.team.manage', { action: 'invite', email, display_name: name, role: 'poster', connection }))
    assert.equal(await app.signIn(label, email), 303)
  }
  const product = ok(await app.action('owner', 'stump.brand.manage', { action: 'product_create', name: `Brightwell ${labels[0][0]}`, tone: 'plain' }))
  const claim = ok(await app.action('owner', 'stump.brand.manage', { action: 'claim_create', product_id: product.id, owner_id: owner.id, text: 'Recurring bookings in 3.2', kind: 'allowed', proof: { url: 'https://brightwell.example/changelog/3-2' }, review_on: '2099-01-01' }))
  ok(await app.action('owner', 'stump.links.manage', { action: 'set_rules', own_domains: ['brightwell.example'], mediums: { published: 'social', handoff: 'community' } }))
  return { owner, people, product, claim }
}
async function venue(fields, rules, members = [], limit = null) {
  const made = ok(await app.action('owner', 'stump.venues.manage', { action: 'create', status: 'ready', ...fields }))
  ok(await app.action('owner', 'stump.venues.rules', { action: 'set', venue_id: made.id, rules }))
  if (limit) ok(await app.action('owner', 'stump.venues.fit', { action: 'set_limit', venue_id: made.id, limit }))
  for (const [person, handle] of members) ok(await app.action('owner', 'stump.venues.members', { action: 'add', venue_id: made.id, person_id: person.id, handle, joined_on: '2024-01-15', karma: 500 }))
  return made
}

test('a member gets a brief and a draft for a venue that keeps posting for its members, and the link they post is checked onto the ledger', async () => {
  const { people: { maya, priya }, product, claim } = await team([['maya', 'Maya Chen', 'employee'], ['priya', 'Priya Nair', 'friend']])
  assert.equal((await app.json('owner', '/agents/api/policy', { document: autonomous }, 'PUT')).status, 200)
  const { token } = (await app.json('owner', '/app/api/agent-credentials', { name: 'Wren' })).body
  const thread = 'https://www.reddit.com/r/synthetic1/comments/abc123/weekly_thread/'
  const subreddit = await venue({ kind: 'subreddit', name: 'r/synthetic1', url: 'https://www.reddit.com/r/synthetic1/', platform: 'reddit' },
    { posting: sourced('members_only'), ai_text: sourced('allowed_with_disclosure'), self_promotion: { ...sourced('thread'), thread_url: thread } }, [[maya, 'maya_bw'], [priya, 'priya_n']], { posts: 1, per: 'week' })
  const noAi = await venue({ kind: 'forum', name: 'Synthetic makers', url: 'https://synthetic-stump-makers.example/' }, { posting: sourced('members_only'), ai_text: sourced('banned'), gates: sourced({ approval: true }) })
  const bluesky = await venue({ kind: 'forum', name: 'Synthetic builders on Bluesky', url: 'https://bsky.app/profile/synthetic-builders.bsky.social', platform: 'bluesky' }, { posting: sourced('members_only'), ai_text: sourced('allowed') }, [[maya, 'maya.synthetic.bsky.social']])
  const prepare = (who, args) => app.action(who, 'stump.handoffs.prepare', { action: 'prepare', product_id: product.id, lapse: 'expire', ...args })

  // The agent prepares Maya's draft in her voice, with the facts, her disclosure and the venue's rules; the class is gated with "a member posts".
  const drafted = await app.mcp(token, 'stump.handoffs.prepare', { action: 'prepare', venue_id: subreddit.id, person_id: maya.id, product_id: product.id, thread_url: thread, due_at: new Date(week(1) + 3 * DAY).toISOString(), lapse: 'expire', generate: true, campaign: 'launch' })
  const handoff = drafted.result.structuredContent
  assert.equal(handoff.state, 'open'); assert.equal(handoff.route, 'handoff_draft')
  assert.ok(handoff.draft_text.startsWith(handoff.disclosure_line), handoff.draft_text)
  assert.match(handoff.draft_text, /brightwell\.example\/changelog\/3-2\?[^ ]*utm_medium=community/)
  assert.deepEqual(handoff.facts.map(fact => fact.claim_id), [claim.id])
  assert.ok(drafted.result._meta['com.runeditrun/decision'].classes.some(item => item.class === 'gated' && item.facts.step === 'a member posts' && item.facts.provider === 'r/synthetic1'))

  // Where AI text is banned: no AI call, talking points and facts, and someone not yet a member joins first.
  const asked = seen.length
  assert.equal((await prepare('owner', { venue_id: noAi.id, person_id: maya.id, due_at: new Date(week(1)).toISOString(), generate: true })).body.code, 'act_refused')
  assert.ok(!seen.slice(asked).some(url => url.startsWith(AI)))
  const brief = ok(await prepare('owner', { venue_id: noAi.id, person_id: maya.id, due_at: new Date(week(1)).toISOString() }))
  assert.equal(brief.state, 'join_first'); assert.equal(brief.draft_text, null); assert.ok(brief.talking_points.length && brief.join_steps.length && brief.own_words_required)
  // A friend recommending the product gets talking points only and must attest; the venue's shared limit counts across people and products.
  const friend = ok(await prepare('owner', { venue_id: subreddit.id, person_id: priya.id, thread_url: thread, due_at: new Date(week(2) + 2 * DAY).toISOString(), recommends: true }))
  assert.equal(friend.attestation_required, true); assert.equal(friend.draft_text, null)
  const full = await prepare('owner', { venue_id: subreddit.id, person_id: priya.id, thread_url: thread, due_at: new Date(week(1) + 4 * DAY).toISOString() })
  assert.equal(full.body.code, 'shared_limit'); assert.equal(full.body.venue_id, subreddit.id)
  // Skipping records the reason and frees the place.
  const spare = ok(await prepare('owner', { venue_id: subreddit.id, person_id: maya.id, thread_url: thread, due_at: new Date(week(3) + DAY).toISOString() }))
  assert.equal((await prepare('owner', { venue_id: subreddit.id, person_id: priya.id, thread_url: thread, due_at: new Date(week(3) + 2 * DAY).toISOString() })).body.code, 'shared_limit')
  assert.equal(ok(await app.action('maya', 'stump.handoffs.manage', { action: 'skip', handoff_id: spare.id, reason: 'Nothing new that week.' })).history.at(-1).detail.reason, 'Nothing new that week.')
  ok(await prepare('owner', { venue_id: subreddit.id, person_id: priya.id, thread_url: thread, due_at: new Date(week(3) + 2 * DAY).toISOString() }))

  // Maya's queue holds only her own, by due date; the disclosure cannot be edited out of her draft.
  const queue = ok(await app.action('maya', 'stump.handoffs.manage', { action: 'queue' })).items.filter(item => item.state !== 'skipped')
  assert.ok(queue.every(item => item.person_id === maya.id) && queue.every((item, index) => index === 0 || item.due_at >= queue[index - 1].due_at), JSON.stringify(queue.map(item => item.due_at)))
  const edited = await app.action('maya', 'stump.handoffs.manage', { action: 'edit', handoff_id: handoff.id, draft_text: 'Recurring bookings landed in Brightwell maya 3.2.' })
  assert.deepEqual([edited.body.code, edited.body.rule], ['disclosure_required', 'D-2'])

  // Only Maya records, with a link in the venue; Reddit is confirmed by her, with no request to reddit.com.
  const record = (who, args) => app.action(who, 'stump.handoffs.check_link', { action: 'record', ...args })
  assert.equal((await record('maya', { handoff_id: handoff.id, url: 'https://www.reddit.com/r/other/comments/zz/post/' })).body.code, 'link_not_on_venue')
  assert.equal((await record('owner', { handoff_id: handoff.id, url: `${thread}c1/` })).body.code, 'forbidden')
  const before = seen.length
  const posted = ok(await record('maya', { handoff_id: handoff.id, url: `${thread}c1/` }))
  assert.deepEqual([posted.state, posted.confirmation], ['posted', 'person'])
  assert.ok(!seen.slice(before).some(url => /reddit\.com/.test(url)))
  const entry = ok(await app.action('owner', 'stump.ledger.search', { action: 'get', entry_id: posted.ledger_id })).entry
  assert.deepEqual([entry.route, entry.person_id, entry.venue_id, entry.by], ['handed_off', maya.id, subreddit.id, 'Wren for Maya Chen'])
  assert.match(entry.text, /utm_source=reddit/)
  assert.equal(ok(await record('maya', { handoff_id: handoff.id, url: `${thread}c1/` })).ledger_id, posted.ledger_id)
  assert.equal((await record('maya', { handoff_id: handoff.id, url: `${thread}c2/` })).body.code, 'link_conflict')

  // The friend attests herself; her agent cannot.
  const priyaAgent = (await app.json('priya', '/app/api/agent-credentials', { name: 'Priya agent' })).body.token
  assert.equal((await app.mcp(priyaAgent, 'stump.handoffs.check_link', { action: 'record', handoff_id: friend.id, url: `${thread}c3/` })).error?.rule, 'D-8')
  assert.equal((await record('priya', { handoff_id: friend.id, url: `${thread}c3/`, own_words: 'Disclosure: I am a friend of the team. It saved our desk an hour a day.' })).body.code, 'attestation_required')
  assert.equal(ok(await record('priya', { handoff_id: friend.id, url: `${thread}c3/`, own_words: 'Disclosure: I am a friend of the team. It saved our desk an hour a day.', attest_own_words: true })).state, 'posted')

  // Bluesky is read back from the AppView: its author must be Maya's handle, and the ledger keeps the text as posted.
  const sky = ok(await prepare('owner', { venue_id: bluesky.id, person_id: maya.id, due_at: new Date(week(1)).toISOString(), generate: true }))
  posts.set('at://someone.bsky.social/app.bsky.feed.post/3kaa', { uri: 'at://did:plc:someone/app.bsky.feed.post/3kaa', author: { did: 'did:plc:someone', handle: 'someone.bsky.social' }, record: { text: 'Not Maya.', createdAt: new Date().toISOString() } })
  assert.equal((await record('maya', { handoff_id: sky.id, url: 'https://bsky.app/profile/someone.bsky.social/post/3kaa' })).body.code, 'author_mismatch')
  posts.set('at://maya.synthetic.bsky.social/app.bsky.feed.post/3kbb', { uri: 'at://did:plc:maya/app.bsky.feed.post/3kbb', author: { did: 'did:plc:maya', handle: 'maya.synthetic.bsky.social' }, record: { text: 'I work at Brightwell. Recurring bookings are here.', createdAt: new Date().toISOString() } })
  const checked = ok(await record('maya', { handoff_id: sky.id, url: 'https://bsky.app/profile/maya.synthetic.bsky.social/post/3kbb' }))
  assert.equal(checked.confirmation, 'network')
  assert.equal(ok(await app.action('owner', 'stump.ledger.search', { action: 'get', entry_id: checked.ledger_id })).entry.text, 'I work at Brightwell. Recurring bookings are here.')
})

test('a hand-off never waits in silence: a hold returns at its review date, a rule change holds it, and removing a person moves it on', async () => {
  const { people: { jo, sam }, product } = await team([['jo', 'Jo Park', 'employee'], ['sam', 'Sam Ortiz', 'employee']])
  const slack = await venue({ kind: 'slack', name: 'Synthetic ops Slack', url: 'https://synthetic-ops.slack.com/', platform: 'slack' }, { posting: sourced('members_only'), ai_text: sourced('allowed') }, [[jo, 'jo-p'], [sam, 'sam-o']])
  const prepare = async (person, due) => ok(await app.action('owner', 'stump.handoffs.prepare', { action: 'prepare', venue_id: slack.id, person_id: person.id, product_id: product.id, due_at: new Date(due).toISOString(), lapse: 'expire', generate: true }))
  const first = await prepare(jo, week(2)), second = await prepare(jo, week(2) + DAY)

  // Jo holds one until a review date; when it comes, the hand-off is back in the queue with the hold in its history.
  const held = ok(await app.action('jo', 'stump.handoffs.manage', { action: 'hold', handoff_id: first.id, reason: 'After the release.', review_at: new Date(Date.now() + 1500).toISOString() }))
  assert.deepEqual([held.state, held.hold.by, held.hold.reason], ['held', jo.id, 'After the release.'])
  await new Promise(resolve => setTimeout(resolve, 2000))
  const back = ok(await app.action('jo', 'stump.handoffs.manage', { action: 'get', handoff_id: first.id }))
  assert.deepEqual([back.state, back.history.at(-1).action], ['open', 'review_date'])

  // A rule change that forbids the draft holds it, naming the rule; changing it back releases it.
  ok(await app.action('owner', 'stump.venues.rules', { action: 'set', venue_id: slack.id, rules: { ai_text: sourced('banned') } }))
  const ruled = ok(await app.action('jo', 'stump.handoffs.manage', { action: 'get', handoff_id: second.id }))
  assert.deepEqual([ruled.state, ruled.hold.rule], ['held', 'ai_text'])
  assert.equal((await app.action('jo', 'stump.handoffs.manage', { action: 'release', handoff_id: second.id })).body.code, 'rule_hold')
  ok(await app.action('owner', 'stump.venues.rules', { action: 'set', venue_id: slack.id, rules: { ai_text: sourced('allowed') } }))
  assert.equal(ok(await app.action('jo', 'stump.handoffs.manage', { action: 'get', handoff_id: second.id })).state, 'open')

  // Removing Jo answers both: each moves to Sam, the venue's other member, with its history, and none is lost.
  const removed = ok(await app.action('owner', 'stump.team.manage', { action: 'remove', person_id: jo.id }))
  assert.deepEqual(removed.handoffs_answered.map(item => [item.handoff_id, item.outcome, item.person_id]).sort(), [[first.id, 'reassigned', sam.id], [second.id, 'reassigned', sam.id]].sort())
  const queue = ok(await app.action('sam', 'stump.handoffs.manage', { action: 'queue' }))
  assert.deepEqual(queue.items.map(item => item.id).sort(), [first.id, second.id].sort())
  assert.ok(queue.items.every(item => item.history.at(-1).action === 'person_removed' && item.history.at(-1).detail.from_person_id === jo.id))
})
