// The shapes the connections screen reads from the person door (type-only).
import type { ConnectionView } from './connections.ts'
import type { publicOffer } from './offers.ts'
import type { StoredRules } from '../links/rules.ts'
import type { TaggedLink } from '../lib/text/index.ts'

export type { ConnectionView }
export type OfferView = ReturnType<typeof publicOffer>
export type RulesView = StoredRules | { own_domains: string[]; mediums: null; revision: 0; updated_by: null; updated_at: null }
export interface PreviewView { text: string; links: TaggedLink[]; rules_set: boolean }
