import { execFile } from 'child_process'
import { promisify } from 'util'
import { t } from '../shared/i18n'

const execFileAsync = promisify(execFile)

/** No password or host-key prompt can ever block: keys and ControlMaster come from ~/.ssh/config. */
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
const SAFE_WORD = /^[A-Za-z0-9_/.,:=+@%-]+$/
const SSH_FAILURE_EXIT = 255
const REMOTE_CHECK_TIMEOUT_MS = 20_000

/**
 * POSIX single-quote a word for the remote login shell.
 * shortcut: fish reads `\\` and `\'` inside single quotes as escapes, so a path holding a backslash differs there; wrap in `sh -c` if that ever matters.
 */
export function shellQuote(value: string): string {
  return SAFE_WORD.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

/** Quote a remote path but keep a leading `~` expandable, since users type `~/project`. */
export function quoteRemotePath(path: string): string {
  if (path === '~') return '~'
  if (path.startsWith('~/')) return path.length === 2 ? '~/' : `~/${shellQuote(path.slice(2))}`
  return shellQuote(path)
}

/** An ssh destination that cannot be read as an option or split into several words. */
export function isValidSshHost(host: string): boolean {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be rejected
  return host.length > 0 && !host.startsWith('-') && !/[\s\0-\x1f\x7f]/.test(host)
}

function assertSshHost(host: string): void {
  if (!isValidSshHost(host)) throw new Error(t('errors.remote.invalidHost', { host }))
}

/** `cd <path> && exec <argv>`, the one string ssh hands to the remote login shell. */
export function remoteCommand(path: string, argv: readonly string[]): string {
  return `cd ${quoteRemotePath(path)} && exec ${argv.map(shellQuote).join(' ')}`
}

/** `--` ends option parsing, so neither the host nor the command can inject ssh options. `tty` is for the interactive terminal only. */
export function sshArgv(host: string, command: string, tty = false): string[] {
  assertSshHost(host)
  return [tty ? '-t' : '-T', ...SSH_OPTIONS, '--', host, command]
}

/** An interactive login shell in `path` on `host`. */
export function buildSshShellArgv(host: string, path: string): string[] {
  return sshArgv(host, `cd ${quoteRemotePath(path)} && exec $SHELL -l`, true)
}

/** The spawn() program and argv that run `argv` inside `path` on `host`. */
export function buildSshInvocation(host: string, path: string, argv: readonly string[]): { file: string; args: string[] } {
  return { file: 'ssh', args: sshArgv(host, remoteCommand(path, argv)) }
}

/** Like buildSshInvocation, but through `$SHELL -l` so ~/.local/bin, ~/.bun/bin and nvm from the profile are on PATH. */
export function buildSshAgentInvocation(host: string, path: string, argv: readonly string[]): { file: string; args: string[] } {
  return { file: 'ssh', args: sshArgv(host, `exec "$SHELL" -lc ${shellQuote(remoteCommand(path, argv))}`) }
}

// The approval prompt lives in a local extension that cannot load over ssh, so only modes that never prompt may run remotely.
const REMOTE_PERMISSION_MODES: ReadonlySet<string> = new Set(['trusted', 'plan-readonly'])

export function isRemotePermissionModeAllowed(mode: string | undefined): boolean {
  return mode !== undefined && REMOTE_PERMISSION_MODES.has(mode)
}

export interface RemoteExecOptions {
  timeout?: number
  maxBuffer?: number
}

/** Run one command in a remote workspace; rejects like execFile (code, stdout, stderr). */
export async function runRemote(
  host: string,
  path: string,
  argv: readonly string[],
  options: RemoteExecOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { file, args } = buildSshInvocation(host, path, argv)
  return execFileAsync(file, args, { encoding: 'utf8', ...options })
}

/** The physical absolute path of directory `path` on `host`; throws the ssh error or a missing-folder message. */
export async function resolveRemoteDirectory(host: string, path: string): Promise<string> {
  let stdout: string
  try {
    ({ stdout } = await execFileAsync('ssh', sshArgv(host, `cd ${quoteRemotePath(path)} && pwd -P`), { encoding: 'utf8', timeout: REMOTE_CHECK_TIMEOUT_MS }))
  } catch (err) {
    const { code, stderr, killed } = err as { code?: unknown; stderr?: unknown; killed?: boolean }
    if (code === 'ENOENT') throw new Error(t('errors.remote.sshMissing'), { cause: err })
    if (killed) throw new Error(t('errors.remote.timeout', { host }), { cause: err })
    if (code !== SSH_FAILURE_EXIT) throw new Error(t('errors.remote.folderMissing', { host, path }), { cause: err })
    const detail = typeof stderr === 'string' ? stderr.trim() : ''
    throw new Error(t('errors.remote.connectFailed', { host, detail: detail || String(err) }), { cause: err })
  }
  // A shell rc file may print first; pwd's line is the last one.
  const resolved = stdout.trim().split('\n').pop()?.trim() ?? ''
  if (!resolved.startsWith('/')) throw new Error(t('errors.remote.folderMissing', { host, path }))
  return resolved
}

/** Whether `path` is a regular file on `host`; an ssh failure counts as present so a resume is never dropped by a network blip. */
export async function remoteFileExists(host: string, path: string): Promise<boolean> {
  try {
    await execFileAsync('ssh', sshArgv(host, `test -f ${quoteRemotePath(path)}`), { timeout: REMOTE_CHECK_TIMEOUT_MS })
    return true
  } catch (err) {
    const { code } = err as { code?: unknown }
    return !(typeof code === 'number' && code !== SSH_FAILURE_EXIT)
  }
}
