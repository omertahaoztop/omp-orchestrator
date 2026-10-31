import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import type { Routine, RoutineInput } from '../shared/ipc-contracts'
import { t } from '../shared/i18n'
import { cronMatches, nextCronRun, parseCron, type CronSchedule } from './cron'

type StoredRoutine = Omit<Routine, 'nextRunAt'>

export interface RoutineDeps {
  file: string
  /** Starts a new session in the workspace and sends it the prompt. */
  launch: (workspaceId: string, prompt: string) => Promise<unknown>
  hasWorkspace: (workspaceId: string) => boolean
  log: (message: string) => void
}

function schedule(cron: string): CronSchedule {
  try {
    return parseCron(cron)
  } catch {
    throw new Error(t('errors.routines.badCron', { cron }))
  }
}

function view(routine: StoredRoutine, now: Date): Routine {
  const next = routine.enabled ? nextCronRun(schedule(routine.cron), now) : null
  return { ...routine, nextRunAt: next?.getTime() ?? null }
}

function load(file: string, log: (message: string) => void): StoredRoutine[] {
  if (!existsSync(file)) return []
  try {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (data && typeof data === 'object' && 'routines' in data && Array.isArray(data.routines)) {
      // Only this class writes the file; the shape check above guards against hand edits.
      const routines: StoredRoutine[] = data.routines
      return routines
    }
  } catch {
    // Falls through to set the unreadable file aside.
  }
  // Keep the unreadable file instead of overwriting it on the next save.
  renameSync(file, `${file}.corrupt-${Date.now()}`)
  log(`routines file was unreadable and was set aside: ${file}`)
  return []
}

/** Cron-scheduled prompts. Each run is a new session in the routine's workspace; runs missed while the app was closed are skipped. */
export class Routines {
  private routines: StoredRoutine[]
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly deps: RoutineDeps) {
    this.routines = load(deps.file, deps.log)
  }

  list(): Routine[] {
    const now = new Date()
    return this.routines.map((routine) => view(routine, now))
  }

  add(input: RoutineInput): Routine {
    const name = input.name.trim()
    const prompt = input.prompt.trim()
    const cron = input.cron.trim()
    if (!name || !prompt) throw new Error(t('errors.routines.fieldsRequired'))
    if (!this.deps.hasWorkspace(input.workspaceId)) throw new Error(t('errors.workspace.notFoundPlain'))
    if (!nextCronRun(schedule(cron), new Date())) throw new Error(t('errors.routines.neverRuns', { cron }))
    const routine: StoredRoutine = { id: randomUUID(), name, cron, workspaceId: input.workspaceId, prompt, enabled: true, lastRunAt: null }
    this.routines.push(routine)
    this.save()
    return view(routine, new Date())
  }

  remove(id: string): void {
    this.require(id)
    this.routines = this.routines.filter((routine) => routine.id !== id)
    this.save()
  }

  setEnabled(id: string, enabled: boolean): Routine {
    const routine = this.require(id)
    routine.enabled = enabled
    this.save()
    return view(routine, new Date())
  }

  async run(id: string): Promise<void> {
    const routine = this.require(id)
    await this.deps.launch(routine.workspaceId, routine.prompt)
    routine.lastRunAt = Date.now()
    this.save()
  }

  /** Starts every enabled routine due in the minute containing `now`. */
  tick(now: Date): void {
    for (const routine of this.routines) {
      if (!routine.enabled || !this.deps.hasWorkspace(routine.workspaceId) || !cronMatches(schedule(routine.cron), now)) continue
      this.run(routine.id).catch((error: unknown) => this.deps.log(`routine ${routine.name} failed: ${String(error)}`))
    }
  }

  start(): void {
    const now = new Date()
    this.timer = setTimeout(() => {
      this.tick(new Date())
      this.start()
    }, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50)
    this.timer.unref()
  }

  stop(): void {
    clearTimeout(this.timer)
  }

  private require(id: string): StoredRoutine {
    const routine = this.routines.find((item) => item.id === id)
    if (!routine) throw new Error(t('errors.routines.notFound', { id }))
    return routine
  }

  private save(): void {
    writeFileSync(this.deps.file, JSON.stringify({ routines: this.routines }, null, 2))
  }
}
