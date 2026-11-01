import type { SessionStats } from './ipc-contracts'

/** Token and dollar spend of one session, or a sum of several. */
export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  /** Input plus output; cache reads are left out, they repeat the context every call. */
  totalTokens: number
  costUsd: number
  /** Model of the latest assistant message, when known. */
  model?: string
}

/** Spending limit of one session; a null field is off. */
export interface SessionBudget {
  usd: number | null
  tokens: number | null
}

export type BudgetLevel = 'off' | 'ok' | 'warn' | 'over'

export const BUDGET_WARN_RATIO = 0.8

/** One live runtime's spend and budget state, keyed by runtime id. */
export interface SessionUsageEntry {
  runtimeId: string
  workspaceId: string
  usage: SessionUsage
  budget: SessionBudget
  level: BudgetLevel
  /** Times the budget stopped this session; a new value asks the user again. */
  hits: number
}

export type SessionUsageMap = Record<string, SessionUsageEntry>

export function emptyUsage(): SessionUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
}

export function usageFromStats(stats: Pick<SessionStats, 'tokens' | 'cost'>, model?: string): SessionUsage {
  const inputTokens = stats.tokens?.input ?? 0
  const outputTokens = stats.tokens?.output ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: Number.isFinite(stats.cost) ? stats.cost : 0,
    ...(model ? { model } : {}),
  }
}

export function sumUsage(list: Iterable<SessionUsage>): SessionUsage {
  const total = emptyUsage()
  for (const usage of list) {
    total.inputTokens += usage.inputTokens
    total.outputTokens += usage.outputTokens
    total.totalTokens += usage.totalTokens
    total.costUsd += usage.costUsd
  }
  return total
}

/** A positive finite limit, or null (off) for anything else. */
export function normalizeBudgetLimit(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** The worst level over the limits that are set; 'off' when none is. */
export function budgetLevel(usage: SessionUsage, budget: SessionBudget): BudgetLevel {
  const ratios = [
    budget.usd === null ? null : usage.costUsd / budget.usd,
    budget.tokens === null ? null : usage.totalTokens / budget.tokens,
  ].filter((ratio): ratio is number => ratio !== null)
  if (ratios.length === 0) return 'off'
  const ratio = Math.max(...ratios)
  if (ratio >= 1) return 'over'
  return ratio >= BUDGET_WARN_RATIO ? 'warn' : 'ok'
}

/** Each set limit moves to the current spend plus one more step of `base` (or of itself). */
export function raiseBudget(usage: SessionUsage, budget: SessionBudget, base: SessionBudget): SessionBudget {
  return {
    usd: budget.usd === null ? null : usage.costUsd + (base.usd ?? budget.usd),
    tokens: budget.tokens === null ? null : usage.totalTokens + (base.tokens ?? budget.tokens),
  }
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

export function formatUsd(usd: number): string {
  return `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`
}

/** The set limits, e.g. "$5.00 / 200.0k"; empty when the budget is off. */
export function formatBudget(budget: SessionBudget): string {
  return [budget.usd === null ? null : formatUsd(budget.usd), budget.tokens === null ? null : formatTokens(budget.tokens)]
    .filter(Boolean)
    .join(' / ')
}
