import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ansiSpans } from './ansi-spans'

test('truecolor runs keep their color and the default foreground ends them', () => {
  const text = '\u001b[38;2;229;192;123m✻ Claude\u001b[39m \u001b[38;2;152;195;121m6%\u001b[39m'
  assert.deepEqual(ansiSpans(text), [
    { text: '✻ Claude', color: 'rgb(229, 192, 123)' },
    { text: ' ', color: undefined },
    { text: '6%', color: 'rgb(152, 195, 121)' },
  ])
})

test('a reset clears every attribute, and 256-color and basic codes resolve to colors', () => {
  assert.deepEqual(ansiSpans('\u001b[1;31mA\u001b[0mB\u001b[38;5;196mC\u001b[mD'), [
    { text: 'A', bold: true, color: '#cd3131' },
    { text: 'B' },
    { text: 'C', color: 'rgb(255, 0, 0)' },
    { text: 'D' },
  ])
})

test('background codes do not leak into the foreground and hyperlinks are dropped', () => {
  const text = '\u001b[48;2;1;2;3mx\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\'
  assert.deepEqual(ansiSpans(text), [{ text: 'xlink' }])
})

test('hyperlinks ended with BEL are dropped too', () => {
  assert.deepEqual(ansiSpans('\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007'), [{ text: 'link' }])
})
