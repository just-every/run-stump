import { refuse, NO_PERSONAS } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { ADMINS, CONNECTIONS, EVERYONE, ROLES, isRole, rank, type Role } from '../people/roles.ts'
import { listPeople, readPerson, type StumpPerson } from '../people/store.ts'
import { answerRemovedPerson } from '../handoffs/lapse.ts'

const email = { type: 'string', format: 'email', minLength: 3, maxLength: 254 }
const personId = { type: 'string', minLength: 1, maxLength: 64 }
const role = { enum: [...ROLES] }
const lines = { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 280 } }
const access = (direction: 'widens' | 'narrows', measure = 1) => [{ class: 'access' as const, facts: { measure, direction } }]

const normalEmail = (value: unknown) => String(value).trim().toLowerCase()
const iso = (at: number | null) => at === null ? null : new Date(at).toISOString()
const publicPerson = (person: StumpPerson) => ({ id: person.id, email: person.email, display_name: person.display_name, role: person.role,
  connection: person.connection, disclosure_lines: person.disclosure_lines, status: person.status, invited_at: iso(person.invited_at), joined_at: iso(person.joined_at) })

async function history(ctx: ActionContext, action: string, person: { id?: string | null; email?: string | null }, detail: Record<string, unknown>) {
  return ctx.db.prepare('INSERT INTO stump_team_history(id,action,person_id,email,actor_id,agent_id,detail,at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), action, person.id ?? null, person.email ?? null, ctx.person.id, ctx.agent?.id ?? null, JSON.stringify(detail), ctx.now())
}

/** A person on the team: active, or invited and still to sign in. */
async function teammate(ctx: ActionContext, id: unknown): Promise<StumpPerson> {
  const person = await readPerson(ctx.db, String(id))
  if (!person || person.status === 'removed') refuse('not_found', { person_id: String(id) })
  return person
}

/** Owners and admins manage the team; only the owner moves owner authority (STUMP-TEAM-001). */
function mayChange(ctx: ActionContext, target: StumpPerson, role?: Role) {
  if (target.role === 'owner') refuse('owner_protected', { person_id: target.id, reason: 'Transfer ownership to another person first.' })
  if (role === 'owner' && ctx.person.role !== 'owner') refuse('forbidden', { action: 'set_role', role: ctx.person.role })
  if (role === 'owner' && target.status !== 'active') refuse('conflict', { person_id: target.id, reason: 'Ownership moves only to someone who has signed in.' })
  if (ctx.person.role === 'admin' && target.role === 'admin' && target.id !== ctx.person.id) refuse('forbidden', { action: 'set_role', role: ctx.person.role })
}

export const teamTools: StumpTool[] = [{
  name: 'stump.team.manage', title: 'Manage the team',
  description: 'Invite people with a role and their connection to the company, list the team, change roles and remove people. A person exists only through an accepted invitation.',
  scope: 'stump:team', classes: ['access', 'standard'], clauses: ['STUMP-TEAM-001'],
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
        // The person is Base's operator for this email, invited and holding nothing until they sign in (D-1).
        // Inviting someone already invited replaces the invitation, so the newest role and connection apply.
        const id = await ctx.admin.invite({ email: address, displayName: String(args.display_name) }), now = ctx.now()
        const invited = await ctx.db.prepare(`INSERT INTO stump_people(id,email,display_name,role,connection,disclosure_lines,status,invited_at,invited_by,invited_by_agent)
          VALUES(?,?,?,?,?,?,'invited',?,?,?)
          ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,role=excluded.role,connection=excluded.connection,
            disclosure_lines=excluded.disclosure_lines,status='invited',invited_at=excluded.invited_at,invited_by=excluded.invited_by,
            invited_by_agent=excluded.invited_by_agent,joined_at=NULL,removed_at=NULL,revision=stump_people.revision+1
          WHERE stump_people.status<>'active' RETURNING id`)
          .bind(id, address, String(args.display_name), String(args.role), (args.connection as string | undefined) ?? null, JSON.stringify(args.disclosure_lines ?? []), now, ctx.person.id, ctx.agent?.id ?? null)
          .first<{ id: string }>()
        if (!invited) refuse('already_member', { person_id: id })
        await (await history(ctx, 'invite', { id, email: address }, { role: args.role, connection: args.connection ?? null })).run()
        ctx.emit('team.invited', `stump://people/${id}`, { role: args.role })
        return publicPerson((await readPerson(ctx.db, id))!)
      },
    },
    list: {
      roles: EVERYONE, read: true,
      // Reading the team changes no one's access: standard work, so a policy that blocks access changes still lets an agent find the person ids drafts need.
      classify: () => [{ class: 'standard' as const, facts: { measure: 0 } }],
      async run(_args, ctx) {
        const items = (await listPeople(ctx.db)).map(publicPerson)
        return { items, total: items.length }
      },
    },
    set_role: {
      roles: ADMINS,
      properties: { person_id: personId, role },
      required: ['person_id', 'role'],
      async classify(args, ctx) { const target = await teammate(ctx, args.person_id); return access(rank(args.role as Role) > rank(target.role) ? 'widens' : 'narrows') },
      async summary(args, ctx) { const target = await teammate(ctx, args.person_id); return { target: { id: target.id, name: target.display_name, email: target.email }, role: String(args.role) } },
      target: args => ({ kind: 'person', id: String(args.person_id) }),
      // Read before the role check, so a caller without the role who would widen their own reach is told self_escalation.
      async authority(args, ctx) {
        const target = await readPerson(ctx.db, String(args.person_id))
        return target && target.status !== 'removed' && isRole(args.role) ? { subject: target.id, widens: rank(args.role) > rank(target.role) } : null
      },
      async run(args, ctx) {
        const target = await teammate(ctx, args.person_id), role = args.role as Role, now = ctx.now()
        mayChange(ctx, target, role)
        if (target.role === role) return publicPerson(target)
        if (role === 'owner') {
          // Ownership moves to another person; the previous owner stays on as an admin, and the transfer is recorded.
          await ctx.db.batch([
            ctx.db.prepare("UPDATE stump_people SET role='admin',revision=revision+1 WHERE id=? AND role='owner' AND status='active'").bind(ctx.person.id),
            ctx.db.prepare("UPDATE stump_people SET role='owner',revision=revision+1 WHERE id=? AND role=? AND status='active'").bind(target.id, target.role),
            await history(ctx, 'transfer_ownership', target, { from: ctx.person.id, to: target.id }),
          ])
        } else {
          const changed = await ctx.db.prepare("UPDATE stump_people SET role=?,revision=revision+1 WHERE id=? AND role=? AND status=? AND role<>'owner'").bind(role, target.id, target.role, target.status).run()
          if (!changed.meta.changes) refuse('conflict', { person_id: target.id })
          await (await history(ctx, 'set_role', target, { from: target.role, to: role })).run()
        }
        ctx.emit('team.role_changed', `stump://people/${target.id}`, { role })
        return { ...publicPerson((await readPerson(ctx.db, target.id))!), changed_at: new Date(now).toISOString() }
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
        return publicPerson((await readPerson(ctx.db, target.id))!)
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
          ctx.db.prepare("UPDATE stump_people SET status='removed',removed_at=?,revision=revision+1 WHERE id=? AND status=? AND role<>'owner'").bind(now, target.id, target.status),
          ctx.db.prepare('UPDATE stump_agent_credentials SET revoked_at=? WHERE person_id=? AND revoked_at IS NULL').bind(now, target.id),
          ...scheduled.flatMap(item => [
            ctx.db.prepare("UPDATE stump_items SET state='draft',scheduled_at=NULL,updated_at=? WHERE id=? AND state=?").bind(now, item.id, item.state),
            ctx.db.prepare("INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at) VALUES(?,?,?,'draft',?,?,'person removed',?)")
              .bind(crypto.randomUUID(), item.id, item.state, ctx.person.id, ctx.agent?.id ?? null, now),
          ]),
          // Removing someone still to sign in cancels their invitation.
          await history(ctx, target.status === 'invited' ? 'cancel_invitation' : 'remove', target, { open_handoffs: handoffs.length, unscheduled_items: scheduled.length }),
        ])
        ctx.emit('team.removed', `stump://people/${target.id}`)
        // The removed person's record, with the open hand-offs and unscheduled items that now need an answer:
        // each hand-off moves to the venue's next member or expires, with its history (STUMP-HANDOFF-003.5).
        return { ...publicPerson((await readPerson(ctx.db, target.id))!), open_handoffs: handoffs, handoffs_answered: await answerRemovedPerson(ctx, target.id), unscheduled_items: scheduled.map(item => item.id) }
      },
    },
  },
}]

export type { Args }
