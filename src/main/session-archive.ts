import { existsSync } from 'fs'
import { mkdir, rename } from 'fs/promises'
import { basename, dirname, join, relative, sep } from 'path'

const JSONL = '.jsonl'

/** Archived sessions sit beside the store, e.g. ~/.omp/agent/sessions → ~/.omp/agent/sessions-archive. */
export function archiveRootFor(sessionsRoot: string): string {
  return join(dirname(sessionsRoot), `${basename(sessionsRoot)}-archive`)
}

/**
 * Moves a parent session (`<project>/<file>.jsonl` under `fromRoot`) and its
 * subagent folder to the same place under `toRoot`. Never overwrites.
 */
export async function moveSession(sessionPath: string, fromRoot: string, toRoot: string): Promise<string> {
  const rel = relative(fromRoot, sessionPath)
  const parts = rel.split(sep)
  if (!rel.endsWith(JSONL) || parts.length !== 2 || parts.includes('..')) {
    throw new Error(`not a parent session of ${fromRoot}: ${sessionPath}`)
  }
  const dest = join(toRoot, rel)
  if (existsSync(dest)) throw new Error(`already exists: ${dest}`)
  await mkdir(dirname(dest), { recursive: true })
  await rename(sessionPath, dest)
  const nest = sessionPath.slice(0, -JSONL.length)
  const destNest = dest.slice(0, -JSONL.length)
  if (existsSync(nest) && !existsSync(destNest)) await rename(nest, destNest)
  return dest
}
