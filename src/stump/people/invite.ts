import type { TeamAdmin } from '../actions/types.ts'
import type { StumpEnv } from '../env.ts'

interface Sender { invite(input: { email: string; displayName: string; role?: 'admin' | 'member'; returnTo?: string }): Promise<{ status: 'accepted' }> }

/**
 * Base sends the sign-in invitation; Stump keeps the role, connection and
 * disclosure lines, and accepts its own invitation at that person's first
 * signed-in request. Someone Base already knows signs in as themselves.
 */
export function baseInvite(env: StumpEnv, sender: Sender): TeamAdmin {
  return {
    async invite({ email, displayName }) {
      const existing = await env.DB.prepare('SELECT status FROM oa_operators WHERE email=?').bind(email).first<{ status: string }>()
      if (existing && existing.status !== 'inactive') return
      await sender.invite({ email, displayName, role: 'member', returnTo: '/app' })
    },
  }
}
