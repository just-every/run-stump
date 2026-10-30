/**
 * The connected account: GET /2/users/me.
 * Source: https://docs.x.com/x-api/users/get-my-user.md (read 30 Oct 2026); scopes tweet.read and users.read.
 *
 * X exposes no field for its Automated label, so the label and operator bio are recorded
 * by a person (STUMP-PUBLISH-004); `description` is returned so the bio can be shown beside it.
 * The read is the account's own data, so it is priced as an owned read.
 */
import { quoteXRead } from './charge'
import { xCall } from './http'
import type { XChargeQuote, XContext, XPriceTable, XResult } from './types'

export interface XUser {
  id: string
  username: string
  name: string
  description: string | null
  verifiedType: string | null
  protected: boolean
  profileImageUrl: string | null
  charge: XChargeQuote | null
}

export async function getXMe(ctx: XContext, prices?: XPriceTable): Promise<XResult<XUser>> {
  return xCall<XUser>(ctx, {
    method: 'GET',
    visible: false,
    path: '/2/users/me',
    query: { 'user.fields': 'id,name,username,description,verified_type,protected,profile_image_url' },
    parse: (body, status) => {
      const u = body?.data
      if (!u || typeof u.id !== 'string' || typeof u.username !== 'string') {
        return { kind: 'server_error', status, message: 'X answered /users/me without a user.', type: null, code: 'no_user', resetAt: null, retry: 'safe', mayHaveApplied: false }
      }
      return {
        id: u.id,
        username: u.username,
        name: String(u.name ?? u.username),
        description: typeof u.description === 'string' ? u.description : null,
        verifiedType: typeof u.verified_type === 'string' ? u.verified_type : null,
        protected: u.protected === true,
        profileImageUrl: typeof u.profile_image_url === 'string' ? u.profile_image_url : null,
        charge: prices ? quoteXRead(1, prices, true) : null,
      }
    },
  })
}
