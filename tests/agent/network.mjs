// The conformance edge for X: OAuth 2.0 token exchange and the account read,
// in X API v2's published shapes, so the journey connects the company's X
// account through its own app. No request leaves the verifier.
const issued = new Set()
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default { async fetch(request) {
  const url = new URL(request.url)
  if (url.pathname === '/2/oauth2/token' && request.method === 'POST') {
    const form = new URLSearchParams(await request.text())
    if (!request.headers.get('authorization')?.startsWith('Basic ') || !form.get('code')) return json({ error: 'invalid_request' }, 400)
    const token = `conformance-${crypto.randomUUID()}`
    issued.add(token)
    return json({ token_type: 'bearer', expires_in: 7200, access_token: token, refresh_token: crypto.randomUUID(), scope: 'tweet.read tweet.write users.read offline.access media.write' })
  }
  if (url.pathname === '/2/oauth2/revoke' && request.method === 'POST') return json({ revoked: true })
  const token = request.headers.get('authorization')?.slice('Bearer '.length) ?? ''
  if (!token.startsWith('conformance-')) return json({ title: 'Unauthorized', status: 401 }, 401)
  if (url.pathname === '/2/users/me') return json({ data: { id: '1500000000000000099', username: 'synthetic_company', name: 'Synthetic Company' } })
  return json({ title: 'Not Found', status: 404 }, 404)
} }
