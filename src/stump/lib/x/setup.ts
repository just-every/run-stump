/**
 * What the setup screen needs to know about the company's own X developer app.
 *
 * Sources (read 30 Oct 2026):
 *  - https://docs.x.com/x-api/getting-started/pricing (pay-per-use plan)
 *  - https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
 *      (callback URL must match exactly; confidential clients get a client secret)
 *  - docs/networks.md in the Stump repository: gates for X (a developer app on pay-per-use;
 *    the Automated label and operator bio for automated accounts; X's prior approval for
 *    AI-generated replies)
 */
import { X_DEFAULT_SCOPES } from './oauth'
import { X_DEFAULT_PRICES } from './charge'

/** Hosts this library calls, for the installation's declared externals. */
export const X_HOSTS = ['api.x.com', 'x.com'] as const

export interface XAppSetup {
  network: 'x'
  title: string
  steps: string[]
  callback_urls: string[]
  scopes: string[]
  hosts: string[]
  /** Approvals the company records by hand; X exposes no API for them. */
  recorded_approvals: { key: 'automated_label' | 'ai_replies_approval'; label: string }[]
  default_prices_usd: typeof X_DEFAULT_PRICES
}

/** The steps, callback URLs and scopes to show for X. `redirectUri` is the app's X callback address. */
export function describeXApp(input: { redirectUri: string | string[] }): XAppSetup {
  const callbacks = Array.isArray(input.redirectUri) ? input.redirectUri : [input.redirectUri]
  return {
    network: 'x',
    title: 'X developer app',
    steps: [
      'Open the X Developer Console and create a project and an app on the pay-per-use plan.',
      'Under the app\'s user authentication settings choose OAuth 2.0, type Web App, Automated App or Bot.',
      'Add the callback URL shown here exactly as written.',
      'Copy the OAuth 2.0 Client ID and Client Secret into Stump.',
      'Add credits in the Developer Console; X blocks requests when the balance reaches zero.',
      'For an account that posts automatically, turn on X\'s Automated label and name the operator in the bio, then record both here.',
      'Before an AI drafts X replies, get X\'s approval and record it here.',
    ],
    callback_urls: callbacks,
    scopes: [...X_DEFAULT_SCOPES],
    hosts: [...X_HOSTS],
    recorded_approvals: [
      { key: 'automated_label', label: 'Automated label on the account, with the operator named in the bio' },
      { key: 'ai_replies_approval', label: "X's approval for AI-drafted replies" },
    ],
    default_prices_usd: X_DEFAULT_PRICES,
  }
}

export interface XAppKeyCheck {
  ok: boolean
  error?: string
  field?: 'client_id' | 'client_secret'
}

/**
 * Shape check on keys a person pastes in. X cannot confirm a Client ID and Secret
 * without a person's consent, so the first connection is the real test.
 */
export function checkXAppKeys(keys: { client_id?: unknown; client_secret?: unknown }): XAppKeyCheck {
  const id = typeof keys.client_id === 'string' ? keys.client_id.trim() : ''
  const secret = typeof keys.client_secret === 'string' ? keys.client_secret.trim() : ''
  if (id === '') return { ok: false, field: 'client_id', error: 'Enter the OAuth 2.0 Client ID.' }
  if (/\s/.test(id)) return { ok: false, field: 'client_id', error: 'The Client ID has no spaces.' }
  if (secret === '') return { ok: false, field: 'client_secret', error: 'Enter the OAuth 2.0 Client Secret.' }
  if (/\s/.test(secret)) return { ok: false, field: 'client_secret', error: 'The Client Secret has no spaces.' }
  return { ok: true }
}

/** Shows a stored key without exposing it: the last four characters behind a fixed mask. */
export function maskSecret(value: string): string {
  const chars = [...value]
  if (chars.length <= 8) return '•'.repeat(8)
  return '•'.repeat(8) + chars.slice(-4).join('')
}
