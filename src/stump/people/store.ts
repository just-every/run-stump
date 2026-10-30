import type { Connection, Role } from './roles.ts'

export interface StumpPerson {
  id: string
  email: string
  display_name: string
  role: Role
  connection: Connection | null
  disclosure_lines: string[]
  status: 'invited' | 'active' | 'removed'
  invited_at: number | null
  joined_at: number | null
}

interface Operator { id: string; email: string; displayName?: string; display_name?: string; role: string; status: string }
type PersonRow = Omit<StumpPerson, 'disclosure_lines'> & { disclosure_lines: string }

const COLUMNS = 'id,email,display_name,role,connection,disclosure_lines,status,invited_at,joined_at'
const toPerson = (row: PersonRow): StumpPerson => ({ ...row, disclosure_lines: JSON.parse(row.disclosure_lines) as string[] })

// An invited person whose Base operator is active and has signed in since the invitation.
const SIGNED_IN = `p.status='invited' AND EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=p.id AND o.status='active')
  AND EXISTS(SELECT 1 FROM oa_sessions s WHERE s.operator_id=p.id AND s.created_at>=p.invited_at)`
const SIGNED_IN_AT = '(SELECT MIN(s.created_at) FROM oa_sessions s WHERE s.operator_id=p.id AND s.created_at>=p.invited_at)'

/**
 * Accepts the invitations of invited people who have signed in (D-1). Base
 * activates an invited operator in the same transaction as their first
 * session, so every read sees the acceptance from that sign-in on, through
 * every door, with the person's join time set to the sign-in.
 */
async function acceptSignedIn(db: D1Database, id?: string): Promise<void> {
  const only = id === undefined ? '' : ' AND p.id=?', args = id === undefined ? [] : [id]
  const due = await db.prepare(`SELECT 1 FROM stump_people p WHERE ${SIGNED_IN}${only} LIMIT 1`).bind(...args).first()
  if (!due) return
  await db.batch([
    db.prepare(`INSERT INTO stump_team_history(id,action,person_id,email,actor_id,detail,at)
      SELECT lower(hex(randomblob(16))),'accept',p.id,p.email,p.id,json_object('role',p.role,'invited_at',p.invited_at),${SIGNED_IN_AT}
      FROM stump_people p WHERE ${SIGNED_IN}${only}`).bind(...args),
    db.prepare(`UPDATE stump_people AS p SET status='active',joined_at=${SIGNED_IN_AT},revision=revision+1 WHERE ${SIGNED_IN}${only}`).bind(...args),
  ])
}

export async function readPerson(db: D1Database, id: string): Promise<StumpPerson | null> {
  const read = () => db.prepare(`SELECT ${COLUMNS} FROM stump_people WHERE id=?`).bind(id).first<PersonRow>()
  let row = await read()
  if (row?.status === 'invited') { await acceptSignedIn(db, id); row = await read() }
  return row ? toPerson(row) : null
}

/** Everyone on the team: active people by join time, then people still to sign in. */
export async function listPeople(db: D1Database): Promise<StumpPerson[]> {
  await acceptSignedIn(db)
  const rows = await db.prepare(`SELECT ${COLUMNS} FROM stump_people WHERE status IN ('active','invited')
    ORDER BY status='invited',COALESCE(joined_at,invited_at),id`).all<PersonRow>()
  return rows.results.map(toPerson)
}

/**
 * The Stump person behind an active Base operator, or null when they are not on
 * the team. A person exists only through an accepted invitation (D-1), accepted
 * when the invited email signs in. The installation owner Base set up becomes
 * Stump's owner while Stump has none.
 */
export async function resolvePerson(db: D1Database, operator: Operator, now = Date.now()): Promise<StumpPerson | null> {
  if (operator.status !== 'active') return null
  const existing = await readPerson(db, operator.id)
  if (existing) return existing.status === 'active' ? existing : null
  if (operator.role !== 'owner') return null
  // Base's installation owner claims Stump's owner seat once, while it is empty.
  const email = operator.email.trim().toLowerCase()
  const name = operator.displayName ?? operator.display_name ?? email
  const inserted = await db.prepare(`INSERT INTO stump_people(id,email,display_name,role,status,joined_at)
    SELECT ?,?,?,'owner','active',? WHERE NOT EXISTS(SELECT 1 FROM stump_people WHERE role='owner' AND status='active') ON CONFLICT DO NOTHING RETURNING id`)
    .bind(operator.id, email, name, now).first<{ id: string }>()
  if (!inserted) return null
  await db.prepare("INSERT INTO stump_team_history(id,action,person_id,email,actor_id,detail,at) VALUES(?,'owner_setup',?,?,?,'{}',?)")
    .bind(crypto.randomUUID(), operator.id, email, operator.id, now).run()
  return readPerson(db, operator.id)
}
