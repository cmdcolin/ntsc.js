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

import { sessionStore } from './env'

const KEY = 'ntsc.trace'
const MAX = 200
// How many sessions to keep, this one included. One slot was not enough, and
// the reason is circular: a freeze that survives a reload is investigated *by
// reloading*, and with a single slot the second reload overwrote the trace of
// the session that actually broke with nine lines saying "I loaded, I got no
// frames, I quit". The evidence and the act of looking for it were the same
// key. Only the first reload after a freeze printed anything worth reading.
const SESSIONS = 5
// Consecutive sessions that never received a single animation frame. It lives
// outside the ring because it is the one fact worth knowing *before* the two
// seconds it takes the watchdog to notice: a run longer than one says the fault
// outlived a document, which is the whole difference between "reload it" and
// "this tab is gone, open another".
const FRAMELESS_KEY = 'ntsc.frameless'
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
  // The sessions that ended before this one, snapshotted the first time they
  // are asked for. Taking the snapshot once is what keeps a session from ever
  // reading itself back as its own predecessor after its first flush.
  private earlier: Session[] | null = null

  history(): Session[] {
    this.earlier ??= readSessions()
    return this.earlier
  }

  // This session so far, for `window.vfTrace()` — a freeze worth looking at is
  // usually still on screen, and having to reload to read the recording is how
  // the single-slot version destroyed its own evidence.
  live(): Line[] {
    return this.lines
  }

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
    const store = sessionStore()
    // Nowhere to write: a worker has no localStorage, and neither do the unit
    // tests. Leaving before serializing, rather than building the whole ring
    // into a string and handing it to nothing — every forced flush is a stall, a
    // GPU strike or a lifecycle transition, so this is the path that runs when
    // the app is already in trouble. It also leaves `dirty` set, which is the
    // truth: those lines have not been written anywhere.
    if (store === null) return
    const now = performance.now()
    if (this.dirty && (force || now - this.lastFlush > FLUSH_MS)) {
      this.dirty = false
      this.lastFlush = now
      const session: Session = {
        at: Date.now(),
        ua: navigator.userAgent,
        lines: this.lines,
      }
      const all = [...this.history(), session].slice(-SESSIONS)
      try {
        store.setItem(KEY, JSON.stringify(all))
      } catch {
        // Quota. Retreat to this session alone rather than lose the write
        // entirely — the history is worth keeping, but not at the price of the
        // recording being made right now.
        try {
          store.setItem(KEY, JSON.stringify([session]))
        } catch {
          // Nowhere left to go; the live console still has everything.
        }
      }
    }
  }
}

// Consecutive sessions that never saw an animation frame. Read at boot, before
// there is anything else to go on.
export function framelessStarts(): number {
  const raw = sessionStore()?.getItem(FRAMELESS_KEY) ?? null
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// Called once per session, when the loop concludes it has never been ticked.
// Returns the new run length.
export function recordFramelessStart(): number {
  const n = framelessStarts() + 1
  try {
    sessionStore()?.setItem(FRAMELESS_KEY, String(n))
  } catch {
    // Quota; the count is a convenience, not the diagnosis.
  }
  return n
}

// The first animation frame of a healthy session ends the run. Guarded so the
// overwhelming majority of loads — the ones with nothing to clear — don't take
// a synchronous localStorage write on their first frame.
export function clearFramelessStarts(): void {
  if (framelessStarts() > 0) sessionStore()?.removeItem(FRAMELESS_KEY)
}

export const trace = new Trace()

// Every session still in the store, oldest first.
function readSessions(): Session[] {
  try {
    const raw = sessionStore()?.getItem(KEY) ?? null
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    // A bare object is what the single-slot version wrote. Adopt it rather than
    // discard the one recording a freeze may already have left behind.
    if (isSession(parsed)) return [parsed]
    return Array.isArray(parsed) ? parsed.filter(isSession) : []
  } catch {
    return []
  }
}

// The trace the session immediately before this one left behind, or null if
// there is none.
export function previousTrace(): Session | null {
  return trace.history().at(-1) ?? null
}

function isSession(v: unknown): v is Session {
  return (
    typeof v === 'object' &&
    v !== null &&
    'lines' in v &&
    Array.isArray(v.lines)
  )
}

// Print the previous session's tail. Called once at startup so a freeze that
// forced a tab close leaves its evidence in the next tab's console.
export function reportPreviousTrace(): void {
  // Ahead of the trace, because it is the one thing that can be said before the
  // watchdog has had its two seconds — and on the load where it matters it is
  // also the only line the user needs.
  const frameless = framelessStarts()
  if (frameless > 0) {
    console.error(
      `[trace] the last ${frameless} session${frameless === 1 ? '' : 's'} in this tab never received a single animation frame. ` +
        (frameless === 1
          ? 'If this one does the same, the fault has outlived a document and reloading will not clear it.'
          : 'The fault has outlived a document, so reloading cannot clear it — open this URL in a new tab instead.'),
    )
  }
  const history = trace.history()
  const prev = history.at(-1)
  if (prev !== undefined) {
    const ended = new Date(prev.at).toLocaleTimeString()
    const stalled = prev.lines.some(l => l.includes('|stall|'))
    console.log(
      `[trace] previous session ended ${ended}, ${prev.lines.length} events${stalled ? ' — INCLUDES AN rAF STALL' : ''}. ${history.length} session${history.length === 1 ? '' : 's'} kept; window.vfTrace() for all of them.`,
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
    // Oldest first, this session last and labelled as still running. A freeze
    // that survives reloads is read across sessions, not within one — which
    // session was the last healthy one is the question, and it cannot be
    // answered from a single recording.
    const past = trace
      .history()
      .map(
        s =>
          `--- session ended ${new Date(s.at).toLocaleTimeString()} (${s.lines.length} events) ---\n${s.lines.join('\n')}`,
      )
    const now = `--- this session, still running (${trace.live().length} events) ---\n${trace.live().join('\n')}`
    console.log([...past, now].join('\n\n'))
  }
}
