/**
 * Image upload for a post.
 *
 * Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
 *   POST /rest/images?action=initializeUpload {initializeUploadRequest:{owner}} ->
 *   {value:{uploadUrl, uploadUrlExpiresAt, image:"urn:li:image:..."}}; the bytes then go to
 *   uploadUrl with the bearer token (the Share on LinkedIn guide sends the file with
 *   curl --upload-file, a PUT); JPG, GIF and PNG under 36,152,320 pixels; permissions include
 *   w_member_social, which is write-only, so the image cannot be read back with it. Alt text
 *   is set on the post's media (see posts.ts), up to 4,086 characters.
 *   https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 *   (upload step with the Authorization header).
 */
import { classifyLinkedInResponse, classifyLinkedInThrown, localLinkedInError } from './errors'
import { linkedInCall, timedFetch } from './http'
import type { LinkedInContext, LinkedInError, LinkedInOutcome } from './types'

export const LINKEDIN_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'] as const
export const LINKEDIN_ALT_TEXT_MAX = 4086

/** Upload URLs come from LinkedIn's answer; the token is only sent to LinkedIn's own hosts. */
export function isLinkedInUploadUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'linkedin.com' || u.hostname.endsWith('.linkedin.com') || u.hostname.endsWith('.licdn.com'))
  } catch {
    return false
  }
}

export interface LinkedInImageUploadStart {
  uploadUrl: string
  imageUrn: string
  expiresAt: string | null
}

export function initializeLinkedInImageUpload(ctx: LinkedInContext, ownerUrn: string): Promise<LinkedInOutcome<LinkedInImageUploadStart>> {
  return linkedInCall<LinkedInImageUploadStart>(ctx, {
    method: 'POST',
    visible: false,
    path: '/rest/images',
    query: { action: 'initializeUpload' },
    json: { initializeUploadRequest: { owner: ownerUrn } },
    parse: (b, status) => {
      const v = b?.value
      if (!v || typeof v.uploadUrl !== 'string' || typeof v.image !== 'string') {
        return { kind: 'server_error', status, message: 'LinkedIn answered the image start without an upload address.', providerCode: null, serviceErrorCode: null, code: 'no_upload_url', limitScope: null, resetAt: null, retry: 'safe', mayHaveApplied: false } as LinkedInError
      }
      if (!isLinkedInUploadUrl(v.uploadUrl)) {
        return localLinkedInError('untrusted_upload_url', 'LinkedIn gave an upload address outside its own hosts; nothing was sent.')
      }
      return { uploadUrl: v.uploadUrl, imageUrn: v.image, expiresAt: typeof v.uploadUrlExpiresAt === 'number' ? new Date(v.uploadUrlExpiresAt).toISOString() : null }
    },
  })
}

export interface LinkedInImageUpload {
  imageUrn: string
  altText: string | null
  bytes: number
}

/** Starts the upload and sends the bytes. Use the returned URN in createLinkedInPost with the alt text. */
export async function uploadLinkedInImage(
  ctx: LinkedInContext,
  input: { ownerUrn: string; bytes: Uint8Array; mediaType: string; altText?: string },
): Promise<LinkedInOutcome<LinkedInImageUpload>> {
  if (!(LINKEDIN_IMAGE_TYPES as readonly string[]).includes(input.mediaType)) {
    return { ok: false, error: localLinkedInError('unsupported_media', 'LinkedIn images are JPG, PNG or GIF.') }
  }
  if (input.bytes.byteLength === 0) return { ok: false, error: localLinkedInError('empty_media', 'The image file is empty.') }
  if (input.altText !== undefined && input.altText.length > LINKEDIN_ALT_TEXT_MAX) {
    return { ok: false, error: localLinkedInError('alt_too_long', `Alt text is over LinkedIn's ${LINKEDIN_ALT_TEXT_MAX}-character limit.`) }
  }
  const start = await initializeLinkedInImageUpload(ctx, input.ownerUrn)
  if (!start.ok) return start

  const req = { method: 'PUT', visible: false }
  const got = await timedFetch(
    ctx.fetch,
    start.value.uploadUrl,
    { method: 'PUT', headers: { authorization: `Bearer ${ctx.accessToken}`, 'content-type': input.mediaType }, body: new Uint8Array(input.bytes) },
    ctx.timeoutMs ?? 30_000,
  )
  if (!got.ok) return { ok: false, error: classifyLinkedInThrown(got.err, req, got.timedOut) }
  if (got.res.status < 200 || got.res.status > 299) {
    let json: unknown = null
    try { json = got.text ? JSON.parse(got.text) : null } catch { json = null }
    return { ok: false, error: classifyLinkedInResponse(got.res.status, got.res.headers, json, got.text, req) }
  }
  return { ok: true, status: got.res.status, value: { imageUrn: start.value.imageUrn, altText: input.altText ?? null, bytes: input.bytes.byteLength } }
}
