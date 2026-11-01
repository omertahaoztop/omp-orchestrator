import assert from 'node:assert/strict'
import { test } from 'node:test'
import { thinkingPreview } from './thinking-block'

test('thinkingPreview shows the latest non-empty line without markdown markers', () => {
  assert.equal(thinkingPreview('First idea.\n\n**Checking** the `config`\n\n'), 'Checking the config')
  assert.equal(thinkingPreview('- list item'), 'list item')
  assert.equal(thinkingPreview('## Heading\n'), 'Heading')
  assert.equal(thinkingPreview('  \n\n'), '')
})
