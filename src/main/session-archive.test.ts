import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveRootFor, moveSession } from './session-archive'

test('archiveRootFor puts the archive beside the store', () => {
  assert.equal(archiveRootFor('/h/.omp/agent/sessions'), '/h/.omp/agent/sessions-archive')
})

test('moveSession archives a session with its subagent folder and restores it', async () => {
  const base = mkdtempSync(join(tmpdir(), 'session-archive-'))
  const root = join(base, 'sessions')
  const archive = archiveRootFor(root)
  const file = join(root, '-home-p', '1_abc.jsonl')
  mkdirSync(join(root, '-home-p', '1_abc'), { recursive: true })
  writeFileSync(file, '{}\n')
  writeFileSync(join(root, '-home-p', '1_abc', 'child.jsonl'), '{}\n')

  const archived = await moveSession(file, root, archive)
  assert.equal(archived, join(archive, '-home-p', '1_abc.jsonl'))
  assert.equal(existsSync(file), false)
  assert.equal(existsSync(join(archive, '-home-p', '1_abc', 'child.jsonl')), true)

  assert.equal(await moveSession(archived, archive, root), file)
  assert.equal(existsSync(join(root, '-home-p', '1_abc', 'child.jsonl')), true)
})

test('moveSession refuses paths that are not parent sessions and never overwrites', async () => {
  const base = mkdtempSync(join(tmpdir(), 'session-archive-'))
  const root = join(base, 'sessions')
  const archive = archiveRootFor(root)
  await assert.rejects(moveSession(join(root, 'p', 'nest', 'x.jsonl'), root, archive))
  await assert.rejects(moveSession(join(base, 'elsewhere', 'x.jsonl'), root, archive))
  await assert.rejects(moveSession(join(root, 'p', 'x.txt'), root, archive))
  mkdirSync(join(root, 'p'), { recursive: true })
  mkdirSync(join(archive, 'p'), { recursive: true })
  writeFileSync(join(root, 'p', 'x.jsonl'), 'new')
  writeFileSync(join(archive, 'p', 'x.jsonl'), 'old')
  await assert.rejects(moveSession(join(root, 'p', 'x.jsonl'), root, archive), /already exists/)
  assert.equal(existsSync(join(root, 'p', 'x.jsonl')), true)
})
