import { normalizeDomain, validateLinkRules, type LinkRules } from '../lib/text/index.ts'

export interface StoredRules extends LinkRules { revision: number; updated_by: string; updated_at: string }

interface RulesRow { own_domains: string; mediums: string; revision: number; updated_by: string; updated_at: number }

/** The company's naming rules, or null before the company has set them. */
export async function readRules(db: D1Database): Promise<StoredRules | null> {
  const row = await db.prepare("SELECT own_domains,mediums,revision,updated_by,updated_at FROM stump_link_rules WHERE id='rules'").first<RulesRow>()
  if (!row) return null
  return { own_domains: JSON.parse(row.own_domains) as string[], mediums: JSON.parse(row.mediums) as LinkRules['mediums'], revision: row.revision, updated_by: row.updated_by, updated_at: new Date(row.updated_at).toISOString() }
}

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** The rules as stored: domains in their normal form, and the reasons any rule is refused. */
export function checkRules(input: { own_domains: readonly string[]; mediums: LinkRules['mediums'] }): { rules: LinkRules; errors: string[] } {
  const own = [...new Set(input.own_domains.map(normalizeDomain))]
  const rules: LinkRules = { own_domains: own, mediums: { published: input.mediums.published, handoff: input.mediums.handoff } }
  const errors = validateLinkRules(rules)
  for (const domain of own) if (domain && !HOST.test(domain)) errors.push(`${domain} is not a domain name`)
  return { rules, errors }
}

export async function writeRules(db: D1Database, rules: LinkRules, personId: string, now: number): Promise<void> {
  await db.prepare(`INSERT INTO stump_link_rules(id,own_domains,mediums,revision,updated_by,updated_at) VALUES('rules',?,?,1,?,?)
    ON CONFLICT(id) DO UPDATE SET own_domains=excluded.own_domains,mediums=excluded.mediums,revision=revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(JSON.stringify(rules.own_domains), JSON.stringify(rules.mediums), personId, now).run()
}
