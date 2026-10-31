import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePlanReviewArgs, planReviewOpenerScript } from './plan-review'

test('the opener hands the review URL and the agent folder to the app, quoting odd paths', { skip: process.platform === 'win32' }, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "plan review 'x' ")))
  const opener = join(dir, 'open')
  // node prints the arguments after `--` as JSON, standing in for the relaunched app.
  writeFileSync(opener, planReviewOpenerScript([process.execPath, '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--']))
  chmodSync(opener, 0o755)
  const argv = JSON.parse(execFileSync(opener, ['http://127.0.0.1:19432/'], { cwd: dir, encoding: 'utf-8' })) as string[]
  rmSync(dir, { recursive: true })
  assert.deepEqual(parsePlanReviewArgs(argv), { url: 'http://127.0.0.1:19432/', cwd: dir })
})

test('only a loopback http review with a folder is accepted', () => {
  const at = (url: string) => parsePlanReviewArgs([`--plannotator-review=${url}`, '--plannotator-cwd=/p'])
  assert.deepEqual(at('http://localhost:5/'), { url: 'http://localhost:5/', cwd: '/p' })
  assert.equal(at('https://example.com/'), null)
  assert.equal(at('file:///etc/passwd'), null)
  assert.equal(at('not a url'), null)
  assert.equal(parsePlanReviewArgs(['--plannotator-review=http://127.0.0.1:5/']), null)
  assert.equal(parsePlanReviewArgs(['/some/project']), null)
})
