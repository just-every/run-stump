import type { DevPersona } from './modules/operator-auth/dev/index.mjs'

// Local dev personas. Stump has none: a person exists only through an accepted
// invitation (D-1), and invited emails appear in dev sign-in once invited.
export function devPersonas(): DevPersona[] {
 return []
}
