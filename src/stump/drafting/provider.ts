// The company's AI provider (STUMP-DRAFT-006, stump.setup.ai). An admin chooses
// it in Settings · Connections: an OpenAI-compatible address, the model and the
// key, sealed at rest. An installation can instead set it through its AI_*
// settings (Base ai.provider.v1: AI_ENABLED, AI_BASE_URL, AI_API_KEY, AI_MODEL);
// the provider saved in Settings is the one drafting uses when both exist, and
// the setting says which one applies.
import { aiConfig, type AiConfig } from '../../modules/ai/index.mjs'
import { refuse } from '../actions/refusals.ts'
import { seal, unseal } from '../accounts/seal.ts'
import type { StumpEnv } from '../env.ts'

const PURPOSE = 'ai-provider:company'

interface Row { base_url: string; model: string; api_key: string | null; key_hint: string | null; set_by: string; set_at: number; revision: number }
type AiEnv = StumpEnv & { AI_ENABLED?: string; AI_BASE_URL?: string; AI_API_KEY?: string; AI_MODEL?: string; MODELS_SERVICE?: string; MODELS_KEY?: string }
export type { AiConfig }

/** The address rule ai.provider.v1 applies: https, or plain http only on this computer, with no credentials, query or fragment. */
function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value), local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
    return (url.protocol === 'https:' || (url.protocol === 'http:' && local)) && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}

const readRow = (db: D1Database) => db.prepare('SELECT base_url,model,api_key,key_hint,set_by,set_at,revision FROM stump_ai_provider WHERE id=?').bind('company').first<Row>()
const hostOf = (base: string | undefined) => { try { return base ? new URL(base).host : 'not set' } catch { return 'not set' } }
const installation = (env: StumpEnv) => aiConfig(env as AiEnv as unknown as Record<string, unknown>)

/** Where the provider comes from: Settings, the installation's AI_* settings, or nowhere yet. */
export type ProviderSource = 'settings' | 'installation' | 'none'

/** The ai.provider.v1 configuration a drafting request uses, and where it came from. */
export async function providerConfig(env: StumpEnv, db: D1Database): Promise<{ config: AiConfig; source: ProviderSource; host: string; apiKey: string | null }> {
  const row = await readRow(db)
  if (row) {
    // A provider restored from an archive has no key until an admin enters it again: say so rather than call without one.
    if (!row.api_key) refuse('ai_failed', { provider_code: 'ai_key_missing', host: hostOf(row.base_url), reason: `The AI provider at ${hostOf(row.base_url)} has no key. An owner or admin enters it again in Settings › Connections.` })
    const apiKey = await unseal<string>(env, PURPOSE, row.api_key)
    return { config: { enabled: true, model: row.model, direct: { baseUrl: row.base_url, apiKey }, models: undefined, features: {} }, source: 'settings', host: hostOf(row.base_url), apiKey }
  }
  const config = installation(env)
  const enabled = config.enabled && !!(config.direct || config.models)
  return { config, source: enabled ? 'installation' : 'none', host: hostOf(config.direct?.baseUrl ?? config.models?.baseUrl), apiKey: config.direct?.apiKey ?? config.models?.apiKey ?? null }
}

/** The setting as both doors answer it: never the key, only its last four characters. */
export async function describeProvider(env: StumpEnv, db: D1Database) {
  const row = await readRow(db), config = installation(env)
  const fromInstallation = config.enabled && (config.direct || config.models)
    ? { host: hostOf(config.direct?.baseUrl ?? config.models?.baseUrl), model: config.model ?? null } : null
  return {
    source: (row ? 'settings' : fromInstallation ? 'installation' : 'none') as ProviderSource,
    base_url: row?.base_url ?? null, host: row ? hostOf(row.base_url) : fromInstallation?.host ?? null, model: row?.model ?? fromInstallation?.model ?? null,
    key: row ? row.api_key ? `••••${row.key_hint ?? ''}` : null : null, key_needed: !!row && !row.api_key,
    set_by: row?.set_by ?? null, set_at: row ? new Date(row.set_at).toISOString() : null, revision: row?.revision ?? 0,
    installation: fromInstallation,
  }
}

/** Checks the address and model before anything is saved; the key is checked by the provider on the first draft. */
export function checkProvider(args: { base_url?: unknown; model?: unknown; api_key?: unknown }) {
  const base = typeof args.base_url === 'string' ? args.base_url.trim().replace(/\/+$/, '') : ''
  if (!validBaseUrl(base)) refuse('invalid_arguments', { field: 'base_url', reason: 'Give the provider\'s https address, such as https://api.openai.com/v1, with no key or query in it.' })
  const model = typeof args.model === 'string' ? args.model.trim() : ''
  if (!model || /\s/.test(model)) refuse('invalid_arguments', { field: 'model', reason: 'Give the model\'s exact id, such as gpt-4.1-mini.' })
  const key = typeof args.api_key === 'string' ? args.api_key.trim() : null
  if (key !== null && (!key || /\s/.test(key))) refuse('invalid_arguments', { field: 'api_key', reason: 'Paste the key with no spaces.' })
  return { base, model, key }
}

/** Saves the provider; a key left out keeps the one already sealed. */
export async function saveProvider(env: StumpEnv, db: D1Database, input: { base: string; model: string; key: string | null }, personId: string, now: number) {
  const current = await readRow(db)
  if (!input.key && !current?.api_key) refuse('invalid_arguments', { field: 'api_key', reason: 'Paste the provider\'s key.' })
  const sealed = input.key ? await seal(env, PURPOSE, input.key) : current!.api_key, hint = input.key ? input.key.slice(-4) : current!.key_hint
  await db.prepare(`INSERT INTO stump_ai_provider(id,base_url,model,api_key,key_hint,set_by,set_at) VALUES('company',?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url,model=excluded.model,api_key=excluded.api_key,key_hint=excluded.key_hint,
      set_by=excluded.set_by,set_at=excluded.set_at,revision=stump_ai_provider.revision+1`).bind(input.base, input.model, sealed, hint, personId, now).run()
}

export const clearProvider = (db: D1Database) => db.prepare('DELETE FROM stump_ai_provider WHERE id=?').bind('company').run()

/**
 * The provider's own words when it refuses a request: OpenAI-compatible APIs
 * answer {error: {message}}. The key is never repeated, and the text is cut short.
 */
export async function providerMessage(response: Response, apiKey: string | null): Promise<string | null> {
  try {
    const body = await response.json() as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown }
    const raw = typeof body.error === 'string' ? body.error : typeof body.error?.message === 'string' ? body.error.message : typeof body.message === 'string' ? body.message : typeof body.detail === 'string' ? body.detail : null
    if (!raw) return null
    const scrubbed = apiKey ? raw.split(apiKey).join('••••') : raw
    return scrubbed.replace(/\s+/g, ' ').trim().slice(0, 300) || null
  } catch { return null }
}
