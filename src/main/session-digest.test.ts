import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionDigests, editedPaths, type DigestRun } from './session-digest'
import type { SessionDigestMap } from '../shared/ipc-contracts'

function harness(summarize: (run: DigestRun) => Promise<string>) {
  let clock = 1000
  let latest: SessionDigestMap = {}
  const runs: DigestRun[] = []
  const digests = createSessionDigests({
    now: () => clock,
    summarize: (run) => {
      runs.push(run)
      return summarize(run)
    },
    onChange: (map) => { latest = map },
  })
  const turn = (answer: string): void => {
    digests.handleEvent('rt-1', 'ws-1', { type: 'agent_start' })
    digests.handleEvent('rt-1', 'ws-1', { type: 'message_end', message: { role: 'user', content: 'fix the bug' } })
    digests.handleEvent('rt-1', 'ws-1', { type: 'tool_execution_start', toolName: 'write', args: { path: 'a.ts' } })
    digests.handleEvent('rt-1', 'ws-1', { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: answer }] } })
    clock = 5000
    digests.handleEvent('rt-1', 'ws-1', { type: 'agent_end' })
  }
  return { digests, runs, turn, latest: () => latest }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('a finished turn is unread and gets the model summary of its request, answer and files', async () => {
  const h = harness(async () => 'Fixed it. Next: release.')
  h.turn('\n  Done fixing.\nMore detail')
  assert.deepEqual(h.latest()['rt-1'], {
    runtimeId: 'rt-1', workspaceId: 'ws-1', startedAt: 1000, finishedAt: 5000, summary: null, read: false, todo: null,
  })
  await settle()
  assert.deepEqual(h.runs, [{ request: 'fix the bug', answer: 'Done fixing.\nMore detail', files: ['a.ts'], nextStep: null }])
  assert.equal(h.latest()['rt-1'].summary, 'Fixed it. Next: release.')
  h.digests.markRead('rt-1')
  assert.equal(h.latest()['rt-1'].read, true)
})

test('a failed summary falls back to the first line of the last answer', async () => {
  const h = harness(async () => { throw new Error('model down') })
  h.turn('\n  Done fixing.\nMore detail')
  await settle()
  assert.equal(h.latest()['rt-1'].summary, 'Done fixing.')
})

test('a summary that arrives after a new turn started is dropped', async () => {
  let release: (text: string) => void = () => {}
  const h = harness(() => new Promise((resolve) => { release = resolve }))
  h.turn('first')
  h.digests.handleEvent('rt-1', 'ws-1', { type: 'agent_start' })
  release('stale summary')
  await settle()
  assert.equal(h.latest()['rt-1'].summary, null)
  assert.equal(h.latest()['rt-1'].finishedAt, null)
})

test('edited paths come from path args and hashline section headers', () => {
  assert.deepEqual(editedPaths('edit', { input: '[src/a.ts#1A2B]\nPUT 1.=1:\n+x\n[b.md#ffff]\nCUT 2' }), ['src/a.ts', 'b.md'])
  assert.deepEqual(editedPaths('write', { path: 'c.txt' }), ['c.txt'])
  assert.deepEqual(editedPaths('read', { path: 'c.txt' }), [])
  assert.deepEqual(editedPaths('constructor', { path: 'c.txt' }), [])
})

test('todo progress skips abandoned tasks, prefers the in-progress step, and survives the next turn', async () => {
  const h = harness(async () => 'ok')
  const phases = [
    { name: 'A', tasks: [{ content: 'one', status: 'completed' }, { content: 'two', status: 'abandoned' }] },
    { name: 'B', tasks: [{ content: 'three', status: 'pending' }, { content: 'four', status: 'in_progress' }] },
  ]
  h.digests.handleEvent('rt-1', 'ws-1', { type: 'agent_start' })
  h.digests.handleEvent('rt-1', 'ws-1', { type: 'tool_execution_end', toolName: 'todo', result: { details: { phases } } })
  h.digests.handleEvent('rt-1', 'ws-1', { type: 'tool_execution_end', toolName: 'bash', result: { details: { phases: [] } } })
  assert.deepEqual(h.latest()['rt-1'].todo, { done: 1, total: 3, current: 'four' })
  h.digests.handleEvent('rt-1', 'ws-1', { type: 'message_end', message: { role: 'assistant', content: 'done' } })
  h.digests.handleEvent('rt-1', 'ws-1', { type: 'agent_end' })
  await settle()
  assert.equal(h.runs[0].nextStep, 'four')
  h.digests.handleEvent('rt-1', 'ws-1', { type: 'agent_start' })
  assert.deepEqual(h.latest()['rt-1'].todo, { done: 1, total: 3, current: 'four' })
})
