import type { PiAskAnswer, PiAskQuestion } from '../../../shared/ipc-contracts'

export interface AskQuestionState {
  selected: string[]
  custom: string
}

/** The recommended option starts selected, so accepting the agent's suggestion is one click. */
export function initialAskState(questions: readonly PiAskQuestion[]): AskQuestionState[] {
  return questions.map((question) => {
    const recommended = question.recommended === undefined ? undefined : question.options[question.recommended]
    return { selected: recommended ? [recommended.label] : [], custom: '' }
  })
}

/** Single-select replaces the choice and clears free text (OMP rejects both); multi-select toggles. */
export function toggleAskOption(question: PiAskQuestion, state: AskQuestionState, label: string): AskQuestionState {
  if (!question.multi) return { selected: [label], custom: '' }
  const selected = state.selected.includes(label)
    ? state.selected.filter((item) => item !== label)
    : [...state.selected, label]
  return { ...state, selected }
}

export function setAskCustom(question: PiAskQuestion, state: AskQuestionState, custom: string): AskQuestionState {
  if (!question.multi && custom.trim() !== '') return { selected: [], custom }
  return { ...state, custom }
}

export function isAskAnswered(state: AskQuestionState): boolean {
  return state.selected.length > 0 || state.custom.trim() !== ''
}

/** OMP's wire shape: one answer per question in question order; null until every question is answered. */
export function buildAskAnswers(
  questions: readonly PiAskQuestion[],
  states: readonly AskQuestionState[],
): PiAskAnswer[] | null {
  if (states.length !== questions.length || !states.every(isAskAnswered)) return null
  return questions.map((question, index) => {
    const state = states[index]
    const labels = question.options.map((option) => option.label)
    const answer: PiAskAnswer = { id: question.id, selectedOptions: labels.filter((label) => state.selected.includes(label)) }
    const custom = state.custom.trim()
    if (custom !== '') answer.customInput = custom
    return answer
  })
}
