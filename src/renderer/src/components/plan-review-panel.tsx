import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { PLAN_REVIEW_PARTITION } from '../../../shared/preview-partitions'

// `<webview>` is not a typed JSX intrinsic (see file-tree.tsx).
const Webview = 'webview' as unknown as React.FC<React.HTMLAttributes<HTMLElement> & { src: string; partition?: string }>

/** Plannotator's review page beside the chat; main closes it once Plannotator's server stops. */
export function PlanReviewPanel({ url, onClose }: { url: string; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium text-secondary">{t('chat.planReview.title')}</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-faint hover:text-muted"
          title={t('chat.planReview.close')}
          aria-label={t('chat.planReview.close')}
        >
          <X size={12} />
        </button>
      </div>
      <Webview key={url} src={url} partition={PLAN_REVIEW_PARTITION} className="min-h-0 flex-1" />
    </div>
  )
}
