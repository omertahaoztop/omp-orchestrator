import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { MarkdownRenderer } from './markdown-renderer'
import { CopyButton } from './copy-button'

/** The latest non-empty line of reasoning, without markdown markers, for the collapsed header. */
export function thinkingPreview(text: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/[*_`#>]/g, '').replace(/^\s*[-+]\s+/, '').trim()
    if (line) return line
  }
  return ''
}

export function ThinkingBlock({ text, open, onToggle, streaming = false, className }: {
  text: string
  open: boolean
  onToggle: () => void
  streaming?: boolean
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  // Opening lands on the newest text; after that, follow the tail only when the reader is near the bottom.
  useEffect(() => {
    const el = scrollRef.current
    const justOpened = open && !wasOpen.current
    wasOpen.current = open
    if (!el || !streaming) return
    if (justOpened || el.scrollHeight - el.clientHeight - el.scrollTop <= 48) el.scrollTop = el.scrollHeight
  }, [text, streaming, open])

  return (
    <div className={clsx('thinking-hover min-w-0', className)}>
      <div className="flex h-7 min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1 text-sm text-dim transition-colors hover:text-muted"
        >
          <Brain size={12} className="shrink-0" />
          {streaming && <Loader2 size={12} className="shrink-0 animate-spin text-special" />}
          {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
          <span className="shrink-0">{t('common.thinking')}</span>
          {!open && <span className="min-w-0 truncate text-faint">{thinkingPreview(text)}</span>}
        </button>
        {!streaming && <CopyButton text={text} className="thinking-copy-btn" />}
      </div>
      {open && (
        <div ref={scrollRef} className={clsx('min-w-0', streaming && 'max-h-36 overflow-x-hidden overflow-y-auto')}>
          <div className="markdown-body min-w-0 font-sans italic text-sm text-muted break-words [overflow-wrap:anywhere]">
            <MarkdownRenderer content={text} />
          </div>
        </div>
      )}
    </div>
  )
}
