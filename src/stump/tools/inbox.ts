import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { xPrices } from '../accounts/apps.ts'
import { readAccount } from '../accounts/store.ts'
import { aiHost } from '../drafting/ai.ts'
import { checkReply, countInbox, listInbox, NO_DM, planReply, pollCeiling, pollInbox, replyClasses, runReply } from '../inbox/index.ts'
import { EDITORS, READERS } from '../people/roles.ts'

// stump.inbox.read and stump.inbox.reply: the company's X mentions and replies,
// read at the company's read price and stored once, and answers to the people
// who engaged first (STUMP-INBOX-001, STUMP-INBOX-002). There is no like,
// repost, quote, follow or direct message here: asking for one by name answers
// act_refused with its rule (D-4).

const id = { type: 'string', minLength: 1, maxLength: 64 }
const text = { type: 'string', minLength: 1, maxLength: 4000 }

async function account(ctx: ActionContext, args: Args) {
  const row = await readAccount(ctx.db, String(args.account_id))
  if (!row) refuse('not_found', { account_id: String(args.account_id) })
  return row
}

/** Direct messages are not sent from Stump; asked for by name, they are a contact the person did not start (D-4). */
const NO_MESSAGES = { dm: NO_DM, direct_message: NO_DM, send_dm: NO_DM, message: NO_DM }

export const inboxTools: StumpTool[] = [{
  name: 'stump.inbox.read', title: 'Read the inbox',
  description: 'Read the mentions of and replies to a connected X account through the company\'s X app, each read priced from the company\'s price table, and list them with their authors, links, whether each author engaged with the account first, the company post they answered and any reply. Check a reply\'s text before it goes out.',
  scope: 'stump:inbox', classes: ['standard', 'money'], clauses: ['STUMP-INBOX-001'], refused: NO_MESSAGES,
  actions: {
    poll: {
      roles: EDITORS,
      properties: { account_id: id }, required: ['account_id'],
      // Policy weighs the most one read can cost before it runs; the answer carries what it did cost.
      async classify(args, ctx) {
        await account(ctx, args)
        const ceiling = pollCeiling(await xPrices(ctx.db))
        return [{ class: 'standard' as const, facts: { measure: 1 } }, ...(ceiling > 0 ? [{ class: 'money' as const, facts: { measure: ceiling / 1e6, currency: 'usd', counterparty: 'x' } }] : [])]
      },
      async summary(args, ctx) {
        const row = await account(ctx, args), ceiling = pollCeiling(await xPrices(ctx.db))
        return { target: { id: row.id, name: `Read the inbox of ${row.handle}` }, ...(ceiling > 0 ? { amount: { value: ceiling / 1e6, currency: 'USD' }, payee: 'X' } : {}) }
      },
      target: args => ({ kind: 'account', id: String(args.account_id) }),
      async run(args, ctx) { return pollInbox(ctx, await account(ctx, args)) },
    },
    list: {
      roles: READERS, read: true,
      properties: { account_id: id }, required: ['account_id'],
      async classify(args, ctx) { await account(ctx, args); return [{ class: 'standard' as const, facts: { measure: await countInbox(ctx.db, String(args.account_id)) } }] },
      async run(args, ctx) { return listInbox(ctx.db, (await account(ctx, args)).id) },
    },
    check: {
      roles: EDITORS, read: true,
      properties: { inbox_item_id: id, account_id: id, text }, required: ['inbox_item_id', 'account_id', 'text'],
      classify: () => [{ class: 'standard' as const, facts: { measure: 1 } }],
      run: (args, ctx) => checkReply(ctx, args),
    },
  },
}, {
  name: 'stump.inbox.reply', title: 'Answer someone who engaged first',
  description: 'Reply from the account to a post in its inbox, only where the author engaged with the account first and only once per interaction. Give the text, or ask for a draft in the person\'s voice through the company\'s AI provider; every reply passes the claim, disclosure and near-duplicate checks, posts through the network and lands on the ledger. An AI-drafted reply on X waits for X\'s approval step.',
  scope: 'stump:inbox', classes: ['external', 'money', 'gated'], clauses: ['STUMP-INBOX-002', 'STUMP-SURFACE-003', 'STUMP-SURFACE-005', 'STUMP-TRUTH-003', 'STUMP-TRUTH-004'], refused: NO_MESSAGES,
  actions: {
    reply: {
      roles: EDITORS,
      properties: { inbox_item_id: id, account_id: id, text, generate: { type: 'boolean' } }, required: ['inbox_item_id', 'account_id'],
      async classify(args, ctx) { return replyClasses(await planReply(ctx, args), aiHost(ctx.env)) },
      async summary(args, ctx) {
        const plan = await planReply(ctx, args)
        return { target: { id: plan.inbox.id, name: `Reply to @${plan.inbox.author_handle ?? 'someone'} on ${plan.account.network}` }, recipients: [plan.inbox.url],
          ...(plan.charge_micro > 0 ? { amount: { value: plan.charge_micro / 1e6, currency: 'USD' }, payee: 'X' } : {}) }
      },
      target: args => ({ kind: 'inbox_item', id: String(args.inbox_item_id) }),
      run: (args, ctx) => runReply(ctx, args),
    },
  },
}]
