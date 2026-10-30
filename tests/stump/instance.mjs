// A running Stump for tests through its public doors: the instance named by
// STUMP_URL and STUMP_DEV_KEY_FILE, or a fresh `rer dev` of this checkout,
// stopped by its own PID afterwards.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'

const root = new URL('../../', import.meta.url)
const freePort = () => new Promise((resolve, reject) => { const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) }).on('error', reject) })

async function startDev() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freePort()
    // The local site takes the next port; skip a pair whose second half is taken.
    const child = spawn('pnpm', ['exec', 'rer', 'dev', '--detach', '--port', String(port)], { cwd: root, env: { ...process.env, RER_NO_UPDATE_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
    const code = await new Promise(resolve => child.on('exit', resolve))
    const url = output.match(/^RER_READY (\S+)/m)?.[1], pid = Number(output.match(/running in the background \(PID (\d+)\)/)?.[1])
    if (code === 0 && url && pid) return { url, pid }
    if (attempt === 2) throw new Error(`rer dev did not start:\n${output.replace(/#\S+/g, '#…')}`)
  }
}

export async function stump() {
  const started = process.env.STUMP_URL ? null : await startDev()
  const origin = new URL(process.env.STUMP_URL ?? started.url).origin
  const keyFile = process.env.STUMP_DEV_KEY_FILE ?? new URL('.rer/local/dev-key.env', root)
  const key = (await readFile(keyFile, 'utf8')).match(/=(.+)/)[1].trim()
  const sessions = new Map()

  async function request(who, path, init = {}) {
    const jar = sessions.get(who) ?? new Map()
    const response = await fetch(origin + path, { redirect: 'manual', ...init, headers: { 'x-rer-dev-key': key, origin, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      ...(typeof init.body === 'string' ? { 'content-type': init.type ?? 'application/json' } : {}), ...init.headers } })
    for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at + 1)) }
    sessions.set(who, jar)
    return response
  }
  async function json(who, path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await request(who, path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  /** Base dev sign-in, as a person does: the owner, or an invited email. */
  async function signIn(who, as) { return (await request(who, `/auth/dev/enter?as=${encodeURIComponent(as)}&returnTo=/app`)).status }
  const action = (who, tool, args) => json(who, `/app/api/actions/${tool}`, args)
  async function mcp(token, name, args) {
    const response = await fetch(origin + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28', 'mcp-method': name ? 'tools/call' : 'tools/list', ...(name ? { 'mcp-name': name } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: name ? 'tools/call' : 'tools/list', params: { ...(name ? { name, arguments: { idempotency_key: randomUUID(), ...args } } : {}), _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }) })
    const body = await response.json().catch(() => null)
    return { status: response.status, result: body?.result, error: body?.result?._meta?.['com.runeditrun/error'] ?? null }
  }
  async function owner() {
    await signIn('owner', 'owner')
    // Base's first run: the owner confirms the installation once.
    await request('owner', '/setup', { method: 'POST', type: 'application/x-www-form-urlencoded', body: 'confirm=yes' })
    return (await json('owner', '/app/api/me')).body.person
  }
  return { origin, request, json, signIn, action, mcp, owner, email: label => `synthetic-stump-${label}-${randomUUID().slice(0, 8)}@example.com`,
    stop() { if (started) try { process.kill(started.pid) } catch {} } }
}
