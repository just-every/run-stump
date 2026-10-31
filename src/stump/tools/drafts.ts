import { refuse, refuseAct } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { claimStaleness, isCurrentRecord } from '../lib/claims/index.ts'
import { countText, type Network } from '../lib/text/index.ts'
import { CONTRIBUTORS, EDITORS, EVERYONE } from '../people/roles.ts'
import { checkView, COUNTED, counted, loadBrand } from '../drafting/check.ts'
import { wordDiff } from '../drafting/diff.ts'
import { checkRow, heldBecause, holdOf, itemView, mayWrite, prepareSave, readItem, readRevision, saveItem, storeCheck } from '../drafting/items.ts'
import { claimRecord, itemRecord, itemText, libClaim, masterRecord, parse, today, type Row } from '../drafting/records.ts'
import { createItem, createMaster, draftFromSource, draftingClasses, screen } from '../drafting/write.ts'
import { venueOrRefuse } from '../venues/model.ts'
import { routesFor } from '../venues/rules.ts'

// Drafting posts, threads, replies, pitches and master posts, with revisions,
// the draft check and previews (STUMP-DRAFT-001 to -010, STUMP-BRAND-004,
// STUMP-TRUTH-002 to -004, STUMP-PITCH-001).
const id = { type: 'string', minLength: 1, maxLength: 64 }
const body = { type: 'string', minLength: 1, maxLength: 25_000 }
const parts = { type: 'array', minItems: 1, maxItems: 25, items: body }
const url = { type: 'string', minLength: 1, maxLength: 2048 }
const network = { type: 'string', minLength: 1, maxLength: 32 }
const revisionNumber = { type: 'integer', minimum: 1 }
const ids = (max: number) => ({ type: 'array', minItems: 1, maxItems: max, items: id })

const writeFields = {
  format: { enum: ['post', 'thread', 'reply', 'pitch'] }, person_id: id, product_id: id, account_id: id, venue_id: id, network,
  text: body, parts, reply_to: { type: 'object', required: ['url'], additionalProperties: false, properties: { url } },
  recipient: { type: 'object', required: ['contact_id'], additionalProperties: false, properties: { contact_id: id } },
  subject: { type: 'string', minLength: 1, maxLength: 200 }, campaign: { type: 'string', minLength: 1, maxLength: 120 }, voice_id: id,
  generate: { type: 'boolean' }, source_url: url, prompt: { type: 'string', minLength: 1, maxLength: 4000 },
  poll: { type: 'object', required: ['options'], properties: { options: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 25 } }, duration_minutes: { type: 'integer', minimum: 5, maximum: 10080 } } },
  content_warning: { type: 'string', minLength: 1, maxLength: 500 }, visibility: { enum: ['public', 'unlisted', 'private'] }, recommends: { type: 'boolean' },
}
const targetSchema = { type: 'object', additionalProperties: false, properties: { format: writeFields.format, person_id: id, product_id: id, account_id: id, venue_id: id, network, voice_id: id } }

/** Results as JSON carries them: the MCP door accepts only plain JSON values, so absent fields are dropped, not undefined. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const standard = (measure = 1) => [{ class: 'standard' as const, facts: { measure } }]
const itemTarget = (args: Args) => ({ kind: 'item', id: String(args.item_id) })

async function itemRevision(args: Args, ctx: ActionContext) { return Number((await readItem(ctx, args.item_id)).revision) }
async function master(ctx: ActionContext, masterId: unknown) {
  const row = await ctx.db.prepare('SELECT * FROM stump_masters WHERE id=?').bind(String(masterId)).first<Row>()
  if (!row) refuse('not_found', { master_id: String(masterId) })
  return masterRecord(row)
}
/** A master's variants; a poster sees only their own (STUMP-TEAM-001.2), as readItem shows them only their own items. */
async function variants(ctx: ActionContext, masterId: string) {
  const own = ctx.person.role === 'poster' ? ' AND i.person_id=?' : ''
  const rows = await ctx.db.prepare(`SELECT i.*,a.handle,a.display_name AS account_name FROM stump_items i LEFT JOIN stump_accounts a ON a.id=i.account_id
    WHERE i.master_id=?${own} ORDER BY i.created_at,i.id`).bind(masterId, ...(own ? [ctx.person.id] : [])).all<Row>()
  return rows.results
}
/**
 * A master post and the variants the person may see. A poster sees a master
 * only when it speaks for them or holds a variant of theirs, with its accounts
 * cut to those variants' accounts; any other master reads as not found.
 */
async function visibleMaster(ctx: ActionContext, masterId: unknown) {
  const record = await master(ctx, masterId), rows = await variants(ctx, record.id)
  if (ctx.person.role !== 'poster') return { record, rows }
  if (record.person_id !== ctx.person.id && !rows.length) refuse('not_found', { master_id: record.id })
  const accounts = new Set(rows.map(row => row.account_id as string | null))
  return { record: { ...record, account_ids: record.account_ids.filter(id => accounts.has(id)) }, rows }
}
/** A held refusal's fields: the rule, its source and the venue where a venue rule holds the item, and the hold itself. */
const heldFields = (itemId: unknown, hold: Record<string, unknown> | null) => ({
  item_id: itemId, rule: hold?.rule ?? hold?.reason ?? null, ...(hold?.source_url !== undefined ? { source_url: hold.source_url } : {}), ...(hold?.venue_id ? { venue_id: hold.venue_id } : {}), hold,
})
const nextText = (args: Args) => {
  if (Array.isArray(args.parts)) return { text: null, parts: args.parts as string[] }
  if (typeof args.text === 'string') return { text: args.text, parts: null }
  return refuse('invalid_arguments', { field: 'text', reason: 'Give the text or the parts.' })
}

export const draftTools: StumpTool[] = [{
  name: 'stump.drafts.write', title: 'Draft posts, threads, replies and pitches',
  description: 'Draft a post, thread, reply or pitch for a person on the team, by hand or through the company\'s AI provider in that person\'s voice; draft from a source such as a changelog entry for several accounts and venues; or open one master post as a variant per account.',
  scope: 'stump:drafts', classes: ['standard', 'external'], clauses: ['STUMP-DRAFT-010', 'STUMP-DRAFT-001', 'STUMP-DRAFT-002', 'STUMP-DRAFT-006', 'STUMP-DRAFT-011', 'STUMP-DRAFT-007', 'STUMP-BRAND-002'],
  actions: {
    create: {
      // The person defaults to the one drafting (an agent's own person); a personal account's draft speaks for its owner.
      roles: CONTRIBUTORS, properties: writeFields, required: ['format'],
      async classify(args, ctx) { await screen(ctx, args, 'create'); return draftingClasses(ctx, args.generate === true ? 1 : 0, 1) },
      summary: args => ({ target: { name: `Draft a ${String(args.format)}${args.generate === true ? ' through the AI provider' : ''}` } }),
      async run(args, ctx) {
        await screen(ctx, args, 'create')
        const made = await createItem(ctx, args)
        return { ...await itemView(ctx.db, made.id), check: checkView(made.check) }
      },
    },
    from_source: {
      // The call's person, product and voice apply to every target that does not name its own.
      roles: CONTRIBUTORS, properties: { source_url: url, targets: { type: 'array', minItems: 1, maxItems: 10, items: targetSchema }, person_id: id, product_id: id, voice_id: id, prompt: writeFields.prompt, campaign: writeFields.campaign },
      required: ['source_url', 'targets'],
      async classify(args, ctx) { await screen(ctx, args, 'from_source'); return draftingClasses(ctx, (args.targets as unknown[]).length, (args.targets as unknown[]).length) },
      summary: args => ({ target: { name: `Draft ${(args.targets as unknown[]).length} items from ${String(args.source_url)}` } }),
      async run(args, ctx) {
        await screen(ctx, args, 'from_source')
        const made = await draftFromSource(ctx, args)
        const items = await Promise.all(made.ids.map(itemId => itemView(ctx.db, itemId)))
        return { items, total: items.length, source: made.source }
      },
    },
    master: {
      // `venues` aims an account's variant at a venue (the instance, community or channel it posts in), so its rules apply and the ledger files it there.
      roles: CONTRIBUTORS, properties: { text: writeFields.text, account_ids: ids(12), person_id: id, product_id: id, generate: writeFields.generate, source_url: url, prompt: writeFields.prompt, voice_id: id,
        venues: { type: 'array', maxItems: 12, items: { type: 'object', required: ['account_id', 'venue_id'], additionalProperties: false, properties: { account_id: id, venue_id: id } } } },
      required: ['account_ids'],
      async classify(args, ctx) { await screen(ctx, { ...args, person_id: args.person_id ?? ctx.person.id }, 'master'); return draftingClasses(ctx, args.generate === true ? 1 : 0, (args.account_ids as unknown[]).length) },
      summary: args => ({ target: { name: `Open a post for ${(args.account_ids as unknown[]).length} accounts` } }),
      async run(args, ctx) {
        await screen(ctx, { ...args, person_id: args.person_id ?? ctx.person.id }, 'master')
        const made = await createMaster(ctx, args)
        const items = await Promise.all(made.ids.map(itemId => itemView(ctx.db, itemId)))
        return { master: await master(ctx, made.master_id), variants: items }
      },
    },
  },
}, {
  name: 'stump.drafts.revise', title: 'Revise drafts',
  description: 'Read and list items, save a new revision, aim a draft at another venue or product, compare two revisions, restore an earlier one as a new revision, mark an item ready, and change a master post.',
  scope: 'stump:drafts', classes: ['standard'], clauses: ['STUMP-DRAFT-003', 'STUMP-TEAM-002'],
  actions: {
    get: {
      roles: EVERYONE, read: true, properties: { item_id: id }, required: ['item_id'],
      classify: () => standard(),
      target: itemTarget,
      async run(args, ctx) { await readItem(ctx, args.item_id); return itemView(ctx.db, String(args.item_id)) },
    },
    list: {
      roles: EVERYONE, read: true, properties: { venue_id: id, product_id: id, master_id: id, q: { type: 'string', minLength: 1, maxLength: 200 }, state: { type: 'string', minLength: 1, maxLength: 32 } },
      classify: () => standard(0),
      async run(args, ctx) {
        const filters: string[] = [], values: unknown[] = []
        for (const field of ['venue_id', 'product_id', 'master_id', 'state'] as const) if (typeof args[field] === 'string') { filters.push(`${field}=?`); values.push(args[field]) }
        if (typeof args.q === 'string') { const like = `%${args.q.replace(/[\\%_]/g, c => `\\${c}`)}%`; filters.push("(text LIKE ? ESCAPE '\\' OR parts LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\')"); values.push(like, like, like) }
        if (ctx.person.role === 'poster') { filters.push('person_id=?'); values.push(ctx.person.id) }
        const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : ''
        const [rows, total] = await ctx.db.batch([ctx.db.prepare(`SELECT * FROM stump_items${where} ORDER BY updated_at DESC,id LIMIT 200`).bind(...values), ctx.db.prepare(`SELECT COUNT(*) AS n FROM stump_items${where}`).bind(...values)])
        return { items: (rows!.results as Row[]).map(itemRecord), total: Number((total!.results as Row[])[0]?.n ?? 0) }
      },
    },
    save: {
      roles: CONTRIBUTORS, properties: { item_id: id, text: body, parts }, required: ['item_id'],
      classify: () => standard(),
      target: itemTarget, revision: itemRevision,
      async run(args, ctx) {
        const row = await readItem(ctx, args.item_id)
        mayWrite(ctx, row.person_id)
        const next = nextText(args)
        const owner = row.master_id ? await master(ctx, row.master_id) : null
        const saved = await saveItem(ctx, row, { ...next, ...(owner ? { differs_from_master: itemText(next) === owner.text ? 0 as const : 1 as const } : {}) }, 'edited')
        return { ...saved.item, check: checkView(saved.check) }
      },
    },
    aim: {
      // Where an open draft goes and what it is for: its venue and product change as a new revision, checked again against the venue's rules and the product's claims.
      roles: CONTRIBUTORS, properties: { item_id: id, venue_id: id, product_id: id, clear: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: ['venue', 'product'] } } },
      required: ['item_id'],
      classify: () => standard(),
      target: itemTarget, revision: itemRevision,
      async run(args, ctx) {
        const row = await readItem(ctx, args.item_id)
        mayWrite(ctx, row.person_id)
        const clear = new Set((args.clear as string[] | undefined) ?? [])
        if (args.venue_id === undefined && args.product_id === undefined && !clear.size) refuse('invalid_arguments', { field: 'venue_id', reason: 'Name the venue or the product, or what to clear.' })
        if (args.venue_id !== undefined && clear.has('venue')) refuse('invalid_arguments', { field: 'clear', reason: 'Name a venue or clear it, not both.' })
        if (args.product_id !== undefined && clear.has('product')) refuse('invalid_arguments', { field: 'clear', reason: 'Name a product or clear it, not both.' })
        const venueId = clear.has('venue') ? null : (args.venue_id as string | undefined) ?? (row.venue_id as string | null)
        const productId = clear.has('product') ? null : (args.product_id as string | undefined) ?? (row.product_id as string | null)
        const venue = venueId === null ? null : await venueOrRefuse(ctx.db, venueId)
        if (args.venue_id !== undefined && venue && (venue.archived === 1 || venue.status === 'excluded')) refuse('invalid_arguments', { field: 'venue_id', reason: venue.archived === 1 ? 'The venue is archived.' : 'The venue is excluded.' })
        if (args.product_id !== undefined && !await ctx.db.prepare('SELECT 1 FROM stump_products WHERE id=?').bind(String(args.product_id)).first()) refuse('not_found', { product_id: String(args.product_id) })
        const saved = await saveItem(ctx, row, { text: row.text as string | null, parts: parse<string[] | null>(row.parts, null),
          aim: { venue_id: venueId, product_id: productId, routes: venue ? routesFor(venue).routes : [] } }, 'aimed')
        // A master post is for one product: its product follows the variants'.
        if (row.master_id && productId !== row.product_id) await ctx.db.prepare('UPDATE stump_masters SET product_id=?,updated_at=? WHERE id=?').bind(productId, ctx.now(), row.master_id).run()
        return { ...saved.item, check: checkView(saved.check) }
      },
    },
    diff: {
      roles: EVERYONE, read: true, properties: { item_id: id, from: revisionNumber, to: revisionNumber }, required: ['item_id', 'from', 'to'],
      classify: () => standard(),
      target: itemTarget,
      async run(args, ctx) {
        await readItem(ctx, args.item_id)
        const [from, to] = await Promise.all([readRevision(ctx.db, String(args.item_id), Number(args.from)), readRevision(ctx.db, String(args.item_id), Number(args.to))])
        return { item_id: args.item_id, from: args.from, to: args.to, changes: wordDiff(itemText(from), itemText(to)) }
      },
    },
    restore: {
      roles: CONTRIBUTORS, properties: { item_id: id, revision: revisionNumber }, required: ['item_id', 'revision'],
      classify: () => standard(),
      target: itemTarget, revision: itemRevision,
      async run(args, ctx) {
        const row = await readItem(ctx, args.item_id)
        mayWrite(ctx, row.person_id)
        // Restoring makes a new revision with the earlier text (STUMP-DRAFT-003.3).
        const earlier = await readRevision(ctx.db, String(row.id), Number(args.revision))
        const owner = row.master_id ? await master(ctx, row.master_id) : null
        const saved = await saveItem(ctx, row, { ...earlier, ...(owner ? { differs_from_master: itemText(earlier) === owner.text ? 0 as const : 1 as const } : {}) }, `restored revision ${Number(args.revision)}`)
        return { ...saved.item, restored_from: Number(args.revision), check: checkView(saved.check) }
      },
    },
    mark_ready: {
      roles: CONTRIBUTORS, properties: { item_id: id }, required: ['item_id'],
      async classify(args, ctx) {
        const row = await readItem(ctx, args.item_id), check = await checkRow(ctx, row)
        // A connected person's item that mentions the company must disclose it first (D-2, STUMP-TRUTH-002), through every door.
        const flag = check.flags.find(item => item.code === 'disclosure_missing' || item.code === 'disclosure_below_cut')
        if (flag) await refuseAct(ctx, 'stump.drafts.revise', 'mark_ready', { rule: 'D-2', source: 'STUMP-TRUTH-002' }, { item_id: String(row.id), flag: flag.code, because: flag.because ?? null })
        return standard()
      },
      summary: async (args, ctx) => { const row = await readItem(ctx, args.item_id); return { target: { id: String(row.id), name: `Mark ready: ${itemText(row).slice(0, 80)}` } } },
      target: itemTarget, revision: itemRevision,
      async run(args, ctx) {
        const row = await readItem(ctx, args.item_id)
        mayWrite(ctx, row.person_id)
        if (row.state === 'ready') return itemView(ctx.db, String(row.id))
        // A held item names what holds it: the venue rule with its source, or the near-duplicate match.
        if (row.state === 'held') refuse('held', heldFields(row.id, parse<Record<string, unknown> | null>(row.hold, null)))
        if (row.state !== 'draft') refuse('invalid_state', { item_id: row.id, state: row.state })
        const check = await checkRow(ctx, row), now = ctx.now()
        if (check.duplicates.length || check.venue_hold) {
          // Nearly repeats something queued or posted since it was drafted (STUMP-TRUTH-004), or its venue's rules hold it where it is aimed (D-3):
          // held, naming the match or the rule, until it is rewritten or the rule allows it.
          const hold = holdOf(check, String(row.person_id))
          await ctx.db.batch([
            ctx.db.prepare("UPDATE stump_items SET state='held',flags=?,hold=?,updated_at=? WHERE id=? AND state='draft' AND revision=?")
              .bind(JSON.stringify(check.flags), hold, now, row.id, row.revision),
            ctx.db.prepare("INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at) SELECT ?,?,'draft','held',?,?,?,? WHERE changes()=1")
              .bind(crypto.randomUUID(), row.id, ctx.person.id, ctx.agent?.id ?? null, heldBecause(check), now),
          ])
          if (check.duplicates.length) return itemView(ctx.db, String(row.id))
          refuse('held', heldFields(row.id, JSON.parse(hold!) as Record<string, unknown>))
        }
        // Every blocking flag is named: an avoided word, a missing alt text, a claim, a limit (STUMP-BRAND-001.3, -004, STUMP-PUBLISH-002.5).
        const blocking = check.flags.filter(flag => flag.blocking)
        if (blocking.length) {
          // The item keeps what this check found, so its flags name what stops it on every screen and door.
          await storeCheck(ctx, row, check)
          const words = blocking.filter(flag => flag.code === 'avoid_word').map(flag => flag.word)
          refuse('checks_failed', { item_id: row.id, codes: [...new Set(blocking.map(flag => flag.code))], ...(words.length ? { words: [...new Set(words)] } : {}), flags: blocking })
        }
        const approvers = ctx.approvers.length ? JSON.stringify(ctx.approvers) : null
        const [update] = await ctx.db.batch([
          ctx.db.prepare("UPDATE stump_items SET state='ready',flags=?,claims_used=?,approved_by=?,updated_at=? WHERE id=? AND state='draft' AND revision=?")
            .bind(JSON.stringify(check.flags), JSON.stringify(check.claims_used), approvers, now, row.id, row.revision),
          ctx.db.prepare("INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at) SELECT ?,?,'draft','ready',?,?,?,? WHERE changes()=1")
            .bind(crypto.randomUUID(), row.id, ctx.person.id, ctx.agent?.id ?? null, `ready at revision ${Number(row.revision)}`, now),
        ])
        if (!update!.meta.changes) refuse('revision_conflict', { current_revision: (await readItem(ctx, row.id)).revision })
        ctx.emit('item.ready', `stump://items/${String(row.id)}`, { revision: Number(row.revision) })
        return itemView(ctx.db, String(row.id))
      },
    },
    save_master: {
      roles: CONTRIBUTORS, properties: { master_id: id, text: body }, required: ['master_id', 'text'],
      async classify(args, ctx) { return standard((await variants(ctx, (await master(ctx, args.master_id)).id)).length + 1) },
      target: args => ({ kind: 'master', id: String(args.master_id) }),
      async revision(args, ctx) { return (await master(ctx, args.master_id)).revision },
      async run(args, ctx) {
        const current = await master(ctx, args.master_id), text = String(args.text)
        mayWrite(ctx, current.person_id)
        const brand = await loadBrand(ctx.db), rows = await variants(ctx, current.id), statements: D1PreparedStatement[] = []
        statements.push(ctx.db.prepare('UPDATE stump_masters SET text=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(text, ctx.now(), current.id, current.revision))
        // Variants nobody edited follow the master; edited ones keep their text and stay marked as differing (STUMP-DRAFT-010.4).
        const following = rows.filter(row => Number(row.differs_from_master) === 0 && !['posting', 'posted', 'partly_posted', 'uncertain', 'cancelled'].includes(String(row.state)))
        for (const row of following) statements.push(...(await prepareSave(ctx, brand, row, { text, parts: null, differs_from_master: 0 }, 'master changed')).statements)
        const [update] = await ctx.db.batch(statements)
        if (!update!.meta.changes) refuse('revision_conflict', { current_revision: (await master(ctx, current.id)).revision })
        return { master: await master(ctx, current.id), variants: await Promise.all(rows.map(row => itemView(ctx.db, String(row.id)))), followed: following.map(row => row.id) }
      },
    },
  },
}, {
  name: 'stump.drafts.check', title: 'Check drafts',
  description: 'Run the claim, limit, disclosure, vote-request and near-duplicate checks on an item, count a text the way each network counts, back an unmatched claim with a claim on record, and set the near-duplicate window.',
  scope: 'stump:drafts', classes: ['standard'], clauses: ['STUMP-BRAND-004', 'STUMP-DRAFT-005', 'STUMP-TRUTH-002', 'STUMP-TRUTH-004'],
  actions: {
    run: {
      roles: CONTRIBUTORS, properties: { item_id: id }, required: ['item_id'],
      classify: () => standard(),
      target: itemTarget,
      async run(args, ctx) {
        const row = await readItem(ctx, args.item_id), check = await storeCheck(ctx, row)
        return { item_id: row.id, revision: Number(row.revision), ...checkView(check) }
      },
    },
    count: {
      roles: EVERYONE, read: true, properties: { text: body, networks: { type: 'array', minItems: 1, maxItems: 8, items: { enum: [...COUNTED] } } }, required: ['text', 'networks'],
      classify: () => standard(0),
      // Each network's count keyed by network; the limit, unit and fit of each are in details (STUMP-DRAFT-001.1).
      async run(args) {
        const details = Object.fromEntries((args.networks as Network[]).map(item => [item, countText({ network: item }, String(args.text))]))
        return plain({ counts: Object.fromEntries(Object.entries(details).map(([item, count]) => [item, count.count])), details })
      },
    },
    back: {
      roles: CONTRIBUTORS, properties: { item_id: id, claim_id: id, text: body }, required: ['item_id', 'claim_id'],
      classify: () => standard(),
      target: itemTarget,
      async run(args, ctx) {
        const row = await readItem(ctx, args.item_id)
        mayWrite(ctx, row.person_id)
        const claimRow = await ctx.db.prepare('SELECT * FROM stump_claims WHERE id=?').bind(String(args.claim_id)).first<Row>()
        if (!claimRow) refuse('not_found', { claim_id: String(args.claim_id) })
        const claim = claimRecord(claimRow)
        // Only a current claim with proof backs a sentence (STUMP-BRAND-004.4).
        if (claim.kind === 'banned' || !isCurrentRecord(libClaim(claim)) || claimStaleness({ review_on: claim.review_on ?? undefined }, today(ctx.now())).stale) refuse('claim_not_current', { claim_id: claim.id, kind: claim.kind })
        const before = await checkRow(ctx, row)
        // The claim already covers the sentence (recorded with proof after the draft was flagged): the item is backed as it stands.
        const covered = before.claims.filter(finding => finding.status === 'matched' && finding.claim_id === claim.id && (typeof args.text !== 'string' || finding.text === args.text))
        if (covered.length) {
          await ctx.db.prepare('UPDATE stump_items SET flags=?,claims_used=? WHERE id=? AND revision=?').bind(JSON.stringify(before.flags), JSON.stringify(before.claims_used), row.id, row.revision).run()
          return { item_id: row.id, backed: { claim_id: claim.id, text: covered[0]!.text }, ...checkView(before) }
        }
        const unmatched = before.claims.filter(finding => finding.status === 'unmatched')
        const chosen = typeof args.text === 'string' ? unmatched.filter(finding => finding.text === args.text) : unmatched
        if (chosen.length !== 1) refuse('invalid_arguments', { field: 'text', reason: chosen.length ? 'Name the sentence to back.' : 'Nothing in the item is unmatched.', unmatched: unmatched.map(finding => finding.text) })
        // The wording joins the claim's aliases, so it matches here and in later drafts.
        await ctx.db.prepare('UPDATE stump_claims SET aliases=?,revision=revision+1,updated_at=? WHERE id=?').bind(JSON.stringify([...new Set([...claim.aliases, chosen[0]!.text])]), ctx.now(), claim.id).run()
        const check = await checkRow(ctx, row)
        await ctx.db.prepare('UPDATE stump_items SET flags=?,claims_used=? WHERE id=? AND revision=?').bind(JSON.stringify(check.flags), JSON.stringify(check.claims_used), row.id, row.revision).run()
        return { item_id: row.id, backed: { claim_id: claim.id, text: chosen[0]!.text }, ...checkView(check) }
      },
    },
    set_duplicate_window: {
      roles: EDITORS, properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, required: ['days'],
      classify: () => standard(),
      async run(args, ctx) {
        await ctx.db.prepare('UPDATE stump_drafting_settings SET duplicate_window_days=?,updated_by=?,updated_at=? WHERE id=1').bind(Number(args.days), ctx.person.id, ctx.now()).run()
        return { duplicate_window_days: Number(args.days) }
      },
    },
  },
}, {
  name: 'stump.drafts.preview', title: 'Preview items',
  description: 'Return how each network will show an item or every variant of a master post, and the accounts a person can draft for.',
  scope: 'stump:drafts', classes: ['standard'], clauses: ['STUMP-DRAFT-004'],
  actions: {
    master: {
      roles: EVERYONE, read: true, properties: { master_id: id }, required: ['master_id'],
      async classify(args, ctx) { return standard((await visibleMaster(ctx, args.master_id)).rows.length) },
      target: args => ({ kind: 'master', id: String(args.master_id) }),
      async run(args, ctx) {
        const { record, rows } = await visibleMaster(ctx, args.master_id)
        const items = rows.map(row => {
          const item = itemRecord(row), text = itemText(row)
          return { item_id: item.id, network: item.network, account_id: item.account_id, venue_id: item.venue_id, product_id: item.product_id, handle: row.handle ?? null, account_name: row.account_name ?? null, text,
            count: counted(item.network) ? countText({ network: item.network }, text) : null, flags: item.flags, state: item.state, revision: item.revision, differs_from_master: item.differs_from_master }
        })
        return plain({ master: record, items, total: items.length })
      },
    },
    item: {
      roles: EVERYONE, read: true, properties: { item_id: id }, required: ['item_id'],
      classify: () => standard(),
      target: itemTarget,
      async run(args, ctx) {
        const item = itemRecord(await readItem(ctx, args.item_id))
        const stored = item.parts as unknown, texts = Array.isArray(stored) && stored.length ? stored as string[] : [String(item.text ?? '')]
        const items = texts.map((text, index) => ({ network: item.network, part: texts.length > 1 ? index + 1 : null, text, count: counted(item.network) ? countText({ network: item.network }, text) : null }))
        return plain({ item_id: item.id, items, total: items.length })
      },
    },
    targets: {
      roles: EVERYONE, read: true,
      classify: () => standard(0),
      async run(_args, ctx) {
        // The accounts a person drafts for: the company's, and their own. A poster sees only their own (STUMP-TEAM-001.2).
        const own = ['owner', 'admin', 'editor'].includes(ctx.person.role) ? '' : ctx.person.role === 'poster' ? " WHERE owner_kind='person' AND owner_person_id=?" : " WHERE owner_kind='company' OR owner_person_id=?"
        const rows = await ctx.db.prepare(`SELECT id,network,handle,display_name,owner_kind,owner_person_id,state FROM stump_accounts${own} ORDER BY owner_kind='person',network,handle`)
          .bind(...(own ? [ctx.person.id] : [])).all<Row>()
        return { items: rows.results, total: rows.results.length }
      },
    },
  },
}]

