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

/** The line a person adds to disclose their connection: the venue's own line, else their first own line, else the plain line for their connection. */
export function offeredDisclosureLine(venueLine: string | null, person: Pick<StumpPerson, 'connection' | 'disclosure_lines'> | null, company: string): string {
  if (venueLine?.trim()) return venueLine.trim()
  const own = person?.disclosure_lines.find(line => line.trim())
  return own ? own.trim() : plainDisclosureLine(person?.connection ?? null, company)
}
