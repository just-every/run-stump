// The UI calls the same person door an integration does: /app/api/actions/<tool>.
export class ActionError extends Error {
  constructor(readonly code: string, readonly fields: Record<string, unknown>, readonly status: number) { super(code); this.name = 'ActionError' }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) { const { code, ...fields } = body; throw new ActionError(typeof code === 'string' ? code : 'request_failed', fields, response.status) }
  return body as T
}

export const runAction = async <T>(tool: string, args: Record<string, unknown>) =>
  (await call<{ result: T }>(`/app/api/actions/${tool}`, { method: 'POST', body: JSON.stringify(args) })).result

export interface Me { person: { id: string; email: string; display_name: string; role: string; connection: string | null }; actions: string[] }
export const me = () => call<Me>('/app/api/me')

export interface Credential { client_id: string; name: string; person_id: string; created_at: string; revoked_at: string | null }
export const credentials = () => call<{ items: Credential[]; total: number }>('/app/api/agent-credentials')
export const issueCredential = (name: string) => call<{ token: string; client_id: string; agent: { id: string; name: string; specialist: string } }>('/app/api/agent-credentials', { method: 'POST', body: JSON.stringify({ name }) })
export const revokeCredential = (clientId: string) => call<{ revoked: boolean }>(`/app/api/agent-credentials/${encodeURIComponent(clientId)}/revoke`, { method: 'POST', body: '{}' })

/** Plain words for the refusal codes a person can meet on these screens. */
export function explain(error: unknown): string {
  if (!(error instanceof ActionError)) return 'Something went wrong. Try again.'
  const words: Record<string, string> = {
    forbidden: 'Your role cannot do that.', owner_protected: 'Transfer ownership to someone else first.', already_member: 'That person is already on the team.',
    self_escalation: 'You cannot widen your own access.', not_found: 'That no longer exists.', invalid_arguments: 'Check the fields and try again.',
    act_refused: 'Stump never does that.', origin_refused: 'Reload the page and try again.', unauthenticated: 'Sign in again to continue.',
  }
  return words[error.code] ?? `Refused: ${error.code.replace(/_/g, ' ')}.`
}
