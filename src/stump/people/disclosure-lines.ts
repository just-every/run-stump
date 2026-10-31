import type { StumpPerson } from './store.ts'

/** The plain line for each connection, naming the company: what Stump offers when no venue or personal line is set (D-2). */
const PLAIN: Record<string, (company: string) => string> = {
  founder: company => `I'm a founder of ${company}.`,
  employee: company => `I work at ${company}.`,
  contractor: company => `I work on ${company} as a contractor.`,
  investor: company => `Disclosure: I'm an investor in ${company}.`,
  advisor: company => `Disclosure: I advise ${company}.`,
  friend: company => `Disclosure: I'm a friend of the ${company} team.`,
  family: company => `Disclosure: someone in my family works at ${company}.`,
}

export const plainDisclosureLine = (connection: StumpPerson['connection'], company: string) => (PLAIN[connection ?? ''] ?? (name => `I work on ${name}.`))(company)

/** The plain line for every connection, naming each of `names`. */
export const plainDisclosureLines = (names: readonly string[]) => names.flatMap(name => Object.values(PLAIN).map(line => line(name)))

/**
 * The text with a disclosure line added first, as a sentence of its own: after a line that ends a sentence (. ! ? …) a space
 * follows; after one that does not, a blank line, so the line still stands as a whole sentence.
 */
export const withDisclosureLine = (line: string, text: string) => {
  const head = line.trim(), body = text.trim()
  if (!body) return head
  return /[.!?\u2026]["'\u201d\u2019)\]]*$/u.test(head) ? `${head} ${body}` : `${head}\n\n${body}`
}

/** The line a person adds to disclose their connection: the venue's own line, else their first own line, else the plain line for their connection. */
export function offeredDisclosureLine(venueLine: string | null, person: Pick<StumpPerson, 'connection' | 'disclosure_lines'> | null, company: string): string {
  if (venueLine?.trim()) return venueLine.trim()
  const own = person?.disclosure_lines.find(line => line.trim())
  return own ? own.trim() : plainDisclosureLine(person?.connection ?? null, company)
}
