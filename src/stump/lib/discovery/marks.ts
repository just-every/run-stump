/**
 * Learning from "useful / not useful" marks (STUMP-WATCH-005.4).
 *
 * A mark counts toward a handful of findings' features: the source, the specific feed or instance,
 * the kind of item, the author and the linked site. Each feature keeps a count of useful and
 * not-useful marks. A new finding gets a bounded adjustment from the features it shares with marked
 * ones, shrunk toward zero until a feature has several marks. The model is plain JSON for the spine
 * to store; it holds no finding text.
 */
import { normalizeHandle } from './screen.ts'
import { hostOf } from './url.ts'
import type { Finding } from './types.ts'

export interface Mark {
  finding: Pick<Finding, 'source' | 'source_ref' | 'kind' | 'author' | 'url' | 'links'>
  useful: boolean
}

export interface MarksModel {
  version: 1
  counts: Record<string, { useful: number; not_useful: number }>
}

export const MARKS_MAX_POINTS = 10

export function emptyModel(): MarksModel {
  return { version: 1, counts: {} }
}

export function featuresOf(f: Pick<Finding, 'source' | 'source_ref' | 'kind' | 'author' | 'url' | 'links'>): { key: string; label: string; weight: number }[] {
  const out = [
    { key: `kind:${f.source}:${f.kind}`, label: `${f.kind.replace('_', ' ')} items from ${f.source}`, weight: 1 },
    { key: `ref:${f.source}:${f.source_ref}`, label: `items from ${f.source_ref}`, weight: 1.2 },
  ]
  const author = normalizeHandle(f.author)
  if (author) out.push({ key: `author:${f.source}:${author}`, label: `posts by ${f.author}`, weight: 1.5 })
  const link = f.source === 'hn' || f.source === 'rss' ? (f.links[0] ?? f.url) : undefined
  const host = link ? hostOf(link) : ''
  if (host && f.source !== 'rss') out.push({ key: `host:${host}`, label: `links to ${host}`, weight: 1 })
  return out
}

/** Fold marks into a model. Pass the existing model to add to it. */
export function learnFromMarks(marks: Mark[], model: MarksModel = emptyModel()): MarksModel {
  const counts = { ...model.counts }
  for (const m of marks) {
    for (const { key } of featuresOf(m.finding)) {
      const c = counts[key] ?? { useful: 0, not_useful: 0 }
      counts[key] = m.useful ? { ...c, useful: c.useful + 1 } : { ...c, not_useful: c.not_useful + 1 }
    }
  }
  return { version: 1, counts }
}

export interface MarksAdjustment {
  points: number
  /** The feature that moved the score most, in words. */
  detail: string | null
}

/** Points between -10 and +10 for a finding, from what was marked before. Zero when nothing relevant was marked. */
export function marksAdjustment(model: MarksModel | undefined, f: Finding): MarksAdjustment {
  if (!model) return { points: 0, detail: null }
  let sum = 0
  let weights = 0
  let best: { mag: number; text: string } | null = null
  for (const feat of featuresOf(f)) {
    const c = model.counts[feat.key]
    if (!c) continue
    const n = c.useful + c.not_useful
    if (n < 2) continue
    const rate = (c.useful + 1) / (n + 2)
    const confidence = Math.min(1, n / 6)
    const signed = (rate - 0.5) * 2 * confidence
    sum += signed * feat.weight
    weights += feat.weight
    const mag = Math.abs(signed) * feat.weight
    if (!best || mag > best.mag) {
      best = { mag, text: `${c.useful} of ${n} marks on ${feat.label} were useful` }
    }
  }
  if (weights === 0) return { points: 0, detail: null }
  const points = Math.round((sum / weights) * MARKS_MAX_POINTS * 10) / 10
  return { points, detail: best?.text ?? null }
}
