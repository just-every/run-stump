// Results of the spine's actions, as the person door returns them.
export interface TeamPerson { id: string; email: string; display_name: string; role: string; connection: string | null; disclosure_lines: string[]; joined_at: string }
export interface Invitation { id: string; email: string; display_name: string; role: string; connection: string | null; created_at: string }
export interface Team { items: TeamPerson[]; total: number; invitations: Invitation[] }
export interface PauseScope { scope: 'all' | 'account'; account_id: string | null; person_id: string; at: string }
export interface PauseState { paused: PauseScope[]; history: Array<{ action: 'pause' | 'resume'; scope: string; account_id: string | null; person_id: string; agent_id: string | null; at: string }> }
export interface Resumed { will_post: Array<{ item_id: string; account_id: string | null; scheduled_at: string | null }>; held_overdue: Array<{ item_id: string; account_id: string | null; scheduled_at: string | null }> }
