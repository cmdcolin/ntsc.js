// Black-box recorder for the freeze that takes the tab with it.
//
// When the tab wedges there is no console left to read and no reload that
// recovers it — the only way out is closing the tab, which throws away every
// breadcrumb the loop logged. So the interesting state also goes to
// localStorage, written from the watchdog interval: the one timer still running
// when rAF, the compositor and the paint pipeline have all stopped. Whatever
// the frozen session managed to write is read back and printed by the next one.
//
// `window.vfTrace()` dumps the previous session's trace on demand.

const KEY = 'ntsc.trace'
const MAX = 200
// Steady-state writes are rate-limited to this. A serialize + localStorage write
// is main-thread work, and the recorder must not be a reason the picture
// hitches; the events that actually matter force a write regardless, so the only
// thing this delays is a routine beat.
const FLUSH_MS = 15000

// One event per line, `ms|tag|info`, so the whole ring stays a small string
// rather than a few hundred objects re-serialized every flush.
type Line = string

interface Session {
  at: number
  ua: string
  lines: Line[]
}

class Trace {
  private lines: Line[] = []
  private t0 = performance.now()
  private lastBeat = ''
  private lastFlush = 0
  private dirty = false

  add(tag: string, info = ''): void {
    this.lines.push(`${Math.round(performance.now() - this.t0)}|${tag}|${info}`)
    if (this.lines.length > MAX) this.lines.splice(0, this.lines.length - MAX)
    this.dirty = true
  }

  // Per-watchdog state sample. `signature` is the qualitative state and is all
  // that's compared, so a healthy session recording 60 fps every two seconds
  // writes one line, not one per beat — the frame counter in `detail` would
  // otherwise make every beat look new and fill the ring with noise.
  beat(signature: string, detail: string): void {
    if (signature !== this.lastBeat) {
      this.lastBeat = signature
      this.add('beat', `${signature} ${detail}`)
    }
  }

  // `force` is for the events worth a synchronous write on the spot — a stall, a
  // GPU strike, a lifecycle transition — because the next frame may never
  // return. Routine beats take the rate-limited path instead.
  flush(force = false): void {
    const now = performance.now()
    if (this.dirty && (force || now - this.lastFlush > FLUSH_MS)) {
      this.dirty = false
      this.lastFlush = now
      try {
        const session: Session = {
          at: Date.now(),
          ua: navigator.userAgent,
          lines: this.lines,
        }
        localStorage.setItem(KEY, JSON.stringify(session))
      } catch {
        // Quota, or a context with no DOM at all (the loop's unit tests); the
        // live console still has everything.
      }
    }
  }
}

export const trace = new Trace()

// The trace a previous session left behind, or null if there is none.
export function previousTrace(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    return isSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isSession(v: unknown): v is Session {
  return (
    typeof v === 'object' &&
    v !== null &&
    'lines' in v &&
    Array.isArray((v).lines)
  )
}

// Print the previous session's tail. Called once at startup so a freeze that
// forced a tab close leaves its evidence in the next tab's console.
export function reportPreviousTrace(): void {
  const prev = previousTrace()
  if (prev !== null) {
    const ended = new Date(prev.at).toLocaleTimeString()
    const stalled = prev.lines.some(l => l.includes('|stall|'))
    console.log(
      `[trace] previous session ended ${ended}, ${prev.lines.length} events${stalled ? ' — INCLUDES AN rAF STALL' : ''}. window.vfTrace() for the full log.`,
    )
    if (stalled) console.log(prev.lines.slice(-40).join('\n'))
  }
}

declare global {
  interface Window {
    vfTrace?: () => void
  }
}

// Guarded so importing the loop under a bare node test environment doesn't need
// a DOM.
if (typeof window !== 'undefined') {
  window.vfTrace = () => {
    const prev = previousTrace()
    console.log(
      prev === null ? '[trace] nothing recorded' : prev.lines.join('\n'),
    )
  }
}
