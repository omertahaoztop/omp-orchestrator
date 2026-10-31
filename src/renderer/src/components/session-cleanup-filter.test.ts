import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanupGroups, type CleanupGroup } from './session-cleanup-filter'
import type { SessionListItem } from '../../../shared/ipc-contracts'

const DAY = 86_400_000
const NOW = 100 * DAY

function session(path: string, projectPath: string, ageDays: number, contentState: SessionListItem['contentState']): SessionListItem {
  return { path, name: null, preview: null, sessionId: path, lastModified: NOW - ageDays * DAY, messageCount: 0, projectPath, projectName: projectPath.slice(1), contentState }
}

const sessions = [
  session('a1', '/a', 1, 'empty'),
  session('a2', '/a', 40, 'non-empty'),
  session('a3', '/a', 2, 'non-empty'),
  session('b1', '/b', 50, 'empty'),
  session('b2', '/b', 1, 'unknown'),
]

test('cleanupGroups matches any enabled filter and groups by project, biggest first', () => {
  const groups = cleanupGroups(sessions, { empty: true, olderThanDays: 30 }, NOW, {})
  assert.deepEqual(groups.map((g) => [g.projectName, g.sessions.map((s) => s.path)]), [['a', ['a1', 'a2']], ['b', ['b1']]])
})

test('cleanupGroups honours each filter alone and skips open sessions', () => {
  const paths = (groups: CleanupGroup[]): string[] => groups.flatMap((g) => g.sessions.map((s) => s.path))
  assert.deepEqual(paths(cleanupGroups(sessions, { empty: true, olderThanDays: null }, NOW, {})), ['a1', 'b1'])
  assert.deepEqual(paths(cleanupGroups(sessions, { empty: false, olderThanDays: 30 }, NOW, {})), ['a2', 'b1'])
  assert.deepEqual(paths(cleanupGroups(sessions, { empty: true, olderThanDays: 30 }, NOW, { b1: true })), ['a1', 'a2'])
  assert.deepEqual(cleanupGroups(sessions, { empty: false, olderThanDays: null }, NOW, {}), [])
})
