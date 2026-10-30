// The time zone a person schedules in. Stump is US-first: a US marketer travelling abroad still schedules in their own
// US time, so the picker offers the US zones and the chosen accounts' queue zones beside this device's zone, and
// remembers the last choice on this browser only (a convenience; the server stores each item's zone with its time).
import { parseAt, validZone, wallClock } from '../publish/time.ts'

const KEY = 'stump.schedule-zone'

/** The US zones, in the order a US marketer reads them. */
export const US_ZONES: ReadonlyArray<readonly [string, string]> = [
  ['America/New_York', 'Eastern Time'], ['America/Chicago', 'Central Time'], ['America/Denver', 'Mountain Time'], ['America/Phoenix', 'Arizona Time'],
  ['America/Los_Angeles', 'Pacific Time'], ['America/Anchorage', 'Alaska Time'], ['Pacific/Honolulu', 'Hawaii Time'],
]

export function deviceZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

/** A zone in words: "Pacific Time" for a US zone, else its city ("Brisbane time"). */
export function zoneName(zone: string): string {
  const us = US_ZONES.find(([id]) => id === zone)?.[1]
  if (us) return us
  return zone === 'UTC' || zone.startsWith('Etc/') ? 'UTC' : `${zone.split('/').pop()!.replaceAll('_', ' ')} time`
}

export function storedZone(): string | null {
  try { const zone = localStorage.getItem(KEY); return zone && validZone(zone) ? zone : null } catch { return null }
}
export function storeZone(zone: string): void {
  try { localStorage.setItem(KEY, zone) } catch { /* private window or blocked storage: the choice lasts this visit */ }
}

const pad = (value: number) => String(value).padStart(2, '0')
/** The next whole hour as a wall-clock "YYYY-MM-DDTHH:00" in `zone`. */
export function nextHour(zone: string, now = Date.now()): string {
  const wall = wallClock(now + 3_600_000, zone)
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:00`
}

/** The instant a wall-clock "YYYY-MM-DDTHH:mm" names in `zone`, or NaN. */
export const instantIn = (value: string, zone: string): number => parseAt(value, zone) ?? Number.NaN
