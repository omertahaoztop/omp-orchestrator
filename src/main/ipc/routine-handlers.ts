import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { appLog } from '../app-log'
import { getGuiDataPath } from '../app-data-paths'
import { Routines } from '../routines'
import { launchTask } from './session-handlers'
import { isObject, isString } from './validation'
import type { IpcContext } from './context'

export function registerRoutineHandlers(ctx: IpcContext): void {
  const { workspaceManager } = ctx
  const routines = new Routines({
    file: getGuiDataPath('routines.json'),
    launch: (workspaceId, prompt) => launchTask(workspaceManager, workspaceId, prompt),
    hasWorkspace: (workspaceId) => workspaceManager.getWorkspaces().some((workspace) => workspace.id === workspaceId),
    log: (message) => appLog.warn('routines', message),
  })
  routines.start()

  ipcMain.handle(IPC_CHANNELS.ROUTINES_LIST, () => routines.list())

  ipcMain.handle(IPC_CHANNELS.ROUTINES_ADD, (_event, input: unknown) => {
    if (!isObject(input) || !isString(input.name) || !isString(input.cron) || !isString(input.workspaceId) || !isString(input.prompt)) {
      throw new Error('routine must have string name, cron, workspaceId and prompt')
    }
    return routines.add({ name: input.name, cron: input.cron, workspaceId: input.workspaceId, prompt: input.prompt })
  })

  ipcMain.handle(IPC_CHANNELS.ROUTINES_REMOVE, (_event, id: unknown) => {
    if (!isString(id)) throw new Error('id must be a string')
    routines.remove(id)
  })

  ipcMain.handle(IPC_CHANNELS.ROUTINES_SET_ENABLED, (_event, id: unknown, enabled: unknown) => {
    if (!isString(id) || typeof enabled !== 'boolean') throw new Error('id must be a string and enabled a boolean')
    return routines.setEnabled(id, enabled)
  })

  ipcMain.handle(IPC_CHANNELS.ROUTINES_RUN, async (_event, id: unknown) => {
    if (!isString(id)) throw new Error('id must be a string')
    await routines.run(id)
  })
}
