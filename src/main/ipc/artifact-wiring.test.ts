import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { readArtifactLibrary, resolveArtifact } from './artifact-wiring'

test('resolveArtifact resolves paths against the session cwd and keeps URLs', () => {
  assert.deepEqual(resolveArtifact({ path: 'docs/a.md' }, '/w', 5), { source: '/w/docs/a.md', label: 'a.md', url: false, shownAt: 5 })
  assert.equal(resolveArtifact({ path: '~/r.html' }, '/w', 0)?.source, join(homedir(), 'r.html'))
  assert.equal(resolveArtifact({ path: 'file:///tmp/x.pdf' }, '/w', 0)?.source, '/tmp/x.pdf')
  assert.deepEqual(resolveArtifact({ path: 'https://e.com', title: 'E' }, '/w', 1), { source: 'https://e.com', label: 'E', url: true, shownAt: 1 })
  assert.equal(resolveArtifact({}, '/w', 0), null)
})

test('readArtifactLibrary returns newest first and survives a missing or broken file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'artifacts-'))
  const file = join(dir, 'artifact-library.json')
  assert.deepEqual(await readArtifactLibrary(file), [])
  writeFileSync(file, '{broken')
  assert.deepEqual(await readArtifactLibrary(file), [])
  writeFileSync(file, JSON.stringify([
    { source: '/a.md', label: 'A', kind: 'markdown', lastShownAt: 1 },
    { source: 'https://b', kind: 'url', lastShownAt: 3 },
    { label: 'no source' },
  ]))
  assert.deepEqual(await readArtifactLibrary(file), [
    { source: 'https://b', label: 'b', url: true, shownAt: 3 },
    { source: '/a.md', label: 'A', url: false, shownAt: 1 },
  ])
})
