import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { i18n, languageNativeName } from '../../shared/i18n'
import { createSessionDigests, summarizeRun } from '../session-digest'
import { appLog } from '../app-log'
import { loadAppSettings } from './settings'
import type { IpcContext } from './context'

/** Feeds every session runtime's events into the Komuta digests and serves them to the renderer. */
export function wireSessionDigests(ctx: IpcContext): void {
  const { workspaceManager } = ctx
  const digests = createSessionDigests({
    now: () => Date.now(),
    summarize: async (run, runtimeId) => {
      const settings = await loadAppSettings(workspaceManager)
      const engine = workspaceManager.getSessionRuntime(runtimeId)?.engine ?? 'omp'
      try {
        return await summarizeRun(run, engine, settings.summaryModel, languageNativeName(i18n.language))
      } catch (error) {
        appLog.warn('komuta', 'Session summary failed', { engine, reason: error instanceof Error ? error.message : 'unknown' })
        throw error
      }
    },
    onChange: (map) => ctx.broadcast(IPC_CHANNELS.EVENT_SESSION_DIGESTS, map),
  })

  workspaceManager.onPiManager((manager) => {
    manager.on('event', (event: { type?: unknown } & Record<string, unknown>) => {
      const runtimeId = workspaceManager.runtimeIdFor(manager)
      const workspaceId = workspaceManager.workspaceIdFor(manager)
      if (runtimeId && workspaceId) digests.handleEvent(runtimeId, workspaceId, event)
    })
  })
  workspaceManager.onSessionRuntime((runtime) => {
    if (runtime.closed) digests.remove(runtime.runtimeId)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DIGESTS_GET, async () => digests.getMap())
  ipcMain.handle(IPC_CHANNELS.SESSION_DIGEST_MARK_READ, async (_event, runtimeId: unknown) => {
    if (typeof runtimeId === 'string') digests.markRead(runtimeId)
  })
}
