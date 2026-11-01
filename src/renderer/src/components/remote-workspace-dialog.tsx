import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Server, X } from 'lucide-react'
import type { Workspace } from '../../../shared/ipc-contracts'
import { useAppStore } from '../store'
import { formatIpcError } from '../utils/ipc-error'

const FIELD = 'mt-1 w-full rounded border border-border-strong bg-app px-2 py-1.5 text-sm text-primary outline-none focus:border-focus'

export function RemoteHostBadge({ host }: { host: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className="flex max-w-[10rem] shrink-0 items-center gap-1 rounded bg-warning-bg px-1.5 py-0.5 text-[10px] text-warning"
      title={t('remoteWorkspace.badgeTitle', { host })}
    >
      <Server size={10} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{host}</span>
    </span>
  )
}

/**
 * Add an SSH workspace, or repoint `workspace` at another host/folder. Main
 * runs `ssh -o BatchMode=yes <host> 'cd <path> && pwd -P'` before saving, so a
 * failure stays in the dialog with ssh's own message.
 */
export function RemoteWorkspaceDialog({ workspace, onClose }: {
  workspace?: Workspace
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const saveRemoteWorkspace = useAppStore((s) => s.saveRemoteWorkspace)
  const [host, setHost] = useState(workspace?.host ?? '')
  const [path, setPath] = useState(workspace?.host ? workspace.path : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (busy || !host.trim() || !path.trim()) return
    setBusy(true)
    setError(null)
    try {
      await saveRemoteWorkspace(host.trim(), path.trim(), workspace?.id)
      onClose()
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const close = (): void => {
    if (!busy) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close()
      }}
      role="presentation"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-lg border border-border-strong bg-surface shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-primary">
              {workspace ? t('remoteWorkspace.dialog.editTitle') : t('remoteWorkspace.dialog.addTitle')}
            </h2>
            <p className="mt-0.5 text-xs text-dim">{t('remoteWorkspace.dialog.intro')}</p>
          </div>
          <button type="button" onClick={close} disabled={busy} className="rounded p-1 text-muted hover:bg-surface-hover hover:text-primary disabled:opacity-50" aria-label={t('common.close')}>
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <label className="block text-xs text-muted">
            {t('remoteWorkspace.dialog.hostLabel')}
            <input
              autoFocus
              value={host}
              onChange={(event) => setHost(event.target.value)}
              disabled={busy}
              placeholder={t('remoteWorkspace.dialog.hostPlaceholder')}
              spellCheck={false}
              className={FIELD}
            />
          </label>
          <label className="block text-xs text-muted">
            {t('remoteWorkspace.dialog.pathLabel')}
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              disabled={busy}
              placeholder="~/projects/app"
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
          </label>
          {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={close} disabled={busy} className="rounded px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-primary disabled:opacity-50">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || !host.trim() || !path.trim()}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {busy ? t('remoteWorkspace.dialog.checking') : t('remoteWorkspace.dialog.connect')}
          </button>
        </div>
      </form>
    </div>
  )
}
