// Drafting through the company's own AI provider (Base ai.provider.v1,
// STUMP-DRAFT-002, STUMP-DRAFT-006, STUMP-BRAND-002.2). A request carries only
// what the draft needs, the record lists those fields, the model, the provider's
// host and the USD cost the provider reported, and a failure leaves no draft.
import { aiConfig, AiError, createAiClient } from '../../modules/ai/index.mjs'
import { refuse } from '../actions/refusals.ts'
import type { StumpEnv } from '../env.ts'
import { claimsForRequest, type Claim } from '../lib/claims/index.ts'
import { NotPublicError, publicFetch, stumpFetch } from '../net/fetch.ts'
import type { ProductRecord, VoiceRecord } from './records.ts'

/** The ai.provider.v1 bindings (Base modules/ai); absent until the company sets its provider. */
type AiEnv = StumpEnv & { AI_ENABLED?: string; AI_BASE_URL?: string; AI_API_KEY?: string; AI_MODEL?: string; MODELS_SERVICE?: string; MODELS_KEY?: string }

/** The provider's host, which the record and the external class name. */
export function aiHost(env: StumpEnv): string {
  const config = aiConfig(env as AiEnv as unknown as Record<string, unknown>)
  const base = config.direct?.baseUrl ?? config.models?.baseUrl
  try { return base ? new URL(base).host : 'not set' } catch { return 'not set' }
}

export interface Source { url: string; title: string | null; text: string; read_at: string; sha256: string }

const SOURCE_BYTES = 512 * 1024, SOURCE_CHARS = 12_000
const decode = (value: string) => value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_, code: string) => {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  if (named[code.toLowerCase()]) return named[code.toLowerCase()]!
  const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
  return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : ''
})
/** The readable text of a page: its article or main element when it has one, without scripts, styles or markup. */
export function pageText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const body = /<article[\s>][\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<main[\s>][\s\S]*?<\/main>/i.exec(html)?.[0] ?? html
  const text = decode(body.replace(/<(script|style|noscript|svg|nav|footer|header)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { title: title ? decode(title).replace(/\s+/g, ' ').trim() : null, text }
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Reads a public source page (a changelog entry, docs page or post) through the network edge, or refuses saying why. */
export async function readSource(env: StumpEnv, url: string, now: number): Promise<Source> {
  let parsed: URL
  try { parsed = new URL(url) } catch { refuse('invalid_arguments', { field: 'source_url' }) }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) refuse('invalid_arguments', { field: 'source_url' })
  let response: Response
  try {
    response = await publicFetch(env)(parsed.href, { headers: { accept: 'text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    refuse('source_unreadable', { source_url: parsed.href, reason: error instanceof NotPublicError ? 'Stump reads public web pages only.' : 'The page could not be reached.' })
  }
  if (!response.ok) { await response.body?.cancel(); refuse('source_unreadable', { source_url: parsed.href, status: response.status, reason: `The page answered ${response.status}.` }) }
  const reader = response.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > SOURCE_BYTES) { await reader.cancel(); break }
    chunks.push(value)
  }
  const raw = new TextDecoder().decode(chunks.reduce((all, chunk) => { const next = new Uint8Array(all.length + chunk.length); next.set(all); next.set(chunk, all.length); return next }, new Uint8Array()))
  const type = response.headers.get('content-type') ?? ''
  const page = /html|xml/i.test(type) || /^\s*</.test(raw) ? pageText(raw) : { title: null, text: raw.trim() }
  if (!page.text) refuse('source_unreadable', { source_url: parsed.href, reason: 'The page has no text to draft from.' })
  const text = page.text.slice(0, SOURCE_CHARS)
  return { url: parsed.href, title: page.title, text, read_at: new Date(now).toISOString(), sha256: await sha256(text) }
}

export interface DraftRequest {
  format: 'post' | 'thread' | 'reply' | 'pitch'
  network: string | null
  limit: number | null
  product: ProductRecord | null
  voice: VoiceRecord | null
  claims: readonly Claim[]
  venue: { name: string; rules: Record<string, unknown> } | null
  source: Source | null
  prompt: string | null
  reply_to: string | null
  recipient: { name: string; kind: string; beat: string | null; publication: string | null } | null
  today: string
}
export interface Drafted { text: string | null; parts: string[] | null; subject: string | null; ai: { model: string; cost_usd: number | null; fields_sent: string[]; host: string; claims_sent: string[]; tokens: { input: number | null; output: number | null } } }

const INSTRUCTIONS = [
  'You draft one social post, thread, reply or press pitch for a small software company, in the named person\'s own voice.',
  'Write only from the fields given. State a product fact only when it is one of claims.allowed, compare only with claims.comparative, and never make a claim in claims.banned.',
  'Follow voice.do and avoid voice.dont; use the product\'s tone and words, and never its avoid words.',
  'When a source is given, link its url once. Never ask anyone to upvote or vote, and never write a review or testimonial.',
  'Keep a post within limit characters. Answer JSON only: {"text": "..."} for a post or reply, {"parts": ["...", "..."]} for a thread, {"subject": "...", "text": "..."} for a pitch.',
].join(' ')

/** The fields the request sends, and nothing else of the records (STUMP-DRAFT-006.1, .5). */
function brief(request: DraftRequest) {
  const claims = claimsForRequest(request.claims, { ...(request.product ? { product_id: request.product.id } : {}), today: request.today })
  const fields: Record<string, unknown> = { format: request.format }
  if (request.network) fields.network = request.network
  if (request.limit) fields.limit = request.limit
  if (request.product) fields.product = { name: request.product.name, description: request.product.description, audience: request.product.audience,
    tone: request.product.tone, words_use: request.product.words_use, words_avoid: request.product.words_avoid }
  if (request.voice) fields.voice = { samples: request.voice.samples, do: request.voice.do, dont: request.voice.dont }
  fields.claims = { allowed: claims.allowed, comparative: claims.comparative, banned: claims.banned }
  if (request.venue) fields.venue_rules = { venue: request.venue.name, rules: request.venue.rules }
  if (request.source) fields.source = { url: request.source.url, title: request.source.title, text: request.source.text }
  if (request.reply_to) fields.reply_to = request.reply_to
  if (request.recipient) fields.recipient = request.recipient
  if (request.prompt) fields.prompt = request.prompt
  return { fields, claims_sent: claims.sent_ids }
}

/** The assistant's text from a chat completion, as JSON or as server-sent events. */
async function completion(response: Response): Promise<{ content: string; model: string | null; usage: Record<string, unknown> | null }> {
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    let content = '', model: string | null = null, usage: Record<string, unknown> | null = null
    for (const line of (await response.text()).split('\n')) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (!data || data === '[DONE]') continue
      const event = JSON.parse(data) as { model?: string; usage?: Record<string, unknown> | null; choices?: Array<{ delta?: { content?: string } }> }
      content += event.choices?.[0]?.delta?.content ?? ''
      model = event.model ?? model
      usage = event.usage ?? usage
    }
    return { content, model, usage }
  }
  const body = await response.json() as { model?: string; usage?: Record<string, unknown>; choices?: Array<{ message?: { content?: unknown } }> }
  const content = body.choices?.[0]?.message?.content
  return { content: typeof content === 'string' ? content : '', model: body.model ?? null, usage: body.usage ?? null }
}

/** The USD cost the provider reported: the Models service's receipt header, or the usage cost an OpenAI-compatible gateway returns. */
function reportedCost(response: Response, usage: Record<string, unknown> | null): number | null {
  const micro = Number(response.headers.get('x-models-cost-microusd'))
  if (response.headers.has('x-models-cost-microusd') && Number.isFinite(micro)) return micro / 1_000_000
  const cost = usage?.cost ?? usage?.total_cost
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : null
}

const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim()) ? (value as string[]).map(item => item.trim()) : null

/** One drafting request to the company's provider; any failure refuses with the provider's code and leaves nothing behind. */
export async function draftWithAi(env: StumpEnv, request: DraftRequest): Promise<Drafted> {
  const config = aiConfig(env as AiEnv as unknown as Record<string, unknown>)
  const { fields, claims_sent } = brief(request)
  let response: Response
  try {
    response = await createAiClient(config, { fetch: stumpFetch(env) }).chat({
      messages: [{ role: 'system', content: INSTRUCTIONS }, { role: 'user', content: JSON.stringify(fields) }],
      response_format: { type: 'json_object' },
    }, { feature: 'drafting', signal: AbortSignal.timeout(90_000) })
  } catch (error) {
    if (error instanceof AiError) refuse('ai_failed', { provider_code: error.code, status: error.status, host: aiHost(env) })
    throw error
  }
  let answer: Awaited<ReturnType<typeof completion>>
  try { answer = await completion(response) } catch { refuse('ai_failed', { provider_code: 'ai_invalid_response', host: aiHost(env) }) }
  let output: Record<string, unknown> = {}
  try { output = JSON.parse(answer.content) as Record<string, unknown> } catch { refuse('ai_failed', { provider_code: 'ai_invalid_output', host: aiHost(env), reason: 'The provider did not answer the JSON the request asked for.' }) }
  const text = typeof output.text === 'string' && output.text.trim() ? output.text.trim() : null
  const parts = strings(output.parts)
  const subject = typeof output.subject === 'string' && output.subject.trim() ? output.subject.trim() : null
  if (request.format === 'thread' ? !parts && !text : !text) refuse('ai_failed', { provider_code: 'ai_invalid_output', host: aiHost(env), reason: 'The provider answered no draft text.' })
  const input = answer.usage?.prompt_tokens ?? answer.usage?.input_tokens, output_tokens = answer.usage?.completion_tokens ?? answer.usage?.output_tokens
  return {
    text, parts: request.format === 'thread' ? parts : null, subject,
    ai: { model: answer.model ?? config.model ?? 'unknown', cost_usd: reportedCost(response, answer.usage), fields_sent: Object.keys(fields), host: aiHost(env), claims_sent,
      tokens: { input: typeof input === 'number' ? input : null, output: typeof output_tokens === 'number' ? output_tokens : null } },
  }
}
