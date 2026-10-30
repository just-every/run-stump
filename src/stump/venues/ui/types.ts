// The venue tools' results as the person door returns them (src/stump/tools/venues.ts).
export interface Rule { value: unknown; source_url: string | null; read_at: string | null; sourced: boolean; detail?: string | null; thread_url?: string | null; origin?: string }
export type RuleKey = 'posting' | 'ai_text' | 'self_promotion' | 'links' | 'disclosure_line' | 'gates'
export interface Venue {
  id: string; kind: string; name: string; url: string | null; platform: string | null; status: string; priority: string | null
  products: Array<{ product_id: string; name: string | null; fit: number | null; items: number }>
  rules: Record<RuleKey, Rule | null>; routes: string[]; shared_limit: { posts: number; per: string; text?: string | null } | null; next_open_at: string | null
  archived: boolean; excluded: { reason: string; alternative: string | null } | null; details: Record<string, unknown>
  audience: string | null; why: string | null; reader_value: string | null; how_to_post: Record<string, unknown>; requirements: Record<string, unknown>
  reception: string | null; notes: string | null; imported: boolean; revision: number; created_at: string; updated_at: string; archived_at: string | null
}
export interface VenueItem { id: string; master_id: string | null; product_id: string | null; product_name: string | null; handoff: { id: string; state: string } | null; format: string; state: string; text: string | null; routes: string[]; hold: { reason?: string; rule?: string } | null; flags: string[]; scheduled_at: string | null; history: Array<{ from_state: string | null; to_state: string; reason: string | null; at: string }> }
export interface VenueList { items: Venue[]; total: number }
export interface RouteAnswer { venue_id: string; routes: string[]; reasons: Array<{ route: string; open: boolean; rule: string | null; because: string }>; unsourced: string[] }
export interface Unmet { gate: string; need: number | boolean; has: number | boolean | null }
export interface Member { venue_id: string; person_id: string; display_name: string | null; handle: string; joined_on: string | null; karma: number | null; eligible: boolean; unmet: Unmet[] }
export interface Application { id: string; venue_id: string; person_id: string; handle: string; state: string; applied_at: string; decided_at: string | null }
export interface Members { items: Member[]; total: number; applications: Application[] }
export interface Usage { limit: { posts: number; per: string } | null; used: number; open: boolean; next_open_at: string | null }
