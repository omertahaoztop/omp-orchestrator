import type { BrowserWindow } from 'electron'
import type { SessionDigestMap } from '../../shared/ipc-contracts'
import { t } from '../../shared/i18n'
import { appLog } from '../app-log'
import { getGuiDataDir } from '../app-data-paths'
import { loadMatrixConfig, startMatrixBridge } from '../matrix'
import type { PiEventRouter } from '../pi-event-router'
import { loadAppSettings } from './settings'
import type { IpcContext } from './context'

export interface MatrixWiring {
  syncQuestions(): void
  handleDigests(map: SessionDigestMap): void
}

/** Phone bridge: waiting prompts go to the Matrix room and replies answer them; finished turns post their summary. Null when matrix.json is absent. */
export function wireMatrix(
  ctx: IpcContext,
  deps: { router: PiEventRouter; getWindow: () => BrowserWindow | null; focusRuntimeId: () => string | null },
): MatrixWiring | null {
  const { workspaceManager } = ctx
  let config
  try {
    config = loadMatrixConfig(getGuiDataDir())
  } catch (error) {
    appLog.warn('matrix', error instanceof Error ? error.message : String(error))
    return null
  }
  if (!config) return null

  const projectName = (workspaceId: string | null): string =>
    workspaceManager.getWorkspaces().find((workspace) => workspace.id === workspaceId)?.name ?? ''
  const bridge = startMatrixBridge({
    config,
    pending: () => deps.router.listPending().map(({ manager, event }) => ({
      request: event,
      project: projectName(workspaceManager.workspaceIdFor(manager)),
    })),
    respond: (id, response) => deps.router.respond(id, response),
    log: (message) => appLog.warn('matrix', message),
  })

  const postedFinish = new Map<string, number>()
  return {
    syncQuestions: () => bridge.syncQuestions(),
    handleDigests: (map) => {
      for (const digest of Object.values(map)) {
        if (!digest.summary || !digest.finishedAt || postedFinish.get(digest.runtimeId) === digest.finishedAt) continue
        postedFinish.set(digest.runtimeId, digest.finishedAt)
        const { runtimeId, workspaceId, summary } = digest
        void loadAppSettings(workspaceManager).then((settings) => {
          // Someone at the window, or focused on another session, needs no phone ping.
          const focus = deps.focusRuntimeId()
          if (settings.notifyOnlyQuestions || deps.getWindow()?.isFocused() || (focus !== null && focus !== runtimeId)) return
          bridge.post(`${t('matrix.finished', { project: projectName(workspaceId) })}\n${summary}`)
        })
      }
    },
  }
}
