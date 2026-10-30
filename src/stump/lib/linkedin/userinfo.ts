/**
 * The connected member: OpenID Connect userinfo.
 *
 * Source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
 *   GET https://api.linkedin.com/v2/userinfo with the bearer token (scopes openid profile) ->
 *   {sub, name, given_name, family_name, picture, locale, email?, email_verified?}.
 * The member's post author URN is urn:li:person:{sub} (Share on LinkedIn:
 * https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).
 */
import { linkedInCall } from './http'
import type { LinkedInContext, LinkedInOutcome } from './types'

export interface LinkedInMember {
  sub: string
  /** The author URN to post as: urn:li:person:{sub}. */
  urn: string
  name: string
  givenName: string | null
  familyName: string | null
  picture: string | null
  locale: string | null
  /** Only when the app asked for the email scope. Stump does not. */
  email: string | null
}

export function linkedInPersonUrn(sub: string): string {
  return `urn:li:person:${sub}`
}

export function getLinkedInMember(ctx: LinkedInContext): Promise<LinkedInOutcome<LinkedInMember>> {
  return linkedInCall<LinkedInMember>(ctx, {
    method: 'GET',
    visible: false,
    plain: true,
    path: '/v2/userinfo',
    parse: (b, status) => {
      if (!b || typeof b.sub !== 'string' || b.sub === '') {
        return {
          kind: 'server_error', status, message: 'LinkedIn answered userinfo without a member id.', providerCode: null,
          serviceErrorCode: null, code: 'no_sub', limitScope: null, resetAt: null, retry: 'safe', mayHaveApplied: false,
        }
      }
      const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
      return {
        sub: b.sub,
        urn: linkedInPersonUrn(b.sub),
        name: str(b.name) ?? [str(b.given_name), str(b.family_name)].filter(Boolean).join(' '),
        givenName: str(b.given_name),
        familyName: str(b.family_name),
        picture: str(b.picture),
        locale: str(b.locale),
        email: str(b.email),
      }
    },
  })
}
