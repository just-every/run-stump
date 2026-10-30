import { refuse, NO_PERSONAS } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { ADMINS, CONNECTIONS, EVERYONE, ROLES, rank, type Role } from '../people/roles.ts'
import { readPerson, type StumpPerson } from '../people/store.ts'

const email = { type: 'string', format: 'email', minLength: 3, maxLength: 254 }
const personId = { type: 'string', minLength: 1, maxLength: 64 }
const role = { enum: [...ROLES] }
const lines = { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 280 } }
const access = (direction: 'widens' | 'narrows', measure = 1) => [{ class: 'access' as const, facts: { measure, direction } }]

const normalEmail = (value: unknown) => String(value).trim().toLowerCase()
const publicPerson = (person: StumpPerson) => ({ id: person.id, email: person.email, display_name: person.display_name, role: person.role,
  connection: person.connection, disclosure_lines: person.disclosure_lines, status: person.status, joined_at: new Date(person.joined_at).toISOString() })

async function history(ctx: ActionContext, action: string, person: { id?: string | null; email?: string | null }, detail: Record<string, unknown>) {
  return ctx.db.prepare('INSERT INTO stump_team_history(id,action,person_id,email,actor_id,agent_id,detail,at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), action, person.id ?? null, person.email ?? null, ctx.person.id, ctx.agent?.id ?? null, JSON.stringify(detail), ctx.now())
}

async function teammate(ctx: ActionContext, id: unknown): Promise<StumpPerson> {
  const person = await readPerson(ctx.db, String(id))
  if (!person || person.status !== 'active') refuse('not_found', { person_id: String(id) })
  return person
}

/** Owners and admins manage the team; only the owner moves owner authority (STUMP-TEAM-001). */
function mayChange(ctx: ActionContext, target: StumpPerson, role?: Role) {
  if (target.role === 'owner') refuse('owner_protected', { person_id: target.id, reason: 'Transfer ownership to another person first.' })
  if (role === 'owner' && ctx.person.role !== 'owner') refuse('forbidden', { action: 'set_role', role: ctx.person.role })
  if (ctx.person.role === 'admin' && target.role === 'admin' && target.id !== ctx.person.id) refuse('forbidden', { action: 'set_role', role: ctx.person.role })
}

export const teamTools: StumpTool[] = [{
  name: 'stump.team.manage', title: 'Manage the team',
  description: 'Invite people with a role and their connection to the company, list the team, change roles and remove people. A person exists only through an accepted invitation.',
  scope: 'stump:team', classes: ['access'], clauses: ['STUMP-TEAM-001', 'STUMP-TRUTH-001'],
  refused: { create: NO_PERSONAS, add: NO_PERSONAS, import_person: NO_PERSONAS },
  actions: {
    invite: {
      roles: ADMINS,
      properties: { email, display_name: { type: 'string', minLength: 1, maxLength: 120 }, role, connection: { enum: [...CONNECTIONS] }, disclosure_lines: lines },
      required: ['email', 'display_name', 'role'],
      classify: () => access('widens'),
      summary: args => ({ target: { email: normalEmail(args.email), name: String(args.display_name) }, role: String(args.role) }),
      authority: async args => ({ subject: normalEmail(args.email), widens: true }),
      async run(args, ctx) {
        const address = normalEmail(args.email)
        // Owner authority moves only by transfer (set_role), never by invitation.
        if (args.role === 'owner') refuse('invalid_arguments', { field: 'role', reason: 'Invite as admin, then transfer ownership.' })
        const member = await ctx.db.prepare("SELECT id FROM stump_people WHERE email=? AND status='active'").bind(address).first<{ id: string }>()
        if (member) refuse('already_member', { person_id: member.id })
        await ctx.admin.invite({ email: address, displayName: String(args.display_name) })
        const id = crypto.randomUUID(), now = ctx.now()
        // A pending invitation for the same address is replaced, so the newest role and connection apply.
        await ctx.db.batch([
          ctx.db.prepare("UPDATE stump_invitations SET state='cancelled' WHERE email=? AND state='pending'").bind(address),
          ctx.db.prepare('INSERT INTO stump_invitations(id,email,display_name,role,connection,disclosure_lines,invited_by,invited_by_agent,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .bind(id, address, String(args.display_name), String(args.role), (args.connection as string | undefined) ?? null, JSON.stringify(args.disclosure_lines ?? []), ctx.person.id, ctx.agent?.id ?? null, now),
          await history(ctx, 'invite', { email: address }, { invitation_id: id, role: args.role, connection: args.connection ?? null }),
        ])
        ctx.emit('team.invited', `stump://people/invitations/${id}`, { role: args.role })
        return { invitation: { id, email: address, display_name: String(args.display_name), role: String(args.role), connection: (args.connection as string | undefined) ?? null, state: 'pending', created_at: new Date(now).toISOString() } }
      },
    },
    list: {
      roles: EVERYONE, read: true,
      classify: () => access('narrows', 0),
      async run(_args, ctx) {
        const people = (await ctx.db.prepare("SELECT id FROM stump_people WHERE status='active' ORDER BY joined_at,id").all<{ id: string }>()).results
        const items = (await Promise.all(people.map(row => readPerson(ctx.db, row.id)))).filter((p): p is StumpPerson => !!p).map(publicPerson)
        const invitations = ['owner', 'admin'].includes(ctx.person.role)
          ? (await ctx.db.prepare("SELECT id,email,display_name,role,connection,created_at FROM stump_invitations WHERE state='pending' ORDER BY created_at").all<Record<string, unknown>>()).results
            .map(row => ({ ...row, state: 'pending', created_at: new Date(Number(row.created_at)).toISOString() }))
          : []
        return { items, total: items.length, invitations }
      },
    },
    set_role: {
      roles: ADMINS,
      properties: { person_id: personId, role },
      required: ['person_id', 'role'],
      async classify(args, ctx) { const target = await teammate(ctx, args.person_id); return access(rank(args.role as Role) > rank(target.role) ? 'widens' : 'narrows') },
      async summary(args, ctx) { const target = await teammate(ctx, args.person_id); return { target: { id: target.id, name: target.display_name, email: target.email }, role: String(args.role) } },
      target: args => ({ kind: 'person', id: String(args.person_id) }),
      async authority(args, ctx) { const target = await teammate(ctx, args.person_id); return { subject: target.id, widens: rank(args.role as Role) > rank(target.role) } },
      async run(args, ctx) {
        const target = await teammate(ctx, args.person_id), role = args.role as Role, now = ctx.now()
        mayChange(ctx, target, role)
        if (target.role === role) return { person: publicPerson(target) }
        if (role === 'owner') {
          // Ownership moves to another person; the previous owner stays on as an admin, and the transfer is recorded.
          await ctx.db.batch([
            ctx.db.prepare("UPDATE stump_people SET role='admin',revision=revision+1 WHERE id=? AND role='owner' AND status='active'").bind(ctx.person.id),
            ctx.db.prepare("UPDATE stump_people SET role='owner',revision=revision+1 WHERE id=? AND role=? AND status='active'").bind(target.id, target.role),
            await history(ctx, 'transfer_ownership', target, { from: ctx.person.id, to: target.id }),
          ])
        } else {
          const changed = await ctx.db.prepare("UPDATE stump_people SET role=?,revision=revision+1 WHERE id=? AND role=? AND status='active' AND role<>'owner'").bind(role, target.id, target.role).run()
          if (!changed.meta.changes) refuse('conflict', { person_id: target.id })
          await (await history(ctx, 'set_role', target, { from: target.role, to: role })).run()
        }
        ctx.emit('team.role_changed', `stump://people/${target.id}`, { role })
        return { person: publicPerson((await readPerson(ctx.db, target.id))!), changed_at: new Date(now).toISOString() }
      },
    },
    update: {
      roles: EVERYONE,
      properties: { person_id: personId, display_name: { type: 'string', minLength: 1, maxLength: 120 }, connection: { enum: [...CONNECTIONS] }, disclosure_lines: lines },
      required: ['person_id'],
      classify: () => access('narrows'),
      async summary(args, ctx) { const target = await teammate(ctx, args.person_id); return { target: { id: target.id, name: target.display_name } } },
      target: args => ({ kind: 'person', id: String(args.person_id) }),
      authority: async args => ({ subject: String(args.person_id), widens: false }),
      async run(args, ctx) {
        const target = await teammate(ctx, args.person_id)
        const admin = ['owner', 'admin'].includes(ctx.person.role)
        // A person keeps their own name and disclosure lines; their connection to the company is recorded by an owner or admin.
        if (!admin && (target.id !== ctx.person.id || args.connection !== undefined)) refuse('forbidden', { action: 'update', role: ctx.person.role })
        const next = {
          display_name: (args.display_name as string | undefined) ?? target.display_name,
          connection: (args.connection as string | undefined) ?? target.connection,
          disclosure_lines: (args.disclosure_lines as string[] | undefined) ?? target.disclosure_lines,
        }
        await ctx.db.batch([
          ctx.db.prepare('UPDATE stump_people SET display_name=?,connection=?,disclosure_lines=?,revision=revision+1 WHERE id=?').bind(next.display_name, next.connection, JSON.stringify(next.disclosure_lines), target.id),
          await history(ctx, 'update', target, { fields: Object.keys(args).filter(key => key !== 'action' && key !== 'person_id') }),
        ])
        return { person: publicPerson((await readPerson(ctx.db, target.id))!) }
      },
    },
    remove: {
      roles: ADMINS,
      properties: { person_id: personId },
      required: ['person_id'],
      classify: () => access('narrows'),
      async summary(args, ctx) { const target = await teammate(ctx, args.person_id); return { target: { id: target.id, name: target.display_name, email: target.email } } },
      target: args => ({ kind: 'person', id: String(args.person_id) }),
      authority: async args => ({ subject: String(args.person_id), widens: false }),
      async run(args, ctx) {
        const target = await teammate(ctx, args.person_id), now = ctx.now()
        mayChange(ctx, target)
        const handoffs = (await ctx.db.prepare("SELECT id FROM stump_handoffs WHERE person_id=? AND state IN ('open','join_first','held') ORDER BY due_at,id").bind(target.id).all<{ id: string }>()).results.map(row => row.id)
        const scheduled = (await ctx.db.prepare("SELECT id,state FROM stump_items WHERE person_id=? AND state IN ('scheduled','paused') ORDER BY scheduled_at,id").bind(target.id).all<{ id: string; state: string }>()).results
        // Their scheduled items go back to draft (nothing posts as someone who left), and their agents stop.
        await ctx.db.batch([
          ctx.db.prepare("UPDATE stump_people SET status='removed',removed_at=?,revision=revision+1 WHERE id=? AND status='active' AND role<>'owner'").bind(now, target.id),
          ctx.db.prepare('UPDATE stump_agent_credentials SET revoked_at=? WHERE person_id=? AND revoked_at IS NULL').bind(now, target.id),
          ...scheduled.flatMap(item => [
            ctx.db.prepare("UPDATE stump_items SET state='draft',scheduled_at=NULL,updated_at=? WHERE id=? AND state=?").bind(now, item.id, item.state),
            ctx.db.prepare("INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at) VALUES(?,?,?,'draft',?,?,'person removed',?)")
              .bind(crypto.randomUUID(), item.id, item.state, ctx.person.id, ctx.agent?.id ?? null, now),
          ]),
          await history(ctx, 'remove', target, { open_handoffs: handoffs.length, unscheduled_items: scheduled.length }),
        ])
        ctx.emit('team.removed', `stump://people/${target.id}`)
        return { person_id: target.id, removed: true, open_handoffs: handoffs, unscheduled_items: scheduled.map(item => item.id) }
      },
    },
    cancel_invitation: {
      roles: ADMINS,
      properties: { invitation_id: personId },
      required: ['invitation_id'],
      classify: () => access('narrows'),
      summary: args => ({ target: { id: String(args.invitation_id) } }),
      authority: async args => ({ subject: String(args.invitation_id), widens: false }),
      async run(args, ctx) {
        const row = await ctx.db.prepare("UPDATE stump_invitations SET state='cancelled' WHERE id=? AND state='pending' RETURNING email").bind(String(args.invitation_id)).first<{ email: string }>()
        if (!row) refuse('not_found', { invitation_id: String(args.invitation_id) })
        await (await history(ctx, 'cancel_invitation', { email: row.email }, { invitation_id: args.invitation_id })).run()
        return { invitation_id: String(args.invitation_id), state: 'cancelled' }
      },
    },
  },
}]

export type { Args }
