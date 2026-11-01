import { useMemo } from 'react'
import { create } from 'zustand'
import { formatTokens, formatUsd, sumUsage, type SessionUsage, type SessionUsageMap } from '../../shared/session-usage'

export type { SessionUsage, SessionUsageEntry, BudgetLevel } from '../../shared/session-usage'

// Kept out of the app store: main pushes the whole map for every runtime, background ones included.
export const useSessionUsageStore = create<{ entries: SessionUsageMap }>(() => ({ entries: {} }))

let subscribed = false
function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  const apply = (entries: SessionUsageMap): void => useSessionUsageStore.setState({ entries })
  window.piDesktop.onSessionUsage(apply)
  void window.piDesktop.workspace.getSessionUsage().then(apply).catch(() => undefined)
}

export function useSessionUsageMap(): SessionUsageMap {
  ensureSubscribed()
  return useSessionUsageStore((state) => state.entries)
}

export function useSessionUsage(runtimeId: string | null | undefined): SessionUsage | null {
  ensureSubscribed()
  return useSessionUsageStore((state) => (runtimeId ? state.entries[runtimeId]?.usage ?? null : null))
}

/** Sum over the project's live runtimes; null when none has reported yet. */
export function useProjectUsage(workspaceId: string | null | undefined): SessionUsage | null {
  const entries = useSessionUsageMap()
  return useMemo(() => {
    const usages = Object.values(entries).filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.usage)
    return usages.length > 0 ? sumUsage(usages) : null
  }, [entries, workspaceId])
}

/** Tokens and dollars, e.g. "12.3k · $0.420"; callers put the word "tokens" in a translated tooltip. */
export function formatUsageCompact(usage: SessionUsage): string {
  return `${formatTokens(usage.totalTokens)} · ${formatUsd(usage.costUsd)}`
}
