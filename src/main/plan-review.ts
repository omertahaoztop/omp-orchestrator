// Plannotator runs PLANNOTATOR_BROWSER with its review URL. The opener this
// writes relaunches the app, and the running instance gets the URL and the
// agent's folder in its `second-instance` argv. Electron-free for unit tests.

const URL_ARG = '--plannotator-review='
const CWD_ARG = '--plannotator-cwd='

export interface PlanReviewRequest {
  url: string
  cwd: string
}

/** True for an http URL on this machine: the only place Plannotator's server is shown inside the app. */
export function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
  } catch {
    return false
  }
}

/** The review a relaunch carries; null for any other relaunch. Chromium may reorder argv, so each value is one `--name=value` token. */
export function parsePlanReviewArgs(argv: readonly string[]): PlanReviewRequest | null {
  const url = argv.find((arg) => arg.startsWith(URL_ARG))?.slice(URL_ARG.length)
  const cwd = argv.find((arg) => arg.startsWith(CWD_ARG))?.slice(CWD_ARG.length)
  if (!url || !cwd || !isLoopbackHttpUrl(url)) return null
  return { url, cwd }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** A POSIX shell script that hands `$1` (the URL) and the agent's working folder to `command`. */
export function planReviewOpenerScript(command: readonly string[]): string {
  return `#!/bin/sh\nexec ${command.map(shellQuote).join(' ')} "${URL_ARG}$1" "${CWD_ARG}$PWD"\n`
}
