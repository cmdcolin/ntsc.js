import { describe, expect, it } from 'vitest'

import { MORPH_SECONDS } from './morph'
import { PROFILE_NAME_MAX } from './savedProfiles'
import {
  CLIP_HOLD,
  DEFAULT_HOLD,
  EMPTY_STRIP,
  HOLD_BARS,
  derivedLabel,
  named,
  renameRow,
  MAX_DRIFT,
  STOPPED,
  TRANSITION_RING,
  addRow,
  advance,
  cycleArrive,
  cycleHold,
  cycleTransition,
  duplicateRow,
  fire,
  fireEffects,
  holdFrames,
  holdLabel,
  holdProgress,
  learnClipSeconds,
  moveRow,
  nextRow,
  prerollFor,
  readStrip,
  removeRow,
  rowFill,
  rowRuntime,
  rowLabel,
  seedFor,
  start,
  stepArrive,
  stepHold,
  stepTransition,
  stripSeconds,
  transitionLabel,
  walking,
} from './strip'
import { TRANSITION_NAMES, transitionOf } from './transitions'

import type { Clock, Effect, Hold, Row, Strip, Walk } from './strip'

// 120bpm at 60fps: one bar is 2 seconds is 120 frames, so a 4-bar hold is 480.
// Chosen so every expectation below is a round number a reader can check by
// hand rather than by re-running the arithmetic this file is testing.
const CLOCK = (frame: number): Clock => ({ frame, bpm: 120, fps: 60 })

const row = (over: Partial<Row> = {}): Row => ({
  id: 'r1',
  name: '',
  session: 'set=&mod=',
  clip: null,
  fill: { kind: 'clip' },
  hold: { bars: 4, drift: 0 },
  arrive: { seconds: 1, transition: null },
  ...over,
})

const strip = (rows: Row[], over: Partial<Strip> = {}): Strip => ({
  rows,
  seed: 42,
  loop: true,
  ...over,
})

describe('seedFor', () => {
  it('gives the same seed for the same row on the same lap', () => {
    expect(seedFor(42, 3, 1)).toBe(seedFor(42, 3, 1))
  })

  // The three axes have to separate, or a strip's rolls repeat in a pattern the
  // ear picks up long before the eye does: row 2 rolling what row 1 rolled, or
  // lap two playing back lap one.
  it('separates the seed, the row and the lap', () => {
    const seeds = new Set([
      seedFor(1, 0, 0),
      seedFor(2, 0, 0),
      seedFor(1, 1, 0),
      seedFor(1, 0, 1),
      // The transposition that a plain sum would collapse.
      seedFor(1, 2, 1),
      seedFor(1, 1, 2),
    ])
    expect(seeds.size).toBe(6)
  })

  it('stays a positive 32-bit integer, so it survives JSON and a URL', () => {
    for (const s of [0, 1, -7, 2 ** 31, 0x7fffffff]) {
      const out = seedFor(s, 5, 2)
      expect(Number.isInteger(out)).toBe(true)
      expect(out).toBeGreaterThanOrEqual(0)
      expect(out).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('holdFrames', () => {
  it('turns bars into frames at the tempo', () => {
    expect(holdFrames({ bars: 4, drift: 0 }, CLOCK(0), 1)).toBe(480)
    expect(holdFrames({ bars: 1, drift: 0 }, CLOCK(0), 1)).toBe(120)
    expect(
      holdFrames({ bars: 4, drift: 0 }, { frame: 0, bpm: 60, fps: 60 }, 1),
    ).toBe(960)
  })

  it('waits for a hand when there are no bars', () => {
    expect(holdFrames({ bars: null, drift: 0.5 }, CLOCK(0), 1)).toBeNull()
  })

  // The taste call, as a testable statement: a drifted hold lands somewhere
  // inside its span and is not the same somewhere every time.
  it('drifts inside the fraction asked for, and no further', () => {
    const lengths = new Set<number>()
    for (let seed = 1; seed < 60; seed++) {
      const n = holdFrames({ bars: 4, drift: 0.25 }, CLOCK(0), seed)
      expect(n).not.toBeNull()
      expect(n).toBeGreaterThanOrEqual(360)
      expect(n).toBeLessThanOrEqual(600)
      lengths.add(n as number)
    }
    expect(lengths.size).toBeGreaterThan(30)
  })

  it('is exact at zero drift, which is the per-row beat-lock', () => {
    for (let seed = 1; seed < 20; seed++) {
      expect(holdFrames({ bars: 2, drift: 0 }, CLOCK(0), seed)).toBe(240)
    }
  })

  it('clamps a drift past the maximum rather than honouring it', () => {
    const wild = holdFrames({ bars: 4, drift: 9 }, CLOCK(0), 7)
    const capped = holdFrames({ bars: 4, drift: MAX_DRIFT }, CLOCK(0), 7)
    expect(wild).toBe(capped)
  })

  // A hold of zero frames would fire every row in the strip on one tick, which
  // reads as the strip having emptied itself rather than as a fast hold.
  it('never resolves to nothing at a tempo fast enough to round to zero', () => {
    const n = holdFrames(
      { bars: 0.001, drift: 0 },
      { frame: 0, bpm: 300, fps: 60 },
      1,
    )
    expect(n).toBeGreaterThanOrEqual(1)
  })
})

describe('fireEffects', () => {
  it('puts the session up and stops there for a clip row', () => {
    expect(fireEffects(row({ session: 'set=vSize:0.5' }), 3)).toEqual([
      { kind: 'session', session: 'set=vSize:0.5', seconds: 1 },
    ])
  })

  // The whole reason `RowClip` exists: a row captured over a shelf clip has to
  // put that clip back, and the session string cannot say which one —
  // `writeProfileParams` drops every source mode a URL cannot name.
  it('names its clip after putting the session up', () => {
    const out = fireEffects(
      row({
        session: 'set=vSize:0.5',
        clip: { id: 'c7', name: 'surf.mp4', seconds: 0 },
      }),
      3,
    )
    expect(out).toEqual([
      { kind: 'session', session: 'set=vSize:0.5', seconds: 1 },
      { kind: 'clip', id: 'c7', name: 'surf.mp4' },
    ])
  })

  // After the session, for the same reason the fillings are: a session may
  // carry a `?src=`, and the row's own clip is the more specific answer.
  it('puts the clip on top of the session, never under it', () => {
    const out = fireEffects(
      row({
        session: 'src=sweep',
        clip: { id: 'c1', name: 'a.mp4', seconds: 0 },
      }),
      3,
    )
    expect(out.map(e => e.kind)).toEqual(['session', 'clip'])
  })

  // A transition row defers its *whole* step, clip included — the rule the
  // fault variant already carries for the session and the fillings.
  it('defers the clip to the cut on a transition row', () => {
    const out = fireEffects(
      row({
        clip: { id: 'c2', name: 'b.mp4', seconds: 0 },
        arrive: { seconds: 0, transition: 'collapse' },
      }),
      3,
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('fault')
    if (out[0].kind === 'fault')
      expect(out[0].atCut.map(e => e.kind)).toEqual(['session', 'clip'])
  })

  // Ordered, and the order is the point: both of the other fillings are
  // departures *from* what the session named, so the session has to land first.
  it('rolls after putting the session up', () => {
    const out = fireEffects(
      row({ fill: { kind: 'roll', origin: 'archive' } }),
      9,
    )
    expect(out.map(e => e.kind)).toEqual(['session', 'roll'])
    expect(out[1]).toEqual({ kind: 'roll', origin: 'archive', seed: 9 })
  })

  it('jitters after putting the session up', () => {
    const out = fireEffects(
      row({ fill: { kind: 'jitter', amount: 'wild' } }),
      9,
    )
    expect(out.map(e => e.kind)).toEqual(['session', 'jitter'])
    expect(out[1]).toEqual({ kind: 'jitter', amount: 'wild', seed: 9 })
  })

  it('carries the arrival, so a cut and a morph stay distinguishable', () => {
    const out = fireEffects(
      row({ arrive: { seconds: 0, transition: null } }),
      1,
    )
    expect(out[0]).toMatchObject({ kind: 'session', seconds: 0 })
  })

  // A transition row asks for a *fault* rather than a step, and the difference
  // is when the step lands: plainly it is done now, and behind a fault it is
  // done on the frame the engine says the picture is least legible. Two verbs
  // rather than one with a mode — see the `Effect` union.
  it('arrives behind a fault when the row names a transition', () => {
    const out = fireEffects(
      row({
        session: 'src=sweep',
        arrive: { seconds: 4, transition: 'collapse' },
      }),
      1,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      kind: 'fault',
      transition: 'collapse',
      atCut: [{ kind: 'session', session: 'src=sweep', seconds: 4 }],
    })
  })

  // The look still glides while the fault does the cutting — the pairing
  // _Transitions_ asks for — so the morph rides along rather than being
  // replaced by the transition.
  it('carries the look’s own arrival through a transition', () => {
    const out = fireEffects(
      row({ arrive: { seconds: 8, transition: 'roll' } }),
      1,
    )
    expect(out[0]).toMatchObject({
      kind: 'fault',
      atCut: [{ kind: 'session', seconds: 8 }],
    })
  })

  // A row built by hand rather than read through the codec — a harness, a test,
  // an object literal — has `undefined` where the codec would have put null,
  // and `undefined !== null`. Tested against null alone this handed the engine
  // an undefined transition; `scripts/rendercheck.mjs` found it by building a
  // rundown the way a caller naturally would.
  it('arrives plainly when the transition is missing rather than null', () => {
    const bare = { ...row(), arrive: { seconds: 1 } } as Row
    expect(fireEffects(bare, 1)[0]).toMatchObject({ kind: 'session' })
  })

  it('and when it names something this build’s shelf does not have', () => {
    const odd = row({ arrive: { seconds: 1, transition: 'dissolve' as never } })
    expect(fireEffects(odd, 1)[0]).toMatchObject({ kind: 'session' })
  })

  // The departure rides the cut with the session rather than beside it, and
  // this is the assertion that says so. It used to read `['fault', 'roll']` —
  // the right *order* in a list whose order had stopped meaning time, since the
  // roll fired at once and the session waited. What that cost is in
  // `stripRun.test.ts`: the engine's own re-roll, kicked off by the late
  // session, beat the seeded pick and the take stopped reproducing.
  it('keeps the whole step behind the fault, in the order it would have run', () => {
    const out = fireEffects(
      row({
        fill: { kind: 'roll', origin: 'commons' },
        arrive: { seconds: 1, transition: 'dub' },
      }),
      9,
    )
    expect(out.map(e => e.kind)).toEqual(['fault'])
    expect(out[0]).toMatchObject({
      atCut: [
        { kind: 'session' },
        { kind: 'roll', origin: 'commons', seed: 9 },
      ],
    })
  })
})

describe('the transition ring', () => {
  it('steps through the shelf and back to a plain cut', () => {
    const seen: (string | null)[] = []
    let at: ReturnType<typeof cycleTransition> = null
    for (let i = 0; i < TRANSITION_RING.length; i++) {
      at = cycleTransition(at)
      seen.push(at)
    }
    expect(seen.at(-1)).toBeNull()
    expect(seen).toContain('collapse')
    expect(new Set(seen).size).toBe(TRANSITION_RING.length)
  })

  // A name off the ring — a hand-edited file, an older build's shelf — steps to
  // the head rather than sticking, which is the head being the plain cut.
  it('steps an unrecognised name to the plain cut', () => {
    expect(cycleTransition('dissolve' as never)).toBeNull()
  })

  // One character either way, which is what keeps the chip from resizing as the
  // ring steps under the pointer — and what keeps the ✕ inside a 190px card.
  it('reads as an arrow when there is no transition, and as the shelf’s glyph when there is', () => {
    expect(transitionLabel(null)).toBe('↷')
    expect(transitionLabel('collapse')).toBe(transitionOf('collapse')?.glyph)
    for (const name of TRANSITION_NAMES) {
      expect(Array.from(transitionLabel(name)), name).toHaveLength(1)
    }
  })

  // A name off a shelf this build does not have draws as the plain cut rather
  // than as the raw string, which would be both wrong and eight chips wide.
  it('draws an unknown name as the plain cut', () => {
    expect(transitionLabel('dissolve' as never)).toBe('↷')
  })

  it('steps one row only, and leaves the look’s arrival alone', () => {
    const s = strip([row({ id: 'a' }), row({ id: 'b' })])
    const out = stepTransition(s, 0)
    expect(out.rows[0].arrive.transition).toBe(TRANSITION_RING[1])
    expect(out.rows[0].arrive.seconds).toBe(s.rows[0].arrive.seconds)
    expect(out.rows[1].arrive.transition).toBeNull()
  })

  it('and the look’s arrival steps without disturbing the transition', () => {
    const s = stepTransition(strip([row()]), 0)
    const out = stepArrive(s, 0)
    expect(out.rows[0].arrive.transition).toBe(s.rows[0].arrive.transition)
  })
})

describe('start', () => {
  it('lands on the first row', () => {
    const { walk, effects } = start(
      strip([row(), row({ id: 'r2' })]),
      CLOCK(90),
    )
    expect(walk).toEqual({ row: 0, lap: 0, since: 90, frames: 480 })
    expect(effects).toHaveLength(1)
  })

  // A transport that says it is playing with nothing to play is the worse of
  // the two lies available here.
  it('stays stopped on an empty strip', () => {
    const { walk, effects } = start(strip([]), CLOCK(0))
    expect(walk).toEqual(STOPPED)
    expect(walking(walk)).toBe(false)
    expect(effects).toEqual([])
  })
})

describe('advance', () => {
  const two = strip([row(), row({ id: 'r2' })])

  it('does nothing while the hold is still running', () => {
    const { walk } = start(two, CLOCK(0))
    expect(advance(two, walk, CLOCK(1))).toBeNull()
    expect(advance(two, walk, CLOCK(479))).toBeNull()
  })

  it('fires the next row on the boundary frame', () => {
    const { walk } = start(two, CLOCK(0))
    const step = advance(two, walk, CLOCK(480))
    expect(step?.walk).toMatchObject({ row: 1, lap: 0, since: 480 })
  })

  it('does nothing at all while a row holds for a hand', () => {
    const held = strip([row({ hold: { bars: null, drift: 0 } }), row()])
    const { walk } = start(held, CLOCK(0))
    expect(advance(held, walk, CLOCK(100000))).toBeNull()
  })

  it('does nothing when stopped', () => {
    expect(advance(two, STOPPED, CLOCK(9999))).toBeNull()
  })

  // Late means the next row is late, not that the strip skips: a tick arriving
  // long after a boundary — a hidden tab, a slow frame, a coarse offline step —
  // must not fire three rows nobody saw in order to catch up.
  it('advances one row however late the tick is', () => {
    const { walk } = start(two, CLOCK(0))
    const step = advance(two, walk, CLOCK(100000))
    expect(step?.walk).toMatchObject({ row: 1, lap: 0 })
  })

  it('comes back round, on the next lap', () => {
    const first = start(two, CLOCK(0))
    const second = advance(two, first.walk, CLOCK(480))
    const third = advance(two, second?.walk as Walk, CLOCK(960))
    expect(third?.walk).toMatchObject({ row: 0, lap: 1 })
  })

  // Which is what gives an offline render a last frame.
  it('stops at the end when the strip does not loop', () => {
    const once = strip([row()], { loop: false })
    const { walk } = start(once, CLOCK(0))
    const step = advance(once, walk, CLOCK(480))
    expect(step?.walk).toEqual(STOPPED)
    expect(step?.effects).toEqual([])
  })

  // The list is editable under a running walk, so the row a walk is on can stop
  // existing between two ticks.
  it('recovers when the strip shrank out from under the walk', () => {
    const shrunk = strip([row()])
    const stale: Walk = { row: 7, lap: 0, since: 0, frames: 60 }
    const step = advance(shrunk, stale, CLOCK(60))
    expect(step?.walk).toMatchObject({ row: 0, lap: 1 })
  })
})

describe('fire', () => {
  const three = strip([row(), row({ id: 'r2' }), row({ id: 'r3' })])

  it('jumps to a row by hand', () => {
    const step = fire(three, STOPPED, 2, CLOCK(30))
    expect(step.walk).toMatchObject({ row: 2, since: 30 })
    expect(step.effects).toHaveLength(1)
  })

  it('re-fires the row already up, which is the retrigger', () => {
    const { walk } = start(three, CLOCK(0))
    const again = fire(three, walk, 0, CLOCK(200))
    expect(again.walk).toMatchObject({ row: 0, since: 200 })
    expect(again.effects).toHaveLength(1)
  })

  // A pad bound to row 7 of a strip that has since lost three rows should do
  // nothing, rather than fire whatever is now at the end.
  it('does nothing for a row that is not there', () => {
    const { walk } = start(three, CLOCK(0))
    for (const index of [-1, 3, 99]) {
      const step = fire(three, walk, index, CLOCK(500))
      expect(step.walk).toBe(walk)
      expect(step.effects).toEqual([])
    }
  })
})

describe('holdProgress', () => {
  it('runs 0 to 1 across the hold', () => {
    const { walk } = start(strip([row()]), CLOCK(0))
    expect(holdProgress(walk, CLOCK(0))).toBe(0)
    expect(holdProgress(walk, CLOCK(240))).toBe(0.5)
    expect(holdProgress(walk, CLOCK(480))).toBe(1)
    // Past the boundary the caller has not ticked yet; a bar drawn past its own
    // end is worse than one that sits full.
    expect(holdProgress(walk, CLOCK(9999))).toBe(1)
  })

  it('has nothing to draw when stopped or holding for a hand', () => {
    expect(holdProgress(STOPPED, CLOCK(10))).toBeNull()
    const held = strip([row({ hold: { bars: null, drift: 0 } })])
    const { walk } = start(held, CLOCK(0))
    expect(holdProgress(walk, CLOCK(10))).toBeNull()
  })
})

describe('rowFill', () => {
  it('reads a pool mode as a roll, through the sources own table', () => {
    expect(rowFill('src=wiki-random&set=')).toEqual({
      kind: 'roll',
      origin: 'commons',
    })
    expect(rowFill('src=ia-random&set=')).toEqual({
      kind: 'roll',
      origin: 'archive',
    })
  })

  it('reads anything else as a clip', () => {
    expect(rowFill('src=bars&set=')).toEqual({ kind: 'clip' })
    expect(rowFill('vurl=https://example/x.mp4')).toEqual({ kind: 'clip' })
    expect(rowFill('')).toEqual({ kind: 'clip' })
  })

  it('takes a jitter over whatever the session names', () => {
    expect(rowFill('src=wiki-random', 'gentle')).toEqual({
      kind: 'jitter',
      amount: 'gentle',
    })
  })
})

describe("a hold of 'clip'", () => {
  // The iMovie reading: a clip trimmed to three seconds is on screen for three
  // seconds, and the bar count has nothing to do with it.
  it('holds for the clip’s own length', () => {
    const r = row({
      hold: { bars: 'clip', drift: 0 },
      clip: { id: 'c1', name: 'a.mp4', seconds: 3 },
    })
    expect(holdFrames(r.hold, CLOCK(0), 1, rowRuntime(r))).toBe(180)
  })

  // The trim wins, which is the whole of what an in/out pair means: it says
  // which stretch plays, so it is also how long the row is up.
  it('a trimmed clip holds for the trim, not the file', () => {
    const r = row({
      hold: { bars: 'clip', drift: 0 },
      session: 'cuea=2,5',
      clip: { id: 'c1', name: 'a.mp4', seconds: 30 },
    })
    expect(rowRuntime(r)).toBe(3)
    expect(holdFrames(r.hold, CLOCK(0), 1, rowRuntime(r))).toBe(180)
  })

  // A cue marked and never closed has no span — the playhead runs on past it —
  // so it is not a trim and the clip's own length is still the answer.
  it('an open-ended cue is not a trim', () => {
    const r = row({
      session: 'cuea=2',
      clip: { id: 'c1', name: 'a.mp4', seconds: 30 },
    })
    expect(rowRuntime(r)).toBe(30)
  })

  // A rundown that silently stopped at a clip nobody had measured would read
  // as a broken transport, so an unknown runtime holds for bars instead.
  it('falls back to a bar count when nothing knows the length', () => {
    const r = row({ hold: { bars: 'clip', drift: 0 }, clip: null })
    expect(holdFrames(r.hold, CLOCK(0), 1, rowRuntime(r))).toBe(480)
  })

  it('never waits for a hand, which is a different setting', () => {
    const r = row({ hold: { bars: 'clip', drift: 0 } })
    expect(holdFrames(r.hold, CLOCK(0), 1, 0)).not.toBeNull()
  })

  it('says how long rather than what it is counting', () => {
    expect(holdLabel({ bars: 'clip', drift: 0 })).toBe('whole clip')
  })

  it('round-trips through the codec', () => {
    const original = strip([row({ id: 'a', hold: { bars: 'clip', drift: 0 } })])
    expect(readStrip(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  // A row that arrived as a picture holds for that picture; one captured off a
  // board with no clip on it is a look change, which has no length of its own.
  it('is what a clip row arrives on', () => {
    const withClip = addRow(EMPTY_STRIP, 'set=', {
      clip: { id: 'c3', name: 'n.mp4', seconds: 4 },
    })
    expect(withClip.rows[0].hold).toEqual(CLIP_HOLD)
    expect(addRow(EMPTY_STRIP, 'set=').rows[0].hold).toEqual(DEFAULT_HOLD)
  })
})

// What ⎙ renders, and the number that used to be ten seconds however long the
// piece was.
describe('how long a rundown runs', () => {
  const TEMPO = { bpm: 120, fps: 60 }

  it('is the sum of the holds', () => {
    const s = strip([
      row({ id: 'a', hold: { bars: 4, drift: 0 } }),
      row({ id: 'b', hold: { bars: 2, drift: 0 } }),
    ])
    expect(stripSeconds(s, TEMPO)).toBe(12)
  })

  it('counts a clip row as its picture', () => {
    const s = strip([
      row({
        id: 'a',
        hold: { bars: 'clip', drift: 0 },
        clip: { id: 'c1', name: 'a.mp4', seconds: 7 },
      }),
    ])
    expect(stripSeconds(s, TEMPO)).toBe(7)
  })

  // The whole of why the ＋ measures. A rundown of clips nobody had played was
  // eight bar counts wearing the word "clip", and this is that state.
  it('falls back to a bar count for a clip of unknown length', () => {
    const s = strip([
      row({
        id: 'a',
        hold: { bars: 'clip', drift: 0 },
        clip: { id: 'c1', name: 'a.mp4', seconds: 0 },
      }),
    ])
    expect(stripSeconds(s, TEMPO)).toBe(8)
  })

  // Open-ended rather than long: a row that waits for a hand has no length, so
  // neither does the rundown holding it, and a render told otherwise would cut
  // off wherever the guess ran out.
  it('cannot say when a row waits for a hand', () => {
    const s = strip([
      row({ id: 'a', hold: { bars: 4, drift: 0 } }),
      row({ id: 'b', hold: { bars: null, drift: 0 } }),
    ])
    expect(stripSeconds(s, TEMPO)).toBe(0)
    expect(stripSeconds(EMPTY_STRIP, TEMPO)).toBe(0)
  })

  // Bar-counted holds are bars, so the answer moves with the tempo — which is
  // why the tray reads it per render rather than storing it.
  it('follows the tempo', () => {
    const s = strip([row({ hold: { bars: 4, drift: 0 } })])
    expect(stripSeconds(s, { bpm: 60, fps: 60 })).toBe(16)
  })

  // Lap zero's numbers exactly, drift included: the length reported is the
  // length that will play, and reseeding moves both together.
  it('is the length the walk will actually draw', () => {
    const s = strip([row({ hold: { bars: 4, drift: MAX_DRIFT } })])
    const walked = start(s, CLOCK(0))
    expect(stripSeconds(s, TEMPO)).toBe((walked.walk.frames ?? 0) / 60)
    expect(stripSeconds({ ...s, seed: 7 }, TEMPO)).not.toBe(
      stripSeconds({ ...s, seed: 99 }, TEMPO),
    )
  })

  // One lap. A loop is a set going round; the piece is what gets rendered.
  it('does not multiply by the loop', () => {
    const s = strip([row({ hold: { bars: 4, drift: 0 } })])
    expect(stripSeconds({ ...s, loop: false }, TEMPO)).toBe(
      stripSeconds({ ...s, loop: true }, TEMPO),
    )
  })
})

describe('learning how long a clip is', () => {
  const unmeasured = (id: string, clip: string) =>
    row({ id, clip: { id: clip, name: `${clip}.mp4`, seconds: 0 } })

  // Keyed on the clip, not the row: pressing ＋ twice on one clip teaches both
  // rows from one measurement, and so does a duplicate made before it landed.
  it('teaches every row holding that clip', () => {
    const s = strip([
      unmeasured('a', 'c1'),
      unmeasured('b', 'c2'),
      unmeasured('c', 'c1'),
    ])
    const known = learnClipSeconds(s, 'c1', 12)
    expect(known.rows.map(r => r.clip?.seconds)).toEqual([12, 0, 12])
  })

  // A probe resolves after the click that started it, and a deck may have read
  // the real duration in between. The one that was there wins.
  it('does not overwrite a length something already knew', () => {
    const s = strip([row({ clip: { id: 'c1', name: 'a.mp4', seconds: 30 } })])
    expect(learnClipSeconds(s, 'c1', 12).rows[0].clip?.seconds).toBe(30)
  })

  it('a clip that could not be measured changes nothing', () => {
    const s = strip([unmeasured('a', 'c1')])
    expect(learnClipSeconds(s, 'c1', 0)).toBe(s)
    expect(learnClipSeconds(s, 'nobody', 12).rows[0].clip?.seconds).toBe(0)
  })

  // The point of the whole exercise: a row added off the shelf holds for its
  // picture once the measurement lands, where before it held for four bars.
  it('turns a bar-count fallback into the clip’s own length', () => {
    const added = addRow(EMPTY_STRIP, 'set=', {
      clip: { id: 'c1', name: 'a.mp4', seconds: 0 },
    })
    const tempo = { bpm: 120, fps: 60 }
    expect(stripSeconds(added, tempo)).toBe(8)
    expect(stripSeconds(learnClipSeconds(added, 'c1', 3), tempo)).toBe(3)
  })
})

describe('a row that names a clip', () => {
  // The card used to read "look only" over a clip somebody had just loaded,
  // which was accurate about the session string and a lie about the picture.
  it('reads as its clip rather than as the session', () => {
    expect(
      derivedLabel(row({ clip: { id: 'c7', name: 'surf.mp4', seconds: 0 } })),
    ).toBe('surf.mp4')
  })

  // A clip the shelf has lost its name for falls through to what the session
  // says, rather than showing an empty card.
  it('falls back to the session when the clip has no name', () => {
    expect(
      derivedLabel(row({ clip: { id: 'c7', name: '', seconds: 0 } })),
    ).toBe('look only')
  })

  it('captures the clip on the deck', () => {
    const got = addRow(EMPTY_STRIP, 'set=', {
      clip: { id: 'c3', name: 'neon.mp4', seconds: 0 },
    })
    expect(got.rows[0].clip).toEqual({ id: 'c3', name: 'neon.mp4', seconds: 0 })
  })

  // A shake is a departure from whatever is live, so hauling a clip onto the
  // deck under it would make it a source change wearing a jitter's name.
  it('a shake row takes no clip even when one is on the deck', () => {
    const got = addRow(EMPTY_STRIP, 'set=', {
      jitter: 'normal',
      clip: { id: 'c3', name: 'neon.mp4', seconds: 0 },
    })
    expect(got.rows[0].clip).toBeNull()
  })

  it('a duplicate carries the clip with it', () => {
    const one = addRow(EMPTY_STRIP, 'set=', {
      clip: { id: 'c3', name: 'n', seconds: 0 },
    })
    expect(duplicateRow(one, 0).rows[1].clip).toEqual({
      id: 'c3',
      name: 'n',
      seconds: 0,
    })
  })
})

describe('readStrip', () => {
  it('reads back what it stores', () => {
    const original = strip([
      row({ id: 'a', fill: { kind: 'roll', origin: 'commons' } }),
      row({ id: 'b', hold: { bars: null, drift: 0 } }),
    ])
    expect(readStrip(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  it('round-trips a row that names a clip', () => {
    const original = strip([
      row({ id: 'a', clip: { id: 'c7', name: 'surf.mp4', seconds: 0 } }),
    ])
    expect(readStrip(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  // Every row written before the field existed, which is every row anybody
  // already has: a rundown must not lose its rows to a schema that grew.
  it('reads a row stored without a clip as having none', () => {
    const got = readStrip({ rows: [{ session: 'set=' }], seed: 3 })
    expect(got.rows[0].clip).toBeNull()
  })

  // An id that names nothing the shelf could answer for is not a clip. A row
  // that fires and silently does nothing is worse than one that never claimed
  // to have a clip at all.
  it('declines a clip with no usable id', () => {
    const got = readStrip({
      rows: [
        { session: 'set=', clip: { id: '', name: 'x' } },
        { session: 'set=', clip: { id: 7 } },
        { session: 'set=', clip: 'c1' },
      ],
      seed: 3,
    })
    expect(got.rows.map(r => r.clip)).toEqual([null, null, null])
  })

  // Stored JSON is a claim rather than a fact — a stale schema, a hand edit,
  // another build's leftovers.
  it('drops a row with nothing to put up', () => {
    const got = readStrip({
      rows: [{ session: 'set=' }, { session: '' }, {}, null, 7, 'x'],
      seed: 3,
    })
    expect(got.rows).toHaveLength(1)
  })

  it('mints an id for a row that lost one', () => {
    const got = readStrip({ rows: [{ session: 'set=' }], seed: 3 })
    expect(got.rows[0].id).not.toBe('')
  })

  it('falls back rather than dropping when only a field is bad', () => {
    const got = readStrip({
      rows: [
        {
          session: 'set=',
          fill: { kind: 'roll', origin: 'nowhere' },
          hold: { bars: 'soon', drift: 99 },
          arrive: { seconds: 7, transition: 'dissolve' },
        },
      ],
      seed: 3,
    })
    expect(got.rows[0].fill).toEqual({ kind: 'clip' })
    expect(got.rows[0].hold.bars).toBe(DEFAULT_HOLD.bars)
    expect(got.rows[0].hold.drift).toBe(MAX_DRIFT)
    // Not a member of MORPH_SECONDS, so it lands on the same 1s a stored morph
    // duration falls back to.
    expect(got.rows[0].arrive.seconds).toBe(1)
    // And a transition this build's shelf does not have arrives plainly rather
    // than handing an unknown name to the engine.
    expect(got.rows[0].arrive.transition).toBeNull()
  })

  // The one field that must never be a shared constant: every browser falling
  // back to the same seed would mean every user's rolls were the same rolls.
  it('mints a fresh seed rather than a fixed one', () => {
    const seeds = new Set(
      Array.from({ length: 20 }, () => readStrip({ rows: [] }).seed),
    )
    expect(seeds.size).toBeGreaterThan(1)
  })

  it('reads junk as an empty strip rather than throwing', () => {
    for (const junk of [null, 7, 'x', [], {}, { rows: 'lots' }]) {
      expect(readStrip(junk).rows).toEqual([])
    }
  })
})

describe('editing the rundown', () => {
  const three = strip([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })])
  const ids = (s: Strip) => s.rows.map(r => r.id)

  it('adds a row from a captured session, reading its kind off it', () => {
    const got = addRow(strip([]), 'src=ia-random&set=')
    expect(got.rows).toHaveLength(1)
    expect(got.rows[0].fill).toEqual({ kind: 'roll', origin: 'archive' })
    expect(got.rows[0].hold).toEqual(DEFAULT_HOLD)
  })

  it('takes a jitter over what the session names', () => {
    const got = addRow(strip([]), 'src=wiki-random', { jitter: 'wild' })
    expect(got.rows[0].fill).toEqual({ kind: 'jitter', amount: 'wild' })
  })

  // Ids only have to be unique within the strip, but they do have to be that:
  // React keys the cards on them, and two rows sharing one is a card that keeps
  // another row's drag state.
  it('never mints an id a row already has', () => {
    let s = strip([])
    for (let i = 0; i < 12; i++) s = addRow(s, 'set=')
    expect(new Set(ids(s)).size).toBe(12)
  })

  it('mints past the highest, not past the count', () => {
    const s = addRow(strip([row({ id: 'r9' })]), 'set=')
    expect(s.rows[1].id).not.toBe('r9')
  })

  it('removes by index', () => {
    expect(ids(removeRow(three, 1))).toEqual(['a', 'c'])
  })

  it('moves a row, closing the gap behind it', () => {
    expect(ids(moveRow(three, 0, 2))).toEqual(['b', 'c', 'a'])
    expect(ids(moveRow(three, 2, 0))).toEqual(['c', 'a', 'b'])
  })

  // A drag that ended outside the tray should put the row back rather than park
  // it at an end the hand never reached.
  it('leaves the order alone for a move that goes nowhere', () => {
    for (const [from, to] of [
      [0, 0],
      [-1, 1],
      [1, 9],
      [9, 1],
    ]) {
      expect(moveRow(three, from, to)).toBe(three)
    }
  })

  // Next to itself, not appended: a copy that landed at the end of a forty-row
  // strip would be a scroll away from the thing it is a copy of.
  it('duplicates a row next to itself, not at the end', () => {
    const got = duplicateRow(three, 0)
    expect(got.rows).toHaveLength(4)
    expect(ids(got).filter(id => id !== got.rows[1].id)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(new Set(ids(got)).size).toBe(4)
  })

  it('gives the copy everything but the identity', () => {
    const s = strip([row({ id: 'a', hold: { bars: 8, drift: 0 } })])
    const got = duplicateRow(s, 0)
    expect(got.rows[1].hold).toEqual({ bars: 8, drift: 0 })
    expect(got.rows[1].id).not.toBe('a')
  })

  it('numbers the copy off the original rather than repeating its name', () => {
    const s = addRow(strip([]), 'set=', { name: 'the drop' })
    const got = duplicateRow(s, 0)
    expect(got.rows.map(r => r.name)).toEqual(['the drop', 'the drop 2'])
  })

  it('leaves an unnamed copy unnamed', () => {
    const got = duplicateRow(three, 0)
    expect(got.rows[1].name).toBe('')
  })

  it('leaves the strip alone for a row that is not there', () => {
    expect(duplicateRow(three, 9)).toBe(three)
  })

  it('steps the hold around its ring and back', () => {
    // From the head of the ring rather than from a hard-coded 1, so the
    // assertion says "stepping walks the ring and comes back" rather than
    // pinning today's first entry — which changed the day `'clip'` went in
    // front, and failed here rather than anywhere the ring order matters.
    let hold: Hold = { bars: HOLD_BARS[0], drift: 0.25 }
    const seen = HOLD_BARS.map(() => {
      hold = cycleHold(hold)
      return hold.bars
    })
    expect(seen).toEqual([...HOLD_BARS.slice(1), HOLD_BARS[0]])
  })

  it('keeps the drift while stepping the bars', () => {
    expect(cycleHold({ bars: 2, drift: 0.4 }).drift).toBe(0.4)
  })

  // A hand-edited file or an older build's ring lands here; the chip must not
  // become a dead button.
  it('steps a hold that is not on the ring to the head of it', () => {
    expect(cycleHold({ bars: 3, drift: 0 }).bars).toBe(HOLD_BARS[0])
  })

  it('steps the arrival around the morph durations', () => {
    expect(cycleArrive(0)).toBe(MORPH_SECONDS[1])
    expect(cycleArrive(MORPH_SECONDS[MORPH_SECONDS.length - 1])).toBe(
      MORPH_SECONDS[0],
    )
  })

  it('steps a row in place, and only that row', () => {
    const got = stepHold(three, 1)
    expect(got.rows[0]).toBe(three.rows[0])
    expect(got.rows[1].hold.bars).not.toBe(three.rows[1].hold.bars)
  })

  it('leaves the strip alone when the row is not there', () => {
    expect(stepHold(three, 9)).toBe(three)
    expect(stepArrive(three, -1)).toBe(three)
  })
})

describe('a row that carries a name', () => {
  it('says its name instead of what the session reads as', () => {
    const r = row({ name: 'the drop', session: 'src=sweep' })
    expect(rowLabel(r)).toBe('the drop')
    expect(named(r)).toBe(true)
    // The derivation is still there underneath, for the placeholder the rename
    // field shows and for the card that has no name.
    expect(derivedLabel(r)).toBe('Sweep')
  })

  it('falls back to the session when nobody has said', () => {
    const r = row({ session: 'src=sweep' })
    expect(rowLabel(r)).toBe('Sweep')
    expect(named(r)).toBe(false)
  })

  it('takes the suggestion a capture offers', () => {
    const got = addRow(strip([]), 'set=', { name: 'vhs' })
    expect(got.rows[0].name).toBe('vhs')
  })

  // Two rows called "vhs" in one rundown is the case a name exists to prevent,
  // and capturing the same board twice is the ordinary way to get there.
  it('deduplicates a suggested name against the rows already there', () => {
    let s = addRow(strip([]), 'set=', { name: 'vhs' })
    s = addRow(s, 'set=', { name: 'vhs' })
    s = addRow(s, 'set=', { name: 'vhs' })
    expect(s.rows.map(r => r.name)).toEqual(['vhs', 'vhs 2', 'vhs 3'])
  })

  // Unnamed is not a name, so three unnamed rows are not a collision.
  it('leaves a blank suggestion blank rather than numbering it', () => {
    let s = addRow(strip([]), 'set=')
    s = addRow(s, 'set=')
    expect(s.rows.map(r => r.name)).toEqual(['', ''])
  })

  it('renames, and clears back to the derived label', () => {
    const s = addRow(strip([]), 'src=sweep', { name: 'first' })
    expect(rowLabel(renameRow(s, 0, 'second').rows[0])).toBe('second')
    expect(rowLabel(renameRow(s, 0, '').rows[0])).toBe('Sweep')
  })

  // A hand typing the same name onto two rows has said what it meant; appending
  // a "2" to something someone just typed reads as a bug.
  it('does not deduplicate a rename the way it does a capture', () => {
    let s = addRow(strip([]), 'set=', { name: 'vhs' })
    s = addRow(s, 'set=', { name: 'other' })
    expect(renameRow(s, 1, 'vhs').rows[1].name).toBe('vhs')
  })

  it('collapses the whitespace a paste brings, and caps the length', () => {
    const s = addRow(strip([]), 'set=')
    expect(renameRow(s, 0, '  the   drop \n').rows[0].name).toBe('the drop')
    expect(renameRow(s, 0, 'x'.repeat(200)).rows[0].name.length).toBe(
      PROFILE_NAME_MAX,
    )
  })

  it('leaves the strip alone for a row that is not there', () => {
    const s = addRow(strip([]), 'set=')
    expect(renameRow(s, 9, 'nope').rows[0].name).toBe('')
  })

  it('reads a stored name back, and anything else as unnamed', () => {
    const got = readStrip({
      rows: [
        { session: 'set=', name: 'the drop' },
        { session: 'set=', name: 42 },
        { session: 'set=' },
      ],
      seed: 3,
    })
    expect(got.rows.map(r => r.name)).toEqual(['the drop', '', ''])
  })
})

describe('what a card says', () => {
  it('names a shake by its amount', () => {
    expect(rowLabel(row({ fill: { kind: 'jitter', amount: 'gentle' } }))).toBe(
      'shake · gentle',
    )
  })

  it('names a file by its filename, not its url', () => {
    expect(
      rowLabel(row({ session: 'vurl=https://x.test/a/clip%20one.mp4' })),
    ).toBe('clip one.mp4')
  })

  // SOURCE_DESC reads "Color bars — SMPTE test pattern": a name and then an
  // explanation, and a card has room for the name.
  it('names a generated source by the head of its description', () => {
    expect(rowLabel(row({ session: 'src=sweep' }))).toBe('Sweep')
  })

  // Not a broken row: a look change over whatever is already up is a thing a
  // set wants, and the only row that costs nothing at the boundary.
  it('calls a row that names no source what it is', () => {
    expect(rowLabel(row({ session: 'set=vSize:0.4' }))).toBe('look only')
  })

  it('falls back to the bare mode a build no longer has', () => {
    expect(rowLabel(row({ session: 'src=holodeck' }))).toBe('holodeck')
  })

  // The ≈ is the taste call made visible: it says out loud that the boundary is
  // not where the number says.
  it('marks a drifting hold and leaves an exact one plain', () => {
    expect(holdLabel({ bars: 4, drift: 0.25 })).toBe('≈4 bars')
    expect(holdLabel({ bars: 4, drift: 0 })).toBe('4 bars')
    expect(holdLabel({ bars: 1, drift: 0 })).toBe('1 bar')
    expect(holdLabel({ bars: null, drift: 0 })).toBe('hold')
  })
})

// The property the whole design hangs on, and the reason the seed is in the
// first commit rather than the third: two walks of one strip must ask the same
// questions in the same order. Without this a recorded take cannot be
// re-rendered at quality, which is the entire point of the offline half.
describe('a walk is reproducible', () => {
  const mixed = strip([
    row({ id: 'a', fill: { kind: 'roll', origin: 'commons' } }),
    row({ id: 'b', fill: { kind: 'jitter', amount: 'normal' } }),
    row({ id: 'c', hold: { bars: 2, drift: 0.5 } }),
  ])

  const walkOf = (s: Strip, ticks: number) => {
    const log: Effect[] = []
    let step = start(s, CLOCK(0))
    log.push(...step.effects)
    let walk = step.walk
    for (let frame = 1; frame <= ticks; frame++) {
      const next = advance(s, walk, CLOCK(frame))
      if (next !== null) {
        walk = next.walk
        log.push(...next.effects)
      }
    }
    return log
  }

  it('draws the same effects, in the same order, from the same seed', () => {
    expect(walkOf(mixed, 3000)).toEqual(walkOf(mixed, 3000))
  })

  it('draws different ones from a different seed', () => {
    const other = { ...mixed, seed: mixed.seed + 1 }
    expect(walkOf(mixed, 3000)).not.toEqual(walkOf(other, 3000))
  })

  // Reached by playing from the top or by a hand jumping there, row 2 on lap 0
  // is the same row 2: the seed comes from where the walk *is*, not from how
  // many numbers it has drawn on the way.
  it('asks the same question however the row was reached', () => {
    const played = advance(
      mixed,
      advance(mixed, start(mixed, CLOCK(0)).walk, CLOCK(480))?.walk as Walk,
      CLOCK(960),
    )
    const jumped = fire(mixed, STOPPED, 2, CLOCK(0))
    expect(played?.effects).toEqual(jumped.effects)
  })
})

// Preroll depth 1 (docs/EDITOR.md › _Performance: the boundary is the only
// cost_). Two questions, and they are separate on purpose: what a row's clip
// resolves to, and when a walk asks for it.
describe('what a row loads ahead', () => {
  const CLIP = 'https://example.test/reel.mp4'

  it('names an explicit clip url, with the row’s in-point', () => {
    expect(prerollFor(row({ session: `vurl=${CLIP}&cuea=12.5` }))).toEqual({
      url: CLIP,
      start: 12.5,
    })
  })

  // A bundled clip is an id on this side of the boundary and a url on the
  // other, and the row stores the id — so resolving it here is what lets a slot
  // be handed the one thing it can act on.
  it('resolves a bundled clip id to the url the slot would load', () => {
    const got = prerollFor(row({ session: 'src=clip-popeye' }))
    expect(got?.url).toContain('popeye')
    expect(got?.start).toBe(0)
  })

  // The three that cannot be named ahead of time, and the reason each one is
  // not a gap: a pool is a search rather than a file, a still needs no element,
  // and a look-only row leaves the deck where it is — which is the case with no
  // boundary cost to save in the first place.
  it('answers nothing for a pool, a still, or a row that names no source', () => {
    expect(prerollFor(row({ session: 'src=wiki-random' }))).toBeNull()
    expect(prerollFor(row({ session: 'src=bars' }))).toBeNull()
    expect(prerollFor(row({ session: 'set=vSize:0.5' }))).toBeNull()
  })

  it('looks round the end of a looping rundown, and off the end of one without', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })]
    expect(nextRow(strip(rows), 1)?.id).toBe('a')
    expect(nextRow(strip(rows, { loop: false }), 1)).toBeNull()
    expect(nextRow(strip(rows), 0)?.id).toBe('b')
  })

  // The lookahead is on the *walk*, so firing row 0 asks for row 1's clip — a
  // whole hold before the cut that wants it, which is the point.
  it('is fired with the row before the one that wants it', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', session: `vurl=${CLIP}` })]
    const effects = start(strip(rows), CLOCK(0)).effects
    expect(effects.at(-1)).toEqual({ kind: 'preroll', url: CLIP, start: 0 })
  })

  // Last, after the row's own effects: the deck is pointed at what is on air
  // before anything starts fetching what comes after it.
  it('comes after the row’s own effects, never before them', () => {
    const rows = [
      row({ id: 'a', fill: { kind: 'roll', origin: 'commons' } }),
      row({ id: 'b', session: `vurl=${CLIP}` }),
    ]
    expect(
      start(strip(rows), CLOCK(0)).effects.map((e: Effect) => e.kind),
    ).toEqual(['session', 'roll', 'preroll'])
  })

  // And it goes behind the fault with the rest of the step when the row names
  // one. A slot parks one element, so a lookahead spent while this row's own
  // session was still waiting for the cut retired the clip that cut was about
  // to promote — every transition cut paying the cold price, on exactly the
  // rows preroll was built for.
  it('rides the cut when the row it fires with arrives behind a fault', () => {
    const rows = [
      row({ id: 'a', arrive: { seconds: 1, transition: 'collapse' } }),
      row({ id: 'b', session: `vurl=${CLIP}` }),
    ]
    const effects = start(strip(rows), CLOCK(0)).effects
    expect(effects.map((e: Effect) => e.kind)).toEqual(['fault'])
    const fault = effects[0]
    if (fault.kind !== 'fault') throw new Error('expected a fault')
    expect(fault.atCut.map(e => e.kind)).toEqual(['session', 'preroll'])
    expect(fault.atCut.at(-1)).toEqual({ kind: 'preroll', url: CLIP, start: 0 })
  })

  it('asks for nothing when the next row has nothing to load', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', session: 'src=bars' })]
    expect(
      start(strip(rows), CLOCK(0)).effects.some(
        (e: Effect) => e.kind === 'preroll',
      ),
    ).toBe(false)
  })

  // A hand jumping into a bank of scenes still loads what running on would
  // want: the lookahead is a fact about the rundown, not about how the row was
  // reached.
  it('loads ahead from a row fired by hand too', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c', session: `vurl=${CLIP}` }),
    ]
    const jumped = fire(strip(rows), STOPPED, 1, CLOCK(0))
    expect(jumped.effects.at(-1)).toEqual({
      kind: 'preroll',
      url: CLIP,
      start: 0,
    })
  })
})
