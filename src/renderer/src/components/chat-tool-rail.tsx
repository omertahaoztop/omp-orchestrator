import { useAppStore } from '../store'
import { activeShortcuts } from '../utils/app-shortcuts'
import { formatShortcut, type ShortcutAction } from '../../../shared/keyboard-shortcuts'
import { useTranslation } from 'react-i18next'
import { clsx } from 'clsx'
import { ClipboardCheck, FolderTree, GitCompare, ListChecks, Terminal, ShieldCheck } from 'lucide-react'
import { countRunningSubagentTasks } from '../../../shared/subagent-task'

export function ChatToolRail(): React.JSX.Element {
  const { t } = useTranslation()
  const reviewOpen = useAppStore((state) => state.reviewOpen)
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const sidePanel = useAppStore((state) => state.chatSidePanel)
  const setSidePanel = useAppStore((state) => state.setChatSidePanel)
  const runningSubagents = useAppStore((state) => countRunningSubagentTasks(state.subagentTasks))
  const hasPlanReview = useAppStore((state) => state.planReview !== null && state.planReview.workspaceId === state.activeWorkspace?.id)

  return (
    <nav className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border bg-app py-2">
      <RailButton
        icon={<ShieldCheck size={16} />}
        active={reviewOpen}
        onClick={() => useAppStore.getState().toggleReview()}
        title={t('chat.toolbar.reviewPanel')}
        shortcutAction="review"
      />
      <RailButton
        icon={<FolderTree size={16} />}
        active={sidePanel === 'files'}
        onClick={() => void setSidePanel(sidePanel === 'files' ? null : 'files')}
        title={t('chat.toolbar.fileTree')}
        shortcutAction="files"
      />
      <RailButton
        icon={<GitCompare size={16} />}
        active={sidePanel === 'diff'}
        onClick={() => void setSidePanel(sidePanel === 'diff' ? null : 'diff')}
        title={t('chat.toolbar.diffViewer')}
        shortcutAction="diff"
      />
      <RailButton
        icon={<ListChecks size={16} />}
        active={sidePanel === 'tasks'}
        onClick={() => void setSidePanel(sidePanel === 'tasks' ? null : 'tasks')}
        title={t('chat.toolbar.subagents')}
        badge={runningSubagents}
        badgeLabel={t('chat.toolbar.subagentsRunning', { count: runningSubagents })}
      />
      {hasPlanReview && (
        <RailButton
          icon={<ClipboardCheck size={16} />}
          active={sidePanel === 'plan'}
          onClick={() => void setSidePanel(sidePanel === 'plan' ? null : 'plan')}
          title={t('chat.planReview.title')}
        />
      )}
      <RailButton
        icon={<Terminal size={16} />}
        active={terminalOpen}
        onClick={() => useAppStore.getState().toggleTerminal()}
        title={t('chat.toolbar.terminal')}
        shortcutAction="terminal"
      />
    </nav>
  )
}

function RailButton({
  icon,
  active,
  onClick,
  title,
  shortcutAction,
  badge,
  badgeLabel,
}: {
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  title: string
  shortcutAction?: ShortcutAction
  badge?: number
  /** Spoken instead of `title` while the badge shows, so the count is not visual only. */
  badgeLabel?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const shortcut = useAppStore((state) => shortcutAction ? activeShortcuts(state)[shortcutAction] : null)
  const tooltip = shortcut
    ? t('settings.shortcuts.actionWithShortcut', { action: title, shortcut: formatShortcut(shortcut, window.piDesktop.system.platform) })
    : title
  const showBadge = badge !== undefined && badge > 0
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={showBadge && badgeLabel ? badgeLabel : title}
      className={clsx(
        'relative flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-card text-primary before:absolute before:-right-1 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent'
          : 'text-dim hover:bg-highlight hover:text-secondary'
      )}
      title={tooltip}
    >
      {icon}
      {showBadge && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-bg px-0.5 text-[9px] font-semibold leading-none text-accent-fg tabular-nums">
          {badge}
        </span>
      )}
    </button>
  )
}
