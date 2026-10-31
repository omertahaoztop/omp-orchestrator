import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PiExtensionUiRequest } from '../shared/ipc-contracts'
import { loadMatrixConfig, questionMessage, replyWords, startMatrixBridge, toResponse } from './matrix'

const ask: PiExtensionUiRequest = {
  type: 'extension_ui_request',
  id: 'q1',
  method: 'ask',
  questions: [{ id: 'db', question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }],
}

test('replies become the response each prompt method expects', () => {
  assert.deepEqual(toResponse({ ...ask, method: 'confirm' }, ['Evet']), { confirmed: true })
  assert.deepEqual(toResponse({ ...ask, method: 'confirm' }, ['hayır']), { confirmed: false })
  assert.throws(() => toResponse({ ...ask, method: 'confirm' }, ['belki']))
  assert.deepEqual(toResponse({ ...ask, method: 'select', options: ['a', 'b'] }, ['2']), { value: 'b' })
  assert.throws(() => toResponse({ ...ask, method: 'select', options: ['a', 'b'] }, ['3']))
  assert.deepEqual(toResponse({ ...ask, method: 'input' }, ['hello', 'there']), { value: 'hello there' })
  assert.deepEqual(toResponse(ask, ['sqlite', 'please']), { answers: [{ id: 'db', selectedOptions: ['SQLite'], customInput: 'please' }] })
  assert.throws(() => toResponse(ask, ['1', '2']))
})

test('quoted reply fallback is not part of the answer', () => {
  assert.deepEqual(replyWords('> <@bot> Which database?\n> 1. Postgres\n\n2'), ['2'])
})

test('already numbered options are not numbered twice', () => {
  const message = questionMessage({ ...ask, method: 'select', questions: undefined, options: ['1. Postgres', 'SQLite'] }, 'p')
  assert.match(message, /\n1\. Postgres\n2\. SQLite\n/)
})

test('token comes from the env before the token file, never from matrix.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'matrix-'))
  assert.equal(loadMatrixConfig(dir, {}), undefined)
  writeFileSync(join(dir, 'matrix.json'), JSON.stringify({ homeserver: 'https://hs/', roomId: '!r', accessToken: 'ignored' }))
  assert.throws(() => loadMatrixConfig(dir, {}))
  writeFileSync(join(dir, 'matrix-token'), 'file-token\n')
  assert.deepEqual(loadMatrixConfig(dir, {}), { homeserver: 'https://hs', roomId: '!r', accessToken: 'file-token' })
  assert.equal(loadMatrixConfig(dir, { PI_DESKTOP_MATRIX_TOKEN: 'env-token' })?.accessToken, 'env-token')
})

test('a waiting prompt is posted once and a reply to it answers it', async () => {
  const sent: Array<{ body: string; relates?: string }> = []
  let syncs = 0
  let deliver: () => void = () => {}
  const replied = new Promise<void>((resolve) => { deliver = resolve })
  let posted: () => void = () => {}
  const questionPosted = new Promise<void>((resolve) => { posted = resolve })
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const json = (data: unknown): Response => new Response(JSON.stringify(data))
    if (url.includes('/account/whoami')) return json({ user_id: '@bot:hs' })
    if (url.includes('/send/')) {
      const body: unknown = JSON.parse(String(init?.body))
      const message = typeof body === 'object' && body !== null && 'body' in body ? String(body.body) : ''
      const relates = typeof body === 'object' && body !== null && 'm.relates_to' in body ? JSON.stringify(body['m.relates_to']) : undefined
      sent.push({ body: message, relates })
      if (relates) deliver()
      else posted()
      return json({ event_id: sent.length === 1 ? '$q' : `$r${sent.length}` })
    }
    syncs += 1
    if (syncs === 1) return json({ next_batch: 's1' })
    if (syncs === 2) {
      await questionPosted
      await new Promise((resolve) => setImmediate(resolve))
      return json({
        next_batch: 's2',
        rooms: { join: { '!r': { timeline: { events: [{ event_id: '$u', sender: '@me:hs', type: 'm.room.message', content: { body: '2', 'm.relates_to': { 'm.in_reply_to': { event_id: '$q' } } } }] } } } },
      })
    }
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
  }
  const answers: Array<[string, unknown]> = []
  let pending = [{ request: ask, project: 'od-ux' }]
  const bridge = startMatrixBridge({
    config: { homeserver: 'https://hs', roomId: '!r', accessToken: 'x' },
    pending: () => pending,
    respond: (id, response) => {
      answers.push([id, response])
      pending = []
    },
    log: () => {},
  })
  try {
    bridge.syncQuestions()
    bridge.syncQuestions()
    await replied
    assert.equal(sent.filter((message) => message.body.includes('Which database?')).length, 1)
    assert.deepEqual(answers, [['q1', { answers: [{ id: 'db', selectedOptions: ['SQLite'] }] }]])
    assert.match(sent.at(-1)?.relates ?? '', /\$u/)
  } finally {
    bridge.stop()
    globalThis.fetch = realFetch
  }
})
