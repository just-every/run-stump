import { refuse, NO_PERSONAS } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { ADMINS, CONNECTIONS, EVERYONE, ROLES, isRole, rank, type Role } from '../people/roles.ts'
import { listPeople, readPerson, type StumpPerson } from '../people/store.ts'
import { answerRemovedPerson } from '../handoffs/lapse.ts'
import { outsideVoice } from '../handoffs/brief.ts'
import { refuseClaimingLines } from '../drafting/check.ts'
import { disconnectAccount } from '../accounts/connect.ts'
import type { AccountRow } from '../accounts/store.ts'
import { IMPORT_HOLD_SQL, moveItem, type ItemState } from '../items/state.ts'

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

const sameLines = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((line, index) => line === b[index])

/**
 * What an update changes for its person, read from their record. Moving an
 * outside voice (a contractor, investor, advisor, friend, family, or nobody
 * recorded) to founder or employee lets Stump write in their voice about the
 * company (D-8), and someone else's disclosure lines decide what counts as
 * their disclosure (D-2): both widen what is done in that person's name.
 * Another person's connection and disclosure lines are recorded by a signed-in
 * person, never by an agent, and follow the same protection as roles: the
 * owner's are their own, and an admin does not change another admin's.
 */
async function updating(ctx: ActionContext, args: Args) {
  const target = await teammate(ctx, args.person_id)
  const admin = ['owner', 'admin'].includes(ctx.person.role), other = target.id !== ctx.person.id
  // A person keeps their own disclosure lines; their connection to the company is recorded by an owner or admin.
  if (!admin && (other || args.connection !== undefined)) refuse('forbidden', { action: 'update', role: ctx.person.role })
  // A teammate's name is a word the claim check reads as the team's own (drafting/check.ts loadBrand), so after the
  // invitation a name changes only by a signed-in owner or admin, never by an agent.
  if (args.display_name !== undefined && args.display_name !== target.display_name) {
    if (!admin) refuse('forbidden', { action: 'update', field: 'display_name', role: ctx.person.role, reason: 'An owner or admin records names on the team.' })
    if (ctx.agent) refuse('person_only', { field: 'display_name', reason: 'Names on the team are recorded by a signed-in owner or admin.' })
  }
  const connection = args.connection === undefined ? target.connection : args.connection as StumpPerson['connection']
  const lines = args.disclosure_lines === undefined ? target.disclosure_lines : args.disclosure_lines as string[]
  const connectionChanged = connection !== target.connection, linesChanged = !sameLines(lines, target.disclosure_lines)
  if (other) {
    if (target.role === 'owner') refuse('owner_protected', { person_id: target.id, reason: 'The owner records their own connection and disclosure lines.' })
    if (ctx.person.role === 'admin' && target.role === 'admin') refuse('forbidden', { action: 'update', role: ctx.person.role })
    if (ctx.agent && (connectionChanged || linesChanged)) refuse('person_only', { field: connectionChanged ? 'connection' : 'disclosure_lines', reason: 'Another person\'s connection and disclosure lines are recorded by a signed-in person.' })
  }
  const insider = outsideVoice(target) && !outsideVoice({ role: target.role, connection })
  const widens = (connectionChanged && insider) || (other && linesChanged)
  return { target, connection, lines, widens, connectionChanged, linesChanged }
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
        if (args.disclosure_lines !== undefined) await refuseClaimingLines(ctx.db, args.disclosure_lines as string[], 'disclosure_lines', ctx.now())
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
        // How the invitation reaches them: Base emails a sign-in link once deployed; a local installation sends no mail,
        // so they sign in from this computer at /signin.
        const invitation = ctx.env.AUTH_LOCAL === 'true' ? { by: 'this_computer' as const, sign_in: '/signin' } : { by: 'email' as const }
        return { ...publicPerson((await readPerson(ctx.db, id))!), invitation }
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
          // The installation's sign-in owner moves with it, so installation settings and sign-in administration follow
          // Stump's owner: the new owner is made the sign-in owner before anyone else stops being one. Both people sign in again.
          const signIn = await ctx.db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND status='active'").bind(target.id).first()
          if (!signIn) refuse('conflict', { person_id: target.id, reason: 'Ownership moves only to someone who can sign in.' })
          await ctx.db.batch([
            ctx.db.prepare("UPDATE stump_people SET role='admin',revision=revision+1 WHERE id=? AND role='owner' AND status='active'").bind(ctx.person.id),
            ctx.db.prepare("UPDATE stump_people SET role='owner',revision=revision+1 WHERE id=? AND role=? AND status='active'").bind(target.id, target.role),
            ctx.db.prepare("UPDATE oa_operators SET role='owner' WHERE id=? AND status='active'").bind(target.id),
            ctx.db.prepare("UPDATE oa_operators SET role='member' WHERE role='owner' AND id<>?").bind(target.id),
            ctx.db.prepare("INSERT INTO oa_auth_audit(id,actor_id,action,value,created_at) VALUES(?,?,'operators.role',?,?)")
              .bind(crypto.randomUUID(), ctx.person.id, JSON.stringify({ operatorId: target.id, detail: 'owner', via: 'transfer_ownership' }), now),
            await history(ctx, 'transfer_ownership', target, { from: ctx.person.id, to: target.id }),
          ])
          ctx.emit('team.role_changed', `stump://people/${target.id}`, { role })
          return { ...publicPerson((await readPerson(ctx.db, target.id))!), changed_at: new Date(now).toISOString(), sign_in_again: true }
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
      async classify(args, ctx) { return access((await updating(ctx, args)).widens ? 'widens' : 'narrows') },
      async summary(args, ctx) {
        const change = await updating(ctx, args)
        // An approver reads what changes for the person: their connection, and the disclosure lines they would hold.
        const items = [...(change.connectionChanged ? [`Connection: ${change.target.connection ?? 'none'} to ${change.connection ?? 'none'}`] : []),
          ...(change.linesChanged ? [change.lines.length ? `Disclosure lines: ${change.lines.map(line => `"${line}"`).join(', ')}` : 'Disclosure lines: none'] : [])]
        return { target: { id: change.target.id, name: change.target.display_name }, ...(items.length ? { items } : {}) }
      },
      target: args => ({ kind: 'person', id: String(args.person_id) }),
      // Read before the role check, so a caller who would widen their own reach is told self_escalation.
      // The owner already holds every authority, so recording their own connection widens nothing of theirs.
      async authority(args, ctx) {
        const target = await readPerson(ctx.db, String(args.person_id))
        if (!target || target.status === 'removed') return null
        const connection = args.connection === undefined ? target.connection : args.connection as StumpPerson['connection']
        return { subject: target.id, widens: target.role !== 'owner' && connection !== target.connection && outsideVoice(target) && !outsideVoice({ role: target.role, connection }) }
      },
      async run(args, ctx) {
        const { target, connection, lines } = await updating(ctx, args)
        if (args.disclosure_lines !== undefined) await refuseClaimingLines(ctx.db, lines, 'disclosure_lines', ctx.now())
        const display_name = (args.display_name as string | undefined) ?? target.display_name
        await ctx.db.batch([
          ctx.db.prepare('UPDATE stump_people SET display_name=?,connection=?,disclosure_lines=?,revision=revision+1 WHERE id=?').bind(display_name, connection, JSON.stringify(lines), target.id),
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
        // Every item of theirs that could still go out goes back to draft: scheduled, paused, and held (a rate-limit or day-limit hold resumes by itself).
        // An imported post waiting for its release keeps waiting: nothing schedules it until a person releases it, and the release checks it again.
        const scheduled = (await ctx.db.prepare(`SELECT id,state FROM stump_items WHERE person_id=? AND state IN ('scheduled','paused','held') AND NOT ${IMPORT_HOLD_SQL} ORDER BY scheduled_at,id`).bind(target.id).all<{ id: string; state: ItemState }>()).results
        const mover = { db: ctx.db, person: ctx.person, agent: ctx.agent, now: () => now }
        // Nothing posts as someone who left: their items return to draft, their agents and sign-in sessions end.
        await ctx.db.batch([
          ctx.db.prepare("UPDATE stump_people SET status='removed',removed_at=?,revision=revision+1 WHERE id=? AND status=? AND role<>'owner'").bind(now, target.id, target.status),
          ctx.db.prepare('UPDATE stump_agent_credentials SET revoked_at=? WHERE person_id=? AND revoked_at IS NULL').bind(now, target.id),
          ctx.db.prepare('UPDATE oa_sessions SET revoked_at=? WHERE operator_id=? AND revoked_at IS NULL').bind(now, target.id),
          ...scheduled.flatMap(item => moveItem(mover, item, 'draft', 'person removed', { scheduled_at: null, queued: 0, hold: null })),
          // Removing someone still to sign in cancels their invitation.
          await history(ctx, target.status === 'invited' ? 'cancel_invitation' : 'remove', target, { open_handoffs: handoffs.length, unscheduled_items: scheduled.length }),
        ])
        // Their personal accounts are disconnected (revoked at the network where it allows), never passed to anyone else;
        // company accounts they connected stay the company's (STUMP-CONNECT-001).
        const personal = (await ctx.db.prepare("SELECT * FROM stump_accounts WHERE owner_kind='person' AND owner_person_id=? AND state<>'disconnected' ORDER BY network,handle").bind(target.id).all<AccountRow>()).results
        const disconnected: Array<{ account_id: string; revoked: string; unscheduled: string[] }> = []
        for (const account of personal) {
          const done = await disconnectAccount(ctx, account)
          disconnected.push({ account_id: account.id, revoked: done.revoked, unscheduled: done.unscheduled.map(item => item.item_id) })
        }
        ctx.emit('team.removed', `stump://people/${target.id}`)
        // The removed person's record, with the open hand-offs and unscheduled items that now need an answer:
        // each hand-off moves to the venue's next member or expires, with its history (STUMP-HANDOFF-003.5).
        return { ...publicPerson((await readPerson(ctx.db, target.id))!), open_handoffs: handoffs, handoffs_answered: await answerRemovedPerson(ctx, target.id),
          unscheduled_items: [...new Set([...scheduled.map(item => item.id), ...disconnected.flatMap(account => account.unscheduled)])], disconnected_accounts: disconnected }
      },
    },
  },
}]

export type { Args }
