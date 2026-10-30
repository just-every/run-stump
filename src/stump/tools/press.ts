import { refuse } from '../actions/refusals.ts'
import type { ActionContext, StumpTool } from '../actions/types.ts'
import { EDITORS, READERS } from '../people/roles.ts'
import { contactRecord, type Row } from '../drafting/records.ts'

// Journalists, publications and podcasts (STUMP-PITCH-001). A contact route is
// kept only with the public page it appeared on and the date it was read;
// Stump never guesses an address.
const id = { type: 'string', minLength: 1, maxLength: 64 }
const short = { type: 'string', minLength: 1, maxLength: 160 }
const kind = { enum: ['journalist', 'publication', 'podcast'] }
const route = {
  type: 'object', additionalProperties: false, required: ['kind', 'value'],
  properties: {
    kind: { enum: ['email', 'handle', 'form', 'guest_intake', 'website', 'phone'] },
    value: { type: 'string', minLength: 1, maxLength: 2048 },
    source_url: { type: 'string', minLength: 1, maxLength: 2048 },
    read_at: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}' },
  },
}

const http = (value: unknown) => { try { return ['http:', 'https:'].includes(new URL(String(value)).protocol) } catch { return false } }
/** A journalist's contact route is personal data about someone outside the team (STUMP-SURFACE-015.2). */
const classes = (personal: boolean) => personal
  ? [{ class: 'standard' as const, facts: { measure: 1 } }, { class: 'sensitive' as const, facts: { measure: 1, kind: 'contact route' } }]
  : [{ class: 'standard' as const, facts: { measure: 1 } }]

async function contact(ctx: ActionContext, contactId: unknown) {
  const row = await ctx.db.prepare('SELECT * FROM stump_press_contacts WHERE id=?').bind(String(contactId)).first<Row>()
  if (!row) refuse('not_found', { contact_id: String(contactId) })
  return contactRecord(row)
}

export const pressTools: StumpTool[] = [{
  name: 'stump.press.contacts', title: 'Keep journalists, publications and podcasts',
  description: 'Record journalists, publications and podcasts with their beat or topics and a public contact route, each with the page it appeared on and the date it was read.',
  scope: 'stump:press', classes: ['standard', 'sensitive'], clauses: ['STUMP-PITCH-001'],
  actions: {
    create: {
      roles: EDITORS,
      properties: { kind, name: short, beat: short, publication: short, topics: { type: 'array', maxItems: 20, items: short }, contact_route: route },
      required: ['kind', 'name'],
      classify: args => classes(args.kind === 'journalist' && args.contact_route !== undefined),
      summary: args => ({ target: { name: `${String(args.kind)} ${String(args.name)}` } }),
      async run(args, ctx) {
        const path = args.contact_route as { kind: string; value: string; source_url?: string; read_at?: string } | undefined
        // An address or handle without the public page it came from cannot be saved (STUMP-PITCH-001.2).
        if (path && (!http(path.source_url) || !path.read_at)) refuse('source_required', { field: path.source_url === undefined || !http(path.source_url) ? 'contact_route.source_url' : 'contact_route.read_at' })
        if (path && ['form', 'guest_intake', 'website'].includes(path.kind) && !http(path.value)) refuse('invalid_arguments', { field: 'contact_route.value' })
        const contactId = crypto.randomUUID(), now = ctx.now()
        await ctx.db.prepare('INSERT INTO stump_press_contacts(id,kind,name,beat,publication,topics,contact_route,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .bind(contactId, args.kind, String(args.name).trim(), args.beat ?? null, args.publication ?? null, JSON.stringify(args.topics ?? []), JSON.stringify(path ?? {}), ctx.person.id, now, now).run()
        return contact(ctx, contactId)
      },
    },
    get: {
      roles: READERS, read: true, properties: { contact_id: id }, required: ['contact_id'],
      async classify(args, ctx) { const record = await contact(ctx, args.contact_id); return classes(record.kind === 'journalist' && !!record.contact_route?.value) },
      target: args => ({ kind: 'contact', id: String(args.contact_id) }),
      run: (args, ctx) => contact(ctx, args.contact_id),
    },
    list: {
      roles: READERS, read: true, properties: { kind },
      classify: () => [{ class: 'standard', facts: { measure: 0 } }],
      async run(args, ctx) {
        const rows = await ctx.db.prepare(`SELECT id,kind,name,beat,publication,topics,created_at FROM stump_press_contacts${typeof args.kind === 'string' ? ' WHERE kind=?' : ''} ORDER BY name,id`)
          .bind(...(typeof args.kind === 'string' ? [args.kind] : [])).all<Row>()
        // Names and beats only; a contact route is read one record at a time.
        const items = rows.results.map(row => { const { contact_route: _route, ...rest } = contactRecord(row); return rest })
        return { items, total: items.length }
      },
    },
  },
}]
