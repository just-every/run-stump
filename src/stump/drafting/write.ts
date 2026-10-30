// What stump.drafts.write does: the checks every door applies before a draft
// exists (D-1, D-3, D-4, D-8), and the drafts it writes by hand, from a prompt
// or source through the company's AI provider, or as one master per account.
import { refuse, refuseAct } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { bannedAct, screenDraftRequest } from '../lib/claims/index.ts'
import { NETWORK_LIMITS, splitThread } from '../lib/text/index.ts'
import { notActiveReason, readPerson, type StumpPerson } from '../people/store.ts'
import { aiHost, draftWithAi, readSource, type Drafted, type Source } from './ai.ts'
import { counted, loadBrand, namesCompany, readAccount, type Account } from './check.ts'
import { insertItems, mayWrite, type NewItem } from './items.ts'
import { contactRecord, libClaim, parse, today, voiceRecord, type Row, type VoiceRecord } from './records.ts'

export const TOOL = 'stump.drafts.write'
const FORMATS = ['post', 'thread', 'reply', 'pitch'] as const
type Format = typeof FORMATS[number]

/** The class of a drafting call: standard by hand, external when it sends text to the AI provider (STUMP-SURFACE-002, -003.3). */
export async function draftingClasses(ctx: Pick<ActionContext, 'env' | 'db'>, aiCalls: number, items: number) {
  return aiCalls > 0
    ? [{ class: 'external' as const, facts: { measure: aiCalls, counterparty: 'known' as const, provider: await aiHost(ctx.env, ctx.db) } }]
    : [{ class: 'standard' as const, facts: { measure: items } }]
}

/** The person an item speaks for: someone on the team who has signed in (D-1). */
async function speaker(ctx: ActionContext, personId: unknown, action: string): Promise<StumpPerson> {
  const person = await readPerson(ctx.db, String(personId))
  if (!person || person.status !== 'active') return refuseAct(ctx, TOOL, action, { rule: 'D-1', source: 'STUMP-TRUTH-001' }, { person_id: String(personId), reason: notActiveReason(person) })
  return person
}

async function venueRow(ctx: ActionContext, venueId: unknown) {
  const row = await ctx.db.prepare('SELECT id,name,platform,rules FROM stump_venues WHERE id=?').bind(String(venueId)).first<Row>()
  if (!row) refuse('not_found', { venue_id: String(venueId) })
  return { id: String(row.id), name: String(row.name), platform: row.platform as string | null, rules: parse<Record<string, { value?: unknown; source_url?: string }>>(row.rules, {}) }
}
const AI_BANNED = new Set(['banned', 'no', 'not_allowed', 'forbidden', 'prohibited'])

/** A voice guide drafts only its own person's items, and an archived one drafts nothing (STUMP-BRAND-002.3, .5, STUMP-TRUTH-001.3). */
async function voiceFor(ctx: ActionContext, person: StumpPerson, voiceId: unknown, action: string): Promise<VoiceRecord | null> {
  if (voiceId === undefined) {
    const row = await ctx.db.prepare('SELECT * FROM stump_voice_guides WHERE person_id=? ORDER BY updated_at DESC,id LIMIT 1').bind(person.id).first<Row>()
    return row ? voiceRecord(row, person) : null
  }
  const row = await ctx.db.prepare('SELECT * FROM stump_voice_guides WHERE id=?').bind(String(voiceId)).first<Row>()
  if (!row) refuse('not_found', { voice_id: String(voiceId) })
  if (row.person_id !== person.id) return refuseAct(ctx, TOOL, action, { rule: 'D-1', source: 'STUMP-TRUTH-001' }, { voice_id: String(voiceId), person_id: person.id })
  const voice = voiceRecord(row, person)
  if (voice.state !== 'active') refuse('voice_archived', { voice_id: voice.id })
  return voice
}

/** The items a drafting call writes: the call itself, the author of a master, or each target of from_source with the call's person, product and voice as defaults. */
export function requestsOf(args: Args, action: string, self: string): Args[] {
  if (action === 'master') return [{ ...args, person_id: args.person_id ?? self }]
  if (action !== 'from_source') return [args]
  const defaults = Object.fromEntries(['person_id', 'product_id', 'voice_id'].filter(key => args[key] !== undefined).map(key => [key, args[key]]))
  return ((args.targets as Args[] | undefined) ?? []).map(entry => ({ ...defaults, ...entry }))
}

/** Whom an item speaks for, as target() decides it: the named person, a personal account's owner, or the person drafting. */
async function speakerId(ctx: ActionContext, entry: Args) {
  if (entry.person_id !== undefined) return entry.person_id
  const account = entry.account_id !== undefined ? await readAccount(ctx.db, String(entry.account_id)) : null
  return account?.owner_kind === 'person' ? account.owner_person_id : ctx.person.id
}

type Speaker = Pick<StumpPerson, 'id' | 'connection' | 'role'>

/**
 * A founder or employee may post generated text about the company; anyone else posts their own words (D-8).
 * The owner who set Stump up speaks for the company until their connection is recorded; anyone else without one is an outside voice.
 */
const outsideVoice = (person: { connection: string | null; role: string }) => person.connection ? !['founder', 'employee'].includes(person.connection) : person.role !== 'owner'

/** Generated text for an outside voice that names the company or a product is an endorsement Stump does not write (D-8, STUMP-SURFACE-010.1). */
async function refuseEndorsement(ctx: ActionContext, action: string, person: Speaker, because: string) {
  await refuseAct(ctx, TOOL, action, { rule: 'D-8', source: 'STUMP-SURFACE-010' }, { person_id: person.id, connection: person.connection, because, offer: 'talking_points' })
}

/** After the source is read: an outside voice's draft from a source that names the company is refused the same way (D-8). */
export async function screenSource(ctx: ActionContext, action: string, person: Speaker, source: Source | null) {
  if (source && outsideVoice(person) && namesCompany(await loadBrand(ctx.db), `${source.title ?? ''}\n${source.text}`)) await refuseEndorsement(ctx, action, person, 'source_names_company')
}

/**
 * The refusals a drafting request meets before anything else, the same for a
 * person and an agent under every company policy: a review, testimonial or vote
 * request asked for (D-4), a person not on the team or another person's voice
 * (D-1), generated text where the venue bans it (D-3), and generated
 * endorsement text for an outside voice (D-8).
 */
export async function screen(ctx: ActionContext, args: Args, action: string) {
  for (const finding of typeof args.prompt === 'string' ? screenDraftRequest(args.prompt) : []) {
    const act = bannedAct(finding.act)
    await refuseAct(ctx, TOOL, action, { rule: 'D-4', source: act.source_url, read_at: act.read_at }, { act: act.id, text: finding.text })
  }
  const generate = args.generate === true || action === 'from_source'
  const prompt = typeof args.prompt === 'string' ? args.prompt : ''
  const brand = generate ? await loadBrand(ctx.db) : null
  for (const entry of requestsOf(args, action, ctx.person.id)) {
    const personId = await speakerId(ctx, entry)
    if (personId === undefined || personId === null) continue
    const person = await speaker(ctx, personId, action)
    if (entry.voice_id !== undefined) await voiceFor(ctx, person, entry.voice_id, action)
    // Generated text for an outside voice that names the company is an endorsement, whatever the call says it is (D-8).
    if (brand && outsideVoice(person)) {
      const because = entry.recommends === true ? 'recommends' : entry.product_id !== undefined ? 'product' : namesCompany(brand, prompt) ? 'prompt_names_company' : null
      if (because) await refuseEndorsement(ctx, action, person, because)
    }
  }
  const venues = action === 'from_source' ? ((args.targets as Args[] | undefined) ?? []).map(target => target.venue_id).filter(Boolean)
    : action === 'master' ? ((args.venues as Args[] | undefined) ?? []).map(entry => entry.venue_id) : args.venue_id !== undefined ? [args.venue_id] : []
  for (const venueId of generate ? venues : []) {
    const venue = await venueRow(ctx, venueId), rule = venue.rules.ai_text
    if (AI_BANNED.has(String(rule?.value ?? '').toLowerCase()) || rule?.value === false) {
      await refuseAct(ctx, TOOL, action, { rule: 'D-3', source: rule?.source_url ?? 'STUMP-VENUE-002' }, { venue_id: venue.id, route: 'handoff_brief' })
    }
  }
}

interface Target { format: Format; person_id: string; speaker: Speaker; product_id: string | null; account: Account | null; network: string | null; venue_id: string | null }

async function target(ctx: ActionContext, args: Args, action: string, fallbackPerson: string): Promise<Target> {
  const format = (args.format as Format | undefined) ?? 'post'
  const account = args.account_id !== undefined ? await readAccount(ctx.db, String(args.account_id)) : null
  if (args.account_id !== undefined && !account) refuse('not_found', { account_id: String(args.account_id) })
  // An item speaks for the account's own person; a company account speaks for the person drafting (D-1).
  const personId = String(args.person_id ?? (account?.owner_kind === 'person' ? account.owner_person_id : fallbackPerson))
  const person = await speaker(ctx, personId, action)
  if (account?.owner_kind === 'person' && account.owner_person_id !== person.id) {
    await refuseAct(ctx, TOOL, action, { rule: 'D-1', source: 'STUMP-TRUTH-001' }, { account_id: account.id, person_id: person.id })
  }
  mayWrite(ctx, person.id)
  if (account && args.network !== undefined && args.network !== account.network) refuse('invalid_arguments', { field: 'network', reason: `The account is on ${account.network}.` })
  if (args.product_id !== undefined && !await ctx.db.prepare('SELECT 1 FROM stump_products WHERE id=?').bind(String(args.product_id)).first()) refuse('not_found', { product_id: String(args.product_id) })
  if (args.venue_id !== undefined) await venueRow(ctx, args.venue_id)
  return { format, person_id: person.id, speaker: person, product_id: (args.product_id as string | undefined) ?? null, account, network: account?.network ?? (args.network as string | undefined) ?? null, venue_id: (args.venue_id as string | undefined) ?? null }
}

/** A long text becomes a thread at sentence boundaries, each part counted the network's way (STUMP-DRAFT-001.2). */
function threadParts(text: string, network: string | null): string[] {
  if (!counted(network)) return text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  return splitThread(text, { target: { network } }).parts.map(part => part.text)
}

/** Each item drafted from a source links that source (STUMP-DRAFT-002.1). */
function linked(drafted: { text: string | null; parts: string[] | null }, source: Source | null) {
  if (!source) return drafted
  const bare = source.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const has = (text: string) => text.includes(source.url) || text.includes(bare)
  if (drafted.parts?.length) return drafted.parts.some(has) ? drafted : { ...drafted, parts: [...drafted.parts.slice(0, -1), `${drafted.parts.at(-1)} ${source.url}`] }
  return drafted.text === null || has(drafted.text) ? drafted : { ...drafted, text: `${drafted.text}\n\n${source.url}` }
}

async function aiDraft(ctx: ActionContext, args: Args, item: Target, source: Source | null): Promise<Drafted> {
  const [brand, person, venue, recipient] = await Promise.all([loadBrand(ctx.db), readPerson(ctx.db, item.person_id),
    item.venue_id ? venueRow(ctx, item.venue_id) : null, item.format === 'pitch' && args.recipient ? contactFor(ctx, args.recipient) : null])
  const voice = await voiceFor(ctx, person!, args.voice_id, 'create')
  const product = item.product_id ? brand.products.find(entry => entry.id === item.product_id) ?? null : null
  return draftWithAi(ctx, {
    format: item.format, network: item.network, limit: counted(item.network) ? NETWORK_LIMITS[item.network] : null, product, voice, claims: brand.claims.map(libClaim),
    venue: venue ? { name: venue.name, rules: venue.rules } : null, source, prompt: (args.prompt as string | undefined) ?? null,
    reply_to: (args.reply_to as { url?: string } | undefined)?.url ?? null,
    recipient: recipient ? { name: String(recipient.name), kind: String(recipient.kind), beat: recipient.beat as string | null, publication: recipient.publication as string | null } : null,
    today: today(ctx.now()),
  })
}

async function contactFor(ctx: ActionContext, recipient: unknown) {
  const contactId = (recipient as { contact_id?: unknown } | undefined)?.contact_id
  const row = contactId === undefined ? null : await ctx.db.prepare('SELECT * FROM stump_press_contacts WHERE id=?').bind(String(contactId)).first<Row>()
  if (!row) refuse('not_found', { contact_id: String(contactId) })
  return contactRecord(row)
}

/** One item: written by hand, or drafted through the provider from a prompt or a source. */
export async function createItem(ctx: ActionContext, args: Args) {
  const item = await target(ctx, args, 'create', ctx.person.id)
  // A reply carries the thread it answers; a pitch its recipient and subject (STUMP-DRAFT-001.3-.4, STUMP-PITCH-001).
  if (item.format === 'reply' && typeof (args.reply_to as { url?: unknown } | undefined)?.url !== 'string') refuse('invalid_arguments', { field: 'reply_to', reason: 'A reply names the post it answers.' })
  const recipient = item.format === 'pitch' ? await contactFor(ctx, args.recipient ?? {}) : null
  const source = args.generate === true && typeof args.source_url === 'string' ? await readSource(ctx.env, args.source_url, ctx.now()) : null
  await screenSource(ctx, 'create', item.speaker, source)
  let drafted: { text: string | null; parts: string[] | null; subject?: string | null; ai?: Drafted['ai'] }
  if (args.generate === true) drafted = linked(await aiDraft(ctx, args, item, source), source)
  else {
    if (typeof args.text !== 'string' && !Array.isArray(args.parts)) refuse('invalid_arguments', { field: 'text', reason: 'Give the text, or ask for a generated draft.' })
    drafted = { text: (args.text as string | undefined) ?? null, parts: (args.parts as string[] | undefined) ?? null }
  }
  if (item.format === 'thread' && !drafted.parts?.length) drafted = { ...drafted, parts: threadParts(drafted.text ?? '', item.network), text: null }
  if (item.format !== 'thread' && drafted.parts?.length) drafted = { ...drafted, text: drafted.parts.join('\n\n'), parts: null }
  const subject = (args.subject as string | undefined) ?? drafted.subject ?? null
  if (item.format === 'pitch' && !subject) refuse('invalid_arguments', { field: 'subject', reason: 'A pitch carries its subject.' })
  const id = crypto.randomUUID()
  const [check] = await insertItems(ctx, [{
    id, format: item.format, network: item.network, account_id: item.account?.id ?? null, venue_id: item.venue_id, person_id: item.person_id, product_id: item.product_id, master_id: null,
    text: drafted.text, parts: drafted.parts, ai: drafted.ai, sources: source ? [sourceRef(source)] : [], subject,
    recipient: recipient ? { contact_id: recipient.id, name: recipient.name, kind: recipient.kind, route: (recipient.contact_route as { kind?: string } | null)?.kind ?? null } : null,
    reply_to: args.reply_to ?? null, campaign: (args.campaign as string | undefined) ?? null, options: options(args),
  }])
  return { id, check: check! }
}

const sourceRef = (source: Source) => ({ url: source.url, title: source.title, read_at: source.read_at, sha256: source.sha256 })
// thread_url comes only from a hand-off (stump.drafts.write takes no such argument): the thread its draft is aimed at, which the venue's rules read (D-3).
const options = (args: Args) => Object.fromEntries(['poll', 'content_warning', 'visibility', 'recommends', 'prompt', 'thread_url'].filter(key => args[key] !== undefined).map(key => [key, args[key]]))

/** One source drafted for every target, each through the provider; one failure leaves no draft at all (STUMP-DRAFT-002). */
export async function draftFromSource(ctx: ActionContext, args: Args) {
  const targets = requestsOf(args, 'from_source', ctx.person.id)
  const planned = await Promise.all(targets.map(entry => target(ctx, entry, 'from_source', ctx.person.id)))
  const source = await readSource(ctx.env, String(args.source_url), ctx.now())
  for (const item of planned) await screenSource(ctx, 'from_source', item.speaker, source)
  const drafts: NewItem[] = []
  for (const [index, item] of planned.entries()) {
    const entry = { ...args, ...targets[index] }
    let drafted: { text: string | null; parts: string[] | null; ai: Drafted['ai'] } = linked(await aiDraft(ctx, entry, item, source), source) as Drafted
    if (item.format === 'thread' && !drafted.parts?.length) drafted = { ...drafted, parts: threadParts(drafted.text ?? '', item.network), text: null }
    if (item.format !== 'thread' && drafted.parts?.length) drafted = { ...drafted, text: drafted.parts.join('\n\n'), parts: null }
    drafts.push({ id: crypto.randomUUID(), format: item.format, network: item.network, account_id: item.account?.id ?? null, venue_id: item.venue_id, person_id: item.person_id,
      product_id: item.product_id, master_id: null, text: drafted.text, parts: drafted.parts, ai: drafted.ai, sources: [sourceRef(source)], campaign: (args.campaign as string | undefined) ?? null })
  }
  await insertItems(ctx, drafts)
  return { ids: drafts.map(draft => draft.id), source: sourceRef(source) }
}

/** One master text opened as a variant per account, each its own item (the master data contract, STUMP-DRAFT-010). */
export async function createMaster(ctx: ActionContext, args: Args) {
  const accountIds = [...new Set(args.account_ids as string[])]
  const accounts = await Promise.all(accountIds.map(async accountId => { const account = await readAccount(ctx.db, accountId); if (!account) refuse('not_found', { account_id: accountId }); return account }))
  const author = await speaker(ctx, args.person_id ?? ctx.person.id, 'master')
  // Each variant may be aimed at a venue; one named for an account the post does not go to is a mistake, never ignored.
  const aimed = new Map(((args.venues as Array<{ account_id: string; venue_id: string }> | undefined) ?? []).map(entry => [entry.account_id, entry.venue_id]))
  for (const accountId of aimed.keys()) if (!accountIds.includes(accountId)) refuse('invalid_arguments', { field: 'venues', reason: `The post does not go to account ${accountId}.` })
  const variants = await Promise.all(accounts.map(account => target(ctx, { account_id: account.id, product_id: args.product_id, ...(aimed.has(account.id) ? { venue_id: aimed.get(account.id) } : {}),
    ...(account.owner_kind === 'company' ? { person_id: author.id } : {}) }, 'master', author.id)))
  let text = typeof args.text === 'string' ? args.text : null, ai: Drafted['ai'] | undefined, source: Source | null = null
  if (args.generate === true) {
    source = typeof args.source_url === 'string' ? await readSource(ctx.env, args.source_url, ctx.now()) : null
    await screenSource(ctx, 'master', author, source)
    const drafted = linked(await aiDraft(ctx, args, { format: 'post', person_id: author.id, speaker: author, product_id: (args.product_id as string | undefined) ?? null, account: null, network: null, venue_id: null }, source), source) as Drafted
    text = drafted.text
    ai = drafted.ai
  }
  if (!text) refuse('invalid_arguments', { field: 'text', reason: 'Give the master text, or ask for a generated draft.' })
  // A source given with hand-written text is kept as a reference, unread.
  const masterId = crypto.randomUUID(), now = ctx.now(), sources = source ? [sourceRef(source)] : typeof args.source_url === 'string' ? [{ url: args.source_url }] : []
  const ids = variants.map(() => crypto.randomUUID())
  const master = ctx.db.prepare('INSERT INTO stump_masters(id,person_id,product_id,text,account_ids,sources,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(masterId, author.id, (args.product_id as string | undefined) ?? null, text, JSON.stringify(accountIds), JSON.stringify(sources), ctx.person.id, now, now)
  await insertItems(ctx, variants.map((variant, index) => ({
    id: ids[index]!, format: 'post', network: variant.network, account_id: variant.account!.id, venue_id: variant.venue_id, person_id: variant.person_id, product_id: variant.product_id,
    master_id: masterId, text, parts: null, differs_from_master: 0 as const, sources, ...(ai ? { ai } : {}),
  })), [master])
  return { master_id: masterId, ids }
}
