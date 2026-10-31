// Results of the spine's actions, as the person door returns them.
export interface TeamPerson { id: string; email: string; display_name: string; role: string; connection: string | null; disclosure_lines: string[]; status: 'invited' | 'active' | 'removed'; invited_at: string | null; joined_at: string | null
  /** On an invite's answer only: whether it was emailed, or the person signs in on this computer. */
  invitation?: { by: 'email' } | { by: 'this_computer'; sign_in: string } }
/** set_role answers the person's record and when the role changed. */
export type RoleChange = TeamPerson & { changed_at?: string; sign_in_again?: boolean }
/** remove answers the removed person's record and what of theirs now needs an answer. */
export type RemovedPerson = TeamPerson & { open_handoffs: string[]; unscheduled_items: string[]; disconnected_accounts: Array<{ account_id: string; revoked: string; unscheduled: string[] }> }
export interface Team { items: TeamPerson[]; total: number }
export interface PauseScope { scope: 'all' | 'account'; account_id: string | null; person_id: string; at: string }
export interface PauseState { paused: PauseScope[]; history: Array<{ action: 'pause' | 'resume'; scope: string; account_id: string | null; person_id: string; agent_id: string | null; at: string }> }
export interface Resumed { will_post: Array<{ item_id: string; account_id: string | null; scheduled_at: string | null }>; held_overdue: Array<{ item_id: string; account_id: string | null; scheduled_at: string | null }> }
