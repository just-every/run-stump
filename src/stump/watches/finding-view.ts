// How a finding reads on every screen that shows one (Listening and Today): the
// one job its routes allow, and the few chips that say why it ranks (H16).
import type { FindingView, WatchView } from './ui-types.ts'

export type FindingJob = 'reply' | 'handoff_draft' | 'handoff_brief'

/** The one job a finding's route allows, as its primary action: reply from an account, or hand it to the member who posts there. */
export const jobOf = (finding: FindingView): FindingJob | null => finding.routes.includes('publish') ? 'reply'
  : finding.venue && finding.routes.includes('handoff_draft') ? 'handoff_draft'
  : finding.venue && finding.routes.includes('handoff_brief') ? 'handoff_brief' : null
export const JOB_WORDS: Record<FindingJob, string> = { reply: 'Draft a reply', handoff_draft: 'Hand off with draft', handoff_brief: 'Hand off with brief' }

export interface FindingChip { label: string; title: string }

/** The reasons worth a chip: a question, the watch terms it matched, a fit with a product or venue, freshness, a product or competitor named. Coming from the backfill is every finding's default, so it shows nothing. */
export function chipsFor(finding: FindingView, watch: Pick<WatchView, 'product_ids'> | undefined, products: Array<{ id: string; name: string }>): FindingChip[] {
  const chips: FindingChip[] = []
  const product = watch ? products.find(item => watch.product_ids.includes(item.id)) : undefined
  for (const reason of finding.reason_details) {
    // Only a question about what the watch is for earns a chip; asking for help about something else does not.
    if (reason.factor === 'question' && reason.points >= reason.max) chips.push({ label: 'asks a question', title: reason.label })
    else if (reason.factor === 'question' && reason.points >= 8) chips.push({ label: 'asks in its text', title: reason.label })
    else if (reason.factor === 'matched_terms' && reason.points > 0) {
      // The terms it matched, as the watch names them: "matches invoicing".
      const terms = [...reason.label.matchAll(/"([^"]+)"/g)].map(match => match[1]!).slice(0, 2)
      if (terms.length) chips.push({ label: `matches ${terms.join(', ')}`, title: reason.label })
      if (product) chips.push({ label: `fits ${product.name}`, title: reason.label })
    }
    else if (reason.factor === 'venue_fit' && !/no venue fit/.test(reason.label) && reason.points >= reason.max / 2 && finding.venue) chips.push({ label: `fits ${finding.venue.name}`, title: reason.label })
    else if (reason.factor === 'freshness' && reason.points >= reason.max * 0.6) chips.push({ label: 'fresh', title: reason.label })
  }
  for (const mention of finding.mentions.slice(0, 2)) chips.push({ label: `names ${mention.kind === 'product' ? mention.product : mention.matched}`, title: mention.kind === 'product' ? 'One of your products' : 'A competitor you track' })
  const rank = (label: string) => /^asks/.test(label) ? 0 : /^matches/.test(label) ? 1 : /^fits/.test(label) ? 2 : label === 'fresh' ? 3 : 4
  return chips.filter((chip, index) => chips.findIndex(other => other.label === chip.label) === index).sort((a, b) => rank(a.label) - rank(b.label)).slice(0, 3)
}
