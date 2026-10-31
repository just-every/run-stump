import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// The company's own site at the network edge, for setup's URL-first prefill, and a page that moved to a private address.
const SITE = 'https://synthetic-stump-1.example/', MOVED = 'https://synthetic-stump-3.example/moved'
const reached = []
let app
before(async () => {
  app = await stump({ edge: async request => {
    reached.push(new URL(request.url).host)
    if (request.url === MOVED) return new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/admin' } })
    return request.url === SITE
      ? new Response('<html><head><title>Synthetic Clinic Co · Scheduling for small clinics</title></head><body><h1>Synthetic Clinic Co</h1><p>Recurring bookings for clinics.</p></body></html>', { headers: { 'content-type': 'text/html' } })
      : null
  } })
})
after(() => app?.stop())

test('first-run setup goes on to Stump\'s steps, and the company site names the company and product', async () => {
  await app.owner()
  // Confirming the owner on Base's /setup opens Stump's own setup steps, not an empty app.
  const confirmed = await app.request('owner', '/setup', { method: 'POST', type: 'application/x-www-form-urlencoded', body: 'confirm=yes' })
  assert.equal(confirmed.status, 303)
  assert.equal(confirmed.headers.get('location'), '/app/setup')
  const page = await app.request('owner', '/app/setup')
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Set up Stump/)

  // URL first: the site's own name prefills the company and the product; the owner saves them as they stand.
  const read = await app.action('owner', 'stump.brand.manage', { action: 'site_read', url: 'synthetic-stump-1.example' })
  assert.equal(read.status, 200)
  assert.equal(read.body.result.name, 'Synthetic Clinic Co')
  assert.equal(read.body.result.url, SITE)
  const unreachable = await app.action('owner', 'stump.brand.manage', { action: 'site_read', url: 'https://synthetic-stump-2.example/' })
  assert.equal(unreachable.body.code, 'source_unreadable')
  // Only public web pages are read: a private address, directly or after a redirect, is refused before any request reaches it.
  for (const url of ['http://127.0.0.1:1/', 'http://[::ffff:127.0.0.1]/', 'http://192.168.1.1/', 'http://localhost/', MOVED]) {
    const refused = await app.action('owner', 'stump.brand.manage', { action: 'site_read', url })
    assert.equal(refused.body.code, 'source_unreadable', url); assert.equal(refused.body.reason, 'Stump reads public web pages only.', url)
  }
  assert.deepEqual(reached.filter(host => /^(127\.|\[|192\.168\.|10\.|localhost)/.test(host)), [])
})
