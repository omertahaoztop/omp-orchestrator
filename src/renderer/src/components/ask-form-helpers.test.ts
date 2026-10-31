import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PiAskQuestion } from '../../../shared/ipc-contracts'
import { buildAskAnswers, initialAskState, setAskCustom, toggleAskOption } from './ask-form-helpers'

const single: PiAskQuestion = {
  id: 'db',
  question: 'Database?',
  options: [{ label: 'SQLite' }, { label: 'Postgres' }],
  recommended: 1,
}
const multi: PiAskQuestion = {
  id: 'langs',
  question: 'Languages?',
  options: [{ label: 'en' }, { label: 'tr' }, { label: 'ru' }],
  multi: true,
}

test('recommended option starts selected; a question without one starts empty', () => {
  assert.deepEqual(initialAskState([single, multi]), [
    { selected: ['Postgres'], custom: '' },
    { selected: [], custom: '' },
  ])
})

test('answers stay null until every question is answered', () => {
  const states = initialAskState([single, multi])
  assert.equal(buildAskAnswers([single, multi], states), null)
  states[1] = setAskCustom(multi, states[1], '   ')
  assert.equal(buildAskAnswers([single, multi], states), null)
})

test('answers follow question order and option order, whatever the click order', () => {
  const states = initialAskState([single, multi])
  states[1] = toggleAskOption(multi, states[1], 'ru')
  states[1] = toggleAskOption(multi, states[1], 'en')
  states[1] = setAskCustom(multi, states[1], ' de ')
  assert.deepEqual(buildAskAnswers([single, multi], states), [
    { id: 'db', selectedOptions: ['Postgres'] },
    { id: 'langs', selectedOptions: ['en', 'ru'], customInput: 'de' },
  ])
})

test('single-select never carries both an option and free text (OMP rejects it)', () => {
  let state = initialAskState([single])[0]
  state = setAskCustom(single, state, 'MariaDB')
  assert.deepEqual(buildAskAnswers([single], [state]), [{ id: 'db', selectedOptions: [], customInput: 'MariaDB' }])
  state = toggleAskOption(single, state, 'SQLite')
  assert.deepEqual(buildAskAnswers([single], [state]), [{ id: 'db', selectedOptions: ['SQLite'] }])
})

test('multi-select toggles an option off again', () => {
  let state = initialAskState([multi])[0]
  state = toggleAskOption(multi, state, 'tr')
  state = toggleAskOption(multi, state, 'tr')
  assert.deepEqual(state.selected, [])
})
