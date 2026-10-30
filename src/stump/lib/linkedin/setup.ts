/**
 * What the setup screen needs to know about the company's own LinkedIn app.
 *
 * Sources (read 30 Oct 2026):
 *  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 *      the Share on LinkedIn product grants w_member_social; add it on the app's Products tab
 *  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 *      redirect URLs must be absolute https, no parameters, no #
 *  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
 *      openid and profile come with Sign In with LinkedIn using OpenID Connect
 *  - docs/networks.md in the Stump repository (gates: Share on LinkedIn for members; Community
 *    Management API, vetted, for pages and analytics)
 */
import { LINKEDIN_MEMBER_SCOPES } from './oauth'
import { LINKEDIN_COMMENTARY_MAX } from './text'
import { LINKEDIN_MEMBER_DAILY_LIMIT } from './limits'

/** Hosts this library calls, for the installation's declared externals. */
export const LINKEDIN_HOSTS = ['www.linkedin.com', 'api.linkedin.com'] as const

export interface LinkedInAppSetup {
  network: 'linkedin'
  title: string
  steps: string[]
  callback_urls: string[]
  scopes: string[]
  hosts: string[]
  limits: { post_characters: number; member_requests_per_day: number }
}

/** The steps, callback URL and scopes to show for LinkedIn. `redirectUri` is the app's LinkedIn callback address. */
export function describeLinkedInApp(input: { redirectUri: string | string[] }): LinkedInAppSetup {
  const callbacks = Array.isArray(input.redirectUri) ? input.redirectUri : [input.redirectUri]
  return {
    network: 'linkedin',
    title: 'LinkedIn app',
    steps: [
      'Create an app in the LinkedIn Developer Portal and associate it with your company page.',
      'On the Products tab add Share on LinkedIn and Sign In with LinkedIn using OpenID Connect.',
      'On the Auth tab add the redirect URL shown here exactly as written (https, no parameters, no #).',
      'Copy the Client ID and Client Secret into Stump.',
      'Each person then connects their own profile from their account; the token lasts 60 days and they reconnect when it ends.',
      'Posting to a company page, and reading results, need the Community Management API, which LinkedIn vets separately.',
    ],
    callback_urls: callbacks,
    scopes: [...LINKEDIN_MEMBER_SCOPES],
    hosts: [...LINKEDIN_HOSTS],
    limits: { post_characters: LINKEDIN_COMMENTARY_MAX, member_requests_per_day: LINKEDIN_MEMBER_DAILY_LIMIT },
  }
}

/** Shape check on keys a person pastes in. LinkedIn confirms them at the first connection. */
export function checkLinkedInAppKeys(keys: { client_id?: unknown; client_secret?: unknown }): { ok: boolean; field?: 'client_id' | 'client_secret'; error?: string } {
  const id = typeof keys.client_id === 'string' ? keys.client_id.trim() : ''
  const secret = typeof keys.client_secret === 'string' ? keys.client_secret.trim() : ''
  if (id === '') return { ok: false, field: 'client_id', error: 'Enter the Client ID.' }
  if (/\s/.test(id)) return { ok: false, field: 'client_id', error: 'The Client ID has no spaces.' }
  if (secret === '') return { ok: false, field: 'client_secret', error: 'Enter the Client Secret.' }
  if (/\s/.test(secret)) return { ok: false, field: 'client_secret', error: 'The Client Secret has no spaces.' }
  return { ok: true }
}

/** Shows a stored key without exposing it: the last four characters behind a fixed mask. */
export function maskLinkedInSecret(value: string): string {
  const chars = [...value]
  if (chars.length <= 8) return '•'.repeat(8)
  return '•'.repeat(8) + chars.slice(-4).join('')
}
