// Times in an account's own time zone (STUMP-PUBLISH-006.1, STUMP-PLAN-002).
// Intl gives the zone's offset at an instant; a wall-clock time converts by
// guessing the offset and correcting once, which lands on the right side of
// a daylight-saving change.

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = typeof WEEKDAYS[number]

export function validZone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true } catch { return false }
}

interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: Weekday }

/** The wall-clock reading of an instant in a zone. */
export function wallClock(ms: number, zone: string): Wall {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }).formatToParts(new Date(ms)).map(part => [part.type, part.value]))
  return { year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour! % 24, minute: +parts.minute!, second: +parts.second!,
    weekday: parts.weekday!.slice(0, 3).toLowerCase() as Weekday }
}

const offset = (ms: number, zone: string) => {
  const wall = wallClock(ms, zone)
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(ms / 1000) * 1000
}

/** The instant a wall-clock time in a zone names. */
export function zonedTime(zone: string, year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = guess - offset(guess, zone)
  return guess - offset(first, zone)
}

/**
 * Reads `at`: an ISO time with an offset or Z is that instant; a time without
 * one (2026-11-02T09:00) is a wall-clock time in `zone`.
 */
export function parseAt(at: string, zone: string): number | null {
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(at)
  if (local) return zonedTime(zone, +local[1]!, +local[2]!, +local[3]!, +local[4]!, +local[5]!, +(local[6] ?? 0))
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(at)) return null
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? null : ms
}

export interface Slot { days: Weekday[]; times: string[] }

/** The open slot times from `from` on, in the account's zone, earliest first. */
export function slotTimes(slots: Slot[], zone: string, from: number, days = 60): number[] {
  const out: number[] = []
  const start = wallClock(from, zone)
  for (let offsetDays = 0; offsetDays < days; offsetDays++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offsetDays))
    const weekday = WEEKDAYS[date.getUTCDay()]!
    for (const slot of slots) {
      if (!slot.days.includes(weekday)) continue
      for (const time of slot.times) {
        const [hour, minute] = time.split(':').map(Number)
        const at = zonedTime(zone, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour!, minute!)
        if (at > from) out.push(at)
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/** True when an instant falls on one of the slots, read in the zone. */
export function onSlot(ms: number, slots: Slot[], zone: string): boolean {
  const wall = wallClock(ms, zone), time = `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`
  return slots.some(slot => slot.days.includes(wall.weekday) && slot.times.includes(time))
}
