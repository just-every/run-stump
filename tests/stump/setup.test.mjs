import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { stump } from './instance.mjs'

// The company's own site at the network edge, for setup's URL-first prefill.
const SITE = 'https://synthetic-stump-1.example/'
let app
before(async () => {
  app = await stump({ edge: async request => request.url === SITE
    ? new Response('<html><head><title>Synthetic Clinic Co · Scheduling for small clinics</title></head><body><h1>Synthetic Clinic Co</h1><p>Recurring bookings for clinics.</p></body></html>', { headers: { 'content-type': 'text/html' } })
    : null })
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
})
