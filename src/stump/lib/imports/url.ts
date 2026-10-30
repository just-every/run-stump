// URL checks and the normalisation that decides whether two venues are the
// same place (STUMP-VENUE-001: a second venue with the same normalised URL is
// refused, naming the first).

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source)$/i;

export function parseHttpUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export const isHttpUrl = (text: string): boolean => parseHttpUrl(text) !== null;

/**
 * host without "www." plus path without a trailing slash, with the query kept
 * except tracking parameters and the fragment dropped. Reddit paths are
 * case-insensitive, so they fold; other paths keep their case.
 */
export function normalizeVenueUrl(text: string): string | null {
  const url = parseHttpUrl(text);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let path = url.pathname.replace(/\/+$/, '');
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) path = path.toLowerCase();
  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING.test(key));
  params.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  const port = url.port && !(url.protocol === 'http:' && url.port === '80') && !(url.protocol === 'https:' && url.port === '443') ? `:${url.port}` : '';
  return `${host}${port}${path}${query}`;
}

/** A name folded for comparison: Unicode NFC, lower case, single spaces. */
export const foldName = (name: string): string => name.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
