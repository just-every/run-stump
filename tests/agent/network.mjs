// The conformance journey's network edge. It runs in isolated workerd with no
// other network and answers, in each provider's published shapes:
// - the company's AI provider: OpenAI-compatible chat completions with a JSON
//   draft and its usage and cost;
// - X API v2: the OAuth 2.0 token exchange and the account read, so the
//   journey connects the company's X account through its own app; the
//   account's mentions timeline, where a member mentions it twice more on
//   every read; post creation and read-back, so a reply posts and reads back;
//   and post deletion, so the company removes its own post;
// - Bluesky's public AppView: a handle resolved to its DID (a did:web naming the
//   handle's host), and a post thread read by that DID's at-URI, so the journey
//   records a hand-off's link checked with the network.
const AI = 'https://ai.synthetic-stump.example'
const X = 'https://api.x.com'
const APPVIEW = 'https://public.api.bsky.app'
const COMPANY = { id: '1500000000000000099', username: 'synthetic_company', name: 'Synthetic Company', public_metrics: { followers_count: 2400, following_count: 12, tweet_count: 40, listed_count: 1 } }
const MEMBER = { id: '1600000000000000099', username: 'synthetic_member', name: 'Synthetic Member' }
const posts = new Map()
let sequence = 0
/** A post id above every earlier one, as X's snowflake ids are. */
const nextId = () => String(BigInt(Date.now()) * 4096n + BigInt(sequence++ % 4096))
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
  if (url.pathname === '/2/users/me') return json({ data: COMPANY })
  if (url.pathname === `/2/users/${COMPANY.id}/mentions`) {
    const data = ['Does the weekly pattern skip holidays?', 'Can a booking repeat every other week?'].map(text => ({ id: nextId(), text: `@${COMPANY.username} ${text}`, author_id: MEMBER.id, created_at: new Date().toISOString() })).reverse()
    for (const item of data) item.conversation_id = item.id
    return json({ data, includes: { users: [MEMBER] }, meta: { result_count: data.length, newest_id: data[0].id, oldest_id: data.at(-1).id } })
  }
  if (url.pathname === '/2/tweets' && request.method === 'POST') {
    const body = await request.json(), post = { id: nextId(), text: body.text, author_id: COMPANY.id, created_at: new Date().toISOString(), edit_history_tweet_ids: [] }
    post.edit_history_tweet_ids.push(post.id); posts.set(post.id, post)
    return json({ data: { id: post.id, text: post.text, edit_history_tweet_ids: post.edit_history_tweet_ids } }, 201)
  }
  const read = /^\/2\/tweets\/(\d+)$/.exec(url.pathname)
  if (read && request.method === 'DELETE') return posts.delete(read[1]) ? json({ data: { deleted: true } }) : json({ title: 'Not Found', status: 404 }, 404)
  if (read && posts.has(read[1])) return json({ data: posts.get(read[1]), includes: { users: [COMPANY] } })
  return json({ title: 'Not Found', status: 404 }, 404)
}

function appview(url) {
  if (url.pathname === '/xrpc/com.atproto.identity.resolveHandle') {
    const handle = url.searchParams.get('handle') ?? ''
    return handle.endsWith('.bsky.social') ? json({ did: `did:web:${handle}` }) : json({ error: 'InvalidRequest', message: 'Unable to resolve handle' }, 400)
  }
  const [, did, rkey] = /^at:\/\/(did:web:[^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(url.searchParams.get('uri') ?? '') ?? []
  if (url.pathname !== '/xrpc/app.bsky.feed.getPostThread' || !did) return json({ error: 'NotFound', message: 'Post not found' }, 400)
  return json({ thread: { $type: 'app.bsky.feed.defs#threadViewPost', post: { uri: `at://${did}/app.bsky.feed.post/${rkey}`, cid: 'bafysynthetic', author: { did, handle: did.slice('did:web:'.length) },
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
