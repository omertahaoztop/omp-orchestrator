import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampQueueSelection, isToolApproval, moveQueueSelection, quickApprovalAnswer } from './approval-queue'
import type { PiExtensionUiRequest } from '../../shared/ipc-contracts'

const request = (fields: Partial<PiExtensionUiRequest>): PiExtensionUiRequest => ({ type: 'extension_ui_request', id: 'r', method: 'select', ...fields })

test('moveQueueSelection wraps at both ends and handles empty lists', () => {
  assert.equal(moveQueueSelection(0, 1, 3), 1)
  assert.equal(moveQueueSelection(2, 1, 3), 0)
  assert.equal(moveQueueSelection(0, -1, 3), 2)
  assert.equal(moveQueueSelection(-1, 1, 3), 1)
  assert.equal(moveQueueSelection(7, -1, 3), 1)
  assert.equal(moveQueueSelection(0, 1, 0), -1)
})

test('clampQueueSelection keeps the index inside the list', () => {
  assert.equal(clampQueueSelection(5, 2), 1)
  assert.equal(clampQueueSelection(-1, 2), 0)
  assert.equal(clampQueueSelection(1, 0), -1)
})

test('quickApprovalAnswer maps allow/deny onto confirm and approve/deny selects', () => {
  assert.deepEqual(quickApprovalAnswer(request({ method: 'confirm' }), true), { confirmed: true })
  assert.deepEqual(quickApprovalAnswer(request({ method: 'confirm' }), false), { confirmed: false })
  const approval = request({ options: ['Approve', 'Deny'] })
  assert.deepEqual(quickApprovalAnswer(approval, true), { value: 'Approve' })
  assert.deepEqual(quickApprovalAnswer(approval, false), { value: 'Deny' })
  assert.equal(quickApprovalAnswer(request({ options: ['main', 'develop'] }), true), null)
  assert.equal(quickApprovalAnswer(request({ method: 'input' }), true), null)
})

test('isToolApproval recognizes omp tool approval prompts', () => {
  assert.equal(isToolApproval(request({ title: 'Allow tool: bash\nCommand: rm -rf build' })), true)
  assert.equal(isToolApproval(request({ title: 'Select base branch' })), false)
})
