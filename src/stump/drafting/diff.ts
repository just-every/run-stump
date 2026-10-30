// The difference between two revisions, word by word (STUMP-DRAFT-003.1).
export interface Change { op: 'equal' | 'insert' | 'delete'; text: string }

const tokens = (text: string) => text.match(/\s+|[^\s]+/g) ?? []

/** A shortest edit script over words and the spaces between them; runs of one kind are joined. */
export function wordDiff(from: string, to: string): Change[] {
  const a = tokens(from), b = tokens(to)
  // Keep the work bounded for long items: a common prefix and suffix are equal outright.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const x = a.slice(start, a.length - end), y = b.slice(start, b.length - end)
  const lcs: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const out: Change[] = []
  const push = (op: Change['op'], text: string) => { const last = out.at(-1); if (last?.op === op) last.text += text; else out.push({ op, text }) }
  if (start) push('equal', a.slice(0, start).join(''))
  let i = 0, j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { push('equal', x[i]!); i++; j++ }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push('delete', x[i++]!)
    else push('insert', y[j++]!)
  }
  while (i < x.length) push('delete', x[i++]!)
  while (j < y.length) push('insert', y[j++]!)
  if (end) push('equal', a.slice(a.length - end).join(''))
  return out
}
