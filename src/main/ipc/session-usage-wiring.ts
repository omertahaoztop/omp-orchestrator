import { ipcMain, Notification } from 'electron'
import { IPC_CHANNELS, type SessionStats, type WorkspaceActivationIntent } from '../../shared/ipc-contracts'
import {
  budgetLevel,
  formatUsd,
  raiseBudget,
  usageFromStats,
  type SessionBudget,
  type SessionUsageEntry,
  type SessionUsageMap,
} from '../../shared/session-usage'
import { t } from '../../shared/i18n'
import type { PiRpcManager } from '../pi-rpc-manager'
import { appLog } from '../app-log'
import { loadAppSettings } from './settings'
import type { IpcContext } from './context'
import type { WindowControls } from './workspace-activity-wiring'

interface Tracked {
  entry: SessionUsageEntry
  manager: PiRpcManager
  /** Limit raised from the budget prompt; null follows the Settings default. */
  override: SessionBudget | null
  /** The budget cut a turn short, so raising it resumes the work. */
  interrupted: boolean
  /** An abort went out for the current turn; its aborted message must not ask again. */
  abortSent: boolean
}

/** Tracks every runtime's spend from the engine's own stats and stops a turn that crosses its budget. */
export function wireSessionUsage(ctx: IpcContext, windowControls: WindowControls, iconPath: string): void {
  const { workspaceManager } = ctx
  const tracked = new Map<string, Tracked>()

  const getMap = (): SessionUsageMap => Object.fromEntries([...tracked].map(([id, item]) => [id, item.entry]))
  const broadcast = (): void => ctx.broadcast(IPC_CHANNELS.EVENT_SESSION_USAGE, getMap())
  const defaultBudget = async (): Promise<SessionBudget> => {
    const settings = await loadAppSettings(workspaceManager)
    return { usd: settings.sessionBudgetUsd, tokens: settings.sessionBudgetTokens }
  }

  const notify = async (entry: SessionUsageEntry): Promise<void> => {
    if (!Notification.isSupported() || !(await loadAppSettings(workspaceManager)).desktopNotifications) return
    const workspace = workspaceManager.getWorkspaces().find((ws) => ws.id === entry.workspaceId)
    const notification = new Notification({
      title: workspace?.name ?? t('notifications.budgetTitle'),
      body: t('notifications.budgetHit', { cost: formatUsd(entry.usage.costUsd) }),
      ...(iconPath ? { icon: iconPath } : {}),
    })
    notification.on('click', () => {
      windowControls.showWindow()
      const sessionPath = workspaceManager.getSessionRuntime(entry.runtimeId)?.sessionPath
      const intent: WorkspaceActivationIntent = {
        workspaceId: entry.workspaceId,
        runtimeId: entry.runtimeId,
        ...(sessionPath ? { sessionPath } : {}),
      }
      ctx.broadcast(IPC_CHANNELS.EVENT_ACTIVATE_WORKSPACE, intent)
    })
    notification.show()
  }

  // Over budget while a turn runs (a turn waiting on a dialog still runs): stop it and ask once per stop.
  const enforce = (item: Tracked): void => {
    if (item.entry.level !== 'over' || item.abortSent) return
    const activity = workspaceManager.getSessionRuntime(item.entry.runtimeId)?.activity
    if (activity !== 'working' && activity !== 'needs-approval') return
    item.abortSent = true
    item.entry = { ...item.entry, hits: item.entry.hits + 1 }
    item.interrupted = true
    void item.manager.sendCommand({ type: 'abort' }).catch(() => undefined)
    void notify(item.entry).catch((err) => appLog.warn('notifications', 'Failed to show budget notification', err))
  }

  const refresh = async (manager: PiRpcManager, model?: string): Promise<void> => {
    if (!workspaceManager.runtimeIdFor(manager)) return
    const response = (await manager.sendCommand({ type: 'get_session_stats' })) as { success?: boolean; data?: SessionStats } | null
    if (!response?.success || !response.data) return
    const defaults = await defaultBudget()
    // Resolved after the awaits so a runtime closed or a workspace removed meanwhile is not re-added.
    const runtimeId = workspaceManager.runtimeIdFor(manager)
    const workspaceId = workspaceManager.workspaceIdFor(manager)
    if (!runtimeId || !workspaceId) return
    const previous = tracked.get(runtimeId)
    const usage = usageFromStats(response.data, model ?? previous?.entry.usage.model)
    const override = previous?.override ?? null
    const budget = override ?? defaults
    const item: Tracked = {
      manager,
      override,
      interrupted: previous?.interrupted ?? false,
      abortSent: previous?.abortSent ?? false,
      entry: { runtimeId, workspaceId, usage, budget, level: budgetLevel(usage, budget), hits: previous?.entry.hits ?? 0 },
    }
    tracked.set(runtimeId, item)
    enforce(item)
    broadcast()
  }

  workspaceManager.onPiManager((manager) => {
    const update = (model?: string): void => {
      if (manager.getStatus().status !== 'running') return
      void refresh(manager, model).catch(() => undefined)
    }
    manager.on('message_end', (event: { message?: { role?: unknown; model?: unknown } }) => {
      if (event.message?.role !== 'assistant') return
      update(typeof event.message.model === 'string' ? event.message.model : undefined)
    })
    // Seeds a resumed session's history and stops a new turn that starts already over budget.
    manager.on('status-change', () => update())
    // Re-reads stats and the current Settings budget: a cached level may predate a raised limit or /new.
    manager.on('agent_start', () => {
      const runtimeId = workspaceManager.runtimeIdFor(manager)
      const item = runtimeId ? tracked.get(runtimeId) : undefined
      if (item) item.abortSent = false
      update()
    })
  })
  workspaceManager.onSessionRuntime((runtime) => {
    if (runtime.closed && tracked.delete(runtime.runtimeId)) broadcast()
  })
  workspaceManager.onWorkspaceRemoved((workspaceId) => {
    let removed = false
    for (const [runtimeId, item] of tracked) {
      if (item.entry.workspaceId === workspaceId) removed = tracked.delete(runtimeId) || removed
    }
    if (removed) broadcast()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_USAGE_GET, async () => getMap())
  ipcMain.handle(IPC_CHANNELS.SESSION_USAGE_RAISE_BUDGET, async (_event, runtimeId: unknown) => {
    if (typeof runtimeId !== 'string') return
    const defaults = await defaultBudget()
    const item = tracked.get(runtimeId)
    if (!item) return
    const override = raiseBudget(item.entry.usage, item.entry.budget, defaults)
    item.override = override
    item.entry = { ...item.entry, budget: override, level: budgetLevel(item.entry.usage, override) }
    if (item.interrupted && item.manager.getStatus().status === 'running') {
      item.interrupted = false
      await item.manager.sendCommand({ type: 'prompt', message: 'Continue.' })
    }
    broadcast()
  })
}
