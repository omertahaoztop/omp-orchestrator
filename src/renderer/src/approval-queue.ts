import type { PiExtensionUiRequest } from '../../shared/ipc-contracts'

/** Step through a list of `length` items, wrapping at both ends; -1 when empty. */
export function moveQueueSelection(index: number, delta: number, length: number): number {
  if (length <= 0) return -1
  const from = Math.min(Math.max(index, 0), length - 1)
  return (((from + delta) % length) + length) % length
}

/** Keep a selection valid after the list shrinks or grows. */
export function clampQueueSelection(index: number, length: number): number {
  return length <= 0 ? -1 : Math.min(Math.max(index, 0), length - 1)
}

const ALLOW_OPTION = /^(approve|allow|yes)\b/i
const DENY_OPTION = /^(deny|reject|no)\b/i

/** The answer an allow/deny key sends, or null when the prompt needs a typed or chosen answer. */
export function quickApprovalAnswer(request: PiExtensionUiRequest, allow: boolean): Record<string, unknown> | null {
  if (request.method === 'confirm') return { confirmed: allow }
  if (request.method !== 'select') return null
  const option = request.options?.find((item) => (allow ? ALLOW_OPTION : DENY_OPTION).test(item.trim()))
  return option === undefined ? null : { value: option }
}

/** omp tool approvals arrive as a select titled "Allow tool: <name>" followed by detail lines such as "Command: …". */
export function isToolApproval(request: PiExtensionUiRequest): boolean {
  return request.method === 'select' && (request.title ?? '').startsWith('Allow tool:')
}
