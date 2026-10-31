import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Routines } from './routines'

function setup(): { routines: Routines; launched: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'routines-'))
  const launched: string[] = []
  const routines = new Routines({
    file: join(dir, 'routines.json'),
    launch: async (_workspaceId, prompt) => launched.push(prompt),
    hasWorkspace: (id) => id === 'ws',
    log: () => {},
  })
  return { routines, launched }
}

test('tick starts only enabled routines due this minute', () => {
  const { routines, launched } = setup()
  routines.add({ name: 'due', cron: '0 9 * * *', workspaceId: 'ws', prompt: 'due' })
  routines.add({ name: 'later', cron: '0 10 * * *', workspaceId: 'ws', prompt: 'later' })
  const paused = routines.add({ name: 'paused', cron: '0 9 * * *', workspaceId: 'ws', prompt: 'paused' })
  routines.setEnabled(paused.id, false)

  routines.tick(new Date('2026-10-31T09:00:40'))

  assert.deepEqual(launched, ['due'])
  assert.equal(routines.list().find((routine) => routine.id === paused.id)?.nextRunAt, null)
})

test('add rejects bad, never-running and orphan routines', () => {
  const { routines } = setup()
  assert.throws(() => routines.add({ name: 'x', cron: '61 * * * *', workspaceId: 'ws', prompt: 'p' }))
  assert.throws(() => routines.add({ name: 'x', cron: '0 0 31 2 *', workspaceId: 'ws', prompt: 'p' }))
  assert.throws(() => routines.add({ name: 'x', cron: '* * * * *', workspaceId: 'gone', prompt: 'p' }))
  assert.throws(() => routines.add({ name: ' ', cron: '* * * * *', workspaceId: 'ws', prompt: 'p' }))
  assert.deepEqual(routines.list(), [])
})

test('an unreadable routines file is set aside, not overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'routines-'))
  writeFileSync(join(dir, 'routines.json'), '{not json')
  const routines = new Routines({ file: join(dir, 'routines.json'), launch: async () => {}, hasWorkspace: () => true, log: () => {} })
  assert.deepEqual(routines.list(), [])
  assert.equal(readdirSync(dir).filter((name) => name.startsWith('routines.json.corrupt-')).length, 1)
})
