import type { BlueskyAuth } from '../lib/bluesky/index.ts'
import type { LinkedInTokenSet } from '../lib/linkedin/index.ts'
import type { XTokenSet } from '../lib/x/index.ts'
import type { StumpEnv } from '../env.ts'
import type { Network } from './apps.ts'
import { shownHandle } from './handle.ts'
import { seal, unseal } from './seal.ts'

// Connected accounts (STUMP-PUBLISH-001, STUMP-CONNECT-001). Each belongs to one
// person or to the company and never changes owner. Credentials are sealed and
// never part of any answer.

export type AccountState = 'connected' | 'expired' | 'disconnected'

export interface AccountRow {
  id: string; network: Network; handle: string; display_name: string | null; owner_kind: 'person' | 'company'; owner_person_id: string | null
  connected_by: string | null; connected_at: number | null; state: AccountState; state_reason: string | null; reconnect_url: string | null; instance: string | null; credentials: string | null
  follower_count: number | null
  automated_label: number; operator_bio: string | null; operator_named: number; network_user_id: string | null; bot: number; bot_rules: string; post_limit: number | null
  token_expires_at: number | null; disconnected_at: number | null; disconnected_by: string | null; revision: number; created_at: number; updated_at: number
}

export type Credentials =
  | { network: 'mastodon'; origin: string; redirect_uri: string; access_token: string }
  | { network: 'bluesky'; pds_url: string; auth: BlueskyAuth }
  | { network: 'x'; tokens: XTokenSet; user_id: string; username: string }
  | { network: 'linkedin'; tokens: LinkedInTokenSet; urn: string }

const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString()

/** The account as every door answers it: never a token, a password or a key. */
export function accountView(row: AccountRow) {
  return {
    id: row.id, network: row.network, handle: row.handle, display_name: row.display_name,
    owner: { kind: row.owner_kind, person_id: row.owner_person_id },
    connected_by: row.connected_by, connected_at: iso(row.connected_at), state: row.state, state_reason: row.state === 'connected' ? null : row.state_reason, reconnect_url: row.reconnect_url,
    followers: row.follower_count,
    instance: row.instance, automated_label: row.automated_label === 1,
    // The bio's text naming the operator, or true when only that fact is recorded.
    operator_bio: row.operator_bio ?? (row.operator_named === 1 ? true : null),
    bot: row.bot === 1, bot_rules: JSON.parse(row.bot_rules) as Array<{ id: string; text: string }>, post_limit: row.post_limit,
    access_expires_at: iso(row.token_expires_at), disconnected_at: iso(row.disconnected_at), revision: row.revision,
  }
}
export type AccountView = ReturnType<typeof accountView>

export const readAccount = (db: D1Database, id: string) => db.prepare('SELECT * FROM stump_accounts WHERE id=?').bind(id).first<AccountRow>()

export async function openCredentials(env: StumpEnv, row: AccountRow): Promise<Credentials | null> {
  return row.credentials ? unseal<Credentials>(env, `account:${row.id}`, row.credentials) : null
}

export const sealCredentials = (env: StumpEnv, accountId: string, credentials: Credentials) => seal(env, `account:${accountId}`, credentials)

export async function saveCredentials(db: D1Database, env: StumpEnv, accountId: string, credentials: Credentials, expiresAt: number | null, now: number) {
  await db.prepare('UPDATE stump_accounts SET credentials=?,token_expires_at=?,updated_at=? WHERE id=?')
    .bind(await sealCredentials(env, accountId, credentials), expiresAt, now, accountId).run()
}

/** How the network refused an account's credentials: revoked by the person or the network, or expired. */
export type RefusedBecause = 'revoked' | 'expired'

/** What a person does to put an account back: the reconnect step, named for every hold it causes. */
export const reconnectStep = (row: Pick<AccountRow, 'network' | 'handle' | 'display_name'>, because: RefusedBecause) =>
  `Reconnect ${shownHandle(row)} in Settings, Accounts: its access ${because === 'expired' ? 'expired' : 'was revoked'} at the network.`

/** The account's follower count as the network last reported it; an unknown count stays as it was. */
export async function saveFollowers(db: D1Database, accountId: string, followers: number | null | undefined, now: number) {
  if (typeof followers !== 'number' || !Number.isSafeInteger(followers) || followers < 0) return
  await db.prepare('UPDATE stump_accounts SET follower_count=?,updated_at=? WHERE id=?').bind(followers, now, accountId).run()
}

/**
 * The network refused the account's credentials (a 401, a revoked or expired
 * token, a refused refresh): the account reads expired, the contract's word,
 * with the reason saying revoked or expired, and waits for its owner to
 * reconnect; every item queued on it holds with the reconnect step as its
 * reason (STUMP-CONNECT-001.4, STUMP-PUBLISH-005.4). Answers that reason.
 */
export async function needsReconnect(db: D1Database, env: StumpEnv, row: AccountRow, because: RefusedBecause, now: number): Promise<string> {
  const reconnect = `${env.AUTH_ORIGIN}/app/settings/accounts?reconnect=${encodeURIComponent(row.id)}`
  const owner = row.owner_person_id ?? row.connected_by
  const reason = reconnectStep(row, because)
  const stateReason = because === 'expired' ? 'Its access expired at the network.' : 'Its access was revoked at the network.'
  const held = (await db.prepare("SELECT id FROM stump_items WHERE account_id=? AND state='scheduled'").bind(row.id).all<{ id: string }>()).results.map(item => item.id)
  await db.batch([
    db.prepare("UPDATE stump_accounts SET state='expired',state_reason=?,reconnect_url=?,updated_at=?,revision=revision+1 WHERE id=?").bind(stateReason, reconnect, now, row.id),
    ...held.flatMap(id => [
      db.prepare("UPDATE stump_items SET state='held',hold=?,updated_at=? WHERE id=? AND state='scheduled'").bind(JSON.stringify({ owner_id: owner, reason, next_attempt_at: null, kind: 'reconnect' }), now, id),
      db.prepare("INSERT INTO stump_item_history(id,item_id,from_state,to_state,reason,at) SELECT ?,?,'scheduled','held','account needs reconnecting',? WHERE changes()=1").bind(crypto.randomUUID(), id, now),
    ]),
  ])
  return reason
}
