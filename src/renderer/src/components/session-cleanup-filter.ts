import { pathGroupKey } from '../../../shared/path-compare'
import type { SessionListItem } from '../../../shared/ipc-contracts'

export interface CleanupFilter {
  empty: boolean
  /** null turns the age filter off. */
  olderThanDays: number | null
}

export interface CleanupGroup {
  projectName: string
  sessions: SessionListItem[]
}

const DAY_MS = 86_400_000

/** Sessions matching any enabled filter, grouped by project folder; open sessions never qualify. */
export function cleanupGroups(
  sessions: SessionListItem[],
  filter: CleanupFilter,
  now: number,
  openPaths: Record<string, true>,
): CleanupGroup[] {
  const cutoff = filter.olderThanDays === null ? null : now - filter.olderThanDays * DAY_MS
  const groups = new Map<string, CleanupGroup>()
  for (const session of sessions) {
    if (openPaths[session.path]) continue
    const empty = filter.empty && session.contentState === 'empty'
    const old = cutoff !== null && session.lastModified < cutoff
    if (!empty && !old) continue
    const key = pathGroupKey(session.projectPath || 'unknown')
    const group = groups.get(key) ?? { projectName: session.projectName || session.projectPath || '?', sessions: [] }
    group.sessions.push(session)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.sessions.length - a.sessions.length)
}
