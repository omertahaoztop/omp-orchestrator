import type { SessionRuntimeInfo } from '../../shared/ipc-contracts'

export type SessionRuntimeState = 'running' | 'awaiting_approval' | 'idle' | 'error' | 'done'

export const SESSION_RUNTIME_STATE_KEYS = {
  running: 'missionControl.runtimeState.working',
  awaiting_approval: 'missionControl.runtimeState.needsApproval',
  idle: 'missionControl.runtimeState.idle',
  error: 'missionControl.runtimeState.failed',
  done: 'missionControl.runtimeState.completed',
} as const satisfies Record<SessionRuntimeState, string>

export function sessionRuntimeState(runtime: Pick<SessionRuntimeInfo, 'activity' | 'status'>): SessionRuntimeState {
  if (runtime.activity === 'needs-approval') return 'awaiting_approval'
  if (runtime.activity === 'working' || runtime.status === 'starting') return 'running'
  if (runtime.activity === 'failed' || runtime.status === 'error') return 'error'
  if (runtime.activity === 'completed') return 'done'
  return runtime.status === 'running' ? 'idle' : 'done'
}

/** A turn is in flight: working, or held on an approval. */
export function isSessionRunning(runtime: Pick<SessionRuntimeInfo, 'activity' | 'status'>): boolean {
  return runtime.activity === 'working' || runtime.activity === 'needs-approval'
}
