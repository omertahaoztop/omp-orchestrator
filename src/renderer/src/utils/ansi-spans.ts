export interface AnsiSpan {
  text: string
  color?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
}

interface AnsiStyle {
  color?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
}

const BASIC_COLORS = [
  '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
]

function xterm256(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined
  if (n < 16) return BASIC_COLORS[n]
  if (n >= 232) {
    const level = 8 + (n - 232) * 10
    return `rgb(${level}, ${level}, ${level})`
  }
  const cube = n - 16
  const step = (v: number): number => (v === 0 ? 0 : 55 + v * 40)
  return `rgb(${step(Math.floor(cube / 36))}, ${step(Math.floor(cube / 6) % 6)}, ${step(cube % 6)})`
}

function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  let next = { ...style }
  for (let i = 0; i < params.length; i++) {
    const code = params[i]
    if (code === 0) next = {}
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 22) { next.bold = false; next.dim = false }
    else if (code === 23) next.italic = false
    else if (code === 39) next.color = undefined
    else if (code >= 30 && code <= 37) next.color = BASIC_COLORS[code - 30]
    else if (code >= 90 && code <= 97) next.color = BASIC_COLORS[code - 90 + 8]
    else if (code === 38 && params[i + 1] === 2 && i + 4 < params.length) {
      next.color = `rgb(${params[i + 2]}, ${params[i + 3]}, ${params[i + 4]})`
      i += 4
    } else if (code === 38 && params[i + 1] === 5 && i + 2 < params.length) {
      next.color = xterm256(params[i + 2])
      i += 2
    } else if ((code === 48 || code === 58) && params[i + 1] === 2) i += 4
    else if ((code === 48 || code === 58) && params[i + 1] === 5) i += 2
  }
  return next
}

/**
 * Splits terminal text into styled runs. Foreground color, bold, dim and
 * italic survive; backgrounds and OSC 8 hyperlinks are dropped.
 */
export function ansiSpans(text: string): AnsiSpan[] {
  // eslint-disable-next-line no-control-regex -- drop OSC 8 hyperlink sequences
  const input = text.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  const spans: AnsiSpan[] = []
  let style: AnsiStyle = {}
  let last = 0
  const push = (chunk: string): void => {
    if (!chunk) return
    const prev = spans[spans.length - 1]
    if (prev && prev.color === style.color && prev.bold === style.bold && prev.dim === style.dim && prev.italic === style.italic) {
      prev.text += chunk
    } else {
      spans.push({ text: chunk, ...style })
    }
  }
  // eslint-disable-next-line no-control-regex -- CSI SGR sequences
  for (const match of input.matchAll(/\x1b\[([0-9;]*)m/g)) {
    push(input.slice(last, match.index))
    const params = match[1] === '' ? [0] : match[1].split(';').map((p) => (p === '' ? 0 : Number(p)))
    style = applySgr(style, params)
    last = match.index + match[0].length
  }
  push(input.slice(last))
  return spans
}
