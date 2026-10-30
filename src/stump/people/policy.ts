import { isActiveOperator, type PolicyInput } from '../../modules/operator-auth/index.mjs'

/**
 * Base's account administration follows Stump's roles (STUMP-TEAM-001), never
 * Base's own: the person acting must be on Stump's team, and what they may do
 * is decided by their Stump role.
 *
 * - Everyone lists and ends their own sign-in sessions.
 * - Stump's owner and admins list accounts and send invitations, only ever as
 *   a Base member; owner authority moves only by Stump's transfer.
 * - Only Stump's owner manages other people's sessions, sign-in providers and
 *   email-domain rules.
 * - Account status and roles change only through `stump.team.manage`, which
 *   protects the owner, keeps admins from acting on each other and records the
 *   team history, so Base's own status, role and cancellation routes refuse.
 */
export function stumpRolePolicy(db: D1Database) {
  return async ({ actor, action, target, role }: PolicyInput): Promise<boolean> => {
    if (!isActiveOperator(actor)) return false
    if ((action === 'sessions:list' || action === 'sessions:revoke') && target?.id === actor.id) return true
    const person = await db.prepare("SELECT role FROM stump_people WHERE id=? AND status='active'").bind(actor.id).first<{ role: string }>()
    if (!person) return false
    const admin = person.role === 'owner' || person.role === 'admin'
    switch (action) {
      case 'operators:list': return admin
      case 'operators:invite': return admin && role === 'member'
      case 'sessions:list': case 'sessions:revoke': case 'providers:manage': case 'domains:manage': return person.role === 'owner'
      default: return false
    }
  }
}
