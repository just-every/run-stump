import { DEFAULT_SCOPE as BLUESKY_SCOPE } from '../lib/bluesky/index.ts'
import { checkLinkedInAppKeys, describeLinkedInApp, maskLinkedInSecret } from '../lib/linkedin/index.ts'
import { DEFAULT_SCOPES as MASTODON_SCOPES } from '../lib/mastodon/index.ts'
import { X_DEFAULT_PRICES, checkXAppKeys, describeXApp, maskSecret, validateXPriceTable, type XPriceTable } from '../lib/x/index.ts'
import type { StumpEnv } from '../env.ts'
import { seal, unseal } from './seal.ts'

// The company's own network apps (STUMP-CONNECT-002). Bluesky and Mastodon need
// none: Stump registers itself on each Mastodon instance and is a public atproto
// client. X and LinkedIn run on the company's own developer apps, whose keys are
// sealed here and only ever answered back masked.

export const NETWORKS = ['bluesky', 'mastodon', 'x', 'linkedin'] as const
export type Network = typeof NETWORKS[number]
export const APP_NETWORKS = ['x', 'linkedin'] as const
export type AppNetwork = typeof APP_NETWORKS[number]
export const NETWORK_NAMES: Record<Network, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon', x: 'X', linkedin: 'LinkedIn' }

export interface AppKeys { clientId: string; clientSecret: string }
interface AppRow { network: AppNetwork; client_id: string | null; client_secret: string | null; prices: string | null; updated_by: string; updated_at: number; revision: number }

/** Where each network sends a person back after its consent screen. */
export const callbackUrl = (env: Pick<StumpEnv, 'AUTH_ORIGIN'>, network: Network) => `${env.AUTH_ORIGIN}/app/connected/${network}`

const purpose = (network: AppNetwork) => `app:${network}`
const row = (db: D1Database, network: AppNetwork) => db.prepare('SELECT * FROM stump_network_apps WHERE network=?').bind(network).first<AppRow>()

export async function appKeys(db: D1Database, env: StumpEnv, network: AppNetwork): Promise<AppKeys | null> {
  const app = await row(db, network)
  if (!app?.client_id || !app.client_secret) return null
  const secrets = await unseal<{ client_id: string; client_secret: string }>(env, purpose(network), app.client_secret)
  return { clientId: secrets.client_id, clientSecret: secrets.client_secret }
}

/** Checks pasted keys; answers the field and the reason when they cannot be keys. */
export function checkKeys(network: AppNetwork, keys: { client_id: unknown; client_secret: unknown }) {
  return network === 'x' ? checkXAppKeys(keys) : checkLinkedInAppKeys(keys)
}

export async function saveKeys(db: D1Database, env: StumpEnv, network: AppNetwork, keys: { client_id: string; client_secret: string }, personId: string, now: number) {
  const clientId = keys.client_id.trim(), clientSecret = keys.client_secret.trim()
  // Both halves are sealed together; the masked Client ID is kept apart for display.
  const sealed = await seal(env, purpose(network), { client_id: clientId, client_secret: clientSecret })
  const mask = network === 'x' ? maskSecret(clientId) : maskLinkedInSecret(clientId)
  await db.prepare(`INSERT INTO stump_network_apps(network,client_id,client_secret,updated_by,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(network) DO UPDATE SET client_id=excluded.client_id,client_secret=excluded.client_secret,updated_by=excluded.updated_by,updated_at=excluded.updated_at,revision=revision+1`)
    .bind(network, mask, sealed, personId, now).run()
}

/** The company's X price table: its own values, or the defaults docs/networks.md records. */
export async function xPrices(db: D1Database): Promise<XPriceTable> {
  const app = await row(db, 'x')
  if (!app?.prices) return { ...X_DEFAULT_PRICES }
  return JSON.parse(app.prices) as XPriceTable
}

export function checkPrices(prices: unknown) { return validateXPriceTable(prices) }

export async function savePrices(db: D1Database, table: XPriceTable, personId: string, now: number) {
  await db.prepare(`INSERT INTO stump_network_apps(network,prices,updated_by,updated_at) VALUES('x',?,?,?)
    ON CONFLICT(network) DO UPDATE SET prices=excluded.prices,updated_by=excluded.updated_by,updated_at=excluded.updated_at,revision=revision+1`)
    .bind(JSON.stringify(table), personId, now).run()
}

export type AppState = 'not_needed' | 'not_created' | 'connected'

/** Whether each network can be connected now: its app state alone, with no keys, steps or prices (every role reads it). */
export async function appStates(db: D1Database): Promise<Array<{ network: Network; state: AppState }>> {
  const keyed = new Set((await db.prepare("SELECT network FROM stump_network_apps WHERE client_secret IS NOT NULL AND client_secret<>''").all<{ network: string }>()).results.map(row => row.network))
  return NETWORKS.map(network => ({ network, state: (APP_NETWORKS as readonly string[]).includes(network) ? keyed.has(network) ? 'connected' : 'not_created' : 'not_needed' }))
}

/** Each network's app as setup shows it: state, steps, callback URLs, scopes and masked keys. */
export async function describeApps(db: D1Database, env: StumpEnv) {
  const rows = new Map((await db.prepare('SELECT * FROM stump_network_apps').all<AppRow>()).results.map(app => [app.network, app]))
  const keyed = (network: AppNetwork) => rows.get(network)?.client_secret ? rows.get(network)! : null
  const keys = (network: AppNetwork) => { const app = keyed(network); return app ? { client_id: app.client_id, client_secret: '••••••••', updated_at: new Date(app.updated_at).toISOString() } : null }
  const x = describeXApp({ redirectUri: callbackUrl(env, 'x') }), linkedin = describeLinkedInApp({ redirectUri: callbackUrl(env, 'linkedin') })
  return [
    { network: 'bluesky', name: 'Bluesky', state: 'not_needed' as AppState, steps: ['No app is needed. Each person connects their own account on its consent screen, or with an app password where their server offers no consent screen.'],
      callback_urls: [callbackUrl(env, 'bluesky')], scopes: BLUESKY_SCOPE.split(' '), hosts: ['bsky.social', 'plc.directory'], keys: null },
    { network: 'mastodon', name: 'Mastodon', state: 'not_needed' as AppState, steps: ['No app is needed. Stump registers itself on each instance the first time someone connects an account there.'],
      callback_urls: [callbackUrl(env, 'mastodon')], scopes: MASTODON_SCOPES.split(' '), hosts: ['each instance'], keys: null },
    { network: 'x', name: 'X', state: (keyed('x') ? 'connected' : 'not_created') as AppState, steps: x.steps, callback_urls: x.callback_urls, scopes: x.scopes, hosts: x.hosts,
      keys: keys('x'), prices: await xPrices(db), default_prices: { ...X_DEFAULT_PRICES } },
    { network: 'linkedin', name: 'LinkedIn', state: (keyed('linkedin') ? 'connected' : 'not_created') as AppState, steps: linkedin.steps, callback_urls: linkedin.callback_urls,
      scopes: linkedin.scopes, hosts: linkedin.hosts, keys: keys('linkedin'), limits: linkedin.limits },
  ]
}
