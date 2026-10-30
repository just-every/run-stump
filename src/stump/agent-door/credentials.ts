// Agent credentials a person issues for their own agent: the agent door's
// localCredentials. The agent acts for that person with exactly their role.
export const SPECIALIST = 'earned-channels-marketer'

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
const tokenHash = async (token: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const TOKEN = /^Bearer[ \t]+(stk_[A-Za-z0-9_-]{43})$/

export interface Credential { client_id: string; name: string; person_id: string; created_at: number; revoked_at: number | null }

export async function issueCredential(db: D1Database, personId: string, name: string, now = Date.now()) {
  const token = `stk_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`, clientId = `agent_${crypto.randomUUID()}`
  await db.prepare('INSERT INTO stump_agent_credentials(client_id,token_hash,person_id,name,created_at) VALUES(?,?,?,?,?)')
    .bind(clientId, await tokenHash(token), personId, name, now).run()
  return { token, client_id: clientId, agent: { id: clientId, name, specialist: SPECIALIST } }
}

export async function listCredentials(db: D1Database, personId: string | null): Promise<Credential[]> {
  const rows = personId
    ? db.prepare('SELECT client_id,name,person_id,created_at,revoked_at FROM stump_agent_credentials WHERE person_id=? ORDER BY created_at DESC').bind(personId)
    : db.prepare('SELECT client_id,name,person_id,created_at,revoked_at FROM stump_agent_credentials ORDER BY created_at DESC')
  return (await rows.all<Credential>()).results
}

/** Revokes it for good, here and in the door's agent register. */
export async function revokeCredential(db: D1Database, clientId: string, now = Date.now()): Promise<boolean> {
  const [revoked] = await db.batch([
    db.prepare('UPDATE stump_agent_credentials SET revoked_at=? WHERE client_id=? AND revoked_at IS NULL').bind(now, clientId),
    db.prepare('UPDATE agent_door_agents SET revoked=1 WHERE id=?').bind(clientId),
  ])
  return (revoked?.meta.changes ?? 0) > 0
}

/** The door's localCredentials: a live Stump token names its person, agent and the tool scopes. */
export async function authenticateCredential(db: D1Database, request: Request, scopes: string[]) {
  const token = TOKEN.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return null
  const row = await db.prepare(`SELECT c.client_id,c.name,c.person_id FROM stump_agent_credentials c JOIN stump_people p ON p.id=c.person_id
    WHERE c.token_hash=? AND c.revoked_at IS NULL AND p.status='active'`).bind(await tokenHash(token)).first<{ client_id: string; name: string; person_id: string }>()
  if (!row) return null
  return { sponsor: { id: row.person_id }, agent: { id: row.client_id, name: row.name, specialist: SPECIALIST }, clientId: row.client_id, scopes }
}
