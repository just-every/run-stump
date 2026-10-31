// Request bodies are read up to a cap and no further: a declared length over
// the cap is refused before any byte is read, and a body that grows past it
// stops being read at the cap. Each door sets its cap a little above the
// largest input it takes.

type Body = Pick<Request, 'headers' | 'body'>

/** The body's bytes, or null when it is larger than `max` (the rest is never read). */
export async function readCapped(request: Body, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > max) { await request.body?.cancel().catch(() => {}); return null }
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    length += next.value.byteLength
    if (length > max) { await reader.cancel().catch(() => {}); return null }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

/** The body as UTF-8 text; null when it is larger than `max`, undefined when it is not UTF-8. */
export async function readCappedText(request: Body, max: number): Promise<string | null | undefined> {
  const bytes = await readCapped(request, max)
  if (!bytes) return null
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return undefined }
}

/** A JSON object body: 'too_large' past `max`, null when it is not a JSON object. */
export async function readJsonObject(request: Body, max: number): Promise<Record<string, unknown> | null | 'too_large'> {
  const text = await readCappedText(request, max)
  if (text === null) return 'too_large'
  if (text === undefined) return null
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}
