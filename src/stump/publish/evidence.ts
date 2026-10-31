import { textsOf } from './parts.ts'
import type { DueItem } from './types.ts'

// What an approver approves when a publication waits for them (STUMP-SURFACE-009,
// BASE-AGENT-007): the words that go out, the item's revision, and a digest of
// everything sent with them. The approval's summary carries one line per post,
// so any change to the text, the reply target, the options or the media before
// the approval runs changes the summary, and the approval asks again.

const enc = new TextEncoder()
const hex = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
const EXCERPT = 120

/** One planned post as the approval shows and binds it. */
export async function approvalLine(item: { id: string; revision: number }, accountId: string, due: DueItem): Promise<string> {
  const media = await Promise.all(due.media.map(async file => ({ id: file.id, sha256: await hex(file.bytes), alt: file.alt ?? null })))
  const content = await hex(enc.encode(JSON.stringify({ account_id: accountId, format: due.format, text: due.text, parts: due.parts, reply_to: due.reply_to, options: due.options, media })))
  const words = textsOf(due).join(' / ').replace(/\s+/g, ' ').trim()
  const excerpt = words.length > EXCERPT ? `${words.slice(0, EXCERPT - 1)}…` : words
  const images = media.length ? ` with ${media.length === 1 ? 'one image' : `${media.length} images`}` : ''
  return `"${excerpt}"${images} (item ${item.id}, revision ${item.revision}, content ${content.slice(0, 16)})`
}
