// shortcut: numeric 5-field cron only (no month/day names, no @daily); add them if users ask.
const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
] as const

export interface CronSchedule {
  minutes: Set<number>
  hours: Set<number>
  days: Set<number>
  months: Set<number>
  weekdays: Set<number>
  /** Cron's rule: when both day fields are restricted, either one matching is enough. */
  dayOr: boolean
}

function parseField(text: string, { min, max }: { min: number; max: number }): Set<number> {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!match) throw new Error(`not a cron expression: ${text}`)
    const step = match[4] ? Number(match[4]) : 1
    const start = match[1] === '*' ? min : Number(match[2])
    const end = match[1] === '*' ? max : match[3] ? Number(match[3]) : match[4] ? max : start
    if (step < 1 || start < min || end > max || start > end) throw new Error(`out of range: ${part}`)
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}

export function parseCron(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`a schedule needs 5 fields (minute hour day month weekday): ${expression}`)
  const [minutes, hours, days, months, weekdays] = parts.map((part, index) => parseField(part, FIELDS[index]))
  if (weekdays.delete(7)) weekdays.add(0)
  // Vixie cron counts a day field starting with '*' (even '*/2') as unrestricted.
  return { minutes, hours, days, months, weekdays, dayOr: !parts[2].startsWith('*') && !parts[4].startsWith('*') }
}

function dayMatches(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.months.has(date.getMonth() + 1)) return false
  const day = schedule.days.has(date.getDate())
  const weekday = schedule.weekdays.has(date.getDay())
  return schedule.dayOr ? day || weekday : day && weekday
}

/** Whether the schedule fires in the local-time minute containing `date`. */
export function cronMatches(schedule: CronSchedule, date: Date): boolean {
  return dayMatches(schedule, date) && schedule.hours.has(date.getHours()) && schedule.minutes.has(date.getMinutes())
}

/** The next local-time minute after `from` when the schedule fires; null if it never does within five years. */
export function nextCronRun(schedule: CronSchedule, from: Date): Date | null {
  const date = new Date(from)
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + 1)
  const limit = from.getTime() + 5 * 366 * 24 * 60 * 60 * 1000
  while (date.getTime() < limit) {
    if (!dayMatches(schedule, date)) {
      date.setHours(24, 0, 0, 0)
    } else if (!schedule.hours.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0)
    } else if (!schedule.minutes.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1)
    } else {
      return date
    }
  }
  return null
}
