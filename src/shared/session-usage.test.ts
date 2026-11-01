import assert from 'node:assert/strict'
import { test } from 'node:test'
import { budgetLevel, normalizeBudgetLimit, raiseBudget, sumUsage, usageFromStats } from './session-usage'

const usage = (costUsd: number, totalTokens: number) => ({ inputTokens: totalTokens, outputTokens: 0, totalTokens, costUsd })

test('usageFromStats counts input and output, not cache reads', () => {
  const stats = { tokens: { input: 100, output: 20, cacheRead: 5000, cacheWrite: 50, total: 5170 }, cost: 0.25 }
  assert.deepEqual(usageFromStats(stats, 'm1'), { inputTokens: 100, outputTokens: 20, totalTokens: 120, costUsd: 0.25, model: 'm1' })
})

test('sumUsage adds every field across sessions', () => {
  assert.deepEqual(sumUsage([usage(0.5, 100), usage(1.25, 50)]), { inputTokens: 150, outputTokens: 0, totalTokens: 150, costUsd: 1.75 })
  assert.deepEqual(sumUsage([]), { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 })
})

test('budget is off when no limit is set', () => {
  assert.equal(budgetLevel(usage(1000, 1e9), { usd: null, tokens: null }), 'off')
})

test('budget warns at 80% and is over at 100% of any set limit', () => {
  const budget = { usd: 10, tokens: null }
  assert.equal(budgetLevel(usage(7.99, 0), budget), 'ok')
  assert.equal(budgetLevel(usage(8, 0), budget), 'warn')
  assert.equal(budgetLevel(usage(10, 0), budget), 'over')
  assert.equal(budgetLevel(usage(1, 900), { usd: 10, tokens: 1000 }), 'warn')
  assert.equal(budgetLevel(usage(11, 10), { usd: 10, tokens: 1000 }), 'over')
})

test('raising a budget adds one step past current spend and leaves unset limits off', () => {
  const raised = raiseBudget(usage(12, 500), { usd: 10, tokens: null }, { usd: 5, tokens: 1000 })
  assert.deepEqual(raised, { usd: 17, tokens: null })
  assert.equal(budgetLevel(usage(12, 500), raised), 'ok')
  assert.deepEqual(raiseBudget(usage(3, 0), { usd: 2, tokens: null }, { usd: null, tokens: null }), { usd: 5, tokens: null })
})

test('only positive finite limits count', () => {
  assert.equal(normalizeBudgetLimit(5), 5)
  for (const value of [0, -1, Number.NaN, Infinity, '5', null, undefined]) assert.equal(normalizeBudgetLimit(value), null)
})
