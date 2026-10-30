// A fresh Stump from the production build (`pnpm run build` first), run in
// Miniflare on its own migrated D1, for tests through its public doors. People
// sign in as they do in production: the owner with the setup token, everyone
// else through the email link their invitation sends. The only fake is the
// mail provider at the network edge, which keeps each message it is given.
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unstable_splitSqlQuery } from 'wrangler'

const require = createRequire(import.meta.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = require('miniflare')
const { Agent } = require('undici')
const root = new URL('../../', import.meta.url).pathname
const secret = () => randomBytes(32).toString('hex')

/** `outbound(request)` answers the requests a test's own network fakes handle (anything else is refused); `db` is the installation's D1 for seeding what other lanes write. */
export async function stump({ outbound } = {}) {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve))
  const directory = await mkdtemp(join(tmpdir(), 'stump-test-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'pipe' })
  const cert = await readFile(join(directory, 'cert.pem'), 'utf8'), origin = `https://127.0.0.1:${port}`, mail = []
  const setupToken = secret()
  const server = join(root, 'dist/server')
  let db
  const worker = new Miniflare(convertV4MiniflareOptions({
    https: true, httpsKey: await readFile(join(directory, 'key.pem'), 'utf8'), httpsCert: cert, host: '127.0.0.1', port,
    modules: [{ type: 'ESModule', path: join(server, 'index.js') }, ...(await readdir(join(server, 'assets'))).filter(name => name.endsWith('.js')).map(name => ({ type: 'ESModule', path: join(server, 'assets', name) }))],
    modulesRoot: server, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: `stump-test-${randomUUID()}` },
    assets: { directory: join(root, 'dist/client'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } },
    bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'false', OWNER_EMAIL: 'synthetic-stump-owner@example.com', SESSION_SECRET: secret(), INSTALLATION_KEY: secret(), SETUP_TOKEN: setupToken,
      MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'synthetic-stump-1', MAIL_FROM: 'synthetic-stump-2@example.com' },
    log: new Log(LogLevel.ERROR),
    async outboundService(request) {
      const handled = await outbound?.(request)
      if (handled) return handled
      if (request.url !== 'https://api.sendgrid.com/v3/mail/send') return new Response('Undeclared network request', { status: 502 })
      mail.push(await request.json())
      return new Response(null, { status: 202, headers: { 'x-message-id': `synthetic-stump-${mail.length}` } })
    },
  }))
  try {
    db = await worker.getD1Database('DB')
    for (const name of (await readdir(join(root, 'migrations/core'))).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(unstable_splitSqlQuery(await readFile(join(root, 'migrations/core', name), 'utf8')).map(sql => db.prepare(sql)))
    }
    await worker.ready
  } catch (error) { await worker.dispose(); await rm(directory, { recursive: true, force: true }); throw error }

  const dispatcher = new Agent({ connect: { ca: cert } }), sessions = new Map()
  async function request(who, path, init = {}) {
    const jar = sessions.get(who) ?? new Map()
    const response = await fetch(origin + path, { dispatcher, redirect: 'manual', ...init, headers: { origin, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      ...(typeof init.body === 'string' ? { 'content-type': init.type ?? 'application/json' } : {}), ...init.headers } })
    for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at + 1)) }
    sessions.set(who, jar)
    return response
  }
  async function json(who, path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await request(who, path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const sentTo = email => mail.filter(message => message.personalizations?.some(item => item.to?.some(to => to.email === email)))
  /** Signs in through the newest sign-in or invitation link mailed to this address; 303 means signed in. */
  async function signIn(who, email) {
    const text = sentTo(email).at(-1)?.content?.map(part => part.value).join('\n') ?? ''
    const token = text.match(/\/auth\/confirm\?token=([A-Za-z0-9_-]+)/)?.[1]
    if (!token) return 0
    return (await request(who, '/auth/confirm', { method: 'POST', body: JSON.stringify({ token }) })).status
  }
  const action = (who, tool, args) => json(who, `/app/api/actions/${tool}`, args)
  async function mcp(token, name, args) {
    const response = await fetch(origin + '/mcp', { dispatcher, method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28', 'mcp-method': name ? 'tools/call' : 'tools/list', ...(name ? { 'mcp-name': name } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: name ? 'tools/call' : 'tools/list', params: { ...(name ? { name, arguments: { idempotency_key: randomUUID(), ...args } } : {}), _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }) })
    const body = await response.json().catch(() => null)
    return { status: response.status, result: body?.result, error: body?.result?._meta?.['com.runeditrun/error'] ?? null }
  }
  let ownerReady = null
  /** The installation owner: claimed once with the setup token, then Base's first run confirmed. */
  function owner() {
    ownerReady ??= (async () => {
      const claimed = await request('owner', '/auth/bootstrap', { method: 'POST', body: JSON.stringify({ token: setupToken, displayName: 'Synthetic Owner' }) })
      if (claimed.status !== 303) throw new Error(`Owner bootstrap answered ${claimed.status}`)
      await request('owner', '/setup', { method: 'POST', type: 'application/x-www-form-urlencoded', body: 'confirm=yes' })
    })()
    return ownerReady.then(async () => (await json('owner', '/app/api/me')).body.person)
  }
  return { origin, db, request, json, signIn, action, mcp, owner, sentTo, email: label => `synthetic-stump-${label}-${randomUUID().slice(0, 8)}@example.com`,
    async stop() { await dispatcher.close(); await worker.dispose(); await rm(directory, { recursive: true, force: true }) } }
}
