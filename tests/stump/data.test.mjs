import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// Switching from Buffer through the import door, and erasing an engager. The network edge answers
// Hacker News search (Algolia's published shape) with stories by the engager and by someone else.
const at = (day, hour) => Math.floor(Date.UTC(2026, 9, day, hour) / 1000)
const next = Math.floor(Date.now() / 1000) + 30 * 86_400
async function outbound(request) {
  const url = new URL(request.url)
  if (url.origin !== 'https://hn.algolia.com') return null
  const hit = (id, author) => ({ objectID: String(id), author, title: `Synthwell recurring bookings ${id}`, url: `https://example.test/hn/${id}`, points: 3, num_comments: 0,
    story_text: '<p>synthwell recurring bookings</p>', comment_text: null, story_id: null, story_title: null, story_url: null, created_at_i: Math.floor(Date.now() / 1000) - 600, _tags: ['story'] })
  return Response.json({ hits: [hit(1, 'synthetic-alice'), hit(2, 'synthetic-bob')], nbHits: 2, page: 0, nbPages: 1, hitsPerPage: 1000 })
}

let app
before(async () => { app = await stump({ edge: outbound }) })
after(() => app?.stop())

const bundle = {
  format: 'buffer-api-v1',
  profiles: [{ id: 'p-x', service: 'twitter', service_username: 'synthwellhq', timezone: 'America/New_York', schedules: [{ days: ['mon', 'wed'], times: ['09:00'] }] },
    { id: 'p-f', service: 'facebook', service_username: 'Synthwell', timezone: 'America/New_York' }],
  updates: {
    'p-x': {
      sent: { total: 2, updates: [
        { id: 'xs1', status: 'sent', text: 'Recurring bookings are live. Thanks @synthetic-alice for the idea.', sent_at: at(20, 15), service_update_id: '185000000000001', statistics: { favorites: 12, retweets: 3 } },
        { id: 'xs2', status: 'sent', text: 'Calendar sync handles daylight saving now.', sent_at: at(21, 15), service_update_id: '185000000000002' }] },
      pending: [{ id: 'xq1', status: 'buffer', text: 'Waitlists for cancelled slots are coming.', due_at: next },
        { id: 'xq2', status: 'buffer', text: 'Reminder texts now go out in the patient\'s own time zone.', due_at: next + 86_400 }],
    },
    'p-f': { sent: [{ id: 'fs1', status: 'sent', text: 'A Facebook post.', sent_at: at(19, 12) }] },
  },
}

async function door(verb, body) {
  const response = await app.request('owner', `/api/operator/import/${verb}?source=buffer`, { method: 'POST', body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
async function plan(text) {
  const bytes = Buffer.from(text), sha = value => createHash('sha256').update(value).digest('hex')
  const upload = await door('uploads', { name: 'buffer.json', bundleSha256: sha(bytes), totalBytes: bytes.length, totalChunks: 1, index: 0, chunkSha256: sha(bytes), base64: bytes.toString('base64') })
  assert.equal(upload.status, 200, JSON.stringify(upload.body))
  return door('plan', { uploadId: upload.body.uploadId })
}
async function until(verb, planned, done) {
  for (let round = 0; round < 50; round++) {
    const answer = await door(verb, { planId: planned.planId, ...(verb === 'apply' ? { reviewedFingerprint: planned.fingerprint } : {}) })
    assert.equal(answer.status, 200, JSON.stringify(answer.body))
    if (done.includes(answer.body.job.state)) return answer.body
  }
  assert.fail(`${verb} did not finish`)
}
const act = async (tool, args) => { const answer = await app.action('owner', tool, args); assert.equal(answer.status, 200, JSON.stringify(answer.body)); return answer.body.result }

test('switching from Buffer: a dry run, sent posts to the ledger, schedules to slots, queued posts paused until released, a rerun that changes nothing, and an Undo that keeps only edits', async () => {
  await app.owner()
  const first = await plan(JSON.stringify(bundle))
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.deepEqual([first.body.summary.channels, first.body.summary.sent, first.body.summary.queued], [1, 2, 2])
  assert.ok(first.body.rejected.some(row => /facebook/.test(row.reason)), 'a channel Stump does not publish to is refused by name')
  assert.equal((await act('stump.ledger.search', { action: 'search' })).total, 0, 'a dry run writes nothing')
  await until('apply', first.body, ['completed'])

  const [account] = (await act('stump.accounts.connect', { action: 'list', include_unconnected: true })).items
  assert.deepEqual([account.network, account.handle, account.owner.kind, account.state, account.connected_at], ['x', 'synthwellhq', 'company', 'expired', null])
  assert.deepEqual((await act('stump.calendar.plan', { action: 'slots', account_id: account.id })).slots, [{ days: ['mon'], times: ['09:00'] }, { days: ['wed'], times: ['09:00'] }])
  const entries = (await act('stump.ledger.search', { action: 'search' })).items
  assert.equal(entries.length, 2)
  const thanked = entries.find(entry => entry.network_id === '185000000000001')
  assert.deepEqual([thanked.route, thanked.state, thanked.confirmation, thanked.results.values.favorites], ['published', 'posted', 'network', 12])
  const [queued] = (await act('stump.drafts.revise', { action: 'list', q: 'Waitlists' })).items
  assert.deepEqual([queued.state, queued.account_id, Date.parse(queued.scheduled_at)], ['paused', account.id, next * 1000])

  const unconfirmed = await app.action('owner', 'stump.calendar.plan', { action: 'release_import', item_ids: [queued.id], confirm_source_cleared: false })
  assert.ok(unconfirmed.status >= 400)
  assert.deepEqual((await act('stump.calendar.plan', { action: 'release_import', item_ids: [queued.id], confirm_source_cleared: true })).released, [queued.id])
  assert.equal((await act('stump.drafts.revise', { action: 'get', item_id: queued.id })).state, 'scheduled')

  // The import's own release is not an edit: a rerun of the same file still changes nothing.
  const again = await plan(JSON.stringify(bundle))
  for (const kind of ['additions', 'replacements', 'conflicts']) assert.equal(again.body.differences[kind].length, 0, kind)
  assert.equal(again.body.changes.length, 0)

  const [reminder] = (await act('stump.drafts.revise', { action: 'list', q: 'Reminder texts' })).items
  await act('stump.drafts.revise', { action: 'save', item_id: reminder.id, text: 'Reminder texts now follow each patient\'s own time zone.' })

  const undone = await until('undo', again.body, ['undone'])
  assert.deepEqual(undone.kept.map(kept => `${kept.kind}:${kept.id}:${kept.reason}`).sort(), [`account:${account.id}:in_use`, `item:${reminder.id}:edited`], 'Undo keeps the edited post and the account it needs')
  assert.deepEqual((await act('stump.drafts.revise', { action: 'list', q: 'Waitlists' })).items, [], 'Undo removes the released post that has not gone out')
  assert.equal((await act('stump.ledger.search', { action: 'search' })).total, 0)
  assert.deepEqual((await act('stump.calendar.plan', { action: 'slots', account_id: account.id })).slots, [])
})

test('erasing a person: an engager leaves findings, the inbox and offers, a journalist their record and route while pitches keep an anonymised reference, each company post naming them is asked to be deleted, and a legal hold keeps its entry', async () => {
  const owner = await app.owner()
  const watch = await act('stump.watches.manage', { action: 'create', name: 'Synthwell', terms: { any: ['synthwell'] }, sources: [{ kind: 'hn' }] })
  const findings = async () => (await act('stump.findings.work', { action: 'list', watch_id: watch.id })).items.map(finding => finding.author).sort()
  assert.deepEqual(await findings(), ['synthetic-alice', 'synthetic-bob'])
  // The engager offer the inbox writes (migration 0500).
  await app.db.prepare(`INSERT INTO stump_stack_offers(id,seed,kind,network,handle,post_url,occurred_at,created_at) VALUES('o1','orbit','engager','x','synthetic-alice','https://x.com/synthetic-alice/status/9',1,1)`).run()
  // What the inbox read from the company's X account: the engager's mention, and someone else's.
  for (const [id, handle] of [['i1', 'Synthetic-Alice'], ['i2', 'synthetic-bob']]) await app.db.prepare(`INSERT INTO stump_inbox_items(id,account_id,network,network_id,kind,url,text,author_handle,engaged_first,offer_id,received_at)
    VALUES(?,'a1','x',?,'mention',?,'@synthwellhq thanks',?,1,?,1)`).bind(id, id, `https://x.com/${handle}/status/${id}`, handle, id === 'i1' ? 'o1' : null).run()
  // A different person with the same name on Bluesky.
  await app.db.prepare(`INSERT INTO stump_stack_offers(id,seed,kind,network,handle,post_url,occurred_at,created_at) VALUES('o2','orbit','engager','bluesky','synthetic-alice','https://bsky.app/profile/synthetic-alice/post/9',1,1)`).run()
  await plan(JSON.stringify({ format: 'buffer-api-v1', profiles: [{ id: 'p-m', service: 'mastodon', service_username: 'synthwell', timezone: 'UTC' }],
    updates: { 'p-m': { sent: [{ id: 'ms1', status: 'sent', text: '@synthetic-alice asked, we answered.', sent_at: at(22, 9), service_update_id: '77', service_link: 'https://mastodon.example/@synthwell/77' },
      { id: 'ms2', status: 'sent', text: 'cc @synthetic-alice@mastodon.example on exports.', sent_at: at(23, 9), service_update_id: '78', service_link: 'https://mastodon.example/@synthwell/78' }] } } }))
    .then(planned => until('apply', planned.body, ['completed']))
  const naming = (await act('stump.ledger.search', { action: 'search', q: 'synthetic-alice' })).items
  assert.equal(naming.length, 2)
  const held = naming.find(entry => entry.text.startsWith('@synthetic-alice asked'))
  await act('stump.ledger.correct', { action: 'legal_hold', entry_id: held.id, reason: 'Dispute on file' })

  const erased = await act('stump.data.erase', { action: 'erase', subject: { kind: 'engager', handles: { hn: 'synthetic-alice', x: '@synthetic-alice', mastodon: 'synthetic-alice@mastodon.example' } } })
  assert.deepEqual(erased.deletion_requests.map(request => request.ledger_id).sort(), naming.map(entry => entry.id).sort())
  assert.ok(erased.deletion_requests.every(request => request.network && request.outcome))
  assert.equal(erased.deletion_requests.find(request => request.ledger_id === held.id).outcome, 'kept')
  assert.deepEqual(await findings(), ['synthetic-bob'])
  assert.deepEqual((await act('stump.stack.send', { action: 'offers' })).items.map(offer => offer.id), ['o2'], 'each handle is matched on its own network only')
  assert.deepEqual([(await app.db.prepare('SELECT id FROM stump_inbox_items ORDER BY id').all()).results.map(row => row.id), erased.removed.inbox_items], [['i2'], 1], 'the engager leaves the inbox')
  const kept = await act('stump.ledger.search', { action: 'get', entry_id: held.id })
  assert.deepEqual([kept.text, kept.legal_hold.reason], [held.text, 'Dispute on file'])

  const contact = await act('stump.press.contacts', { action: 'create', kind: 'journalist', name: 'Jordan Reed', contact_route: { kind: 'email', value: 'synthetic-stump-reporter@example.com', source_url: 'https://example.com/staff', read_at: '2026-10-30' } })
  const pitch = await act('stump.drafts.write', { action: 'create', format: 'pitch', person_id: owner.id, recipient: { contact_id: contact.id }, subject: 'For Jordan Reed', text: 'Hi Jordan Reed, recurring bookings shipped today.' })
  const journalist = await act('stump.data.erase', { action: 'erase', subject: { kind: 'journalist', contact_id: contact.id } })
  assert.equal(journalist.removed.press_contacts, 1)
  assert.equal((await app.action('owner', 'stump.press.contacts', { action: 'get', contact_id: contact.id })).body.code, 'not_found')
  const anonymised = await act('stump.drafts.revise', { action: 'get', item_id: pitch.id })
  assert.match(anonymised.recipient.erased, /^erasure:/)
  assert.ok(!JSON.stringify(anonymised).includes('Jordan Reed'), 'the pitch keeps no trace of the name')
})
