import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { clsx } from 'clsx'
import { Check, Circle, CircleDot, Square, SquareCheck } from 'lucide-react'
import type { PiAskAnswer, PiAskQuestion } from '../../../shared/ipc-contracts'
import { MarkdownRenderer } from './markdown-renderer'
import {
  buildAskAnswers,
  initialAskState,
  isAskAnswered,
  setAskCustom,
  toggleAskOption,
  type AskQuestionState,
} from './ask-form-helpers'

/** OMP's multi-question `ask`: shared by the blocking dialog and the Komuta inbox cards. */
export function AskForm({
  questions,
  onSubmit,
  onCancel,
}: {
  questions: PiAskQuestion[]
  onSubmit: (answers: PiAskAnswer[]) => void
  onCancel?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [states, setStates] = useState<AskQuestionState[]>(() => initialAskState(questions))
  const answers = buildAskAnswers(questions, states)
  const update = (index: number, next: AskQuestionState): void =>
    setStates((current) => current.map((state, i) => (i === index ? next : state)))

  return (
    <div className="space-y-5">
      {questions.map((question, index) => {
        const state = states[index]
        const previewLabel = [...state.selected].reverse().find((label) =>
          question.options.some((option) => option.label === label && option.preview))
        const preview = question.options.find((option) => option.label === previewLabel)?.preview
        return (
          <section key={question.id} className="space-y-2">
            <div className="flex items-center gap-2">
              {question.header && (
                <span className="rounded bg-elevated px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {question.header}
                </span>
              )}
              {isAskAnswered(state) && <Check size={13} className="text-success" />}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm font-medium text-primary">{question.question}</p>
            {question.multi && <p className="text-xs text-dim">{t('chat.extensionUi.askMultiHint')}</p>}
            <div role={question.multi ? 'group' : 'radiogroup'} className="space-y-1">
              {question.options.map((option, optionIndex) => {
                const selected = state.selected.includes(option.label)
                const Icon = question.multi ? (selected ? SquareCheck : Square) : (selected ? CircleDot : Circle)
                return (
                  <button
                    key={option.label}
                    type="button"
                    role={question.multi ? 'checkbox' : 'radio'}
                    aria-checked={selected}
                    onClick={() => update(index, toggleAskOption(question, state, option.label))}
                    className={clsx(
                      'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      selected ? 'border-accent bg-accent/10 text-primary' : 'border-border text-secondary hover:bg-elevated',
                    )}
                  >
                    <Icon size={15} className={clsx('mt-0.5 shrink-0', selected ? 'text-accent' : 'text-dim')} />
                    <span className="min-w-0 flex-1">
                      <span className="break-words">{option.label}</span>
                      {optionIndex === question.recommended && (
                        <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">
                          {t('chat.extensionUi.askRecommended')}
                        </span>
                      )}
                      {option.description && (
                        <span className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-muted">{option.description}</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              value={state.custom}
              placeholder={t('chat.extensionUi.askOtherPlaceholder')}
              onChange={(e) => update(index, setAskCustom(question, state, e.target.value))}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary placeholder:text-faint focus:border-focus focus:outline-none"
            />
            {preview && (
              <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-elevated/40 px-3 py-2 text-sm">
                <MarkdownRenderer content={preview} />
              </div>
            )}
          </section>
        )
      })}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border-strong px-4 py-2 text-sm text-muted hover:bg-surface-hover transition-colors"
          >
            {t('common.cancel')}
          </button>
        )}
        <button
          type="button"
          disabled={answers === null}
          onClick={() => answers && onSubmit(answers)}
          className="rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('chat.extensionUi.askSubmit')}
        </button>
      </div>
    </div>
  )
}
