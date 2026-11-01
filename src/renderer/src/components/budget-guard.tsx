import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store'
import { useSessionUsageMap, useSessionUsageStore } from '../session-usage'
import { formatBudget, formatTokens, formatUsd } from '../../../shared/session-usage'

/** Resolves once no other confirm dialog is open; asking earlier would cancel that dialog. */
function confirmSlotFree(): Promise<void> {
  if (!useAppStore.getState().confirmRequest) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.confirmRequest) return
      unsubscribe()
      resolve()
    })
  })
}

/** Asks once per budget stop whether to raise the session's limit and continue, or leave it stopped. */
export function BudgetGuard(): null {
  const { t } = useTranslation()
  const entries = useSessionUsageMap()
  const askedHits = useRef<Record<string, number>>({})
  // One dialog at a time: a second confirm would cancel the first, which reads as "Stop".
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const ask = async (runtimeId: string): Promise<void> => {
      await confirmSlotFree()
      // Read again after waiting: the limit may have been raised or the session closed meanwhile.
      const entry = useSessionUsageStore.getState().entries[runtimeId]
      if (entry?.level !== 'over') return
      const { workspaces, requestConfirm } = useAppStore.getState()
      const raise = await requestConfirm({
        title: t('budget.hitTitle'),
        message: t('budget.hitMessage', {
          project: workspaces.find((ws) => ws.id === entry.workspaceId)?.name ?? entry.workspaceId,
          limit: formatBudget(entry.budget),
          cost: formatUsd(entry.usage.costUsd),
          tokens: formatTokens(entry.usage.totalTokens),
        }),
        confirmLabel: t('budget.continue'),
        cancelLabel: t('budget.stop'),
      })
      if (raise) await window.piDesktop.workspace.raiseSessionBudget(entry.runtimeId)
    }
    for (const entry of Object.values(entries)) {
      // Only a session still over its limit is asked, so a reload does not re-ask stops already answered.
      if (entry.level !== 'over' || entry.hits <= (askedHits.current[entry.runtimeId] ?? 0)) continue
      askedHits.current[entry.runtimeId] = entry.hits
      queue.current = queue.current.then(() => ask(entry.runtimeId)).catch(() => undefined)
    }
  }, [entries, t])

  return null
}
