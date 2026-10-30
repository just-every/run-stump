import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

let app
before(async () => { app = await stump() })
after(() => app?.stop())

const autonomous = { schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', rules: [{ id: 'all', class: '*', do: 'autonomous' }], spend: { none: true } }
const manage = (who, args) => app.action(who, 'stump.venues.manage', args)
const source = 'https://synthetic-stump-1.example/rules'

test('the register keeps one venue per place, and its rules decide the routes and its gates who can post', async () => {
  const owner = await app.owner()
  assert.equal((await app.json('owner', '/agents/api/policy', { document: autonomous }, 'PUT')).status, 200)
  const { token } = (await app.json('owner', '/app/api/agent-credentials', { name: 'Synthetic venue agent' })).body

  const subreddit = (await manage('owner', { action: 'create', kind: 'subreddit', name: 'r/synthetic1', url: 'https://www.reddit.com/r/synthetic1/', status: 'ready', priority: 'high' })).body.result
  assert.equal(subreddit.details.subreddit, 'r/synthetic1')
  const journalist = await app.mcp(token, 'stump.venues.manage', { action: 'create', kind: 'journalist', name: 'Synthetic Reporter', status: 'editorial', details: { publication: 'Synthetic Times', beat: 'clinics' } })
  assert.equal(journalist.result.structuredContent.details.publication, 'Synthetic Times')
  const newsletter = (await manage('owner', { action: 'create', kind: 'newsletter', name: 'Synthetic Weekly', url: 'https://synthetic-stump-2.example/news', status: 'editorial' })).body.result

  for (const [kind, extra, field] of [['slack', { workspace: 'Synthetic', channel: '#demos' }, 'channel'], ['podcast', { details: { host: 'Synthetic Host' }, guest_intake_url: 'https://synthetic-stump-podcast.example/guests', topics: ['clinics', 'scheduling'] }, 'topics'], ['directory', { details: { price_usd: 49 } }, 'price_usd']]) {
    const venue = (await manage('owner', { action: 'create', kind, name: `Synthetic ${kind}`, url: `https://synthetic-stump-${kind}.example/`, status: 'candidate', ...extra })).body.result
    assert.equal(venue.kind, kind); assert.ok(Object.hasOwn(venue.details, field) && venue.details[field] !== null, kind)
  }
  // What a person gives is kept or refused by name, never dropped.
  const unknown = await app.mcp(token, 'stump.venues.manage', { action: 'create', kind: 'podcast', name: 'Synthetic Show', url: 'https://synthetic-stump-show.example/', pitch_deck: 'x' })
  assert.deepEqual([unknown.error?.code, unknown.error?.field], ['invalid_arguments', 'pitch_deck'])
  const listed = (await manage('owner', { action: 'list', status: 'editorial' })).body.result
  assert.deepEqual(listed.items.map(venue => venue.name).sort(), ['Synthetic Reporter', 'Synthetic Weekly'])
  assert.equal(listed.total, listed.items.length)
  const same = await manage('owner', { action: 'create', kind: 'subreddit', name: 'Again', url: 'https://reddit.com/R/SYNTHETIC1?utm_source=x' })
  assert.equal(same.body.code, 'duplicate_venue'); assert.equal(same.body.venue_id, subreddit.id)

  await manage('owner', { action: 'exclude', venue_id: newsletter.id, reason: 'Not our readers.', alternative: 'The subreddit.' })
  assert.ok(!(await manage('owner', { action: 'list' })).body.result.items.some(venue => venue.id === newsletter.id))
  const proposed = await app.mcp(token, 'stump.venues.manage', { action: 'propose', url: 'https://synthetic-stump-2.example/news/' })
  assert.equal(proposed.error?.code, 'venue_excluded'); assert.equal(proposed.error?.alternative, 'The subreddit.')
  assert.equal((await manage('owner', { action: 'list', include_excluded: true })).body.result.total, 6)
  assert.equal((await manage('owner', { action: 'archive', venue_id: subreddit.id })).body.result.archived, true)
  assert.ok(!(await manage('owner', { action: 'list' })).body.result.items.some(venue => venue.id === subreddit.id))
  assert.equal((await manage('owner', { action: 'restore', venue_id: subreddit.id })).body.result.archived, false)
  const stale = await manage('owner', { action: 'update', venue_id: subreddit.id, expected_revision: subreddit.revision, why: 'stale' })
  assert.equal(stale.body.code, 'revision_conflict')

  // Members keep posting for themselves, and a rule with no source opens nothing.
  const rules = await app.action('owner', 'stump.venues.rules', { action: 'set', venue_id: subreddit.id, rules: {
    posting: { value: 'members_only', source_url: source, read_at: '2026-10-28' }, ai_text: { value: 'banned', source_url: source, read_at: '2026-10-28' },
    gates: { value: { karma: 100 }, source_url: source, read_at: '2026-10-28' } } })
  assert.deepEqual(rules.body.result.routes.routes, ['handoff_brief'])
  const unsourced = await app.mcp(token, 'stump.venues.rules', { action: 'set', venue_id: journalist.result.structuredContent.id, rules: { posting: { value: 'company_account' }, ai_text: { value: 'allowed' } } })
  assert.deepEqual(unsourced.result.structuredContent.routes.routes, ['handoff_brief'])
  const sourced = await app.mcp(token, 'stump.venues.rules', { action: 'set', venue_id: journalist.result.structuredContent.id, rules: { posting: { value: 'api', source_url: source, read_at: '2026-10-29' } } })
  assert.deepEqual(sourced.result.structuredContent.routes.routes, ['publish', 'handoff_brief'])

  const limit = await app.action('owner', 'stump.venues.fit', { action: 'set_limit', venue_id: subreddit.id, limit: { posts: 1, per: 'week' } })
  assert.deepEqual(limit.body.result.venue.shared_limit, { posts: 1, per: 'week', text: null })

  await app.action('owner', 'stump.venues.members', { action: 'add', venue_id: subreddit.id, person_id: owner.id, handle: 'u/synthetic-owner', joined_on: '2025-01-01', karma: 40 })
  const below = (await app.action('owner', 'stump.venues.members', { action: 'eligibility', venue_id: subreddit.id, person_id: owner.id })).body.result
  assert.equal(below.eligible, false); assert.deepEqual(below.unmet.map(gate => [gate.gate, gate.need]), [['karma', 100]])
  const email = app.email('poster')
  const poster = (await app.action('owner', 'stump.team.manage', { action: 'invite', email, display_name: 'Synthetic Poster', role: 'poster', connection: 'friend' })).body.result
  assert.equal(await app.signIn('poster', email), 303)
  const taken = await app.action('poster', 'stump.venues.members', { action: 'apply', venue_id: subreddit.id, person_id: poster.id, handle: 'U/Synthetic-Owner' })
  assert.equal(taken.body.code, 'handle_taken'); assert.equal(taken.body.person_id, owner.id)
  await app.action('owner', 'stump.venues.rules', { action: 'set', venue_id: subreddit.id, rules: { gates: { value: { approval: true }, source_url: source, read_at: '2026-10-29' } } })
  const applied = (await app.action('poster', 'stump.venues.members', { action: 'apply', venue_id: subreddit.id, handle: 'u/synthetic-poster' })).body.result.application
  assert.equal(applied.state, 'applied')
  assert.equal((await app.action('poster', 'stump.venues.members', { action: 'approve_application', application_id: applied.id })).body.code, 'forbidden')
  const approved = (await app.action('owner', 'stump.venues.members', { action: 'approve_application', application_id: applied.id })).body.result
  assert.equal(approved.application.state, 'approved'); assert.equal(approved.eligibility.eligible, true)
})

const run = createHash('sha256').update(String(process.pid)).digest('hex').slice(0, 6)
const list = (status = 'candidate') => `---
date: "2026-10-19"
---
## Synthwell

### reddit-s${run}-1 — r/s${run} weekly thread
- seed: Synthwell
- platform: Reddit
- status: ready
- priority: high
- post_type: comment
- human_written_required: true
- rules_urls: ["https://www.reddit.com/r/s${run}/wiki/rules"]
- evidence_urls: []
- sources: []
- seeds: []
- venue_id: reddit-s${run}

#### Draft

\`\`\`
Synthetic draft: recurring bookings for small clinics.
\`\`\`

## Venue directory

### reddit-s${run} — r/s${run}
- url: https://www.reddit.com/r/s${run}/
- platform: Reddit
- status: ready
- rules_urls: ["https://www.reddit.com/r/s${run}/wiki/rules"]
- shared_limit: One comment per weekly thread
- seeds: ["Synthwell"]

### forum-s${run} — Synthetic Builders ${run}
- url: https://forum-s${run}.example/
- status: ${status}
- seeds: ["Synthwell", "Ledgerly"]

### broken-s${run} — Broken
- url: not a url
- status: ready

## Not recommended

### Synthetic Spam ${run}
- url: https://spam-s${run}.example/
- reason: Bans self-promotion.
- alternative: The builders forum.
`
const csv = `venue_id,name,url,platform,status,shared_limit,seeds,human_written_required,rules_urls,reason,alternative,entry_id,product,draft
reddit-s${run},r/s${run},https://www.reddit.com/r/s${run}/,Reddit,ready,One comment per weekly thread,Synthwell,true,https://www.reddit.com/r/s${run}/wiki/rules,,,reddit-s${run}-1,Synthwell,"Synthetic draft: recurring bookings for small clinics."
forum-s${run},Synthetic Builders ${run},https://forum-s${run}.example/,,candidate,,Synthwell;Ledgerly,false,,,,,,
broken-s${run},Broken,not a url,,ready,,,false,,,,,,
,Synthetic Spam ${run},https://spam-s${run}.example/,,,,,false,,Bans self-promotion.,The builders forum.,,,
`

async function door(verb, source, body) {
  const response = await app.request('owner', `/api/operator/import/${verb}?source=${source}`, { method: 'POST', body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
async function plan(source, text) {
  const bytes = Buffer.from(text), sha = value => createHash('sha256').update(value).digest('hex')
  const upload = await door('uploads', source, { name: `synthetic.${source === 'venues-csv' ? 'csv' : 'md'}`, bundleSha256: sha(bytes), totalBytes: bytes.length, totalChunks: 1, index: 0, chunkSha256: sha(bytes), base64: bytes.toString('base64') })
  assert.equal(upload.status, 200, JSON.stringify(upload.body))
  return door('plan', source, { uploadId: upload.body.uploadId })
}
async function apply(source, planned) {
  for (let round = 0; round < 50; round++) {
    const answer = await door('apply', source, { planId: planned.planId, reviewedFingerprint: planned.fingerprint })
    assert.equal(answer.status, 200, JSON.stringify(answer.body))
    if (answer.body.job.state === 'completed') return answer.body.job
  }
  assert.fail('the import did not complete')
}
const ours = async () => (await manage('owner', { action: 'list', include_excluded: true, q: run })).body.result.items

test('a venue list imports from Markdown and CSV: a dry run, apply, a rerun that changes nothing, a named conflict and Undo', async () => {
  await app.owner()
  const first = await plan('outreach-md', list())
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.deepEqual([first.body.summary.venues, first.body.summary.entries, first.body.summary.excluded], [2, 1, 1])
  assert.equal(first.body.rejected.length, 1); assert.match(first.body.rejected[0].reason, /broken-s/)
  assert.equal((await ours()).length, 0, 'a dry run writes nothing')
  const elsewhere = await app.request('owner', '/api/operator/import/plan?source=outreach-md', { method: 'POST', body: '{}', headers: { origin: 'https://elsewhere.example' } })
  assert.equal(elsewhere.status, 403)
  await apply('outreach-md', first.body)

  const venues = await ours(), reddit = venues.find(venue => venue.name === `r/s${run}`), forum = venues.find(venue => venue.kind === 'forum' && venue.status !== 'excluded')
  const spam = venues.find(venue => venue.status === 'excluded')
  assert.equal(reddit.rules.ai_text.value, 'banned'); assert.equal(reddit.rules.ai_text.sourced, true)
  assert.deepEqual([reddit.shared_limit.posts, reddit.shared_limit.per], [1, 'week'])
  assert.deepEqual(spam.excluded, { reason: 'Bans self-promotion.', alternative: 'The builders forum.' })
  const items = (await manage('owner', { action: 'get', venue_id: reddit.id })).body.result.items
  assert.equal(items.length, 1); assert.equal(items[0].state, 'draft'); assert.equal(items[0].product_id, reddit.products[0].product_id)
  // A shared venue: one record, read the same from both products.
  assert.equal(forum.products.length, 2)
  await manage('owner', { action: 'update', venue_id: forum.id, audience: 'Synthetic builders' })
  for (const product of forum.products) {
    const seen = (await manage('owner', { action: 'list', product_id: product.product_id, q: `forum-s${run}` })).body.result.items
    assert.deepEqual(seen.map(venue => [venue.id, venue.audience]), [[forum.id, 'Synthetic builders']])
  }
  // A rule that keeps self-promotion to its thread holds the draft aimed outside it, and the change is in its history.
  await app.action('owner', 'stump.venues.rules', { action: 'set', venue_id: reddit.id, rules: { self_promotion: { value: 'thread', source_url: source, read_at: '2026-10-29' } } })
  const held = (await manage('owner', { action: 'get', venue_id: reddit.id })).body.result.items[0]
  assert.equal(held.state, 'held'); assert.equal(held.hold.rule, 'self_promotion'); assert.ok(held.history.length >= 2)

  // The same file again is the applied import itself: applying it changes nothing.
  const rerun = await plan('outreach-md', list())
  assert.deepEqual([rerun.body.summary.created, rerun.body.summary.updated, rerun.body.planId, rerun.body.applied], [0, 0, first.body.planId, true])
  await apply('outreach-md', rerun.body)
  // A changed row names its fields; the venue edited here is a conflict and keeps its edit.
  const changed = await plan('outreach-md', list('ready'))
  const conflict = changed.body.changes.find(change => change.id === forum.id)
  assert.ok(conflict?.conflict, JSON.stringify(changed.body.changes))
  assert.ok(conflict.fields.some(field => field.field === 'status' && field.before === 'candidate' && field.after === 'ready'), JSON.stringify(conflict))
  await apply('outreach-md', changed.body)
  assert.equal((await manage('owner', { action: 'get', venue_id: forum.id })).body.result.status, 'candidate', 'the edited venue keeps its edit')

  const under = await door('undo', 'outreach-md', { planId: first.body.planId })
  assert.deepEqual([under.status, under.body.error, under.body.details?.planId], [409, 'import_superseded', changed.body.planId])
  assert.equal((await door('undo', 'outreach-md', { planId: changed.body.planId })).status, 200)
  const undone = await door('undo', 'outreach-md', { planId: first.body.planId })
  assert.equal(undone.body.job.state, 'undone')
  const kept = undone.body.kept.filter(item => item.kind === 'venue').map(item => item.id).sort()
  assert.deepEqual((await ours()).map(venue => venue.id).sort(), kept)
  assert.ok(kept.includes(forum.id) && kept.includes(reddit.id) && !kept.includes(spam.id))
  // The same list again after that Undo: what it kept stays as it is, and the rest comes back.
  const again = await plan('outreach-md', list('ready'))
  assert.equal(again.status, 200, JSON.stringify(again.body))
  await apply('outreach-md', again.body)
  const back = await ours()
  assert.deepEqual(back.filter(venue => kept.includes(venue.id)).map(venue => venue.status).sort(), ['candidate', 'ready'])
  assert.ok(back.some(venue => venue.status === 'excluded' && venue.name === spam.name))
  assert.deepEqual((await manage('owner', { action: 'get', venue_id: reddit.id })).body.result.items.map(item => [item.id, item.state]), [[held.id, 'held']])
  assert.equal((await door('undo', 'outreach-md', { planId: again.body.planId })).body.job.state, 'undone')

  const fromCsv = await plan('venues-csv', csv)
  assert.deepEqual([fromCsv.body.summary.venues, fromCsv.body.summary.entries, fromCsv.body.summary.excluded], [2, 1, 1])
  await apply('venues-csv', fromCsv.body)
  assert.deepEqual((await ours()).map(venue => [venue.name, venue.kind, venue.status]).sort(), venues.map(venue => [venue.name, venue.kind, venue.status]).sort())
})
