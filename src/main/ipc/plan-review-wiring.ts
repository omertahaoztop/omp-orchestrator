import { shell } from 'electron'
import { IPC_CHANNELS, type PlanReviewEvent } from '../../shared/ipc-contracts'
import { pathsEqual } from '../../shared/path-compare'
import type { PlanReviewRequest } from '../plan-review'
import type { IpcContext } from './context'

const PROBE_MS = 2000

let show: ((request: PlanReviewRequest) => void) | null = null

/** Shows a review the opener relayed; outside a known workspace (or before startup ends) the browser shows it. */
export function openPlanReview(request: PlanReviewRequest): void {
  if (show) show(request)
  else void shell.openExternal(request.url)
}

export function wirePlanReview(ctx: IpcContext, showWindow: () => void): void {
  show = ({ url, cwd }) => {
    const workspace = ctx.workspaceManager.getWorkspaces().find((w) => pathsEqual(w.path, cwd))
    if (!workspace) return void shell.openExternal(url)
    showWindow()
    const event: PlanReviewEvent = { url, workspaceId: workspace.id, closed: false }
    ctx.broadcast(IPC_CHANNELS.EVENT_PLAN_REVIEW, event)
    // Plannotator stops its server shortly after the decision; a dead URL ends the review.
    const probe = setInterval(async () => {
      const up = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_MS) }).then(() => true, () => false)
      if (up) return
      clearInterval(probe)
      ctx.broadcast(IPC_CHANNELS.EVENT_PLAN_REVIEW, { ...event, closed: true } satisfies PlanReviewEvent)
    }, PROBE_MS)
    probe.unref()
  }
}
