// The time zone a person schedules in. Stump is US-first: a US marketer travelling abroad still schedules in their own
// US time, so the picker offers the US zones and the chosen accounts' queue zones beside this device's zone, and
// remembers the last choice on this browser only (a convenience; the server stores each item's zone with its time).
// Times the app shows carry their zone ("4:00 PM PT"): a scheduled item in the zone it was scheduled in, anything else
// (hand-off due times, Today's day) in the zone this person schedules in, so a time never silently means the viewer's computer's zone.
import { parseAt, validZone, wallClock, zonedTime } from '../publish/time.ts'

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

/** The zone this person schedules in: the one they last picked here, else this device's. */
export function workingZone(): string {
  return storedZone() ?? deviceZone()
}

/** A zone's short name at an instant: "PT", "MT", "ET" for the US zones, "UTC", else the offset ("GMT+10"). */
export function zoneAbbr(zone: string, at: number): string {
  if (['UTC', 'Etc/UTC', 'Etc/GMT'].includes(zone)) return 'UTC'
  try { return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortGeneric' }).formatToParts(new Date(at)).find(part => part.type === 'timeZoneName')?.value ?? zone } catch { return zone }
}

/** A time with its zone: "4:00 PM PT". */
export function timeIn(iso: string, zone: string): string {
  const at = Date.parse(iso)
  return `${new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(at))} ${zoneAbbr(zone, at)}`
}

/** A date in a zone, with Intl's options ("Sat, Oct 31"). */
export const dateIn = (iso: string | number, zone: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).format(new Date(iso))

/** Midnight starting the day that holds `at` in `zone`, `days` days on. */
export function dayStartIn(at: number, zone: string, days = 0): number {
  const wall = wallClock(at, zone)
  const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days))
  return zonedTime(zone, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, 0)
}

/** Whole days from the day holding `now` to the day holding `at`, in `zone`: 0 today, 1 tomorrow, -1 yesterday. */
export function daysBetween(at: number, now: number, zone: string): number {
  const key = (ms: number) => { const wall = wallClock(ms, zone); return Date.UTC(wall.year, wall.month - 1, wall.day) }
  return Math.round((key(at) - key(now)) / 86_400_000)
}
