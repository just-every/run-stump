// Stump's six roles (STUMP-TEAM-001) and the connections a person records (STUMP-TRUTH-002).
export const ROLES = ['owner', 'admin', 'editor', 'contributor', 'poster', 'viewer'] as const
export type Role = typeof ROLES[number]
export const CONNECTIONS = ['founder', 'employee', 'contractor', 'investor', 'advisor', 'friend', 'family'] as const
export type Connection = typeof CONNECTIONS[number]

export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role)
export const isConnection = (value: unknown): value is Connection => CONNECTIONS.includes(value as Connection)

/** Higher reaches further. A change to a higher rank widens the person's authority. */
export const rank = (role: Role): number => ROLES.length - ROLES.indexOf(role)

// Who may run an action. Each action names one of these sets.
export const EVERYONE: readonly Role[] = ROLES
export const OWNER: readonly Role[] = ['owner']
export const ADMINS: readonly Role[] = ['owner', 'admin']
export const EDITORS: readonly Role[] = ['owner', 'admin', 'editor']
export const CONTRIBUTORS: readonly Role[] = ['owner', 'admin', 'editor', 'contributor']
/** Roles that read company-wide records (a poster sees only their own). */
export const READERS: readonly Role[] = ['owner', 'admin', 'editor', 'contributor', 'viewer']
