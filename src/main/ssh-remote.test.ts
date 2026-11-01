import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSshAgentInvocation, buildSshInvocation, buildSshShellArgv, isRemotePermissionModeAllowed, isValidSshHost, quoteRemotePath, remoteCommand, shellQuote } from './ssh-remote'

test('shellQuote leaves plain words alone and single-quotes the rest', () => {
  assert.equal(shellQuote('--mode'), '--mode')
  assert.equal(shellQuote('/srv/app'), '/srv/app')
  assert.equal(shellQuote(''), "''")
  assert.equal(shellQuote('a b'), "'a b'")
  assert.equal(shellQuote("it's"), "'it'\\''s'")
  assert.equal(shellQuote('$HOME;rm -rf /'), "'$HOME;rm -rf /'")
})

test('quoteRemotePath keeps a leading tilde expandable', () => {
  assert.equal(quoteRemotePath('~'), '~')
  assert.equal(quoteRemotePath('~/'), '~/')
  assert.equal(quoteRemotePath('~/my repo'), "~/'my repo'")
  assert.equal(quoteRemotePath('/a/~b'), "'/a/~b'")
  assert.equal(quoteRemotePath('~other/x'), "'~other/x'")
})

test('buildSshInvocation puts every ssh option before -- and the command last', () => {
  const { file, args } = buildSshInvocation('devbox', '/srv/my app', ['omp', '--mode', 'rpc'])
  assert.equal(file, 'ssh')
  assert.deepEqual(args, [
    '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'devbox',
    "cd '/srv/my app' && exec omp --mode rpc",
  ])
})

test('buildSshShellArgv asks for a tty and keeps $SHELL for the remote side', () => {
  assert.deepEqual(buildSshShellArgv('devbox', "~/it's"), [
    '-t', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'devbox',
    "cd ~/'it'\\''s' && exec $SHELL -l",
  ])
})

test('host validation refuses option-like and multi-word hosts', () => {
  assert.equal(isValidSshHost('user@host.example'), true)
  assert.equal(isValidSshHost('-oProxyCommand=x'), false)
  assert.equal(isValidSshHost('a b'), false)
  assert.equal(isValidSshHost(''), false)
  assert.throws(() => buildSshInvocation('-x', '/', ['true']))
})

test('only modes that never prompt may run remotely', () => {
  assert.equal(isRemotePermissionModeAllowed('trusted'), true)
  assert.equal(isRemotePermissionModeAllowed('plan-readonly'), true)
  assert.equal(isRemotePermissionModeAllowed('ask-edits'), false)
  assert.equal(isRemotePermissionModeAllowed('ask-commands'), false)
  assert.equal(isRemotePermissionModeAllowed(undefined), false)
})

test('buildSshAgentInvocation survives the extra login-shell layer', () => {
  const root = mkdtempSync(join(tmpdir(), 'ssh-remote-'))
  try {
    const dir = join(root, `it's a "dir" $HOME`)
    mkdirSync(dir)
    const args = ['two words', "it's", '$HOME', '`id`', 'a\\b', '']
    const { args: sshArgs } = buildSshAgentInvocation('devbox', dir, ['sh', '-c', 'pwd -P; printf "<%s>\\n" "$@"', '_', ...args])
    assert.match(sshArgs.at(-1)!, /^exec "\$SHELL" -lc '/)
    // HOME points at an empty folder so no real profile runs or prints.
    const out = execFileSync('sh', ['-c', sshArgs.at(-1)!], { encoding: 'utf8', env: { PATH: process.env.PATH, SHELL: 'sh', HOME: root } })
    assert.equal(out, [realpathSync(dir), ...args.map((arg) => `<${arg}>`)].join('\n') + '\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

for (const shell of ['sh', 'bash']) {
  test(`remoteCommand survives a real ${shell} with spaces and quotes in path and args`, () => {
    const root = mkdtempSync(join(tmpdir(), 'ssh-remote-'))
    try {
      const dir = join(root, `it's a "dir" $HOME`)
      mkdirSync(dir)
      const args = ['plain', 'two words', "it's", '"dq"', '$HOME', '`id`', 'a\\b', '']
      const command = remoteCommand(dir, ['sh', '-c', 'pwd -P; printf "<%s>\\n" "$@"', '_', ...args])
      const out = execFileSync(shell, ['-c', command], { encoding: 'utf8' })
      assert.equal(out, [realpathSync(dir), ...args.map((arg) => `<${arg}>`)].join('\n') + '\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
