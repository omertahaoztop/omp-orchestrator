import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { setTimeout as sleep } from 'timers/promises'
import { t } from '../shared/i18n'
import type { PiExtensionUiRequest } from '../shared/ipc-contracts'

export interface MatrixConfig {
  homeserver: string
  roomId: string
  accessToken: string
}

interface RoomEvent {
  event_id: string
  sender: string
  type: string
  content?: { body?: string; 'm.relates_to'?: { 'm.in_reply_to'?: { event_id?: string } } }
}
interface Sync {
  next_batch: string
  rooms?: { join?: Record<string, { timeline?: { events?: RoomEvent[] } }> }
}

const SYNC_WAIT_MS = 30_000
const RETRY_MS = 5_000
const YES = new Set(['y', 'yes', 'e', 'evet'])
const NO = new Set(['n', 'no', 'h', 'hayir', 'hayır'])

/** matrix.json names the room; the token comes from PI_DESKTOP_MATRIX_TOKEN or the matrix-token file, never from matrix.json. */
export function loadMatrixConfig(dir: string, env: NodeJS.ProcessEnv = process.env): MatrixConfig | undefined {
  const file = join(dir, 'matrix.json')
  if (!existsSync(file)) return undefined
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const record: Record<string, unknown> = typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}
  const field = (key: string): string => (typeof record[key] === 'string' ? record[key] : '')
  const tokenFile = join(dir, 'matrix-token')
  const accessToken = env.PI_DESKTOP_MATRIX_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '')
  if (!field('homeserver') || !field('roomId') || !accessToken) {
    throw new Error('matrix.json needs homeserver and roomId, plus a token in PI_DESKTOP_MATRIX_TOKEN or matrix-token')
  }
  return { homeserver: field('homeserver').replace(/\/+$/, ''), roomId: field('roomId'), accessToken }
}

export function questionMessage(request: PiExtensionUiRequest, project: string): string {
  // OMP's ask tool reaches us as a select whose labels are already numbered.
  const numbered = (options: string[]): string[] =>
    options.map((option, index) => (option.startsWith(`${index + 1}. `) ? option : `${index + 1}. ${option}`))
  const lines = [t('matrix.waiting', { project })]
  for (const part of request.questions ?? []) {
    lines.push('', part.question, ...numbered(part.options.map((option) => option.label)))
  }
  if (!request.questions?.length) {
    lines.push('', ...[request.title, request.message].filter((line): line is string => !!line), ...numbered(request.options ?? []))
  }
  lines.push('', t('matrix.howTo'))
  return lines.join('\n')
}

/** Element may prepend a "> quoted" fallback to replies; only the user's own words are the answer. */
export function replyWords(body: string): string[] {
  return body.split('\n').filter((line) => !line.startsWith('>')).join(' ').split(/\s+/).filter(Boolean)
}

function matchOption(options: string[], word: string): string | undefined {
  if (/^\d+$/.test(word)) return options[Number(word) - 1]
  return options.find((option) => option.toLocaleLowerCase('tr') === word.toLocaleLowerCase('tr'))
}

/** Turns reply words into the extension-UI response the asking Pi expects. */
export function toResponse(request: PiExtensionUiRequest, words: string[]): Record<string, unknown> {
  const text = words.join(' ').trim()
  switch (request.method) {
    case 'confirm': {
      const word = text.toLocaleLowerCase('tr')
      if (YES.has(word)) return { confirmed: true }
      if (NO.has(word)) return { confirmed: false }
      throw new Error(t('matrix.answerYesNo'))
    }
    case 'select': {
      const value = matchOption(request.options ?? [], text)
      if (!value) throw new Error(t('matrix.notAnOption', { answer: text }))
      return { value }
    }
    case 'ask': {
      const [only, ...rest] = request.questions ?? []
      if (!only || rest.length > 0) throw new Error(t('matrix.severalParts'))
      const labels = only.options.map((option) => option.label)
      const selected: string[] = []
      const custom: string[] = []
      for (const word of words) {
        const label = matchOption(labels, word)
        if (label) selected.push(label)
        else custom.push(word)
      }
      if (!only.multi && selected.length > 1) throw new Error(t('matrix.pickOne'))
      const customInput = custom.join(' ').trim()
      return { answers: [{ id: only.id, selectedOptions: selected, ...(customInput ? { customInput } : {}) }] }
    }
    default:
      return { value: text }
  }
}

export interface MatrixBridgeDeps {
  config: MatrixConfig
  /** Blocking prompts waiting for an answer, with their project name. */
  pending(): Array<{ request: PiExtensionUiRequest; project: string }>
  respond(id: string, response: Record<string, unknown>): void
  log(message: string): void
}

export interface MatrixBridge {
  /** Posts newly waiting prompts and forgets answered ones; call on every pending-prompt change. */
  syncQuestions(): void
  post(body: string): void
  stop(): void
}

/** Posts waiting prompts to one room and turns replies there into answers. */
export function startMatrixBridge(deps: MatrixBridgeDeps): MatrixBridge {
  const { config } = deps
  const asked = new Map<string, string>()
  const posted = new Set<string>()
  const abort = new AbortController()
  const room = encodeURIComponent(config.roomId)
  let txn = 0

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${config.homeserver}/_matrix/client/v3${path}`, {
      method,
      headers: { authorization: `Bearer ${config.accessToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    })
    if (!res.ok) throw new Error(`matrix ${method} ${path.split('?')[0]} answered ${res.status}`)
    return (await res.json()) as T
  }
  const send = (body: string, replyTo?: string): Promise<{ event_id: string }> =>
    call('PUT', `/rooms/${room}/send/m.room.message/pi-desktop-${Date.now()}-${txn++}`, {
      msgtype: 'm.text',
      body,
      ...(replyTo ? { 'm.relates_to': { 'm.in_reply_to': { event_id: replyTo } } } : {}),
    })
  const warn = (error: unknown): void => {
    if (!abort.signal.aborted) deps.log(error instanceof Error ? error.message : String(error))
  }

  const syncQuestions = (): void => {
    const pending = deps.pending()
    const open = new Set(pending.map(({ request }) => request.id))
    for (const id of posted) if (!open.has(id)) posted.delete(id)
    for (const [eventId, id] of asked) if (!open.has(id)) asked.delete(eventId)
    for (const { request, project } of pending) {
      if (posted.has(request.id)) continue
      posted.add(request.id)
      send(questionMessage(request, project)).then(({ event_id }) => asked.set(event_id, request.id), (error) => {
        posted.delete(request.id)
        warn(error)
      })
    }
  }

  const handle = async (event: RoomEvent): Promise<void> => {
    const words = replyWords(event.content?.body ?? '')
    if (words.length === 0) return
    const pending = deps.pending().map(({ request }) => request)
    const open = [...new Set(asked.values())].filter((id) => pending.some((request) => request.id === id))
    const replyTo = event.content?.['m.relates_to']?.['m.in_reply_to']?.event_id
    const target = replyTo ? asked.get(replyTo) : open.length === 1 ? open[0] : undefined
    const request = pending.find((item) => item.id === target)
    if (!request) {
      await send(open.length > 0 ? t('matrix.which') : t('matrix.none'), event.event_id)
      return
    }
    try {
      deps.respond(request.id, toResponse(request, words))
      await send(t('matrix.sent'), event.event_id)
    } catch (error) {
      await send(t('matrix.failed', { error: error instanceof Error ? error.message : String(error) }), event.event_id)
    }
  }

  const loop = async (): Promise<void> => {
    const filter = encodeURIComponent(JSON.stringify({
      presence: { types: [] },
      account_data: { types: [] },
      room: { rooms: [config.roomId], timeline: { types: ['m.room.message'] } },
    }))
    let self = ''
    let since: string | undefined
    while (!abort.signal.aborted) {
      try {
        if (!self) self = (await call<{ user_id: string }>('GET', '/account/whoami')).user_id
        const wait = since ? `&timeout=${SYNC_WAIT_MS}&since=${since}` : '&timeout=0'
        const sync = await call<Sync>('GET', `/sync?filter=${filter}${wait}`)
        // The first sync only marks where we start; old room history is not a reply.
        const events = since ? (sync.rooms?.join?.[config.roomId]?.timeline?.events ?? []) : []
        since = sync.next_batch
        for (const event of events) if (event.sender !== self && event.type === 'm.room.message') await handle(event)
      } catch (error) {
        warn(error)
        // A homeserver restart must not end the bridge; retry after a pause instead of spinning.
        await sleep(RETRY_MS, undefined, { signal: abort.signal }).catch(() => {})
      }
    }
  }
  void loop()

  return {
    syncQuestions,
    post: (body) => void send(body).catch(warn),
    stop: () => abort.abort(),
  }
}
