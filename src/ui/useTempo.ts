import { useRef, useState } from 'react'

import { readJSON, writeJSON } from './storage'

// Where a beat comes from, for everything in the panel that can lock to one.
//
// It used to come from exactly one place: MIDI clock on the wire. That is the
// right source when there is one — it is the only one that stays in step with
// whatever is making the sound — but it made the ♩ a control that did nothing
// at all on a machine with no MIDI gear plugged into it, which is most of them.
// So the clock stays authoritative and a hand-set tempo sits underneath it: the
// lock is the same lock, and what it reads is whichever of the two is there.
const TEMPO_STORE = 'video_feedback_tempo'

// What asking for a beat with nothing to go on gets you. 120 rather than the
// last-seen clock tempo: a number the ♩ can be reasoned about from beats the
// alternative, which is a tempo restored from a session whose music is gone.
export const DEFAULT_BPM = 120
const BPM_MIN = 20
const BPM_MAX = 300

// Taps further apart than this start the count over rather than extending it.
// At 2s a gap is 30 BPM — slower than anything anyone taps, and much more
// likely to be "went away and came back" than a beat.
const TAP_GAP_MAX_MS = 2000
// How many gaps the estimate averages over. Four is enough to settle the
// jitter out of a hand and short enough that a tempo change is followed rather
// than diluted.
const TAP_GAPS = 4

const clampBpm = (v: number) => Math.min(BPM_MAX, Math.max(BPM_MIN, v))

const loadManual = (): number | null => {
  const v = readJSON<unknown>(TEMPO_STORE, null)
  return typeof v === 'number' && Number.isFinite(v) ? clampBpm(v) : null
}

// The tempo a run of taps describes, or null before there are two of them to
// make a gap. Averaged across the whole window in one division rather than gap
// by gap — same answer, and it cannot drift with the rounding.
//
// Pure, and exported for its own test: this is the one piece of tempo handling
// with arithmetic in it that a browser is a bad place to find out is wrong.
export function bpmFromTaps(times: readonly number[]): number | null {
  if (times.length < 2) return null
  const span = times[times.length - 1] - times[0]
  if (span <= 0) return null
  // To 0.1 BPM, which is what the readout shows and what MIDI clock is rounded
  // to as well — a tap that stored 128.03 would render as 128.0 and then not
  // round-trip through the field it is shown in.
  return clampBpm(Math.round(((60000 * (times.length - 1)) / span) * 10) / 10)
}

export interface Tempo {
  // What anything locked to the beat should read: the clock while one is
  // running, the hand-set tempo otherwise, null when there is neither.
  bpm: number | null
  // Straight off the wire, null the moment the ticks stop. Kept separate so the
  // MIDI section can go on reporting the wire honestly ("no signal") rather
  // than showing a hand-set number as if it had arrived from somewhere.
  clockBpm: number | null
  // The hand-set one, whether or not a clock is currently covering it.
  manual: number | null
  setManual: (bpm: number) => void
  // Register a tap. Two of them is a tempo; the run resets after a long gap.
  tap: () => void
  // Called by anything asking to lock to the beat: with no tempo from any
  // source it puts one there rather than leaving the lock inert, on the rule
  // the bay already follows for patching into a frozen board — asking for the
  // thing is unambiguous, so the ask wins. A no-op once a tempo exists, so it
  // can never overwrite a clock or a tapped-in count.
  ensure: () => void
}

export function useTempo(clockBpm: number | null): Tempo {
  const [manual, setManualState] = useState<number | null>(loadManual)
  // A run of taps, in performance.now() ms. A ref rather than state: nothing
  // renders from the run itself, only from the tempo it settles on, and a
  // re-render per tap would put the whole panel through a rebuild on a gesture
  // whose whole job is to be beaten quickly.
  const taps = useRef<number[]>([])

  const write = (v: number) => {
    writeJSON(TEMPO_STORE, v)
    setManualState(v)
  }

  return {
    bpm: clockBpm ?? manual,
    clockBpm,
    manual,
    setManual: bpm => {
      if (Number.isFinite(bpm)) write(clampBpm(bpm))
    },
    tap: () => {
      const now = performance.now()
      const run = taps.current
      const stale = run.length > 0 && now - run[run.length - 1] > TAP_GAP_MAX_MS
      // One more than the gaps: N taps make N-1 of them.
      const next = [...(stale ? [] : run), now].slice(-(TAP_GAPS + 1))
      taps.current = next
      const bpm = bpmFromTaps(next)
      if (bpm !== null) write(bpm)
    },
    ensure: () => {
      if (clockBpm === null && manual === null) write(DEFAULT_BPM)
    },
  }
}
