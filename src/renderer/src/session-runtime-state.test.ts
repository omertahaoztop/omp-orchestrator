import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSessionRunning, sessionRuntimeState } from './session-runtime-state'

test('sessionRuntimeState ranks approval over work, failure over completion', () => {
  assert.equal(sessionRuntimeState({ activity: 'needs-approval', status: 'error' }), 'awaiting_approval')
  assert.equal(sessionRuntimeState({ activity: 'working', status: 'running' }), 'running')
  assert.equal(sessionRuntimeState({ activity: null, status: 'starting' }), 'running')
  assert.equal(sessionRuntimeState({ activity: 'failed', status: 'running' }), 'error')
  assert.equal(sessionRuntimeState({ activity: 'completed', status: 'error' }), 'error')
  assert.equal(sessionRuntimeState({ activity: 'completed', status: 'running' }), 'done')
  assert.equal(sessionRuntimeState({ activity: null, status: 'running' }), 'idle')
  assert.equal(sessionRuntimeState({ activity: null, status: 'stopped' }), 'done')
})

test('isSessionRunning covers working and held turns only', () => {
  assert.equal(isSessionRunning({ activity: 'working', status: 'running' }), true)
  assert.equal(isSessionRunning({ activity: 'needs-approval', status: 'running' }), true)
  assert.equal(isSessionRunning({ activity: null, status: 'starting' }), false)
  assert.equal(isSessionRunning({ activity: 'completed', status: 'running' }), false)
})
