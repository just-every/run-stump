/**
 * Media upload with alt text.
 *
 * Sources (read 30 Oct 2026):
 *  - https://docs.x.com/x-api/media/quickstart/media-upload-chunked.md
 *      POST /2/media/upload/initialize (json: media_type, total_bytes, media_category) ->
 *      data.id; POST /2/media/upload/{id}/append (multipart: segment_index, media; chunks
 *      of 5 MB or less, server maximum 8 MB); POST /2/media/upload/{id}/finalize ->
 *      data.processing_info when processing is pending; GET /2/media/upload?command=STATUS&media_id=
 *      until state is succeeded or failed.
 *  - https://docs.x.com/x-api/media/metadata-create
 *      POST /2/media/metadata {id, metadata: {alt_text: {text}}}, alt text up to 1000 characters,
 *      scope media.write.
 * Every upload step changes nothing people can see, so a failed step is safe to retry.
 */
import { localXError } from './errors'
import { xCall } from './http'
import type { XContext, XError, XResult } from './types'

export type XMediaCategory = 'tweet_image' | 'tweet_gif' | 'tweet_video'

export const X_ALT_TEXT_MAX = 1000
const CHUNK_BYTES = 4 * 1024 * 1024

export interface XMediaUploadInput {
  bytes: Uint8Array
  /** MIME type such as image/png or video/mp4. */
  mediaType: string
  category?: XMediaCategory
  altText?: string
  /** Pause between status checks; defaults to a timer. Tests inject their own. */
  wait?: (ms: number) => Promise<void>
  /** Longest total wait for X to process a video; defaults to 120 000 ms. */
  maxProcessingMs?: number
}

export interface XMediaUploaded {
  mediaId: string
  mediaKey: string | null
  altTextSet: boolean
  bytes: number
}

export function xMediaCategoryFor(mediaType: string): XMediaCategory | null {
  if (mediaType === 'image/gif') return 'tweet_gif'
  if (mediaType.startsWith('image/')) return 'tweet_image'
  if (mediaType.startsWith('video/')) return 'tweet_video'
  return null
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Checks the alt text alone, so a composer can refuse before any upload. */
export function checkXAltText(altText: string): XError | null {
  if (altText.length > X_ALT_TEXT_MAX) return localXError('alt_too_long', `Alt text is over X's ${X_ALT_TEXT_MAX}-character limit.`)
  return null
}

export async function uploadXMedia(ctx: XContext, input: XMediaUploadInput): Promise<XResult<XMediaUploaded>> {
  const category = input.category ?? xMediaCategoryFor(input.mediaType)
  if (!category) return { ok: false, error: localXError('unsupported_media', `X media must be an image, GIF or video, not ${input.mediaType}.`) }
  if (input.bytes.byteLength === 0) return { ok: false, error: localXError('empty_media', 'The media file is empty.') }
  if (input.altText !== undefined) {
    const e = checkXAltText(input.altText)
    if (e) return { ok: false, error: e }
  }

  const init = await xCall(ctx, {
    method: 'POST',
    visible: false,
    path: '/2/media/upload/initialize',
    json: { media_type: input.mediaType, total_bytes: input.bytes.byteLength, media_category: category },
    parse: (body, status): { id: string; key: string | null } | XError => {
      const id = body?.data?.id
      if (typeof id !== 'string' || id === '') {
        return { kind: 'server_error', status, message: 'X answered the upload start without a media id.', type: null, code: 'no_media_id', resetAt: null, retry: 'safe', mayHaveApplied: false }
      }
      return { id, key: typeof body.data.media_key === 'string' ? body.data.media_key : null }
    },
  })
  if (!init.ok) return init
  const { id, key } = init.value

  let segment = 0
  for (let offset = 0; offset < input.bytes.byteLength; offset += CHUNK_BYTES, segment++) {
    const form = new FormData()
    form.set('segment_index', String(segment))
    form.set('media', new Blob([input.bytes.slice(offset, offset + CHUNK_BYTES)], { type: input.mediaType }), 'chunk')
    const part = await xCall(ctx, { method: 'POST', visible: false, path: `/2/media/upload/${id}/append`, form, parse: () => true })
    if (!part.ok) return part
  }

  const fin = await xCall(ctx, {
    method: 'POST',
    visible: false,
    path: `/2/media/upload/${id}/finalize`,
    parse: (body) => (body?.data?.processing_info ?? null) as { state: string; check_after_secs?: number; error?: { message?: string } } | null,
  })
  if (!fin.ok) return fin

  let info = fin.value
  const wait = input.wait ?? sleep
  const budget = input.maxProcessingMs ?? 120_000
  let waited = 0
  while (info && (info.state === 'pending' || info.state === 'in_progress')) {
    const ms = Math.max(1, Number(info.check_after_secs ?? 1)) * 1000
    if (waited + ms > budget) {
      return { ok: false, error: { kind: 'network_error', status: null, message: 'X was still processing the media when the wait ran out.', type: null, code: 'processing_timeout', resetAt: null, retry: 'safe', mayHaveApplied: false } }
    }
    await wait(ms)
    waited += ms
    const st = await xCall(ctx, {
      method: 'GET',
      visible: false,
      path: '/2/media/upload',
      query: { command: 'STATUS', media_id: id },
      parse: (body) => (body?.data?.processing_info ?? null) as typeof info,
    })
    if (!st.ok) return st
    info = st.value
  }
  if (info && info.state === 'failed') {
    return { ok: false, error: { kind: 'invalid_request', status: null, message: info.error?.message ?? 'X could not process the media.', type: null, code: 'processing_failed', resetAt: null, retry: 'never', mayHaveApplied: false } }
  }

  let altTextSet = false
  if (input.altText !== undefined && input.altText.trim() !== '') {
    const meta = await xCall(ctx, {
      method: 'POST',
      visible: false,
      path: '/2/media/metadata',
      json: { id, metadata: { alt_text: { text: input.altText } } },
      parse: () => true,
    })
    if (!meta.ok) return meta
    altTextSet = true
  }
  return { ok: true, value: { mediaId: id, mediaKey: key, altTextSet, bytes: input.bytes.byteLength }, status: 200, rateLimit: fin.rateLimit }
}
