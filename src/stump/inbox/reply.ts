// Answering someone who engaged first (STUMP-INBOX-002 on X). The account answers
// only a post whose author mentioned, replied to or quoted it, and only once per
// interaction (D-4, X's automation rules). A reply is an item like any other: it
// is written through the drafting module (by hand, or in the person's voice
// through the company's AI provider), passes the claim, disclosure and
// near-duplicate checks, and posts through the network's publisher onto the
// ledger. An AI-drafted reply on X waits at X's prior-approval step, which the
// company has not recorded, and the person may write their own reply instead.
import { refuse, refuseAct, type RuleSource } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { xPrices } from '../accounts/apps.ts'
import { readAccount, type AccountRow } from '../accounts/store.ts'
import { checkDraft, checkView, loadBrand } from '../drafting/check.ts'
import { createItem, screen } from '../drafting/write.ts'
import { readItem as readDraft, saveItem } from '../drafting/items.ts'
import { moveItem, pauseFor, type ItemState } from '../items/state.ts'
import { quoteXPost } from '../lib/x/index.ts'
import { readPerson } from '../people/store.ts'
import { readItem, type FullItemRow } from '../publish/items.ts'
import { agentRuleBroken, ONE_REPLY, UNENGAGED, X_AI_STEP } from '../publish/rules.ts'
import { blockingFlags, commit, mover, prepare, sendNow } from '../publish/schedule.ts'
import { ANSWERED, readInboxItem, type InboxRow } from './store.ts'

export const REPLY_TOOL = 'stump.inbox.reply'

export { ONE_REPLY, UNENGAGED, X_AI_STEP }
/** A direct message to someone who has not opened the conversation is the same unsolicited contact (D-4). */
export const NO_DM: RuleSource = UNENGAGED

/** Draft states a new reply rewrites in place: nothing of it has gone out. */
const PENDING: readonly ItemState[] = ['draft', 'ready', 'held', 'failed']

export interface ReplyPlan { inbox: InboxRow; account: AccountRow; speaker: string; text: string | null; generate: boolean; gated: boolean; charge_micro: number; pending: FullItemRow | null }

/** The inbox item a call names, on the account it names. */
export async function inboxItemOn(ctx: ActionContext, args: Args): Promise<{ inbox: InboxRow; account: AccountRow }> {
  const inbox = await readInboxItem(ctx.db, String(args.inbox_item_id))
  if (!inbox) refuse('not_found', { inbox_item_id: String(args.inbox_item_id) })
  if (args.account_id !== inbox.account_id) refuse('invalid_arguments', { field: 'account_id', reason: 'The post arrived on another account.', account_id: inbox.account_id })
  const account = await readAccount(ctx.db, inbox.account_id)
  if (!account) refuse('not_found', { account_id: inbox.account_id })
  return { inbox, account }
}

/** Who a reply from this account speaks for: a personal account's own person, else the person answering. */
function speakerOf(ctx: ActionContext, account: AccountRow): string {
  if (account.owner_kind === 'person' && account.owner_person_id !== ctx.person.id) refuse('not_account_owner', { account_id: account.id, owner: { kind: 'person', person_id: account.owner_person_id } })
  return account.owner_kind === 'person' ? account.owner_person_id! : ctx.person.id
}

/**
 * Every check a reply meets before anything changes, the same through both
 * doors and under every company policy: the text or a generated draft, the
 * account, D-4's engaged-first and one-reply rules, and X's Automated label for
 * an agent. Computed from records, never from the text's words (D-7).
 */
export async function planReply(ctx: ActionContext, args: Args, stage: 'classify' | 'run' = 'classify'): Promise<ReplyPlan> {
  const text = typeof args.text === 'string' ? args.text : null, generate = args.generate === true
  if (text !== null && generate) refuse('invalid_arguments', { field: 'generate', reason: 'Give your own text, or ask for a generated draft, not both.' })
  if (!generate && !text?.trim()) refuse('invalid_arguments', { field: 'text', reason: 'Write the reply, or ask for a generated draft.' })
  const { inbox, account } = await inboxItemOn(ctx, args)
  if (account.state !== 'connected') refuse('account_not_connected', { account_id: account.id, state: account.state, reconnect_url: account.reconnect_url })
  const speaker = speakerOf(ctx, account)
  if (inbox.engaged_first !== 1) {
    await refuseAct(ctx, REPLY_TOOL, 'reply', UNENGAGED, { act: 'x_unengaged_reply', inbox_item_id: inbox.id, author: inbox.author_handle, url: inbox.url, route: 'handoff' })
  }
  const earlier = inbox.reply_item_id ? await readItem(ctx.db, inbox.reply_item_id) : null
  // The agent door classifies an approved call again when it hands back its receipt, after the reply went out:
  // the same caller asking with the same words is that call, and it reaches run only if it is a new one.
  if (earlier && (ANSWERED as readonly string[]).includes(earlier.state) && (stage === 'run' || !sameCall(ctx, earlier, text))) {
    await refuseAct(ctx, REPLY_TOOL, 'reply', ONE_REPLY, { act: 'x_one_reply_per_interaction', inbox_item_id: inbox.id, reply_item_id: earlier.id, reply_url: earlier.url })
  }
  const broken = ctx.agent ? agentRuleBroken(account) : null
  if (broken) await refuseAct(ctx, REPLY_TOOL, 'reply', broken.source, { account_id: account.id, reason: broken.reason })
  const pending = earlier && PENDING.includes(earlier.state) ? earlier : null
  // The claim, disclosure and limit checks stop a reply before anything is written, as they stop every other publish door
  // (item_flagged). A near-duplicate is the one finding that is written and held until rewritten (STUMP-TRUTH-004).
  if (text !== null) {
    const flags = (await checkText(ctx, account, speaker, text, pending?.id)).flags.filter(flag => flag.blocking && !HELD.includes(flag.code))
    if (flags.length) refuse('item_flagged', { item_id: pending?.id ?? null, inbox_item_id: inbox.id, flag: flags[0]!.code, flags })
  }
  // X keeps an AI-drafted reply for its own prior approval, which Stump has no record of yet (STUMP-CONNECT-002.3).
  const gated = generate && account.network === 'x'
  const charge_micro = text !== null && account.network === 'x' ? quoteXPost(text, await xPrices(ctx.db)).usd_micro : 0
  return { inbox, account, speaker, text, generate, gated, charge_micro, pending }
}

/** Findings a reply is written and held for, rather than refused: it repeats something recent and waits for a rewrite. */
const HELD = ['near_duplicate']

/** The drafting module's full check of a reply's text from this account, for the person it speaks for. Writes nothing. */
async function checkText(ctx: ActionContext, account: AccountRow, speaker: string, text: string, itemId?: string) {
  return checkDraft(ctx.db, await loadBrand(ctx.db), { ...(itemId ? { id: itemId } : {}), format: 'reply', network: account.network, account_id: account.id, venue_id: null, person_id: speaker,
    product_id: null, master_id: null, text, parts: null }, await readPerson(ctx.db, speaker), ctx.now())
}

/** The answered reply is this caller's own, with these words. */
function sameCall(ctx: ActionContext, earlier: FullItemRow, text: string | null) {
  const agent = earlier.agent ? (JSON.parse(earlier.agent) as { id?: string }).id ?? null : null
  return text !== null && earlier.text === text && (earlier as FullItemRow & { created_by: string }).created_by === ctx.person.id && agent === (ctx.agent?.id ?? null)
}

/** The classes of one reply: a public reply to someone who engaged first (known), what X charges for it, and X's step for an AI draft. */
export function replyClasses(plan: ReplyPlan, aiHost: string) {
  return [
    { class: 'external' as const, facts: { measure: 1, counterparty: 'known' as const, ...(plan.generate ? { provider: aiHost } : {}) } },
    ...(plan.charge_micro > 0 ? [{ class: 'money' as const, facts: { measure: plan.charge_micro / 1e6, currency: 'usd', counterparty: 'x' } }] : []),
    ...(plan.gated ? [{ class: 'gated' as const, facts: { measure: 1, provider: plan.account.network, step: X_AI_STEP } }] : []),
  ]
}

async function cancel(ctx: ActionContext, row: FullItemRow | null, reason: string) {
  if (row && PENDING.includes(row.state)) await ctx.db.batch(moveItem(mover(ctx), row, 'cancelled', reason))
}

/** The reply item with what a person needs to read about it. */
async function answer(ctx: ActionContext, plan: ReplyPlan, itemId: string, fields: Record<string, unknown>) {
  const item = (await readItem(ctx.db, itemId))!
  const ledger = await ctx.db.prepare("SELECT id,url,charge_usd,state FROM stump_ledger WHERE item_id=? AND account_id=? AND route='published'").bind(itemId, plan.account.id)
    .first<{ id: string; url: string | null; charge_usd: number | null; state: string }>()
  return {
    inbox_item_id: plan.inbox.id, item_id: item.id, state: item.state, posted: item.state === 'posted', text: item.text, url: item.url, network_id: item.network_id,
    flags: JSON.parse(item.flags) as unknown[], hold: item.hold ? JSON.parse(item.hold) as unknown : null, error: item.error ? JSON.parse(item.error) as unknown : null,
    ai: item.ai ? JSON.parse(item.ai) as unknown : null, ledger_id: ledger?.id ?? null, charge_usd: ledger?.charge_usd ?? null, ...fields,
  }
}

/** Writes the reply, holds it where a check or X's step keeps it, and otherwise posts it and records it on the ledger. */
export async function runReply(ctx: ActionContext, args: Args) {
  const plan = await planReply(ctx, args, 'run')
  const { inbox, account } = plan
  if (!plan.gated) {
    const pause = await pauseFor(ctx.db, account.id)
    if (pause) refuse('publishing_paused', { scope: pause.scope, account_id: pause.account_id })
  }
  const base = { format: 'reply', account_id: account.id, person_id: plan.speaker, reply_to: { url: inbox.url } }
  let itemId: string
  if (plan.generate) {
    await screen(ctx, { ...base, generate: true }, 'create')
    // The post being answered goes to the provider as the thing to answer; its words decide nothing (D-7).
    const made = await createItem(ctx, { ...base, generate: true, prompt: `Answer this ${inbox.kind === 'reply' ? 'reply to our post' : 'post'} by @${inbox.author_handle ?? 'someone'}: ${inbox.text}` })
    itemId = made.id
    await cancel(ctx, plan.pending, 'replaced by a new reply')
  } else if (plan.pending && !plan.pending.ai) {
    // A rewrite of a reply that has not gone out: the new text is checked again, and only a rewrite clears a hold.
    await saveItem(ctx, await readDraft(ctx, plan.pending.id), { text: plan.text, parts: null }, 'rewritten')
    itemId = plan.pending.id
  } else {
    itemId = (await createItem(ctx, { ...base, text: plan.text })).id
    await cancel(ctx, plan.pending, 'replaced by a new reply')
  }
  await ctx.db.prepare('UPDATE stump_inbox_items SET reply_item_id=? WHERE id=?').bind(itemId, inbox.id).run()
  ctx.emit('inbox.replied', `stump://inbox/items/${inbox.id}`, { item_id: itemId })

  const row = (await readItem(ctx.db, itemId))!
  if (plan.gated) {
    if (row.state === 'draft') {
      await ctx.db.batch(moveItem(mover(ctx), row, 'held', X_AI_STEP, { hold: JSON.stringify({ owner_id: plan.speaker, reason: X_AI_STEP, provider: 'x', step: X_AI_STEP, next_attempt_at: null,
        detail: 'X asks for its approval before an app posts AI-drafted replies, and the company has not recorded it. Write your own reply instead.' }) }))
    }
    return answer(ctx, plan, itemId, { step: X_AI_STEP })
  }
  // A near-duplicate is held naming what it repeats until it is rewritten (STUMP-TRUTH-004); any other finding refuses, as every publish door does.
  const flagged = blockingFlags(row), refused = flagged.filter(flag => !HELD.includes(flag.code))
  if (refused.length) refuse('item_flagged', { item_id: row.id, inbox_item_id: inbox.id, flag: refused[0]!.code, flags: refused })
  if (flagged.length) return answer(ctx, plan, itemId, {})
  const sendable = await prepare(ctx, 'reply', { item_id: itemId, account_id: account.id }, { now: true })
  await commit(ctx, sendable)
  const sent = await sendNow(ctx, itemId, 'scheduled')
  return answer(ctx, plan, itemId, { outcome: sent.outcome })
}

/** The checks a reply's text meets, without writing anything: what the composer shows before Reply. */
export async function checkReply(ctx: ActionContext, args: Args) {
  const { inbox, account } = await inboxItemOn(ctx, args)
  const speaker = speakerOf(ctx, account), text = String(args.text)
  const earlier = inbox.reply_item_id ? await readItem(ctx.db, inbox.reply_item_id) : null
  const result = await checkText(ctx, account, speaker, text, earlier && PENDING.includes(earlier.state) ? earlier.id : undefined)
  return {
    ...checkView(result), may_reply: inbox.engaged_first === 1 && !(earlier && (ANSWERED as readonly string[]).includes(earlier.state)),
    charge_usd: account.network === 'x' ? quoteXPost(text, await xPrices(ctx.db)).usd : 0,
  }
}
