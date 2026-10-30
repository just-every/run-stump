// The connected account: handle, display name, profile and the bot flag, as the instance reports them.
//
// Sources:
//   GET /api/v1/accounts/verify_credentials: https://docs.joinmastodon.org/methods/accounts/
//   Account entity (bot, acct, display_name, note): https://docs.joinmastodon.org/entities/Account/

import { fail, invalidResponse, ok, type Result } from './errors.ts';
import { bearer, send, type HttpDeps } from './http.ts';

export interface MastodonAccount {
  id: string;
  username: string;
  /** Local accounts carry no domain here. */
  acct: string;
  /** @username@domain, the form people recognise. */
  handle: string;
  displayName: string;
  url: string;
  avatar: string | null;
  header: string | null;
  /** Profile text as the instance sends it (HTML). */
  noteHtml: string;
  /** The instance's own record of whether the account declares itself automated. */
  bot: boolean;
  locked: boolean;
  createdAt: string | null;
  followersCount: number | null;
  statusesCount: number | null;
}

export function parseAccount(json: unknown, domain: string): MastodonAccount | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  if (typeof j.id !== 'string' || typeof j.username !== 'string') return null;
  const s = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const n = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    id: j.id,
    username: j.username,
    acct: typeof j.acct === 'string' ? j.acct : j.username,
    handle: `@${j.username}@${domain}`,
    displayName: typeof j.display_name === 'string' && j.display_name !== '' ? j.display_name : j.username,
    url: typeof j.url === 'string' ? j.url : '',
    avatar: s(j.avatar),
    header: s(j.header),
    noteHtml: typeof j.note === 'string' ? j.note : '',
    bot: j.bot === true,
    locked: j.locked === true,
    createdAt: s(j.created_at),
    followersCount: n(j.followers_count),
    statusesCount: n(j.statuses_count),
  };
}

export async function verifyCredentials(deps: HttpDeps, origin: string, domain: string, token: string): Promise<Result<MastodonAccount>> {
  const res = await send(deps, { method: 'GET', url: `${origin}/api/v1/accounts/verify_credentials`, headers: { ...bearer(token), accept: 'application/json' }, write: false });
  if (!res.ok) return fail(res.error);
  const account = parseAccount(res.value.json, domain);
  if (!account) return invalidResponse('verify_credentials answered without an account', res.value.status);
  return ok(account, res.rate);
}
