import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Hourglass, Server } from 'lucide-react'
import { clsx } from 'clsx'
import type { PendingPromptItem } from '../../../shared/ipc-contracts'
import { RelativeTime } from '../utils/relative-time'
import { isToolApproval } from '../approval-queue'
import { AskForm } from './ask-form'

const SECONDARY_BUTTON = 'rounded-md border border-border-strong px-3 py-1.5 text-xs text-muted hover:bg-surface-hover transition-colors'
const PRIMARY_BUTTON = 'rounded-md bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover transition-colors'

/** A held prompt answered in place: the answer reaches the asking session without switching to it. */
export function PendingPromptCard({
  item,
  sessionTitle,
  projectName,
  onAnswer,
  onOpen,
  host,
  selected = false,
}: {
  item: PendingPromptItem
  sessionTitle: string
  projectName: string
  onAnswer: (response: Record<string, unknown> | null) => void
  onOpen: (() => void) | null
  /** SSH host of a remote workspace: approving on the wrong machine is the costliest mistake. */
  host?: string
  selected?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { request } = item
  const [text, setText] = useState(request.prefill ?? '')

  const body = ((): React.JSX.Element | null => {
    switch (request.method) {
      case 'ask':
        return <AskForm questions={request.questions ?? []} onSubmit={(answers) => onAnswer({ answers })} onCancel={() => onAnswer(null)} />
      case 'confirm':
        return (
          <>
            {request.message && <p className="whitespace-pre-wrap break-words text-xs text-muted">{request.message}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => onAnswer({ confirmed: false })} className={SECONDARY_BUTTON}>
                {t('missionControl.inbox.deny')}
              </button>
              <button type="button" onClick={() => onAnswer({ confirmed: true })} className={PRIMARY_BUTTON}>
                {t('common.confirm')}
              </button>
            </div>
          </>
        )
      case 'select':
        return (
          <div className="flex flex-wrap gap-1.5">
            {(request.options ?? []).map((option) => (
              <button key={option} type="button" onClick={() => onAnswer({ value: option })} className={SECONDARY_BUTTON}>
                {option}
              </button>
            ))}
          </div>
        )
      case 'input':
      case 'editor':
        return (
          <>
            <textarea
              value={text}
              rows={request.method === 'editor' ? 6 : 2}
              placeholder={request.placeholder ?? ''}
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary placeholder:text-faint focus:border-focus focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => onAnswer(null)} className={SECONDARY_BUTTON}>{t('common.cancel')}</button>
              <button type="button" onClick={() => onAnswer({ value: text })} className={PRIMARY_BUTTON}>{t('common.submit')}</button>
            </div>
          </>
        )
      default:
        return null
    }
  })()

  return (
    <article
      aria-current={selected || undefined}
      className={clsx(
        'space-y-3 rounded-lg border bg-warning-bg/10 px-4 py-3',
        selected ? 'border-accent ring-2 ring-accent/60' : 'border-warning/40',
      )}
    >
      {host && (
        <div className="flex items-center gap-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-base font-semibold text-warning">
          <Server size={16} className="shrink-0" />
          <span className="break-all">{t('missionControl.inbox.remoteHost', { host })}</span>
        </div>
      )}
      <header className="flex items-start gap-2">
        <Hourglass size={14} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-primary">{sessionTitle}</div>
          <div className="truncate text-[11px] text-faint">
            {projectName} · {t('missionControl.inbox.waitingSince')} <RelativeTime timestamp={item.receivedAt} />
          </div>
        </div>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-muted transition-colors hover:bg-highlight hover:text-primary"
          >
            {t('missionControl.open')} <ArrowUpRight size={11} />
          </button>
        )}
      </header>
      {request.method !== 'ask' && request.title && (isToolApproval(request) ? (
        <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-app px-3 py-2 font-mono text-xs text-primary">{request.title}</pre>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-primary">{request.title}</p>
      ))}
      {body}
    </article>
  )
}
