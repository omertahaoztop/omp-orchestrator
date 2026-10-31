import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Archive, ArrowUpRight, CheckCircle2, Circle, Crosshair, FileText, Globe, Inbox, ListChecks, Loader2, Play, RefreshCw, XCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../store'
import { SessionCleanup } from './session-cleanup'
import { openArtifact } from './chat-file-link'
import { DEFAULT_AGENT_ENGINE_LABEL, agentEngineLabel } from '../../../shared/agent-engine-label'
import { getSessionTitle } from '../utils/session-title'
import { pathsEqual } from '../../../shared/path-compare'
import { canResumeRun } from '../utils/workflow-runs'
import { NowContext, RelativeTime } from '../utils/relative-time'
import { SessionRuntimeIndicator } from './session-runtime-indicator'
import { PendingPromptCard } from './pending-prompt-card'
import type { SessionDigest, SessionRuntimeInfo, WorkflowRunStatus, WorkflowRunSummary } from '../../../shared/ipc-contracts'
import type { Translate } from '../../../shared/i18n'

const WORKFLOW_STATUS_KEYS = {
  pending: 'missionControl.workflowStatus.pending',
  running: 'missionControl.workflowStatus.running',
  paused: 'missionControl.workflowStatus.paused',
  completed: 'missionControl.workflowStatus.completed',
  failed: 'missionControl.workflowStatus.failed',
  aborted: 'missionControl.workflowStatus.aborted',
  unknown: 'missionControl.workflowStatus.unknown',
} as const satisfies Record<WorkflowRunStatus, string>

export function MissionControl(): React.JSX.Element {
  const { t } = useTranslation()
  const workspaces = useAppStore((state) => state.workspaces)
  const sessionList = useAppStore((state) => state.sessionList)
  const sessionRuntimes = useAppStore((state) => state.sessionRuntimes)
  const workflowRuns = useAppStore((state) => state.workflowRuns)
  const refreshWorkflowRuns = useAppStore((state) => state.refreshWorkflowRuns)
  const openSessionItem = useAppStore((state) => state.openSessionItem)
  const activateWorkspace = useAppStore((state) => state.activateWorkspace)
  const switchSession = useAppStore((state) => state.switchSession)
  const setCurrentView = useAppStore((state) => state.setCurrentView)
  const setTaskLauncherOpen = useAppStore((state) => state.setTaskLauncherOpen)
  const openWorkflowRunsForWorkspace = useAppStore((state) => state.openWorkflowRunsForWorkspace)
  const pendingPrompts = useAppStore((state) => state.pendingPrompts)
  const answerPendingPrompt = useAppStore((state) => state.answerPendingPrompt)
  const sessionDigests = useAppStore((state) => state.sessionDigests)
  const notifyFocusRuntimeId = useAppStore((state) => state.notifyFocusRuntimeId)
  const focusRuntime = notifyFocusRuntimeId ? sessionRuntimes[notifyFocusRuntimeId] : undefined
  const artifacts = useAppStore((state) => state.artifacts)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [controlBusy, setControlBusy] = useState<string | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)

  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    void refreshWorkflowRuns()
    const timer = window.setInterval(() => {
      void refreshWorkflowRuns()
      setNow(Date.now())
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refreshWorkflowRuns])

  const runtimes = useMemo(
    () => Object.values(sessionRuntimes)
      .filter((runtime) => runtime.status !== 'stopped' || runtime.activity !== null)
      .sort((a, b) => Number(b.active) - Number(a.active)),
    [sessionRuntimes]
  )
  const runningRuntimes = runtimes.filter(isRunning)
  const finishedRuntimes = runtimes
    .filter((runtime) => !isRunning(runtime))
    .sort((a, b) => (sessionDigests[b.runtimeId]?.finishedAt ?? 0) - (sessionDigests[a.runtimeId]?.finishedAt ?? 0))
  // Sessions with an open step come first, then by how much is left.
  const todoRuntimes = runtimes
    .flatMap((runtime) => {
      const todo = sessionDigests[runtime.runtimeId]?.todo
      return todo && todo.total > 0 ? [{ runtime, todo }] : []
    })
    .sort((a, b) => Number(!a.todo.current) - Number(!b.todo.current) || (b.todo.total - b.todo.done) - (a.todo.total - a.todo.done))
  const sessionTitleFor = (sessionPath: string | null, sessionId: string | null): string => {
    const session = sessionPath ? sessionList.find((item) => pathsEqual(item.path, sessionPath)) : undefined
    return session ? getSessionTitle(session.name, session.sessionId, session.preview) : sessionId ?? t('missionControl.startingSession')
  }
  const projectNameFor = (workspaceId: string | null): string =>
    workspaces.find((item) => item.id === workspaceId)?.name ?? t('missionControl.unknownProject')
  const recentRuns = useMemo(
    () => [...workflowRuns].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8),
    [workflowRuns]
  )
  const attentionCount = runtimes.filter((runtime) => runtime.activity === 'needs-approval' || runtime.activity === 'failed' || runtime.status === 'error').length +
    workflowRuns.filter((run) => run.status === 'paused' || run.status === 'failed').length

  const resumeRun = async (run: WorkflowRunSummary): Promise<void> => {
    if (controlBusy) return
    setControlBusy(run.runId)
    setControlError(null)
    try {
      const result = await window.piDesktop.workflows.control(run.workspaceId, run.runId, 'resume')
      if (!result.ok) {
        setControlError(
          t('missionControl.resumeFailed', {
            workflow: run.workflowName,
            reason: result.reason ?? t('missionControl.controlUnavailable'),
          })
        )
      } else await refreshWorkflowRuns()
    } catch {
      setControlError(t('missionControl.resumeFailedGeneric', { workflow: run.workflowName }))
    } finally {
      setControlBusy(null)
    }
  }

  const openRuntime = async (runtime: SessionRuntimeInfo): Promise<void> => {
    if (!runtime.sessionPath) return
    const workspace = workspaces.find((item) => item.id === runtime.workspaceId)
    if (!workspace) return
    const session = sessionList.find((item) => pathsEqual(item.path, runtime.sessionPath!))
    if (session) {
      await openSessionItem(session)
    } else {
      if (!(await activateWorkspace(workspace.id, { awaitingSession: true }))) return
      await switchSession(runtime.sessionPath, workspace.path)
      setCurrentView('chat')
    }
  }

  const reviewRuntime = async (runtime: SessionRuntimeInfo): Promise<void> => {
    await openRuntime(runtime)
    if (useAppStore.getState().activeSessionRuntimeId === runtime.runtimeId) setCurrentView('diff')
  }

  return (
    <NowContext.Provider value={now}>
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-7">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Inbox size={19} className="text-accent-fg" />
              <h1 className="text-lg font-semibold text-primary">{t('missionControl.title')}</h1>
              {attentionCount > 0 && (
                <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-medium text-warning">
                  {t('missionControl.needsAttention', { count: attentionCount })}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-dim">{t('missionControl.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCleanupOpen((open) => !open)}
              aria-pressed={cleanupOpen}
              className={clsx(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-hover hover:text-primary',
                cleanupOpen ? 'border-accent/50 text-primary' : 'border-border text-muted',
              )}
            >
              <Archive size={12} />
              {t('missionControl.cleanup.open')}
            </button>
            <button
              type="button"
              onClick={() => void refreshWorkflowRuns()}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-primary"
              title={t('missionControl.refreshWorkflowRuns')}
            >
              <RefreshCw size={12} />
              {t('common.refresh')}
            </button>
            <button
              type="button"
              onClick={() => setTaskLauncherOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              <Play size={12} />
              {t('missionControl.newTask')}
            </button>
          </div>
        </div>

        {cleanupOpen && <div className="mb-6"><SessionCleanup /></div>}

        {focusRuntime && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-accent/40 bg-accent-bg/10 px-4 py-3">
            <Crosshair size={15} className="shrink-0 text-accent-fg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-primary">
                {t('missionControl.focus.active', { session: sessionTitleFor(focusRuntime.sessionPath, focusRuntime.sessionId) })}
              </div>
              <div className="text-[11px] text-faint">{t('missionControl.focus.hint')}</div>
            </div>
            <button
              type="button"
              onClick={() => void window.piDesktop.workspace.setNotifyFocus(null)}
              className="shrink-0 rounded-md border border-border-strong px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover"
            >
              {t('missionControl.focus.end')}
            </button>
          </div>
        )}

        <section className="mb-6">
          <SectionHeading title={t('missionControl.inbox.title')} count={pendingPrompts.length} />
          {pendingPrompts.length === 0 ? (
            <EmptyState>{t('missionControl.inbox.empty')}</EmptyState>
          ) : (
            <div className="space-y-2">
              {pendingPrompts.map((item) => {
                const runtime = item.runtimeId ? sessionRuntimes[item.runtimeId] : undefined
                return (
                  <PendingPromptCard
                    key={item.request.id}
                    item={item}
                    sessionTitle={sessionTitleFor(item.sessionPath, runtime?.sessionId ?? null)}
                    projectName={projectNameFor(item.workspaceId)}
                    onAnswer={(response) => answerPendingPrompt(item.request, response)}
                    onOpen={runtime ? () => void openRuntime(runtime) : null}
                  />
                )
              })}
            </div>
          )}
        </section>

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {([
            [t('missionControl.board.running'), runningRuntimes, t('missionControl.board.noneRunning')],
            [t('missionControl.board.finished'), finishedRuntimes, t('missionControl.noLiveRuntimes')],
          ] as const).map(([heading, list, empty]) => (
            <section key={heading}>
              <SectionHeading title={heading} count={list.length} />
              {list.length === 0 ? (
                <EmptyState>{empty}</EmptyState>
              ) : (
                <div className="space-y-2">
                  {list.map((runtime) => {
                    const workspace = workspaces.find((item) => item.id === runtime.workspaceId)
                    return (
                      <RuntimeCard
                        key={runtime.runtimeId}
                        runtime={runtime}
                        digest={sessionDigests[runtime.runtimeId]}
                        title={sessionTitleFor(runtime.sessionPath, runtime.sessionId)}
                        projectName={projectNameFor(runtime.workspaceId)}
                        onOpen={runtime.sessionPath && workspace ? () => void openRuntime(runtime) : null}
                        onReview={runtime.sessionPath && (runtime.activity === 'completed' || workspace?.kind === 'worktree')
                          ? () => void reviewRuntime(runtime)
                          : null}
                        focused={notifyFocusRuntimeId === runtime.runtimeId}
                        onToggleFocus={() => void window.piDesktop.workspace.setNotifyFocus(
                          notifyFocusRuntimeId === runtime.runtimeId ? null : runtime.runtimeId,
                        )}
                      />
                    )
                  })}
                </div>
              )}
            </section>
          ))}
        </div>

        <section className="mb-6">
          <SectionHeading title={t('missionControl.todos.title')} count={todoRuntimes.length} />
          {todoRuntimes.length === 0 ? (
            <EmptyState>{t('missionControl.todos.empty')}</EmptyState>
          ) : (
            <div className="space-y-1.5">
              {todoRuntimes.map(({ runtime, todo }) => (
                <button
                  key={runtime.runtimeId}
                  type="button"
                  onClick={() => void openRuntime(runtime)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface/50 px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  <ListChecks size={14} className={clsx('shrink-0', todo.current ? 'text-accent-fg' : 'text-success')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-primary">{todo.current ?? t('missionControl.todos.allDone')}</div>
                    <div className="truncate text-[11px] text-faint">
                      {sessionTitleFor(runtime.sessionPath, runtime.sessionId)} · {projectNameFor(runtime.workspaceId)}
                    </div>
                  </div>
                  <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-card">
                    <div className="h-full bg-accent" style={{ width: `${todo.total ? (todo.done / todo.total) * 100 : 0}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted">{todo.done}/{todo.total}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="mb-6">
          <SectionHeading title={t('missionControl.artifacts.title')} count={artifacts.length} />
          {artifacts.length === 0 ? (
            <EmptyState>{t('missionControl.artifacts.empty')}</EmptyState>
          ) : (
            <div className="space-y-1.5">
              {artifacts.slice(0, 8).map((artifact) => (
                <button
                  key={artifact.source}
                  type="button"
                  onClick={() => void openArtifact(artifact)}
                  title={artifact.source}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface/50 px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  {artifact.url ? <Globe size={14} className="shrink-0 text-muted" /> : <FileText size={14} className="shrink-0 text-muted" />}
                  <span className="min-w-0 flex-1 truncate text-sm text-primary">{artifact.label}</span>
                  <span className="shrink-0 text-[11px] text-faint"><RelativeTime timestamp={artifact.shownAt} /></span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <SectionHeading title={t('missionControl.workflowActivity')} count={workflowRuns.length} />
            <button
              type="button"
              onClick={() => openWorkflowRunsForWorkspace(null)}
              className="text-[11px] text-muted transition-colors hover:text-accent-fg"
            >
              {t('missionControl.openAllWorkflows')}
            </button>
          </div>
          {recentRuns.length === 0 ? (
            <EmptyState>{t('missionControl.noWorkflowRuns')}</EmptyState>
          ) : (
            <>
              {controlError && <div className="mb-2 rounded border border-error/40 bg-error-bg/20 px-3 py-2 text-[11px] text-error" role="status">{controlError}</div>}
              <div className="space-y-2">
              {recentRuns.map((run) => (
                <WorkflowRow
                  key={`${run.workspaceId}:${run.runId}`}
                  run={run}
                  onOpen={() => openWorkflowRunsForWorkspace(run.workspaceId)}
                  onResume={() => void resumeRun(run)}
                  resumeBusy={controlBusy === run.runId}
                />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
    </NowContext.Provider>
  )
}

function RuntimeCard({
  runtime,
  digest,
  title,
  projectName,
  onOpen,
  onReview,
  focused,
  onToggleFocus,
}: {
  runtime: SessionRuntimeInfo
  digest: SessionDigest | undefined
  title: string
  projectName: string
  onOpen: (() => void) | null
  onReview: (() => void) | null
  focused: boolean
  onToggleFocus: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const finishedAt = isRunning(runtime) ? null : digest?.finishedAt ?? null
  const unread = finishedAt !== null && !digest?.read
  return (
    <div className={clsx('rounded-lg border bg-surface/50 px-3 py-3', focused || unread ? 'border-accent/50' : 'border-border')}>
      <div className="flex items-center gap-3">
        <SessionRuntimeIndicator runtime={runtime} />
        {!runtime.activity && runtime.status === 'running' && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full bg-success"
            title={t('missionControl.idle', { agent: agentEngineLabel(runtime.engine) ?? DEFAULT_AGENT_ENGINE_LABEL })}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title={t('missionControl.board.unread')} />}
            <span className="truncate text-sm text-primary">{title}</span>
          </div>
          <div className="truncate text-[11px] text-faint">
            {projectName} · {runtimeState(runtime, t)}
            {isRunning(runtime) && digest?.startedAt && (
              <> · {t('missionControl.board.started')} <RelativeTime timestamp={digest.startedAt} /></>
            )}
            {finishedAt !== null && <> · {t('missionControl.board.ended')} <RelativeTime timestamp={finishedAt} /></>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleFocus}
            aria-pressed={focused}
            title={focused ? t('missionControl.focus.end') : t('missionControl.focus.start')}
            className={clsx(
              'rounded p-1 transition-colors hover:bg-highlight',
              focused ? 'text-accent-fg' : 'text-faint hover:text-primary',
            )}
          >
            <Crosshair size={13} />
          </button>
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted transition-colors hover:bg-highlight hover:text-primary"
            >
              {t('missionControl.open')} <ArrowUpRight size={11} />
            </button>
          )}
          {onReview && (
            <button
              type="button"
              onClick={onReview}
              className="rounded border border-accent/40 px-2 py-1 text-[10px] text-accent-fg transition-colors hover:bg-accent-bg/20"
            >
              {t('missionControl.review')}
            </button>
          )}
        </div>
      </div>
      {finishedAt !== null && (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted">
          {digest?.summary ?? t('missionControl.board.summarizing')}
        </p>
      )}
    </div>
  )
}

function isRunning(runtime: SessionRuntimeInfo): boolean {
  return runtime.activity === 'working' || runtime.activity === 'needs-approval'
}

function WorkflowRow({
  run,
  onOpen,
  onResume,
  resumeBusy,
}: {
  run: WorkflowRunSummary
  onOpen: () => void
  onResume: () => void
  resumeBusy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const Icon = run.status === 'completed'
    ? CheckCircle2
    : run.status === 'failed' || run.status === 'aborted'
      ? XCircle
      : run.status === 'paused'
        ? AlertCircle
        : run.status === 'unknown'
          ? Circle
          : Loader2
  const iconClass = run.status === 'running' || run.status === 'pending'
    ? 'animate-spin text-accent-fg'
    : run.status === 'completed'
      ? 'text-success'
      : run.status === 'paused'
        ? 'text-warning'
        : run.status === 'unknown'
          ? 'text-muted'
          : 'text-error'
  return (
    <div className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface/50 px-3 py-2 transition-colors hover:border-border-strong hover:bg-surface-hover">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left">
        <Icon size={14} className={clsx('shrink-0', iconClass)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-primary">{run.workflowName}</div>
          <div className="truncate text-[11px] text-faint">{run.workspaceName} · {run.currentPhase ?? t(WORKFLOW_STATUS_KEYS[run.status])}</div>
        </div>
        <span className="shrink-0 text-[11px] capitalize text-muted">{t(WORKFLOW_STATUS_KEYS[run.status])}</span>
      </button>
      {canResumeRun(run.status) && (
        <button
          type="button"
          onClick={onResume}
          disabled={resumeBusy}
          className="flex shrink-0 items-center gap-1 rounded border border-success/40 px-2 py-1 text-[10px] font-medium text-success transition-colors hover:bg-success-bg/20 disabled:cursor-not-allowed disabled:opacity-50"
          title={run.status === 'paused' ? t('missionControl.proceedWithWorkflow') : t('missionControl.retryWithWorkflow')}
        >
          {resumeBusy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          {run.status === 'paused' ? t('missionControl.proceed') : t('common.retry')}
        </button>
      )}
    </div>
  )
}

function SectionHeading({ title, count }: { title: string; count: number }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-dim">
      <span>{title}</span>
      <span className="rounded-full bg-card px-1.5 py-0.5 text-[10px] font-normal text-faint">{count}</span>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-xs text-faint">{children}</div>
}

function runtimeState(runtime: SessionRuntimeInfo, t: Translate): string {
  if (runtime.activity === 'needs-approval') return t('missionControl.runtimeState.needsApproval')
  if (runtime.activity === 'working' || runtime.status === 'starting') return t('missionControl.runtimeState.working')
  if (runtime.activity === 'failed' || runtime.status === 'error') return t('missionControl.runtimeState.failed')
  if (runtime.activity === 'completed') return t('missionControl.runtimeState.completed')
  if (runtime.status === 'running') return t('missionControl.runtimeState.idle')
  return t('missionControl.runtimeState.stopped')
}
