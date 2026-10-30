// The conformance journey's network edge. It runs in isolated workerd with no
// other network and answers, in each provider's published shapes:
// - the company's AI provider: OpenAI-compatible chat completions with a JSON
//   draft and its usage and cost;
// - X API v2: the OAuth 2.0 token exchange and the account read, so the
//   journey connects the company's X account through its own app;
// - Bluesky's public AppView: a post thread by the handle in its URI, so the
//   journey records a hand-off's link checked with the network.
const AI = 'https://ai.synthetic-stump.example'
const X = 'https://api.x.com'
const APPVIEW = 'https://public.api.bsky.app'
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function ai(request, url) {
  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') return new Response('Not declared', { status: 404 })
  const body = await request.json()
  const brief = JSON.parse(body.messages.at(-1).content)
  const text = brief.format === 'thread' ? null : `Synthetic draft for a ${brief.format} with ${Object.keys(brief).length} fields.`
  const content = JSON.stringify(brief.format === 'thread' ? { parts: ['Synthetic part one.', 'Synthetic part two.'] } : brief.format === 'pitch' ? { subject: 'Synthetic subject', text } : { text })
  return Response.json({ id: 'synthetic-stump-completion', object: 'chat.completion', model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00042 } })
}

async function x(request, url) {
  if (url.pathname === '/2/oauth2/token' && request.method === 'POST') {
    const form = new URLSearchParams(await request.text())
    if (!request.headers.get('authorization')?.startsWith('Basic ') || !form.get('code')) return json({ error: 'invalid_request' }, 400)
    return json({ token_type: 'bearer', expires_in: 7200, access_token: `conformance-${crypto.randomUUID()}`, refresh_token: crypto.randomUUID(), scope: 'tweet.read tweet.write users.read offline.access media.write' })
  }
  if (url.pathname === '/2/oauth2/revoke' && request.method === 'POST') return json({ revoked: true })
  const token = request.headers.get('authorization')?.slice('Bearer '.length) ?? ''
  if (!token.startsWith('conformance-')) return json({ title: 'Unauthorized', status: 401 }, 401)
  if (url.pathname === '/2/users/me') return json({ data: { id: '1500000000000000099', username: 'synthetic_company', name: 'Synthetic Company' } })
  return json({ title: 'Not Found', status: 404 }, 404)
}

function appview(url) {
  const [, actor, rkey] = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(url.searchParams.get('uri') ?? '') ?? []
  if (url.pathname !== '/xrpc/app.bsky.feed.getPostThread' || !actor) return json({ error: 'NotFound', message: 'Post not found' }, 400)
  return json({ thread: { $type: 'app.bsky.feed.defs#threadViewPost', post: { uri: `at://did:plc:synthetic/app.bsky.feed.post/${rkey}`, cid: 'bafysynthetic', author: { did: 'did:plc:synthetic', handle: actor },
    record: { $type: 'app.bsky.feed.post', text: 'Synthetic hand-off post.', createdAt: new Date().toISOString() }, indexedAt: new Date().toISOString() } } })
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (url.origin === AI) return ai(request, url)
    if (url.origin === X) return x(request, url)
    if (url.origin === APPVIEW) return appview(url)
    return new Response('Not declared', { status: 404 })
  },
}
