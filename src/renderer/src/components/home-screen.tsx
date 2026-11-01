import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSessionTitle } from '../utils/session-title'
import { DEFAULT_AGENT_ENGINE_LABEL, agentEngineLabel } from '../../../shared/agent-engine-label'
import { PI_DESKTOP_PRODUCT_NAME } from '../../../shared/product-name'
import { clsx } from 'clsx'
import {
  FolderOpen,
  Plus,
  Clock,
  Layers,
  GitCompare,
  GitBranch,
  AlertTriangle,
  Settings as SettingsIcon,
  Play,
  Boxes,
  ChevronDown,
  Server,
} from 'lucide-react'
import { useAppStore } from '../store'
import appLogo from '../assets/app-logo.svg'
import { formatGitStatus } from './review-rail'
import { PendingPromptCard } from './pending-prompt-card'
import { useContextMenu } from './context-menu'
import { SESSION_RUNTIME_STATE_KEYS, sessionRuntimeState, type SessionRuntimeState } from '../session-runtime-state'
import { formatUsageCompact, useSessionUsage } from '../session-usage'
import type { GitFileStatus, SessionDigest, SessionListItem, SessionRuntimeInfo, Workspace } from '../../../shared/ipc-contracts'
import { workspaceNameFromFolderPath } from '../../../shared/folder-drop'
import { pathsEqual } from '../../../shared/path-compare'

const MAX_RECENT_WORKSPACES = 6
const MAX_RECENT_SESSIONS = 5
const MAX_CHANGED_FILES = 8

const STATE_BADGE_CLASSES = {
  running: 'bg-accent-bg text-accent-fg',
  awaiting_approval: 'bg-warning-bg text-warning',
  idle: 'bg-success-bg text-success',
  error: 'bg-error-bg text-error',
  done: 'bg-card text-muted',
} as const satisfies Record<SessionRuntimeState, string>

/**
 * Home command screen: new/open actions, what needs the user, live sessions,
 * recents. Chat-first launch (Open to Home off) uses the empty-chat center prompt instead.
 */
export function HomeScreen(): React.JSX.Element {
  return <HomeScreenInfo />
}

/**
 * Home body: pending prompts and live session cards, with recents and changed files alongside.
 */
export function HomeInfoSummary(): React.JSX.Element {
  const { t } = useTranslation()
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const sessionList = useAppStore((s) => s.sessionList)
  const archivedSessions = useAppStore((s) => s.archivedSessions)
  const sessionRuntimes = useAppStore((s) => s.sessionRuntimes)
  const sessionDigests = useAppStore((s) => s.sessionDigests)
  const pendingPrompts = useAppStore((s) => s.pendingPrompts)
  const answerPendingPrompt = useAppStore((s) => s.answerPendingPrompt)
  const activateWorkspace = useAppStore((s) => s.activateWorkspace)
  const createWorkspace = useAppStore((s) => s.createWorkspace)
  const switchSession = useAppStore((s) => s.switchSession)
  const openSessionItem = useAppStore((s) => s.openSessionItem)
  const setCurrentView = useAppStore((s) => s.setCurrentView)
  const requestChatScrollToBottom = useAppStore((s) => s.requestChatScrollToBottom)

  const [gitStatus, setGitStatus] = useState<Record<string, GitFileStatus>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.piDesktop.files
      .getGitStatus()
      .then((s) => {
        if (!cancelled) setGitStatus(s)
      })
      .catch(() => {
        if (!cancelled) setGitStatus({})
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspace?.id])

  const recentWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, MAX_RECENT_WORKSPACES),
    [workspaces]
  )
  const recentSessions = useMemo(
    () => sessionList.filter((s) => !(s.sessionId in archivedSessions)).slice(0, MAX_RECENT_SESSIONS),
    [sessionList, archivedSessions]
  )
  const changedFiles = useMemo(
    () =>
      Object.entries(gitStatus)
        .map(([path, status]) => ({ path, status }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [gitStatus]
  )
  // Same live set Mission Control lists, active tab first.
  const runtimes = useMemo(
    () => Object.values(sessionRuntimes)
      .filter((runtime) => runtime.status !== 'stopped' || runtime.activity !== null)
      .sort((a, b) => Number(b.active) - Number(a.active)),
    [sessionRuntimes]
  )

  const sessionFor = (sessionPath: string | null): SessionListItem | undefined =>
    sessionPath ? sessionList.find((item) => pathsEqual(item.path, sessionPath)) : undefined
  const sessionTitleFor = (sessionPath: string | null, sessionId: string | null): string => {
    const session = sessionFor(sessionPath)
    return session ? getSessionTitle(session.name, session.sessionId, session.preview) : sessionId ?? t('missionControl.startingSession')
  }

  const withBusy = async (run: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await run()
    } finally {
      setBusy(false)
    }
  }

  const openWorkspace = (workspaceId: string): Promise<void> => withBusy(async () => {
    if (!(await activateWorkspace(workspaceId))) return
    if (useAppStore.getState().piStatus !== 'error') {
      requestChatScrollToBottom()
      setCurrentView('chat')
    }
  })

  const openSession = (session: SessionListItem): Promise<void> => withBusy(async () => {
    let targetId: string | undefined
    if (session.projectPath) {
      let ws = useAppStore.getState().workspaces.find((w) => !w.host && pathsEqual(w.path, session.projectPath))
      if (!ws) {
        await createWorkspace(session.projectName, session.projectPath)
        ws = useAppStore.getState().workspaces.find((w) => !w.host && pathsEqual(w.path, session.projectPath))
      }
      targetId = ws?.id
    }
    // Workspace/session activation is non-destructive; the target Pi runtime
    // hydrates in the background while Chat opens immediately.
    if (targetId) {
      if (!(await activateWorkspace(targetId, { awaitingSession: true }))) return
    }
    if (useAppStore.getState().piStatus === 'error') return
    await switchSession(session.path, session.projectPath)
    requestChatScrollToBottom()
    setCurrentView('chat')
  })

  // Mirrors Mission Control's openRuntime: a runtime whose session is not indexed yet opens by path.
  const openRuntime = (runtime: SessionRuntimeInfo): Promise<void> => withBusy(async () => {
    if (!runtime.sessionPath) return
    const workspace = workspaces.find((item) => item.id === runtime.workspaceId)
    if (!workspace) return
    const session = sessionFor(runtime.sessionPath)
    if (session) {
      await openSessionItem(session)
    } else {
      if (!(await activateWorkspace(workspace.id, { awaitingSession: true }))) return
      await switchSession(runtime.sessionPath, workspace.path)
      setCurrentView('chat')
    }
  })

  const openChangedFiles = (): Promise<void> => withBusy(async () => {
    if (!activeWorkspace) return
    if (!(await activateWorkspace(activeWorkspace.id))) return
    if (useAppStore.getState().piStatus !== 'error') setCurrentView('diff')
  })

  return (
    <div className={clsx('grid gap-6 lg:grid-cols-3', busy && 'pointer-events-none opacity-60')}>
      <div className="space-y-6 lg:col-span-2">
        <section>
          <SectionLabel>{t('home.attention.title')}</SectionLabel>
          {pendingPrompts.length === 0 ? (
            <EmptyHint>{t('home.attention.empty')}</EmptyHint>
          ) : (
            <div className="space-y-2">
              {pendingPrompts.map((item) => {
                const runtime = item.runtimeId ? sessionRuntimes[item.runtimeId] : undefined
                return (
                  <PendingPromptCard
                    key={item.request.id}
                    item={item}
                    sessionTitle={sessionTitleFor(item.sessionPath, runtime?.sessionId ?? null)}
                    projectName={workspaces.find((ws) => ws.id === item.workspaceId)?.name ?? t('missionControl.unknownProject')}
                    host={workspaces.find((ws) => ws.id === item.workspaceId)?.host}
                    onAnswer={(response) => answerPendingPrompt(item.request, response)}
                    onOpen={runtime ? () => void openRuntime(runtime) : null}
                  />
                )
              })}
            </div>
          )}
        </section>

        <section>
          <SectionLabel>{t('home.activeSessions.title')}</SectionLabel>
          {runtimes.length === 0 ? (
            <EmptyHint>{t('home.activeSessions.empty')}</EmptyHint>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {runtimes.map((runtime) => {
                const session = sessionFor(runtime.sessionPath)
                return (
                  <ActiveSessionCard
                    key={runtime.runtimeId}
                    runtime={runtime}
                    workspace={workspaces.find((item) => item.id === runtime.workspaceId)}
                    digest={sessionDigests[runtime.runtimeId]}
                    title={sessionTitleFor(runtime.sessionPath, runtime.sessionId)}
                    preview={session?.preview ?? null}
                    onOpen={() => void openRuntime(runtime)}
                  />
                )
              })}
            </div>
          )}
        </section>
      </div>

      <div className="space-y-6">
        <section>
          <SectionLabel>{t('home.recentSessions.title')}</SectionLabel>
          <div className="space-y-1.5">
            {recentSessions.length === 0 ? (
              <EmptyHint>{t('home.recentSessions.empty')}</EmptyHint>
            ) : (
              recentSessions.map((session) => (
                <button
                  key={session.path}
                  onClick={() => void openSession(session)}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-surface/40 px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-hover/60"
                >
                  <Clock size={13} className="shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-secondary">
                      {getSessionTitle(session.name, session.sessionId, session.preview)}
                    </div>
                    <div className="truncate text-[11px] text-faint">{session.projectName}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionLabel>{t('home.recentWorkspaces.title')}</SectionLabel>
          <div className="space-y-1.5">
            {recentWorkspaces.length === 0 ? (
              <EmptyHint>{t('home.recentWorkspaces.empty')}</EmptyHint>
            ) : (
              recentWorkspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => void openWorkspace(ws.id)}
                  className="group flex w-full items-center gap-3 rounded-md border border-border bg-surface/40 px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-hover/60"
                >
                  <Layers size={14} className="shrink-0" style={{ color: ws.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-primary">{ws.name}</div>
                    <div className="truncate text-[11px] text-faint">{ws.host ? `${ws.host}:${ws.path}` : ws.path}</div>
                  </div>
                  {ws.id === activeWorkspace?.id && (
                    <span className="shrink-0 rounded bg-accent-bg px-1.5 py-0.5 text-[10px] text-accent-fg">
                      {t('home.recentWorkspaces.last')}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </section>

        {changedFiles.length > 0 && (
          <section className="rounded-lg border border-border bg-surface/50">
            <div className="flex items-center justify-between px-4 py-2.5">
              <SectionLabel className="mb-0">{t('common.changedFilesHeading')}</SectionLabel>
              <span className="rounded-full bg-card px-2 py-0.5 text-[10px] text-muted">{changedFiles.length}</span>
            </div>
            <div className="max-h-40 overflow-y-auto border-t border-border/60 py-1">
              {changedFiles.slice(0, MAX_CHANGED_FILES).map((file) => (
                <button
                  key={file.path}
                  onClick={() => void openChangedFiles()}
                  title={file.path}
                  className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs text-secondary transition-colors hover:bg-surface-hover"
                >
                  <span className="shrink-0 rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    {formatGitStatus(file.status)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{file.path}</span>
                </button>
              ))}
              {changedFiles.length > MAX_CHANGED_FILES && (
                <button
                  onClick={() => void openChangedFiles()}
                  className="flex w-full items-center gap-1.5 px-4 py-1.5 text-xs text-dim hover:text-secondary"
                >
                  <GitCompare size={11} />
                  {t('home.changedFiles.moreOpenDiff', { count: changedFiles.length - MAX_CHANGED_FILES })}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function ActiveSessionCard({
  runtime,
  workspace,
  digest,
  title,
  preview,
  onOpen,
}: {
  runtime: SessionRuntimeInfo
  workspace: Workspace | undefined
  digest: SessionDigest | undefined
  title: string
  preview: string | null
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const usage = useSessionUsage(runtime.runtimeId)
  const activeModel = useAppStore((s) => (runtime.active ? s.sessionState?.model?.name : undefined))
  const state = sessionRuntimeState(runtime)
  const model = usage?.model ?? activeModel
  const lastLine = digest?.summary ?? preview
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!runtime.sessionPath || !workspace}
      className={clsx(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-surface/50 px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover/60 disabled:cursor-default',
        runtime.active ? 'border-accent/50' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-primary">{title}</span>
        <span className={clsx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', STATE_BADGE_CLASSES[state])}>
          {t(SESSION_RUNTIME_STATE_KEYS[state])}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-faint">
        <span className="truncate">{workspace?.name ?? t('missionControl.unknownProject')}</span>
        {workspace?.branch && (
          <span className="flex min-w-0 items-center gap-0.5 truncate">
            <GitBranch size={10} className="shrink-0" />
            {workspace.branch}
          </span>
        )}
        {workspace?.host && (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-card px-1 py-px text-muted" title={t('home.activeSessions.hostTitle', { host: workspace.host })}>
            <Server size={10} />
            {workspace.host}
          </span>
        )}
      </div>
      {lastLine && <p className="truncate text-xs text-muted">{lastLine}</p>}
      {(model || usage) && (
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-dim">
          {model && <span className="min-w-0 truncate">{model}</span>}
          {usage && (
            <span
              className="ml-auto shrink-0 tabular-nums"
              title={t('home.activeSessions.usageTitle', { input: usage.inputTokens, output: usage.outputTokens })}
            >
              {formatUsageCompact(usage)}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

function PiErrorBanner(): React.JSX.Element | null {
  const { t } = useTranslation()
  const piStatus = useAppStore((s) => s.piStatus)
  const piError = useAppStore((s) => s.piError)
  const engineLabel = useAppStore((s) => agentEngineLabel(s.piEngine) ?? DEFAULT_AGENT_ENGINE_LABEL)
  const setCurrentView = useAppStore((s) => s.setCurrentView)
  if (piStatus !== 'error' || !piError) return null
  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-error-bg bg-error-bg px-4 py-3 text-sm text-error">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="font-medium">{t('home.errorBanner.couldntStart', { agent: engineLabel })}</div>
        <div className="mt-0.5 text-error/80">{piError}</div>
        <div className="mt-1 text-xs text-error/70">{t('home.errorBanner.checkInstalled', { agent: engineLabel })}</div>
      </div>
      <button
        onClick={() => setCurrentView('settings')}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-error/25 px-2.5 py-1 text-xs text-error hover:bg-error/40"
      >
        <SettingsIcon size={12} />
        {t('common.settings')}
      </button>
    </div>
  )
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={clsx('mb-2 text-xs font-medium uppercase tracking-wide text-dim', className)}>
      {children}
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-xs text-faint">{children}</div>
  )
}

function HomeScreenInfo(): React.JSX.Element {
  const { t } = useTranslation()
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const activateWorkspace = useAppStore((s) => s.activateWorkspace)
  const createWorkspace = useAppStore((s) => s.createWorkspace)
  const createNewSession = useAppStore((s) => s.createNewSession)
  const setTaskLauncherOpen = useAppStore((s) => s.setTaskLauncherOpen)
  const setLinkedTaskDialog = useAppStore((s) => s.setLinkedTaskDialog)
  const setCurrentView = useAppStore((s) => s.setCurrentView)
  const requestChatScrollToBottom = useAppStore((s) => s.requestChatScrollToBottom)
  const [busy, setBusy] = useState(false)
  const { show: showNewMenu, ContextMenuComponent: NewMenu } = useContextMenu()

  const goChatUnlessError = (): void => {
    if (useAppStore.getState().piStatus !== 'error') {
      requestChatScrollToBottom()
      setCurrentView('chat')
    }
  }

  const openFolder = async (): Promise<void> => {
    const path = await window.piDesktop.system.openDialog({ title: t('dialogs.openFolder.title') })
    if (!path) return
    setBusy(true)
    try {
      let ws = useAppStore.getState().workspaces.find((w) => !w.host && pathsEqual(w.path, path))
      if (!ws) {
        await createWorkspace(workspaceNameFromFolderPath(path), path)
        ws = useAppStore.getState().workspaces.find((w) => !w.host && pathsEqual(w.path, path))
      }
      if (ws) {
        if (!(await activateWorkspace(ws.id))) return
        goChatUnlessError()
      }
    } finally {
      setBusy(false)
    }
  }

  const newSession = async (): Promise<void> => {
    if (!activeWorkspace) {
      await openFolder()
      return
    }
    setBusy(true)
    try {
      if (!(await activateWorkspace(activeWorkspace.id))) return
      if (useAppStore.getState().piStatus === 'error') return
      await createNewSession()
      requestChatScrollToBottom()
      setCurrentView('chat')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={clsx('mx-auto max-w-[1100px] px-8 py-8', busy && 'pointer-events-none opacity-60')}>
        <PiErrorBanner />

        <div className="mb-6 flex flex-wrap items-center gap-4">
          <img src={appLogo} alt={PI_DESKTOP_PRODUCT_NAME} className="h-10 w-10" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-primary">{PI_DESKTOP_PRODUCT_NAME}</h1>
            <p className="text-sm text-dim">{t('home.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex">
              <button
                type="button"
                onClick={() => void newSession()}
                title={activeWorkspace
                  ? t('home.actions.newSession.inWorkspace', { project: activeWorkspace.name })
                  : t('home.actions.newSession.pickFolderFirst')}
                className="flex items-center gap-1.5 rounded-l-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              >
                <Plus size={14} />
                {t('home.actions.new')}
              </button>
              <button
                type="button"
                aria-label={t('home.actions.newMenu')}
                aria-haspopup="menu"
                onClick={(e) => showNewMenu(e, [
                  { id: 'session', label: t('common.newSession'), icon: <Plus size={14} />, action: () => void newSession() },
                  {
                    id: 'task',
                    label: t('home.actions.newTask.title'),
                    icon: <Play size={14} />,
                    action: () => setTaskLauncherOpen(true),
                  },
                  { id: 'linked', label: t('home.actions.linkedTask.title'), icon: <Boxes size={14} />, action: () => setLinkedTaskDialog({ view: 'start' }) },
                ])}
                className="flex items-center rounded-r-md border-l border-white/20 bg-accent px-1.5 text-white transition-colors hover:bg-accent-hover"
              >
                <ChevronDown size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void openFolder()}
              title={t('home.actions.openFolder.description')}
              className="flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
            >
              <FolderOpen size={14} />
              {t('home.actions.openFolder.title')}
            </button>
          </div>
        </div>
        {NewMenu}

        <HomeInfoSummary />
      </div>
    </div>
  )
}
