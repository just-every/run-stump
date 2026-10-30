import type { TeamAdmin } from '../actions/types.ts'
import type { StumpEnv } from '../env.ts'

interface Sender { invite(input: { email: string; displayName: string; role?: 'admin' | 'member'; returnTo?: string }): Promise<{ status: 'accepted' }> }

/**
 * Base sends the sign-in invitation and keeps the operator; Stump keys its
 * person by that operator id and keeps the role, connection and disclosure
 * lines. Someone Base already knows signs in as themselves.
 */
export function baseInvite(env: StumpEnv, sender: Sender): TeamAdmin {
  const operator = (email: string) => env.DB.prepare('SELECT id,status FROM oa_operators WHERE email=?').bind(email).first<{ id: string; status: string }>()
  return {
    async invite({ email, displayName }) {
      const existing = await operator(email)
      if (existing && existing.status !== 'inactive') return existing.id
      await sender.invite({ email, displayName, role: 'member', returnTo: '/app' })
      const invited = await operator(email)
      if (!invited) throw new Error('Base recorded no operator for the invitation')
      return invited.id
    },
  }
}
