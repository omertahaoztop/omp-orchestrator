import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldNotify, type NotifyParams } from './notify-decision'

const BASE: NotifyParams = {
  enabled: true,
  onlyQuestions: false,
  kind: 'completed',
  windowFocused: false,
  eventWorkspaceId: 'ws-1',
  activeWorkspaceId: 'ws-1',
  eventRuntimeId: 'rt-1',
  focusRuntimeId: null,
}

test('disabled setting suppresses everything', () => {
  assert.equal(shouldNotify({ ...BASE, enabled: false }), 'skip')
  assert.equal(
    shouldNotify({ ...BASE, enabled: false, eventWorkspaceId: 'ws-2', windowFocused: false }),
    'skip',
  )
  assert.equal(shouldNotify({ ...BASE, enabled: false, focusRuntimeId: 'rt-9' }), 'skip')
})

test('unknown event workspace never notifies', () => {
  assert.equal(shouldNotify({ ...BASE, eventWorkspaceId: null }), 'skip')
})

test('focused window suppresses only the active workspace', () => {
  assert.equal(shouldNotify({ ...BASE, windowFocused: true }), 'skip')
  assert.equal(shouldNotify({ ...BASE, windowFocused: true, eventWorkspaceId: 'ws-2' }), 'show')
})

test('unfocused window notifies for active and background workspaces', () => {
  assert.equal(shouldNotify({ ...BASE, windowFocused: false }), 'show')
  assert.equal(shouldNotify({ ...BASE, windowFocused: false, eventWorkspaceId: 'ws-2' }), 'show')
})

test('no active workspace still notifies for a background event', () => {
  assert.equal(
    shouldNotify({ ...BASE, activeWorkspaceId: null, windowFocused: true }),
    'show',
  )
})

test('questions-only keeps finished and failed turns off the desktop but lets questions through', () => {
  assert.equal(shouldNotify({ ...BASE, onlyQuestions: true }), 'skip')
  assert.equal(shouldNotify({ ...BASE, onlyQuestions: true, kind: 'failed' }), 'skip')
  assert.equal(shouldNotify({ ...BASE, onlyQuestions: true, kind: 'needs-approval' }), 'show')
})

test('focus mode holds other sessions\' endings, never their questions or the focused session', () => {
  const focus = { ...BASE, focusRuntimeId: 'rt-focus' }
  assert.equal(shouldNotify(focus), 'hold')
  assert.equal(shouldNotify({ ...focus, kind: 'failed', onlyQuestions: true }), 'hold')
  assert.equal(shouldNotify({ ...focus, kind: 'needs-approval' }), 'show')
  assert.equal(shouldNotify({ ...focus, eventRuntimeId: 'rt-focus' }), 'show')
})
