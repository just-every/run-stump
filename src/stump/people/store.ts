import type { Connection, Role } from './roles.ts'

export interface StumpPerson {
  id: string
  email: string
  display_name: string
  role: Role
  connection: Connection | null
  disclosure_lines: string[]
  status: 'active' | 'removed'
  joined_at: number
}

interface Operator { id: string; email: string; displayName?: string; display_name?: string; role: string; status: string }
interface PersonRow { id: string; email: string; display_name: string; role: Role; connection: Connection | null; disclosure_lines: string; status: 'active' | 'removed'; joined_at: number }

const toPerson = (row: PersonRow): StumpPerson => ({ ...row, disclosure_lines: JSON.parse(row.disclosure_lines) as string[] })

export async function readPerson(db: D1Database, id: string): Promise<StumpPerson | null> {
  const row = await db.prepare('SELECT id,email,display_name,role,connection,disclosure_lines,status,joined_at FROM stump_people WHERE id=?').bind(id).first<PersonRow>()
  return row ? toPerson(row) : null
}

/**
 * The Stump person behind an active Base operator, or null when they are not on
 * the team. A person exists only through an accepted invitation (D-1): the first
 * request after their invited email signs in accepts the invitation. The
 * installation owner Base set up becomes Stump's owner while Stump has none.
 */
export async function resolvePerson(db: D1Database, operator: Operator, now = Date.now()): Promise<StumpPerson | null> {
  if (operator.status !== 'active') return null
  const existing = await readPerson(db, operator.id)
  if (existing?.status === 'active') return existing
  const email = operator.email.trim().toLowerCase()
  const invitation = await db.prepare("SELECT id,display_name,role,connection,disclosure_lines FROM stump_invitations WHERE email=? AND state='pending'").bind(email)
    .first<{ id: string; display_name: string; role: Role; connection: Connection | null; disclosure_lines: string }>()
  if (invitation) {
    await db.batch([
      db.prepare(`INSERT INTO stump_people(id,email,display_name,role,connection,disclosure_lines,status,invitation_id,joined_at)
        SELECT ?,?,?,?,?,?,'active',?,? WHERE EXISTS(SELECT 1 FROM stump_invitations WHERE id=? AND state='pending')
        ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,role=excluded.role,connection=excluded.connection,
          disclosure_lines=excluded.disclosure_lines,status='active',invitation_id=excluded.invitation_id,joined_at=excluded.joined_at,removed_at=NULL,revision=stump_people.revision+1`)
        .bind(operator.id, email, invitation.display_name, invitation.role, invitation.connection, invitation.disclosure_lines, invitation.id, now, invitation.id),
      db.prepare("UPDATE stump_invitations SET state='accepted',accepted_at=?,person_id=? WHERE id=? AND state='pending'").bind(now, operator.id, invitation.id),
      db.prepare("INSERT INTO stump_team_history(id,action,person_id,email,actor_id,detail,at) VALUES(?,'accept',?,?,?,?,?)")
        .bind(crypto.randomUUID(), operator.id, email, operator.id, JSON.stringify({ invitation_id: invitation.id, role: invitation.role }), now),
    ])
    return readPerson(db, operator.id)
  }
  if (operator.role === 'owner' && !existing) {
    // Base's installation owner claims Stump's owner seat once, while it is empty.
    const name = operator.displayName ?? operator.display_name ?? email
    const inserted = await db.prepare(`INSERT INTO stump_people(id,email,display_name,role,status,joined_at)
      SELECT ?,?,?,'owner','active',? WHERE NOT EXISTS(SELECT 1 FROM stump_people WHERE role='owner' AND status='active') ON CONFLICT DO NOTHING RETURNING id`)
      .bind(operator.id, email, name, now).first<{ id: string }>()
    if (inserted) {
      await db.prepare("INSERT INTO stump_team_history(id,action,person_id,email,actor_id,detail,at) VALUES(?,'owner_setup',?,?,?,'{}',?)")
        .bind(crypto.randomUUID(), operator.id, email, operator.id, now).run()
      return readPerson(db, operator.id)
    }
  }
  return null
}

export async function readOperator(db: D1Database, id: string): Promise<Operator | null> {
  return db.prepare('SELECT id,email,display_name AS displayName,role,status FROM oa_operators WHERE id=?').bind(id).first<Operator>()
}
