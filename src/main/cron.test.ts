import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cronMatches, nextCronRun, parseCron } from './cron'

const at = (text: string): Date => new Date(text)

test('next run walks ranges, steps and lists in local time', () => {
  assert.deepEqual(nextCronRun(parseCron('0 9 * * 1-5'), at('2026-10-30T09:00:00')), at('2026-11-02T09:00:00'))
  assert.deepEqual(nextCronRun(parseCron('*/15 * * * *'), at('2026-10-31T10:07:30')), at('2026-10-31T10:15:00'))
  assert.deepEqual(nextCronRun(parseCron('30 8,18 * * *'), at('2026-10-31T08:30:00')), at('2026-10-31T18:30:00'))
  assert.deepEqual(nextCronRun(parseCron('0 0 29 2 *'), at('2026-03-01T00:00:00')), at('2028-02-29T00:00:00'))
})

test('day of month and weekday are either-or when both are set; 7 is Sunday', () => {
  const schedule = parseCron('0 12 1 * 7')
  assert.equal(cronMatches(schedule, at('2026-11-01T12:00:00')), true)
  assert.equal(cronMatches(schedule, at('2026-11-08T12:00:00')), true)
  assert.equal(cronMatches(schedule, at('2026-11-09T12:00:00')), false)
  const stepped = parseCron('0 12 */2 * 1')
  assert.equal(cronMatches(stepped, at('2026-11-09T12:00:00')), true)
  assert.equal(cronMatches(stepped, at('2026-11-03T12:00:00')), false)
})

test('bad and never-firing schedules are told apart', () => {
  for (const bad of ['* * * *', '60 * * * *', '5-1 * * * *', 'x * * * *', '*/0 * * * *']) {
    assert.throws(() => parseCron(bad), Error, bad)
  }
  assert.equal(nextCronRun(parseCron('0 0 31 2 *'), at('2026-10-31T00:00:00')), null)
})
