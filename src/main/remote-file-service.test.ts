import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRemoteTree, parseRemoteGrep } from './remote-file-service'

test('buildRemoteTree nests find output in any batch order, directories first', () => {
  const output = ['f\t./z.txt', 'f\t./src/b.ts', 'f\t./src/a b.ts', 'f\t./link', 'd\t./src/deep', 'd\t./src', 'd\t./docs', ''].join('\0')
  const tree = buildRemoteTree('/srv/app', output)
  assert.equal(tree.name, 'app')
  assert.deepEqual(tree.children!.map((node) => [node.name, node.type]), [
    ['docs', 'directory'], ['src', 'directory'], ['link', 'file'], ['z.txt', 'file'],
  ])
  const src = tree.children!.find((node) => node.name === 'src')!
  assert.deepEqual(src.children!.map((node) => node.relativePath), ['src/deep', 'src/a b.ts', 'src/b.ts'])
  assert.equal(src.children![1].path, '/srv/app/src/a b.ts')
})

test('buildRemoteTree drops entries whose parent was not listed', () => {
  const tree = buildRemoteTree('/r', 'f\tmissing/x.ts\0f\tok.ts\0')
  assert.deepEqual(tree.children!.map((node) => node.relativePath), ['ok.ts'])
})

test('parseRemoteGrep reads grep -n --null lines and honours the limit', () => {
  const output = './src/a.ts\x0012:  const needle = 1\n./b c.md\x003:needle: here\n./x\x001:y\n'
  const results = parseRemoteGrep('/r', output, 2)
  assert.deepEqual(results, [
    { path: '/r/src/a.ts', relativePath: 'src/a.ts', name: 'a.ts', matchType: 'content', line: 12, snippet: 'const needle = 1' },
    { path: '/r/b c.md', relativePath: 'b c.md', name: 'b c.md', matchType: 'content', line: 3, snippet: 'needle: here' },
  ])
})
