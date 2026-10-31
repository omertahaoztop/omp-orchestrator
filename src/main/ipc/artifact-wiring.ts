import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS, type ArtifactEntry } from '../../shared/ipc-contracts'
import type { IpcContext } from './context'

const RECENT_LIMIT = 20

/** Mirrors omp-artifacts' resolveTarget: URLs pass through, paths resolve against the session cwd. */
export function resolveArtifact(args: unknown, cwd: string, now: number): ArtifactEntry | null {
  const { path, title } = (args ?? {}) as { path?: unknown; title?: unknown }
  if (typeof path !== 'string' || !path) return null
  const label = typeof title === 'string' && title ? title : null
  if (/^https?:\/\//i.test(path)) return { source: path, label: label ?? path, url: true, shownAt: now }
  const raw = path.startsWith('file://') ? fileURLToPath(path) : path.replace(/^~(?=$|\/)/, homedir())
  const source = resolve(cwd, raw)
  return { source, label: label ?? basename(source), url: false, shownAt: now }
}

/** Newest first, from omp-artifacts' library file; a missing or broken file is an empty list. */
export async function readArtifactLibrary(file: string): Promise<ArtifactEntry[]> {
  let entries: unknown
  try {
    entries = JSON.parse(await readFile(file, 'utf-8'))
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []
  return entries
    .filter((e): e is { source: string; label?: unknown; kind?: unknown; lastShownAt?: unknown } => typeof e?.source === 'string')
    .map((e) => ({
      source: e.source,
      label: typeof e.label === 'string' && e.label ? e.label : basename(e.source),
      url: e.kind === 'url',
      shownAt: typeof e.lastShownAt === 'number' ? e.lastShownAt : 0,
    }))
    .sort((a, b) => b.shownAt - a.shownAt)
    .slice(0, RECENT_LIMIT)
}

/** Shows show_artifact calls of every session and lets the preview read the files they name. */
export function wireArtifacts(ctx: IpcContext): void {
  const { workspaceManager, approvedAttachmentPaths } = ctx
  const library = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.omp', 'agent'), 'artifact-library.json')
  const approve = (artifact: ArtifactEntry): void => {
    if (!artifact.url) approvedAttachmentPaths.add(artifact.source)
  }

  workspaceManager.onPiManager((manager) => {
    manager.on('event', (event: { type?: unknown; toolName?: unknown; args?: unknown }) => {
      if (event.type !== 'tool_execution_start' || event.toolName !== 'show_artifact') return
      const runtimeId = workspaceManager.runtimeIdFor(manager)
      const workspaceId = workspaceManager.workspaceIdFor(manager)
      const cwd = workspaceManager.getWorkspaces().find((w) => w.id === workspaceId)?.path
      const artifact = cwd ? resolveArtifact(event.args, cwd, Date.now()) : null
      if (!runtimeId || !artifact) return
      approve(artifact)
      ctx.broadcast(IPC_CHANNELS.EVENT_ARTIFACT_SHOWN, { runtimeId, artifact })
    })
  })

  ipcMain.handle(IPC_CHANNELS.ARTIFACTS_LIST, async () => {
    const entries = await readArtifactLibrary(library)
    entries.forEach(approve)
    return entries
  })
}
