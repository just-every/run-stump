import { defaultRolePolicy, type PolicyInput } from '../../modules/operator-auth/index.mjs'

const TEAM_ACTIONS = new Set(['operators:invite', 'operators:deactivate', 'operators:reactivate', 'operators:role'])

/**
 * Base's account administration follows Stump's roles: only Stump's owner and
 * admins send invitations or change accounts, and never to make an owner.
 * Everything else keeps Base's default policy.
 */
export function stumpRolePolicy(db: D1Database) {
  return async (input: PolicyInput): Promise<boolean> => {
    if (!TEAM_ACTIONS.has(input.action)) return defaultRolePolicy(input)
    if (input.actor.status !== 'active' || input.role === 'owner' || input.target?.role === 'owner') return false
    const actor = await db.prepare("SELECT role FROM stump_people WHERE id=? AND status='active'").bind(input.actor.id).first<{ role: string }>()
    return actor?.role === 'owner' || actor?.role === 'admin'
  }
}
