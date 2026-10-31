import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, Loader2, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../store'
import { getSessionRowLabels } from './sidebar-session-labels'
import { formatRelativeTime } from '../utils/format-relative-time'
import { cleanupGroups } from './session-cleanup-filter'
import type { SessionListItem } from '../../../shared/ipc-contracts'

type Tab = 'cleanup' | 'archive'

/** Komuta's clutter tools: archive empty or old session files in bulk, and restore them. Nothing is deleted. */
export function SessionCleanup(): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('cleanup')
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null)
  const [empty, setEmpty] = useState(true)
  const [old, setOld] = useState(true)
  const [days, setDays] = useState(30)
  const [selected, setSelected] = useState<Record<string, true>>({})
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const sessionRuntimes = useAppStore((state) => state.sessionRuntimes)
  const refreshSessionList = useAppStore((state) => state.refreshSessionList)

  const load = useCallback(async (which: Tab) => {
    setSessions(null)
    setSelected({})
    const list = which === 'cleanup'
      ? await window.piDesktop.session.listForCleanup()
      : await window.piDesktop.session.listArchiveFiles()
    setSessions(list)
  }, [])

  useEffect(() => {
    void load(tab)
  }, [tab, load])

  const openPaths = useMemo(() => {
    const paths: Record<string, true> = {}
    for (const runtime of Object.values(sessionRuntimes)) if (runtime.sessionPath) paths[runtime.sessionPath] = true
    return paths
  }, [sessionRuntimes])

  const groups = useMemo(
    () => (tab === 'cleanup' && sessions
      ? cleanupGroups(sessions, { empty, olderThanDays: old ? days : null }, Date.now(), openPaths)
      : []),
    [tab, sessions, empty, old, days, openPaths],
  )

  const archived = useMemo(() => {
    if (tab !== 'archive' || !sessions) return []
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return sessions
    return sessions.filter((s) => `${getSessionRowLabels(s).title} ${s.projectName}`.toLocaleLowerCase().includes(needle))
  }, [tab, sessions, query])

  const selectedPaths = Object.keys(selected)
  const toggle = (paths: string[], on: boolean): void => setSelected((current) => {
    const next = { ...current }
    for (const path of paths) {
      if (on) next[path] = true
      else delete next[path]
    }
    return next
  })

  const archiveSelected = async (): Promise<void> => {
    setBusy(true)
    try {
      const count = await window.piDesktop.session.archiveFiles(selectedPaths)
      setNotice(t('missionControl.cleanup.archivedCount', { count }))
      await Promise.all([load('cleanup'), refreshSessionList()])
    } finally {
      setBusy(false)
    }
  }

  const restore = async (session: SessionListItem): Promise<void> => {
    setBusy(true)
    try {
      await window.piDesktop.session.restoreArchiveFile(session.path)
      setNotice(t('missionControl.cleanup.restored', { title: getSessionRowLabels(session).title }))
      await Promise.all([load('archive'), refreshSessionList()])
    } finally {
      setBusy(false)
    }
  }

  const tabButton = (value: Tab, label: string): React.JSX.Element => (
    <button
      type="button"
      onClick={() => { setNotice(null); setTab(value) }}
      aria-pressed={tab === value}
      className={clsx(
        'rounded-md px-3 py-1.5 text-xs transition-colors',
        tab === value ? 'bg-card text-primary' : 'text-muted hover:text-primary',
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="rounded-lg border border-border bg-surface/50 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tabButton('cleanup', t('missionControl.cleanup.tabCleanup'))}
        {tabButton('archive', t('missionControl.cleanup.tabArchive'))}
        {notice && <span className="ml-auto text-[11px] text-success" role="status">{notice}</span>}
      </div>

      {sessions === null ? (
        <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-dim" /></div>
      ) : tab === 'cleanup' ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-secondary">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} />
              {t('missionControl.cleanup.filterEmpty')}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={old} onChange={(e) => setOld(e.target.checked)} />
              {t('missionControl.cleanup.filterOlder')}
              <input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
                className="w-14 rounded border border-border-strong bg-card px-1.5 py-0.5 text-primary"
                aria-label={t('missionControl.cleanup.daysLabel')}
              />
            </label>
            <button
              type="button"
              disabled={busy || selectedPaths.length === 0}
              onClick={() => void archiveSelected()}
              className="ml-auto flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Archive size={12} />
              {t('missionControl.cleanup.archiveSelected', { count: selectedPaths.length })}
            </button>
          </div>
          {groups.length === 0 ? (
            <div className="py-4 text-center text-xs text-faint">{t('missionControl.cleanup.nothing')}</div>
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {groups.map((group) => {
                const paths = group.sessions.map((s) => s.path)
                const all = paths.every((path) => selected[path])
                return (
                  <div key={paths[0]}>
                    <label className="mb-1 flex items-center gap-2 text-xs font-medium text-secondary">
                      <input type="checkbox" checked={all} onChange={(e) => toggle(paths, e.target.checked)} />
                      {group.projectName}
                      <span className="text-faint">{group.sessions.length}</span>
                    </label>
                    {group.sessions.map((session) => (
                      <label key={session.path} className="flex items-center gap-2 rounded py-1 pl-5 pr-2 text-xs hover:bg-highlight">
                        <input type="checkbox" checked={!!selected[session.path]} onChange={(e) => toggle([session.path], e.target.checked)} />
                        <span className="min-w-0 flex-1 truncate text-primary">
                          {session.contentState === 'empty' ? t('missionControl.cleanup.emptySession') : getSessionRowLabels(session).title}
                        </span>
                        <span className="shrink-0 text-faint">{formatRelativeTime(session.lastModified, Date.now())}</span>
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 rounded border border-border-strong bg-card px-2 py-1">
            <Search size={12} className="text-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('missionControl.cleanup.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-xs text-primary placeholder:text-faint focus:outline-none"
            />
          </div>
          {archived.length === 0 ? (
            <div className="py-4 text-center text-xs text-faint">{t('missionControl.cleanup.archiveEmpty')}</div>
          ) : (
            <div className="max-h-96 space-y-1 overflow-y-auto">
              {archived.map((session) => (
                <div key={session.path} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-highlight">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-primary">{getSessionRowLabels(session).title}</div>
                    <div className="truncate text-[11px] text-faint">
                      {session.projectName} · {formatRelativeTime(session.lastModified, Date.now())}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void restore(session)}
                    className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:bg-surface-hover hover:text-primary disabled:opacity-40"
                  >
                    <ArchiveRestore size={11} />
                    {t('missionControl.cleanup.restore')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
