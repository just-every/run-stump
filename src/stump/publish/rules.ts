import type { RuleSource } from '../actions/refusals.ts'
import { shownHandle } from '../accounts/handle.ts'
import type { AccountRow } from '../accounts/store.ts'
import { bannedAct } from '../lib/claims/index.ts'

// D-4's rules for agent-initiated publishing: an X account carries X's
// Automated label with its operator named in the bio, and a Mastodon account
// carries the bot flag where its instance's rules ask for it. A person posting
// through their own composer is unaffected.

const READ_AT = '2026-10-30'
export const X_AUTOMATION: RuleSource = { rule: 'D-4', source: 'https://help.x.com/en/rules-and-policies/x-automation', read_at: READ_AT }

const unengaged = bannedAct('x_unengaged_reply')
/** D-4: an API reply on X only to an account that engaged with the replying account first. */
export const UNENGAGED: RuleSource = { rule: 'D-4', source: unengaged.source_url, read_at: unengaged.read_at }
/** X's developer guidelines: one reply per interaction. */
export const ONE_REPLY: RuleSource = { rule: 'D-4', source: 'https://docs.x.com/developer-guidelines', read_at: unengaged.read_at }

/** The provider step an AI-drafted reply on X waits at until the company records X's approval (STUMP-SURFACE-005.4). */
export const X_AI_STEP = 'x_ai_reply_approval'

export interface BrokenRule { reason: 'x_automated_label' | 'mastodon_bot_flag'; message: string; source: RuleSource; rules?: Array<{ id: string; text: string }> }

export function agentRuleBroken(account: AccountRow): BrokenRule | null {
  if (account.network === 'x' && !(account.automated_label === 1 && account.operator_named === 1)) {
    return { reason: 'x_automated_label', source: X_AUTOMATION,
      message: `X asks an account that posts automatically to carry its Automated label with the operator named in the bio. Record both for ${shownHandle(account)} before an agent publishes to it.` }
  }
  const rules = JSON.parse(account.bot_rules) as Array<{ id: string; text: string }>
  if (account.network === 'mastodon' && rules.length && account.bot !== 1) {
    return { reason: 'mastodon_bot_flag', rules, source: { rule: 'D-4', source: `${account.instance ?? ''}/about`, read_at: new Date(account.updated_at).toISOString().slice(0, 10) },
      message: `${account.instance ?? 'The instance'} asks automated accounts to carry the bot flag, and ${shownHandle(account)} does not.` }
  }
  return null
}
