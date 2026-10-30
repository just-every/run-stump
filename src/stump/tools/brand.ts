import { refuse, refuseAct } from '../actions/refusals.ts'
import type { ActionContext, StumpTool } from '../actions/types.ts'
import { claimStaleness, isIsoDate, validateClaim, type Claim } from '../lib/claims/index.ts'
import { EDITORS, EVERYONE, type Role } from '../people/roles.ts'
import { readPerson } from '../people/store.ts'
import { claimRecord, parse, productRecord, today, voiceRecord, type ClaimRecord, type Row } from '../drafting/records.ts'

// Products and tone, claims with proof, and a real person's voice guide
// (STUMP-BRAND-001 to -003). Drafting, disclosure and listening read them.
const id = { type: 'string', minLength: 1, maxLength: 64 }
const short = { type: 'string', minLength: 1, maxLength: 120 }
const long = { type: 'string', minLength: 1, maxLength: 1000 }
const words = (items: number, length: number) => ({ type: 'array', maxItems: items, items: { type: 'string', minLength: 1, maxLength: length } })
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const url = { type: 'string', minLength: 1, maxLength: 2048 }
const proof = { anyOf: [{ type: 'string', minLength: 1, maxLength: 2048 }, { type: 'object', properties: { url, document: long, number: { type: ['string', 'number'] }, date, text: long }, additionalProperties: false, minProperties: 1 }] }

const productFields = { name: short, other_names: words(20, 120), description: long, audience: long, positioning: long, urls: words(10, 2048), competitors: words(20, 120), use_words: words(50, 60), avoid_words: words(50, 60), tone: { type: 'string', minLength: 1, maxLength: 280 } }
const claimFields = { product_id: id, text: { type: 'string', minLength: 1, maxLength: 500 }, kind: { enum: ['allowed', 'banned', 'comparative'] }, proof, owner_id: id, review_on: date, reason: long, competitor: short, source_url: url, source_date: date }
const voiceFields = { samples: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 5000 } }, do: words(20, 280), dont: words(20, 280) }

const standard = (measure = 1) => [{ class: 'standard' as const, facts: { measure } }]
const writing = (measure = 1) => [{ class: 'standard' as const, facts: { measure } }, { class: 'sensitive' as const, facts: { measure, kind: 'writing samples' } }]

async function product(ctx: ActionContext, productId: unknown) {
  const row = await ctx.db.prepare('SELECT * FROM stump_products WHERE id=?').bind(String(productId)).first<Row>()
  if (!row) refuse('not_found', { product_id: String(productId) })
  return productRecord(row)
}
async function claim(ctx: ActionContext, claimId: unknown) {
  const row = await ctx.db.prepare('SELECT * FROM stump_claims WHERE id=?').bind(String(claimId)).first<Row>()
  if (!row) refuse('not_found', { claim_id: String(claimId) })
  return claimRecord(row)
}
const claimView = (record: ClaimRecord, now: number) => {
  const staleness = claimStaleness({ review_on: record.review_on ?? undefined }, today(now))
  return { ...record, stale: record.kind !== 'banned' && staleness.stale, days_overdue: staleness.days_overdue }
}

/** A claim's own owner and editors keep it. */
function mayKeepClaim(ctx: ActionContext, record: { owner_id: string } | null) {
  if (EDITORS.includes(ctx.person.role)) return
  if (record && record.owner_id === ctx.person.id) return
  refuse('forbidden', { role: ctx.person.role })
}

/** Why a claim cannot be saved, or nothing (STUMP-BRAND-003.1-.3). */
async function checkClaim(ctx: ActionContext, value: Partial<ClaimRecord>) {
  const optional = <T,>(item: T | null | undefined) => item ?? undefined
  const errors = validateClaim({ text: value.text, kind: value.kind, proof: optional(value.proof), owner_id: optional(value.owner_id), review_on: optional(value.review_on),
    reason: optional(value.reason), competitor: optional(value.competitor), source_url: optional(value.source_url), source_date: optional(value.source_date) }, today(ctx.now()))
  if (value.review_on && !isIsoDate(value.review_on)) errors.push({ field: 'review_on', code: 'invalid' })
  if (errors.length) refuse('invalid_claim', { errors })
  const owner = await readPerson(ctx.db, String(value.owner_id))
  if (!owner || owner.status !== 'active') refuse('invalid_claim', { errors: [{ field: 'owner_id', code: 'not_on_team' }] })
  if (value.product_id) await product(ctx, value.product_id)
}

/** The voice guide's person: only a real person on the team who has signed in (D-1, STUMP-TRUTH-001.5). */
async function voicePerson(ctx: ActionContext, personId: unknown, action: string) {
  const person = await readPerson(ctx.db, String(personId))
  if (!person || person.status !== 'active') return refuseAct(ctx, 'stump.brand.manage', action, { rule: 'D-1', source: 'STUMP-TRUTH-001' }, { person_id: String(personId) })
  return person
}
/** A guide is read and kept by its own person and by editors (STUMP-BRAND-002.4). */
function mayUseVoice(ctx: ActionContext, personId: string) {
  if (personId === ctx.person.id || EDITORS.includes(ctx.person.role)) return
  refuse('forbidden', { role: ctx.person.role })
}
async function voice(ctx: ActionContext, voiceId: unknown) {
  const row = await ctx.db.prepare('SELECT * FROM stump_voice_guides WHERE id=?').bind(String(voiceId)).first<Row>()
  if (!row) refuse('not_found', { voice_id: String(voiceId) })
  mayUseVoice(ctx, String(row.person_id))
  return voiceRecord(row, await readPerson(ctx.db, String(row.person_id)))
}

const WRITERS: readonly Role[] = ['owner', 'admin', 'editor', 'contributor', 'poster']

export const brandTools: StumpTool[] = [{
  name: 'stump.brand.manage', title: 'Keep products, claims and voices',
  description: 'Record each product with its names, competitors, words and tone; the claims the company may make with their proof, owner and review date, the claims it must not make with the reason, and comparisons with a dated source; and a real team member\'s voice guide from their own writing.',
  scope: 'stump:brand', classes: ['standard', 'sensitive'], clauses: ['STUMP-BRAND-001', 'STUMP-BRAND-002', 'STUMP-BRAND-003'],
  actions: {
    product_create: {
      roles: EDITORS, properties: productFields, required: ['name'],
      classify: () => standard(),
      summary: args => ({ target: { name: `Add product ${String(args.name)}` } }),
      async run(args, ctx) {
        const productId = crypto.randomUUID(), now = ctx.now()
        await ctx.db.prepare(`INSERT INTO stump_products(id,name,names,description,audience,positioning,urls,competitors,use_words,avoid_words,tone,created_by,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(productId, String(args.name).trim(), JSON.stringify(args.other_names ?? []), args.description ?? null, args.audience ?? null,
            args.positioning ?? null, JSON.stringify(args.urls ?? []), JSON.stringify(args.competitors ?? []), JSON.stringify(args.use_words ?? []), JSON.stringify(args.avoid_words ?? []),
            JSON.stringify(args.tone ?? ''), ctx.person.id, now, now).run()
        ctx.emit('product.created', `stump://products/${productId}`)
        return product(ctx, productId)
      },
    },
    product_update: {
      roles: EDITORS, properties: { product_id: id, ...productFields }, required: ['product_id'],
      classify: () => standard(),
      async summary(args, ctx) { return { target: { id: String(args.product_id), name: (await product(ctx, args.product_id)).name } } },
      target: args => ({ kind: 'product', id: String(args.product_id) }),
      async run(args, ctx) {
        const current = await product(ctx, args.product_id)
        // A changed profile changes the next draft; drafts already written keep their text (STUMP-BRAND-001.4).
        const next = { ...current, ...Object.fromEntries(Object.keys(productFields).filter(key => args[key] !== undefined).map(key => [key, args[key]])) } as typeof current
        await ctx.db.prepare(`UPDATE stump_products SET name=?,names=?,description=?,audience=?,positioning=?,urls=?,competitors=?,use_words=?,avoid_words=?,tone=?,revision=revision+1,updated_at=? WHERE id=?`)
          .bind(next.name, JSON.stringify(next.other_names), next.description, next.audience, next.positioning, JSON.stringify(next.urls), JSON.stringify(next.competitors),
            JSON.stringify(next.use_words), JSON.stringify(next.avoid_words), JSON.stringify(next.tone), ctx.now(), current.id).run()
        return product(ctx, current.id)
      },
    },
    product_list: {
      roles: EVERYONE, read: true,
      classify: () => standard(0),
      async run(_args, ctx) {
        const [products, settings] = await ctx.db.batch([ctx.db.prepare('SELECT * FROM stump_products ORDER BY name,id'), ctx.db.prepare('SELECT company_names FROM stump_drafting_settings WHERE id=1')])
        const items = (products!.results as Row[]).map(productRecord)
        return { items, total: items.length, company_names: parse<string[]>((settings!.results as Row[])[0]?.company_names, []) }
      },
    },
    company_update: {
      roles: EDITORS, properties: { company_names: words(10, 120) }, required: ['company_names'],
      classify: () => standard(),
      async run(args, ctx) {
        await ctx.db.prepare('UPDATE stump_drafting_settings SET company_names=?,updated_by=?,updated_at=? WHERE id=1').bind(JSON.stringify(args.company_names), ctx.person.id, ctx.now()).run()
        return { company_names: args.company_names }
      },
    },
    claim_create: {
      roles: WRITERS.filter(role => role !== 'poster'), properties: claimFields, required: ['text', 'kind', 'owner_id'],
      classify: () => standard(),
      summary: args => ({ target: { name: `${String(args.kind)} claim: ${String(args.text)}` } }),
      async run(args, ctx) {
        const value = { product_id: (args.product_id as string | undefined) ?? null, text: String(args.text).trim(), kind: args.kind as Claim['kind'], proof: (args.proof as ClaimRecord['proof'] | undefined) ?? null,
          owner_id: String(args.owner_id), review_on: (args.review_on as string | undefined) ?? null, reason: (args.reason as string | undefined) ?? null,
          competitor: (args.competitor as string | undefined) ?? null, source_url: (args.source_url as string | undefined) ?? null, source_date: (args.source_date as string | undefined) ?? null }
        mayKeepClaim(ctx, { owner_id: value.owner_id })
        await checkClaim(ctx, value)
        const claimId = crypto.randomUUID(), now = ctx.now()
        await ctx.db.prepare(`INSERT INTO stump_claims(id,product_id,text,kind,proof,owner_id,review_on,reason,competitor,source_url,source_date,created_by,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(claimId, value.product_id, value.text, value.kind, value.proof === null ? null : JSON.stringify(value.proof), value.owner_id,
            value.review_on, value.reason, value.competitor, value.source_url, value.source_date, ctx.person.id, now, now).run()
        ctx.emit('claim.created', `stump://claims/${claimId}`)
        return claimView(await claim(ctx, claimId), now)
      },
    },
    claim_update: {
      roles: WRITERS.filter(role => role !== 'poster'), properties: { claim_id: id, ...claimFields }, required: ['claim_id'],
      classify: () => standard(),
      target: args => ({ kind: 'claim', id: String(args.claim_id) }),
      async run(args, ctx) {
        const current = await claim(ctx, args.claim_id)
        mayKeepClaim(ctx, current)
        const next = { ...current, ...Object.fromEntries(Object.keys(claimFields).filter(key => args[key] !== undefined).map(key => [key, args[key]])) } as ClaimRecord
        await checkClaim(ctx, next)
        // Renewing a stale claim is a new review date from its owner (STUMP-BRAND-003.4).
        await ctx.db.prepare(`UPDATE stump_claims SET product_id=?,text=?,kind=?,proof=?,owner_id=?,review_on=?,reason=?,competitor=?,source_url=?,source_date=?,revision=revision+1,updated_at=? WHERE id=?`)
          .bind(next.product_id, next.text, next.kind, next.proof === null ? null : JSON.stringify(next.proof), next.owner_id, next.review_on, next.reason, next.competitor,
            next.source_url, next.source_date, ctx.now(), current.id).run()
        return claimView(await claim(ctx, current.id), ctx.now())
      },
    },
    claim_get: {
      roles: EVERYONE, read: true, properties: { claim_id: id }, required: ['claim_id'],
      classify: () => standard(),
      target: args => ({ kind: 'claim', id: String(args.claim_id) }),
      async run(args, ctx) {
        const record = await claim(ctx, args.claim_id)
        // Every draft that used the claim (STUMP-BRAND-003.5).
        const visible = ctx.person.role === 'poster' ? ' AND i.person_id=?' : ''
        const drafts = await ctx.db.prepare(`SELECT i.id,i.format,i.network,i.state,i.revision,i.person_id FROM stump_items i, json_each(i.claims_used) used
          WHERE used.value=?${visible} ORDER BY i.updated_at DESC,i.id`).bind(record.id, ...(visible ? [ctx.person.id] : [])).all<Row>()
        return { ...claimView(record, ctx.now()), drafts: drafts.results.map(row => ({ item_id: row.id, format: row.format, network: row.network, state: row.state, revision: row.revision, person_id: row.person_id })) }
      },
    },
    claim_list: {
      roles: EVERYONE, read: true, properties: { product_id: id, kind: claimFields.kind },
      classify: () => standard(0),
      async run(args, ctx) {
        const filters: string[] = [], values: unknown[] = []
        if (typeof args.product_id === 'string') { filters.push('product_id=?'); values.push(args.product_id) }
        if (typeof args.kind === 'string') { filters.push('kind=?'); values.push(args.kind) }
        const rows = await ctx.db.prepare(`SELECT * FROM stump_claims${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY kind,created_at,id`).bind(...values).all<Row>()
        const items = rows.results.map(row => claimView(claimRecord(row), ctx.now()))
        return { items, total: items.length }
      },
    },
    voice_create: {
      roles: WRITERS, properties: { person_id: id, ...voiceFields }, required: ['person_id', 'samples'],
      async classify(args, ctx) { await voicePerson(ctx, args.person_id, 'voice_create'); return writing() },
      summary: args => ({ target: { id: String(args.person_id), name: 'Voice guide' }, items: [`${(args.samples as unknown[]).length} writing samples`] }),
      async run(args, ctx) {
        const person = await voicePerson(ctx, args.person_id, 'voice_create')
        mayUseVoice(ctx, person.id)
        const voiceId = crypto.randomUUID(), now = ctx.now()
        await ctx.db.prepare(`INSERT INTO stump_voice_guides(id,person_id,samples,do_list,dont_list,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?,?)`)
          .bind(voiceId, person.id, JSON.stringify(args.samples), JSON.stringify(args.do ?? []), JSON.stringify(args.dont ?? []), ctx.person.id, now, now).run()
        ctx.emit('voice.created', `stump://voices/${voiceId}`)
        return voice(ctx, voiceId)
      },
    },
    voice_update: {
      roles: WRITERS, properties: { voice_id: id, ...voiceFields }, required: ['voice_id'],
      async classify(args, ctx) { const current = await voice(ctx, args.voice_id); await voicePerson(ctx, current.person_id, 'voice_update'); return writing() },
      target: args => ({ kind: 'voice', id: String(args.voice_id) }),
      async run(args, ctx) {
        const current = await voice(ctx, args.voice_id)
        await voicePerson(ctx, current.person_id, 'voice_update')
        await ctx.db.prepare('UPDATE stump_voice_guides SET samples=?,do_list=?,dont_list=?,revision=revision+1,updated_at=? WHERE id=?')
          .bind(JSON.stringify(args.samples ?? current.samples), JSON.stringify(args.do ?? current.do), JSON.stringify(args.dont ?? current.dont), ctx.now(), current.id).run()
        return voice(ctx, current.id)
      },
    },
    voice_get: {
      roles: EVERYONE, read: true, properties: { voice_id: id }, required: ['voice_id'],
      classify: () => writing(),
      target: args => ({ kind: 'voice', id: String(args.voice_id) }),
      run: (args, ctx) => voice(ctx, args.voice_id),
    },
    voice_list: {
      roles: EVERYONE, read: true,
      classify: () => standard(0),
      async run(_args, ctx) {
        const own = EDITORS.includes(ctx.person.role) ? '' : ' WHERE v.person_id=?'
        const rows = await ctx.db.prepare(`SELECT v.*,p.display_name,p.status FROM stump_voice_guides v LEFT JOIN stump_people p ON p.id=v.person_id${own} ORDER BY p.display_name,v.created_at`)
          .bind(...(own ? [ctx.person.id] : [])).all<Row>()
        // Counts and notes only: the samples stay on voice_get.
        const items = rows.results.map(row => { const { samples, ...rest } = voiceRecord(row, row.status ? { status: String(row.status), display_name: String(row.display_name) } : null); return { ...rest, sample_count: samples.length } })
        return { items, total: items.length }
      },
    },
  },
}]

