// One master text, one variant per account (STUMP-DRAFT-010).
//
// A variant starts as the master, can be edited on its own, and is counted and
// flagged against its own network only. Changing the master carries over to the
// variants nobody edited and marks the edited ones as differing.

import { countText } from './count'
import { normalizeNewlines } from './graphemes'
import type { CountTarget, TextCount } from './types'

export interface VariantTarget extends CountTarget {
  /** Identifies the variant (usually the account id). */
  key: string
}

export interface VariantFlag {
  code: 'over_limit'
  detail: string
}

export interface Variant {
  key: string
  target: VariantTarget
  text: string
  count: TextCount
  /** The text is not the master's. */
  differs_from_master: boolean
  /** The master changed after this variant was edited, so it kept its own text. */
  master_changed: boolean
  flags: VariantFlag[]
}

function make(target: VariantTarget, text: string, master: string, masterChanged: boolean): Variant {
  const count = countText(target, text)
  const flags: VariantFlag[] = count.fits
    ? []
    : [
        {
          code: 'over_limit',
          detail: `${count.count} of ${count.limit} (${count.unit}) on ${target.network}`,
        },
      ]
  return {
    key: target.key,
    target,
    text,
    count,
    differs_from_master: normalizeNewlines(text) !== normalizeNewlines(master),
    master_changed: masterChanged,
    flags,
  }
}

/** Open a variant for each account, each starting from the master. */
export function openVariants(master: string, targets: readonly VariantTarget[]): Variant[] {
  const seen = new Set<string>()
  for (const t of targets) {
    if (seen.has(t.key)) throw new RangeError(`duplicate variant key ${t.key}`)
    seen.add(t.key)
  }
  return targets.map((t) => make(t, master, master, false))
}

/** Edit one variant; the others and the master are untouched. */
export function editVariant(variant: Variant, master: string, text: string): Variant {
  return make(variant.target, text, master, variant.master_changed)
}

/**
 * Change the master. A variant whose text still equals the old master follows the
 * new one; an edited variant keeps its text, still differs, and is marked
 * `master_changed` so the person sees it did not follow.
 */
export function changeMaster(variants: readonly Variant[], oldMaster: string, newMaster: string): Variant[] {
  return variants.map((v) => {
    const followed = !v.differs_from_master
    if (followed) return make(v.target, newMaster, newMaster, false)
    const sameAsNewMaster = normalizeNewlines(v.text) === normalizeNewlines(newMaster)
    return make(v.target, v.text, newMaster, !sameAsNewMaster && normalizeNewlines(oldMaster) !== normalizeNewlines(newMaster))
  })
}

/** The variants that can go ahead: those with no flags. The rest hold alone. */
export function splitByFlags(variants: readonly Variant[]): { ready: Variant[]; held: Variant[] } {
  return {
    ready: variants.filter((v) => v.flags.length === 0),
    held: variants.filter((v) => v.flags.length > 0),
  }
}
