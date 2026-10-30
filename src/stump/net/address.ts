// Which hosts count as the public web. Stump reads pages, feeds and posts only
// from public addresses: never loopback, private, link-local, shared or
// special-purpose ranges, and never local-only names. The ranges follow Base's
// conservative routing policy (modules/integrations/core/public-address.ts).

const IPV4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['168.63.129.16', 32], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 16], ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['192.175.48.0', 24],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]
// Only ordinary 2000::/3 unicast is public; within it, the documentation, 6to4, Teredo and similar blocks are not.
const IPV6: Array<[string, number]> = [
  ['::', 3], ['4000::', 2], ['8000::', 1], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['2620:4f:8000::', 48], ['3ffe::', 16], ['3fff::', 16],
]
const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain)$/

function ipv4(address: string): number | null {
  const octets = address.split('.')
  if (octets.length !== 4 || octets.some(octet => !/^(0|[1-9]\d{0,2})$/.test(octet))) return null
  const bytes = octets.map(Number)
  return bytes.some(byte => byte > 255) ? null : bytes.reduce((value, byte) => value * 256 + byte, 0)
}

function ipv6(address: string): bigint | null {
  if (!/^[0-9a-f:]+$/.test(address) || !address.includes(':')) return null
  const pieces = address.split('::')
  if (pieces.length > 2) return null
  const left = pieces[0] ? pieces[0].split(':') : [], right = pieces[1] ? pieces[1].split(':') : []
  if ([...left, ...right].some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null
  const missing = 8 - left.length - right.length
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return null
  return [...left, ...Array(pieces.length === 2 ? missing : 0).fill('0'), ...right].reduce((value: bigint, word: string) => (value << 16n) | BigInt(parseInt(word, 16)), 0n)
}

const v4Ranges = IPV4.map(([base, bits]) => ({ base: ipv4(base)!, size: 2 ** (32 - bits) }))
const v6Ranges = IPV6.map(([base, bits]) => ({ base: ipv6(base)!, shift: BigInt(128 - bits) }))

/** An IP address literal, in brackets or not: true only for a public unicast address. Anything that is not an address is false. */
export function isPublicAddress(raw: string): boolean {
  const address = raw.replace(/^\[|\]$/g, '').toLowerCase()
  const v4 = ipv4(address)
  if (v4 !== null) return !v4Ranges.some(({ base, size }) => Math.floor(v4 / size) === Math.floor(base / size))
  const v6 = ipv6(address)
  if (v6 === null) return false
  // ISATAP embeds an IPv4 address in an otherwise public prefix.
  const iid = (v6 >> 32n) & 0xffffffffn
  if (iid === 0x00005efen || iid === 0x02005efen) return false
  return !v6Ranges.some(({ base, shift }) => v6 >> shift === base >> shift)
}

const isLiteral = (host: string) => ipv4(host) !== null || host.includes(':')

/** The host as a URL parser normalised it, without brackets or a trailing dot. */
export const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()

/**
 * Whether a URL may be read as a public page by what its address says alone:
 * http or https without credentials, a public address literal, or a dotted
 * name that is not a local-only one. A name's DNS answers are checked apart.
 */
export function publicByName(url: URL): boolean {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
  const host = hostOf(url)
  if (isLiteral(host)) return isPublicAddress(host)
  return host.includes('.') && !LOCAL_NAME.test(host)
}

const DOH = 'https://cloudflare-dns.com/dns-query'

/**
 * A name's A and AAAA answers from public DNS over HTTPS, for a local runtime
 * whose own network can reach private addresses. A name with no public answer
 * is not a public page: it resolves only on this machine or its network.
 */
export async function publicDns(fetcher: typeof fetch, host: string): Promise<boolean> {
  const answers: string[] = []
  for (const type of ['A', 'AAAA'] as const) {
    const response = await fetcher(`${DOH}?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5_000) })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`DNS for ${host} answered ${response.status}.`) }
    const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> }
    for (const answer of body.Answer ?? []) if (answer.type === 1 || answer.type === 28) answers.push(String(answer.data ?? ''))
  }
  return answers.length > 0 && answers.every(isPublicAddress)
}
