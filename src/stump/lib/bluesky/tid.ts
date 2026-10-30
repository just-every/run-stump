// Record keys as TIDs, so a post can be found again by a key chosen before it was sent.
//
// Source: https://atproto.com/specs/tid (13 characters, base32-sortable alphabet
// 234567abcdefghijklmnopqrstuvwxyz, 53-bit microsecond timestamp, 10-bit clock id, top bit zero).
// app.bsky.feed.post records use key type "tid": lexicon feed/post.json.

const ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

export function encodeTid(timestampMicros: bigint, clockId: number): string {
  if (timestampMicros < 0n || timestampMicros >= 1n << 53n) throw new RangeError('TID timestamp out of range');
  if (!Number.isInteger(clockId) || clockId < 0 || clockId > 1023) throw new RangeError('TID clock id must be 0..1023');
  let v = (timestampMicros << 10n) | BigInt(clockId);
  let out = '';
  for (let i = 0; i < 13; i++) {
    out = ALPHABET[Number(v & 31n)]! + out;
    v >>= 5n;
  }
  return out;
}

export function isTid(s: string): boolean {
  return /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(s);
}

/** A fresh TID for the given moment. */
export function newTid(nowMs: number = Date.now(), clockId: number = crypto.getRandomValues(new Uint16Array(1))[0]! & 1023): string {
  return encodeTid(BigInt(Math.trunc(nowMs)) * 1000n, clockId);
}

/**
 * The same TID every time for one idempotency key and moment (use the item's scheduled time).
 * A retry after a lost answer targets the same record key, so the record can be read back by key
 * and a second post cannot be made under it.
 */
export async function tidFromKey(idempotencyKey: string, atMs: number): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idempotencyKey)));
  const micro = ((digest[0]! << 8) | digest[1]!) % 1000;
  const clock = ((digest[2]! << 8) | digest[3]!) & 1023;
  return encodeTid(BigInt(Math.trunc(atMs)) * 1000n + BigInt(micro), clock);
}
