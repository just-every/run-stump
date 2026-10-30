import type { RuleSource } from '../actions/refusals.ts'
import type { AccountRow } from '../accounts/store.ts'

// D-4's rules for agent-initiated publishing: an X account carries X's
// Automated label with its operator named in the bio, and a Mastodon account
// carries the bot flag where its instance's rules ask for it. A person posting
// through their own composer is unaffected.

const READ_AT = '2026-10-30'
export const X_AUTOMATION: RuleSource = { rule: 'D-4', source: 'https://help.x.com/en/rules-and-policies/x-automation', read_at: READ_AT }

export interface BrokenRule { reason: 'x_automated_label' | 'mastodon_bot_flag'; message: string; source: RuleSource; rules?: Array<{ id: string; text: string }> }

export function agentRuleBroken(account: AccountRow): BrokenRule | null {
  if (account.network === 'x' && !(account.automated_label === 1 && account.operator_bio)) {
    return { reason: 'x_automated_label', source: X_AUTOMATION,
      message: `X asks an account that posts automatically to carry its Automated label with the operator named in the bio. Record both for ${account.handle} before an agent publishes to it.` }
  }
  const rules = JSON.parse(account.bot_rules) as Array<{ id: string; text: string }>
  if (account.network === 'mastodon' && rules.length && account.bot !== 1) {
    return { reason: 'mastodon_bot_flag', rules, source: { rule: 'D-4', source: `${account.instance ?? ''}/about`, read_at: new Date(account.updated_at).toISOString().slice(0, 10) },
      message: `${account.instance ?? 'The instance'} asks automated accounts to carry the bot flag, and ${account.handle} does not.` }
  }
  return null
}
