// Who on the team belongs to a venue, and whether they meet its gates
// (STUMP-VENUE-006, D-1, D-3). A hand-off goes only to a member who meets
// every gate; someone who is not a member yet joins first.
import { rulesOf, type VenueRow } from './model.ts'

export interface MemberRow { venue_id: string; person_id: string; handle: string; joined_on: string | null; karma: number | null; created_at: number }
export interface Gates { karma?: number; account_age_days?: number; approval?: boolean; membership?: boolean }
export interface Unmet { gate: 'membership' | 'karma' | 'account_age' | 'approval'; need: number | boolean; has: number | boolean | null; source_url: string | null }

const DAY = 86_400_000

export const gatesOf = (venue: VenueRow): Gates => (rulesOf(venue).gates?.value as Gates | undefined) ?? {}

/** The steps to join, from the venue's own record and gates. */
export function joinSteps(venue: VenueRow): string[] {
  const gates = gatesOf(venue), steps = [`Join ${venue.name}${venue.url ? ` at ${venue.url}` : ''} with your own account.`]
  if (gates.approval) steps.push('Apply, and record the application in Stump; the moderators approve it.')
  if (gates.karma) steps.push(`Take part until your account has ${gates.karma} karma there.`)
  if (gates.account_age_days) steps.push(`Your account there needs to be ${gates.account_age_days} days old.`)
  steps.push('Record your handle and join date in Stump.')
  return steps
}

/**
 * Whether this person may receive a hand-off at this venue now, naming every
 * gate they do not meet (STUMP-VENUE-006.2, .3). A gate binds whether or not
 * its rule is sourced; karma or account age that is not recorded is unmet.
 */
export function eligibility(venue: VenueRow, personId: string, member: MemberRow | null, now: number, application: { id: string; state: string } | null = null) {
  const gates = gatesOf(venue), source = rulesOf(venue).gates?.source_url ?? null, unmet: Unmet[] = []
  if (!member) unmet.push({ gate: gates.approval ? 'approval' : 'membership', need: true, has: false, source_url: source })
  else {
    if (gates.karma !== undefined && (member.karma ?? -1) < gates.karma) unmet.push({ gate: 'karma', need: gates.karma, has: member.karma, source_url: source })
    if (gates.account_age_days !== undefined) {
      const days = member.joined_on ? Math.floor((now - Date.parse(`${member.joined_on}T00:00:00Z`)) / DAY) : null
      if (days === null || days < gates.account_age_days) unmet.push({ gate: 'account_age', need: gates.account_age_days, has: days, source_url: source })
    }
  }
  return {
    venue_id: venue.id, person_id: personId, eligible: unmet.length === 0, unmet,
    join_first: !member, join_steps: member ? [] : joinSteps(venue), application,
  }
}
export type Eligibility = ReturnType<typeof eligibility>

/** The member row and open-or-latest application, read for one person at one venue. */
export async function memberOf(db: D1Database, venueId: string, personId: string) {
  const member = await db.prepare('SELECT * FROM stump_venue_members WHERE venue_id=? AND person_id=?').bind(venueId, personId).first<MemberRow>()
  const application = await db.prepare("SELECT id,state FROM stump_venue_applications WHERE venue_id=? AND person_id=? ORDER BY state='applied' DESC,created_at DESC LIMIT 1")
    .bind(venueId, personId).first<{ id: string; state: string }>()
  return { member, application }
}

/** Whether a person can receive a hand-off at a venue: the call the hand-off lane makes before it assigns one. */
export async function handoffEligibility(db: D1Database, venue: VenueRow, personId: string, now: number): Promise<Eligibility> {
  const { member, application } = await memberOf(db, venue.id, personId)
  return eligibility(venue, personId, member, now, application)
}
