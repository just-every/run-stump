import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { EDITORS, EVERYONE, READERS } from '../people/roles.ts'
import { readPerson } from '../people/store.ts'
import { holdOverLimit, usage } from '../venues/limits.ts'
import { eligibility, memberOf, type MemberRow } from '../venues/members.ts'
import { PERIODS, readVenue, rulesOf, venueHistory, venueOrRefuse, type VenueRow } from '../venues/model.ts'
import { answer, manageActions, venueId } from '../venues/register.ts'
import { mergeRules, refreshItems, routesFor, ruleChanges, RULES_SCHEMA } from '../venues/rules.ts'

// The venue register (STUMP-VENUE-001 to -006): records, rules and routes,
// the shared limit, and who on the team belongs where.
const standard = (measure = 1) => [{ class: 'standard' as const, facts: { measure } }]
const mover = (ctx: ActionContext) => ({ db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now })
const target = (args: Args) => ({ kind: 'venue', id: String(args.venue_id) })
const summary = async (args: Args, ctx: ActionContext) => ({ target: { id: String(args.venue_id), name: (await readVenue(ctx.db, args.venue_id))?.name } })
const revision = async (args: Args, ctx: ActionContext) => (await readVenue(ctx.db, args.venue_id))?.revision ?? null
const personId = { type: 'string', minLength: 1, maxLength: 80 }
const handle = { type: 'string', minLength: 1, maxLength: 120 }
const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }

/** Writes a venue column under its revision, refreshes the items there, and answers the venue. */
async function saveVenue(ctx: ActionContext, venue: VenueRow, action: string, column: 'rules' | 'shared_limit', value: string | null, detail: Record<string, unknown>, changes: string[] = []) {
  const [updated] = await ctx.db.batch([
    ctx.db.prepare(`UPDATE stump_venues SET ${column}=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`).bind(value, ctx.now(), venue.id, venue.revision),
    venueHistory(ctx.db, venue.id, action, mover(ctx), detail),
  ])
  if (!updated!.meta.changes) refuse('revision_conflict', { current_revision: (await readVenue(ctx.db, venue.id))?.revision ?? null })
  const next = (await readVenue(ctx.db, venue.id))!
  const follow = column === 'rules' ? await refreshItems(ctx.db, next, mover(ctx), changes) : await holdOverLimit(ctx.db, next, mover(ctx))
  if (follow.length) await ctx.db.batch(follow)
  ctx.emit(`venue.${action}`, `stump://venues/${venue.id}`)
  return next
}

async function teammate(ctx: ActionContext, id: unknown) {
  const person = await readPerson(ctx.db, String(id))
  if (!person || person.status === 'removed') refuse('not_found', { person_id: String(id) })
  return person
}
/** Editors record anyone's membership; everyone else records only their own (D-1). */
function forSelf(ctx: ActionContext, person: unknown) {
  if (!EDITORS.includes(ctx.person.role) && person !== ctx.person.id) refuse('forbidden', { action: 'members', role: ctx.person.role })
}
/** A handle belongs to one person at a venue (STUMP-VENUE-006.4). */
async function handleFree(ctx: ActionContext, venue: string, value: string, person: string) {
  const other = await ctx.db.prepare('SELECT person_id FROM stump_venue_members WHERE venue_id=? AND handle=? COLLATE NOCASE AND person_id<>?').bind(venue, value, person).first<{ person_id: string }>()
  const applying = await ctx.db.prepare("SELECT person_id FROM stump_venue_applications WHERE venue_id=? AND handle=? COLLATE NOCASE AND person_id<>? AND state='applied'").bind(venue, value, person).first<{ person_id: string }>()
  const holder = other ?? applying
  if (holder) refuse('handle_taken', { venue_id: venue, handle: value, person_id: holder.person_id })
}

const memberView = (venue: VenueRow, row: MemberRow & { display_name: string | null }, now: number) => ({
  venue_id: row.venue_id, person_id: row.person_id, display_name: row.display_name, handle: row.handle, joined_on: row.joined_on, karma: row.karma,
  ...(({ eligible, unmet }) => ({ eligible, unmet }))(eligibility(venue, row.person_id, row, now)),
})
const applicationView = (row: { id: string; venue_id: string; person_id: string; handle: string; state: string; created_at: number; decided_at: number | null }) => ({
  id: row.id, venue_id: row.venue_id, person_id: row.person_id, handle: row.handle, state: row.state,
  applied_at: new Date(row.created_at).toISOString(), decided_at: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
})

export const venueTools: StumpTool[] = [{
  name: 'stump.venues.manage', title: 'Manage the venue register',
  description: 'Create, read, list, edit, propose, exclude, archive and restore venues: the communities, newsletters, podcasts, directories, publications and journalists worth showing up for. One venue per place, shared across products.',
  scope: 'stump:venues', classes: ['standard'], clauses: ['STUMP-VENUE-001'],
  actions: manageActions,
}, {
  name: 'stump.venues.rules', title: 'Record venue rules and read routes',
  description: 'Record a venue\'s rules (posting, AI text, self-promotion, links, disclosure line, gates), each with the page it comes from and the date it was read, and read the routes those rules allow: publish, hand off with a draft, or hand off with a brief.',
  scope: 'stump:venues', classes: ['standard'], clauses: ['STUMP-VENUE-002'],
  actions: {
    set: {
      roles: EDITORS, properties: { venue_id: venueId, rules: RULES_SCHEMA }, required: ['venue_id', 'rules'],
      classify: () => standard(), summary, target, revision,
      async run(args, ctx) {
        const venue = await venueOrRefuse(ctx.db, args.venue_id)
        const before = routesFor(venue).routes, rules = mergeRules(rulesOf(venue), args.rules as Record<string, unknown>)
        const changes = ruleChanges(rulesOf(venue), rules)
        const next = await saveVenue(ctx, venue, 'rules', 'rules', JSON.stringify(Object.fromEntries(Object.entries(rules).filter(([, rule]) => rule !== null))),
          { rules: Object.keys(args.rules as object), changes, routes_before: before }, changes)
        return { venue: (await answer(ctx, [next]))[0], routes: routesFor(next) }
      },
    },
    routes: {
      roles: READERS, read: true, properties: { venue_id: venueId }, required: ['venue_id'],
      classify: () => standard(0), target,
      async run(args, ctx) { return routesFor(await venueOrRefuse(ctx.db, args.venue_id)) },
    },
  },
}, {
  name: 'stump.venues.fit', title: 'Set a venue\'s shared limit',
  description: 'Set how often the company as a whole may post at a venue, across every person and product (one post a week, say), and read how much of it is used and when the next post is allowed.',
  scope: 'stump:venues', classes: ['standard'], clauses: ['STUMP-VENUE-003'],
  actions: {
    set_limit: {
      roles: EDITORS, required: ['venue_id', 'limit'],
      properties: { venue_id: venueId, limit: { type: ['object', 'null'], additionalProperties: false, required: ['posts', 'per'], properties: { posts: { type: 'integer', minimum: 1, maximum: 1000 }, per: { enum: [...PERIODS] }, text: { type: ['string', 'null'], maxLength: 300 } } } },
      classify: () => standard(), summary, target, revision,
      async run(args, ctx) {
        const venue = await venueOrRefuse(ctx.db, args.venue_id), limit = args.limit as { posts: number; per: string; text?: string | null } | null
        const next = await saveVenue(ctx, venue, 'set_limit', 'shared_limit', limit ? JSON.stringify({ posts: limit.posts, per: limit.per, ...(limit.text ? { text: limit.text } : {}) }) : null, { limit })
        return { venue: (await answer(ctx, [next]))[0], usage: await usage(ctx.db, next, ctx.now()) }
      },
    },
    usage: {
      roles: READERS, read: true, properties: { venue_id: venueId, at: { type: 'string', format: 'date-time' } }, required: ['venue_id'],
      classify: () => standard(0), target,
      async run(args, ctx) {
        const venue = await venueOrRefuse(ctx.db, args.venue_id), at = typeof args.at === 'string' ? Date.parse(args.at) : ctx.now()
        return { venue_id: venue.id, ...await usage(ctx.db, venue, at) }
      },
    },
  },
}, {
  name: 'stump.venues.members', title: 'Record venue members and join applications',
  description: 'Record who on the team belongs to a venue, with their own handle, join date and karma; track join applications; and read whether a person meets the venue\'s gates to receive its hand-offs.',
  scope: 'stump:venues', classes: ['standard', 'gated'], clauses: ['STUMP-VENUE-006'],
  actions: {
    add: {
      roles: EVERYONE, properties: { venue_id: venueId, person_id: personId, handle, joined_on: day, karma: { type: ['integer', 'null'], minimum: 0 } },
      required: ['venue_id', 'person_id', 'handle'],
      classify: () => standard(), summary, target,
      async run(args, ctx) {
        forSelf(ctx, args.person_id)
        const venue = await venueOrRefuse(ctx.db, args.venue_id), person = await teammate(ctx, args.person_id), value = String(args.handle).trim()
        await handleFree(ctx, venue.id, value, person.id)
        await ctx.db.batch([
          ctx.db.prepare(`INSERT INTO stump_venue_members(venue_id,person_id,handle,joined_on,karma,created_at) VALUES(?,?,?,?,?,?)
            ON CONFLICT(venue_id,person_id) DO UPDATE SET handle=excluded.handle,joined_on=COALESCE(excluded.joined_on,stump_venue_members.joined_on),karma=COALESCE(excluded.karma,stump_venue_members.karma)`)
            .bind(venue.id, person.id, value, (args.joined_on as string | undefined) ?? null, (args.karma as number | undefined) ?? null, ctx.now()),
          venueHistory(ctx.db, venue.id, 'member_add', mover(ctx), { person_id: person.id, handle: value }),
        ])
        ctx.emit('venue.member_added', `stump://venues/${venue.id}`, { person_id: person.id })
        const row = (await memberOf(ctx.db, venue.id, person.id)).member!
        return { member: memberView(venue, { ...row, display_name: person.display_name }, ctx.now()) }
      },
    },
    list: {
      roles: EVERYONE, read: true, properties: { venue_id: venueId, person_id: personId },
      classify: () => standard(0),
      async run(args, ctx) {
        // A poster sees only their own memberships (STUMP-TEAM-001.2).
        const only = ctx.person.role === 'poster' ? ctx.person.id : (args.person_id as string | undefined) ?? null
        const venueFilter = (args.venue_id as string | undefined) ?? null
        if (venueFilter) await venueOrRefuse(ctx.db, venueFilter)
        const rows = (await ctx.db.prepare(`SELECT m.*,p.display_name FROM stump_venue_members m LEFT JOIN stump_people p ON p.id=m.person_id
          WHERE (?1 IS NULL OR m.venue_id=?1) AND (?2 IS NULL OR m.person_id=?2) ORDER BY m.venue_id,p.display_name,m.person_id`).bind(venueFilter, only).all<MemberRow & { display_name: string | null }>()).results
        const venues = new Map<string, VenueRow>()
        for (const row of rows) if (!venues.has(row.venue_id)) venues.set(row.venue_id, (await readVenue(ctx.db, row.venue_id))!)
        const applications = (await ctx.db.prepare(`SELECT * FROM stump_venue_applications WHERE (?1 IS NULL OR venue_id=?1) AND (?2 IS NULL OR person_id=?2) ORDER BY created_at DESC,id`)
          .bind(venueFilter, only).all<Parameters<typeof applicationView>[0]>()).results
        const items = rows.map(row => memberView(venues.get(row.venue_id)!, row, ctx.now()))
        return { items, total: items.length, applications: applications.map(applicationView) }
      },
    },
    eligibility: {
      roles: EVERYONE, read: true, properties: { venue_id: venueId, person_id: personId }, required: ['venue_id', 'person_id'],
      classify: () => standard(0), target,
      async run(args, ctx) {
        forSelf(ctx, args.person_id)
        const venue = await venueOrRefuse(ctx.db, args.venue_id), person = await teammate(ctx, args.person_id)
        const { member, application } = await memberOf(ctx.db, venue.id, person.id)
        return eligibility(venue, person.id, member, ctx.now(), application ? { id: application.id, state: application.state } : null)
      },
    },
    apply: {
      // person_id defaults to the caller: a person (or their agent) applies for themselves.
      roles: EVERYONE, properties: { venue_id: venueId, person_id: personId, handle }, required: ['venue_id', 'handle'],
      // The join application is a step the venue keeps for a person: it is gated, with the venue named (computed from the record, D-7).
      async classify(args, ctx) { const venue = await venueOrRefuse(ctx.db, args.venue_id); return [{ class: 'gated', facts: { measure: 1, provider: venue.name, step: 'join application' } }] },
      summary, target,
      async run(args, ctx) {
        const applicant = (args.person_id as string | undefined) ?? ctx.person.id
        forSelf(ctx, applicant)
        const venue = await venueOrRefuse(ctx.db, args.venue_id), person = await teammate(ctx, applicant), value = String(args.handle).trim()
        const { member, application } = await memberOf(ctx.db, venue.id, person.id)
        if (member) refuse('already_member', { venue_id: venue.id, person_id: person.id, handle: member.handle })
        if (application?.state === 'applied') {
          const open = await ctx.db.prepare('SELECT * FROM stump_venue_applications WHERE id=?').bind(application.id).first<Parameters<typeof applicationView>[0]>()
          return { application: applicationView(open!) }
        }
        await handleFree(ctx, venue.id, value, person.id)
        const id = crypto.randomUUID()
        await ctx.db.batch([
          ctx.db.prepare("INSERT INTO stump_venue_applications(id,venue_id,person_id,handle,state,created_by,created_at) VALUES(?,?,?,?,'applied',?,?)").bind(id, venue.id, person.id, value, ctx.person.id, ctx.now()),
          venueHistory(ctx.db, venue.id, 'apply', mover(ctx), { person_id: person.id, application_id: id }),
        ])
        ctx.emit('venue.applied', `stump://venues/${venue.id}`, { person_id: person.id })
        return { application: applicationView((await ctx.db.prepare('SELECT * FROM stump_venue_applications WHERE id=?').bind(id).first<Parameters<typeof applicationView>[0]>())!) }
      },
    },
    approve_application: {
      roles: EDITORS, properties: { application_id: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['application_id'],
      classify: () => standard(),
      target: args => ({ kind: 'venue_application', id: String(args.application_id) }),
      async run(args, ctx) {
        const found = await ctx.db.prepare('SELECT * FROM stump_venue_applications WHERE id=?').bind(args.application_id).first<Parameters<typeof applicationView>[0]>()
        if (!found) refuse('not_found', { application_id: String(args.application_id) })
        const venue = await venueOrRefuse(ctx.db, found.venue_id), now = ctx.now()
        if (found.state !== 'approved') {
          if (found.state !== 'applied') refuse('conflict', { application_id: found.id, state: found.state })
          await handleFree(ctx, venue.id, found.handle, found.person_id)
          // Approval makes them a member from today, with the handle they applied with.
          await ctx.db.batch([
            ctx.db.prepare("UPDATE stump_venue_applications SET state='approved',decided_by=?,decided_at=? WHERE id=? AND state='applied'").bind(ctx.person.id, now, found.id),
            ctx.db.prepare('INSERT INTO stump_venue_members(venue_id,person_id,handle,joined_on,karma,created_at) VALUES(?,?,?,?,NULL,?) ON CONFLICT(venue_id,person_id) DO NOTHING')
              .bind(found.venue_id, found.person_id, found.handle, new Date(now).toISOString().slice(0, 10), now),
            venueHistory(ctx.db, venue.id, 'approve_application', mover(ctx), { person_id: found.person_id, application_id: found.id }),
          ])
          ctx.emit('venue.member_added', `stump://venues/${venue.id}`, { person_id: found.person_id })
        }
        const application = (await ctx.db.prepare('SELECT * FROM stump_venue_applications WHERE id=?').bind(found.id).first<Parameters<typeof applicationView>[0]>())!
        const { member } = await memberOf(ctx.db, venue.id, found.person_id)
        return { application: applicationView(application), eligibility: eligibility(venue, found.person_id, member, now, { id: application.id, state: application.state }) }
      },
    },
  },
}]
