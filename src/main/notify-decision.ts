/**
 * Pure decision for desktop notifications, mirroring tray-decision.ts: no
 * Electron imports so the matrix is unit-testable.
 */
export interface NotifyParams {
  /** The desktopNotifications setting. */
  enabled: boolean
  /** The notifyOnlyQuestions setting: finished/failed turns stay in-app. */
  onlyQuestions: boolean
  kind: 'completed' | 'failed' | 'needs-approval'
  /** Whether the app window currently has OS focus. */
  windowFocused: boolean
  /** Workspace the event happened in (null when unknown). */
  eventWorkspaceId: string | null
  activeWorkspaceId: string | null
  eventRuntimeId: string | null
  /** The session in focus mode, or null when focus mode is off. */
  focusRuntimeId: string | null
}

/** `hold`: muted by focus mode, counted for the summary shown when focus ends. */
export type NotifyDecision = 'show' | 'skip' | 'hold'

/**
 * Notify unless the user is already looking at the workspace in question: a
 * focused window suppresses events from the active workspace only, while an
 * unfocused window notifies for everything (the user is in another app).
 * Questions always pass focus mode and the questions-only rule, or the agent would wait unseen.
 */
export function shouldNotify(params: NotifyParams): NotifyDecision {
  if (!params.enabled) return 'skip'
  if (params.eventWorkspaceId === null) return 'skip'
  if (params.kind !== 'needs-approval') {
    if (params.focusRuntimeId !== null && params.eventRuntimeId !== params.focusRuntimeId) return 'hold'
    if (params.onlyQuestions) return 'skip'
  }
  if (params.windowFocused && params.eventWorkspaceId === params.activeWorkspaceId) return 'skip'
  return 'show'
}
