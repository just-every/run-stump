/**
 * Podcast transcripts (STUMP-WATCH-002.4): `podcast:transcript` links to SRT, WebVTT, plain text,
 * HTML or JSON files, reduced here to the spoken text.
 *
 * Tag: https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/transcript.md
 * Formats: https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/examples/transcripts/transcripts.md
 * WebVTT: https://www.w3.org/TR/webvtt1/ . SubRip (SRT) has no standard; its media type is
 * `application/x-subrip` (also seen as `application/srt` and `text/srt`).
 */
import { SourceError } from './errors.ts'
import { assertOk, readText, send, type HttpOptions } from './http.ts'
import { decodeEntities, htmlToText, stripControls, tidy } from './text.ts'
import type { TranscriptRef } from './feeds.ts'
import { parseHttpUrl } from './url.ts'
import type { SourceWarning } from './types.ts'

export const MAX_TRANSCRIPT_BYTES = 2_000_000
export const MAX_TRANSCRIPT_CHARS = 400_000

export type TranscriptFormat = 'vtt' | 'srt' | 'json' | 'html' | 'text'

const PREFERENCE: TranscriptFormat[] = ['vtt', 'srt', 'json', 'html', 'text']

export function transcriptFormat(type: string, url: string, body?: string): TranscriptFormat {
  const t = type.toLowerCase().split(';')[0].trim()
  if (t === 'text/vtt') return 'vtt'
  if (['application/x-subrip', 'application/srt', 'text/srt', 'application/x-srt'].includes(t)) return 'srt'
  if (t === 'application/json' || t.endsWith('+json')) return 'json'
  if (t === 'text/html' || t === 'application/xhtml+xml') return 'html'
  const path = parseHttpUrl(url)?.pathname.toLowerCase() ?? ''
  if (path.endsWith('.vtt')) return 'vtt'
  if (path.endsWith('.srt')) return 'srt'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.html') || path.endsWith('.htm')) return 'html'
  if (body) {
    const head = body.trimStart()
    if (head.startsWith('WEBVTT')) return 'vtt'
    if (/^\d+\s*\r?\n\d{1,2}:\d\d:\d\d[,.]\d{1,3}\s*-->/.test(head)) return 'srt'
    if (head.startsWith('{') || head.startsWith('[')) return 'json'
    if (/^<(!doctype|html|body|p|div|cite)\b/i.test(head)) return 'html'
  }
  return 'text'
}

function cueText(line: string): string {
  return decodeEntities(line.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')).trim()
}

/** Join cue lines into running text, dropping immediate repeats (rolling auto-captions repeat lines). */
function joinCues(lines: string[]): string {
  const out: string[] = []
  for (const l of lines) {
    if (!l || out[out.length - 1] === l) continue
    out.push(l)
  }
  return out.join(' ')
}

export function parseSrt(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.includes('-->')) continue
    if (/^\d+$/.test(line) && (lines[i + 1] ?? '').includes('-->')) continue
    out.push(cueText(line))
  }
  return joinCues(out)
}

export function parseVtt(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let skipBlock = false
  let i = 0
  // Header block: "WEBVTT" and any header lines up to the first blank line.
  while (i < lines.length && lines[i].trim() !== '') i++
  for (; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') {
      skipBlock = false
      continue
    }
    if (skipBlock) continue
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(line)) {
      skipBlock = true
      continue
    }
    if (line.includes('-->')) continue
    if ((lines[i + 1] ?? '').includes('-->')) continue // cue identifier
    out.push(cueText(line))
  }
  return joinCues(out)
}

function parseJsonTranscript(body: string): string {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new SourceError('parse', 'rss', 'The JSON transcript is not valid JSON')
  }
  const segments = Array.isArray(data) ? data : (data as { segments?: unknown })?.segments
  if (!Array.isArray(segments)) throw new SourceError('parse', 'rss', 'The JSON transcript has no segments list')
  return segments
    .map((s) => (typeof s === 'string' ? s : typeof (s as { body?: unknown })?.body === 'string' ? (s as { body: string }).body : ''))
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
}

/** Spoken text of a transcript file, sanitised and capped. */
export function parseTranscript(body: string, type: string, url: string): string {
  const format = transcriptFormat(type, url, body)
  let text: string
  switch (format) {
    case 'vtt': text = parseVtt(body); break
    case 'srt': text = parseSrt(body); break
    case 'json': text = parseJsonTranscript(body); break
    case 'html': text = htmlToText(body); break
    default: text = body
  }
  return tidy(stripControls(text)).normalize('NFC').slice(0, MAX_TRANSCRIPT_CHARS)
}

function rank(ref: TranscriptRef): number {
  const i = PREFERENCE.indexOf(transcriptFormat(ref.type, ref.url))
  return i < 0 ? PREFERENCE.length : i
}

export interface TranscriptResult {
  text: string | null
  url: string | null
  warnings: SourceWarning[]
}

/**
 * Fetch the best available transcript of an item: WebVTT first, then SRT, JSON, HTML, text. A file
 * that fails to load or parse is reported as a warning and the next one is tried (at most two).
 * A failing transcript never fails the feed.
 */
export async function fetchTranscript(opts: HttpOptions, refs: TranscriptRef[]): Promise<TranscriptResult> {
  const warnings: SourceWarning[] = []
  const ordered = [...refs].sort((a, b) => rank(a) - rank(b)).slice(0, 2)
  const now = opts.now ?? Date.now
  for (const ref of ordered) {
    try {
      const response = await send('rss', opts, ref.url, { headers: { accept: 'text/vtt, application/x-subrip, text/plain, */*;q=0.5' } })
      assertOk('rss', response, ref.url, now())
      const body = await readText('rss', response, ref.url, MAX_TRANSCRIPT_BYTES)
      const text = parseTranscript(body, ref.type || (response.headers.get('content-type') ?? ''), ref.url)
      if (text) return { text, url: ref.url, warnings }
      warnings.push({ code: 'transcript_empty', message: 'A transcript file had no text', url: ref.url })
    } catch (e) {
      warnings.push({
        code: 'transcript_failed',
        message: `A transcript could not be read: ${e instanceof Error ? e.message : String(e)}`,
        url: ref.url,
      })
    }
  }
  return { text: null, url: null, warnings }
}
