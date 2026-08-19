import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../core/controls'
import { EMPTY_TAPE, playTape, push, runAuto, takeSeconds } from './automation'
import { makeAutomationRunner } from './useAutomation'

import type { Controls } from '../core/controls'
import type { AutoEvent, AutoSink, Tape } from './automation'

// A sink that writes down what it was asked for, the same shape and for the
// same reason `stripRun.test.ts`'s does: "the morph replayed a frame late" is
// an assertion here rather than something to notice in a file four minutes
// long.
function fakeSink() {
  const order: string[] = []
  const sets: { key: string; value: number }[] = []
  const applies: Controls[] = []
  const glides: { to: Controls; seconds: number }[] = []
  const sink: AutoSink = {
    set: (key, value) => {
      sets.push({ key, value })
      order.push(`set:${key}`)
    },
    apply: controls => {
      applies.push(controls)
      order.push('apply')
    },
    glide: (to, seconds) => {
      glides.push({ to, seconds })
      order.push('glide')
    },
  }
  return { sink, order, sets, applies, glides }
}

const look = (vSize: number): Controls => ({ ...DEFAULT_CONTROLS, vSize })
const tapeOf = (events: AutoEvent[], frames: number): Tape => ({
  events,
  frames,
})

describe('runAuto', () => {
  it('sends each variant to its own verb', () => {
    const f = fakeSink()
    runAuto({ kind: 'set', at: 0, key: 'vSize', value: 0.5 }, f.sink)
    runAuto({ kind: 'apply', at: 0, controls: look(0.2) }, f.sink)
    runAuto({ kind: 'glide', at: 0, to: look(0.9), seconds: 4 }, f.sink)
    expect(f.order).toEqual(['set:vSize', 'apply', 'glide'])
    expect(f.sets[0]).toEqual({ key: 'vSize', value: 0.5 })
    expect(f.applies[0].vSize).toBe(0.2)
    expect(f.glides[0]).toEqual({ to: look(0.9), seconds: 4 })
  })
})

describe('push', () => {
  it('keeps writes to different keys on one frame', () => {
    const events: AutoEvent[] = []
    push(events, { kind: 'set', at: 3, key: 'vSize', value: 0.1 })
    push(events, { kind: 'set', at: 3, key: 'vHold', value: 0.2 })
    expect(events).toHaveLength(2)
  })

  // The bound on a tape: a drag writes one key many times inside a frame and
  // only the last is what the frame rendered.
  it('collapses a repeat of one key on one frame to the last value', () => {
    const events: AutoEvent[] = []
    push(events, { kind: 'set', at: 3, key: 'vSize', value: 0.1 })
    push(events, { kind: 'set', at: 3, key: 'vSize', value: 0.2 })
    push(events, { kind: 'set', at: 3, key: 'vSize', value: 0.3 })
    expect(events).toEqual([{ kind: 'set', at: 3, key: 'vSize', value: 0.3 }])
  })

  it('keeps the same key on the next frame', () => {
    const events: AutoEvent[] = []
    push(events, { kind: 'set', at: 3, key: 'vSize', value: 0.1 })
    push(events, { kind: 'set', at: 4, key: 'vSize', value: 0.2 })
    expect(events).toHaveLength(2)
  })

  // The hazard the "last event only" rule exists to make unreachable: a preset
  // and then one knob on top of it is a different board from the two the other
  // way round, so nothing may reorder them.
  it('does not collapse across an intervening event of another kind', () => {
    const events: AutoEvent[] = []
    push(events, { kind: 'set', at: 3, key: 'vSize', value: 0.1 })
    push(events, { kind: 'apply', at: 3, controls: look(0.5) })
    push(events, { kind: 'set', at: 3, key: 'vSize', value: 0.9 })
    expect(events.map(e => e.kind)).toEqual(['set', 'apply', 'set'])
  })

  it('collapses a repeated apply and a repeated glide on one frame', () => {
    const events: AutoEvent[] = []
    push(events, { kind: 'apply', at: 1, controls: look(0.1) })
    push(events, { kind: 'apply', at: 1, controls: look(0.2) })
    push(events, { kind: 'glide', at: 1, to: look(0.3), seconds: 1 })
    push(events, { kind: 'glide', at: 1, to: look(0.4), seconds: 8 })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'apply' })
    expect(events[1]).toEqual({
      kind: 'glide',
      at: 1,
      to: look(0.4),
      seconds: 8,
    })
  })
})

describe('playTape', () => {
  it('lands each event on the frame it was recorded on', () => {
    const f = fakeSink()
    const play = playTape(
      tapeOf(
        [
          { kind: 'set', at: 1, key: 'vSize', value: 0.1 },
          { kind: 'set', at: 3, key: 'vSize', value: 0.3 },
        ],
        10,
      ),
      f.sink,
    )
    play(0)
    expect(f.sets).toHaveLength(0)
    play(1)
    expect(f.sets).toEqual([{ key: 'vSize', value: 0.1 }])
    play(2)
    expect(f.sets).toHaveLength(1)
    play(3)
    expect(f.sets).toHaveLength(2)
  })

  it('asking twice for one frame plays nothing twice', () => {
    const f = fakeSink()
    const play = playTape(
      tapeOf([{ kind: 'set', at: 2, key: 'vSize', value: 0.1 }], 10),
      f.sink,
    )
    play(2)
    play(2)
    play(3)
    expect(f.sets).toHaveLength(1)
  })

  // The cursor rather than a lookup by frame: a render asked for 0 then 2 still
  // lands frame 1's gesture rather than dropping it.
  it('a skipped frame still lands its events', () => {
    const f = fakeSink()
    const play = playTape(
      tapeOf(
        [
          { kind: 'set', at: 1, key: 'vSize', value: 0.1 },
          { kind: 'set', at: 2, key: 'vHold', value: 0.2 },
        ],
        10,
      ),
      f.sink,
    )
    play(0)
    play(4)
    expect(f.order).toEqual(['set:vSize', 'set:vHold'])
  })

  it('keeps recorded order within a frame', () => {
    const f = fakeSink()
    const play = playTape(
      tapeOf(
        [
          { kind: 'apply', at: 5, controls: look(0.5) },
          { kind: 'set', at: 5, key: 'vSize', value: 0.9 },
        ],
        10,
      ),
      f.sink,
    )
    play(5)
    expect(f.order).toEqual(['apply', 'set:vSize'])
  })

  // Two renders of one take are two independent walks, which is the property
  // `rendercheck.mjs` asserts on the file and this asserts on the tape.
  it('a second call starts a fresh walk over the same tape', () => {
    const tape = tapeOf([{ kind: 'set', at: 0, key: 'vSize', value: 0.4 }], 5)
    const a = fakeSink()
    const b = fakeSink()
    playTape(tape, a.sink)(0)
    playTape(tape, b.sink)(0)
    expect(a.sets).toEqual(b.sets)
  })

  it('an empty tape is a walk that does nothing', () => {
    const f = fakeSink()
    const play = playTape(EMPTY_TAPE, f.sink)
    play(0)
    play(600)
    expect(f.order).toEqual([])
  })
})

describe('takeSeconds', () => {
  it('converts frames at the rate a take is rendered at', () => {
    expect(takeSeconds(600, 60)).toBe(10)
    expect(takeSeconds(0, 60)).toBe(0)
  })

  it('declines to divide by a rate of zero', () => {
    expect(takeSeconds(600, 0)).toBe(0)
  })
})

describe('makeAutomationRunner', () => {
  // The frame counter, as a thing a test can move. Everything the runner does
  // with time goes through it.
  function harness() {
    let frame = 0
    const runner = makeAutomationRunner()
    runner.setFrameNo(() => frame)
    return { runner, at: (n: number) => (frame = n) }
  }

  it('records nothing until it is rolling', () => {
    const h = harness()
    h.runner.tap.set('vSize', 0.5)
    h.runner.tap.apply(look(0.2))
    expect(h.runner.getTape()).toEqual(EMPTY_TAPE)
    expect(h.runner.getState()).toEqual({ rolling: false, frames: 0 })
  })

  // The stamp is the take's frame, not the app's — the app's counter has been
  // running since page load and a render's counts from zero.
  it('stamps against the frame it started on', () => {
    const h = harness()
    h.at(1000)
    h.runner.start()
    h.runner.tap.set('vSize', 0.1)
    h.at(1030)
    h.runner.tap.set('vSize', 0.2)
    h.at(1059)
    h.runner.stop()
    expect(h.runner.getTape().events).toEqual([
      { kind: 'set', at: 0, key: 'vSize', value: 0.1 },
      { kind: 'set', at: 30, key: 'vSize', value: 0.2 },
    ])
  })

  // Frames elapsed rather than the last event's stamp: four bars of doing
  // nothing at the end are still four bars of take.
  it('seals a length that outlives its last event', () => {
    const h = harness()
    h.runner.start()
    h.runner.tap.set('vSize', 0.1)
    h.at(599)
    h.runner.stop()
    expect(h.runner.getTape().frames).toBe(600)
    expect(h.runner.getState()).toEqual({ rolling: false, frames: 600 })
  })

  it('a take started and stopped on one frame is one frame long', () => {
    const h = harness()
    h.runner.start()
    h.runner.stop()
    expect(h.runner.getTape().frames).toBe(1)
  })

  it('stops recording once sealed', () => {
    const h = harness()
    h.runner.start()
    h.runner.stop()
    h.runner.tap.set('vSize', 0.9)
    expect(h.runner.getTape().events).toHaveLength(0)
  })

  // A take is a performance, and the gesture that starts one is not asking to
  // append to the last.
  it('a second start throws the first tape away', () => {
    const h = harness()
    h.runner.start()
    h.runner.tap.set('vSize', 0.1)
    h.runner.stop()
    h.runner.start()
    h.runner.tap.set('vHold', 0.2)
    h.runner.stop()
    expect(h.runner.getTape().events).toEqual([
      { kind: 'set', at: 0, key: 'vHold', value: 0.2 },
    ])
  })

  it('clear empties the tape and the summary with it', () => {
    const h = harness()
    h.runner.start()
    h.runner.tap.set('vSize', 0.1)
    h.at(120)
    h.runner.stop()
    h.runner.clear()
    expect(h.runner.getTape()).toEqual(EMPTY_TAPE)
    expect(h.runner.getState()).toEqual({ rolling: false, frames: 0 })
  })

  // A board somebody goes on to mutate in place is a take that changes after it
  // was performed.
  it('copies the look it is handed', () => {
    const h = harness()
    h.runner.start()
    const board = look(0.4)
    h.runner.tap.apply(board)
    board.vSize = 0.9
    h.runner.stop()
    const first = h.runner.getTape().events[0]
    expect(first.kind === 'apply' && first.controls.vSize).toBe(0.4)
  })

  // The identity rule `useSyncExternalStore` needs: a fresh object per call
  // spins forever, so the summary is rebuilt only when one of its two answers
  // changes.
  it('publishes a stable summary until something moves', () => {
    const h = harness()
    const seen: unknown[] = []
    h.runner.subscribe(() => seen.push(h.runner.getState()))
    const before = h.runner.getState()
    h.runner.start()
    h.runner.tap.set('vSize', 0.1)
    h.runner.tap.set('vSize', 0.2)
    expect(h.runner.getState()).not.toBe(before)
    expect(seen).toHaveLength(1)
    const rolling = h.runner.getState()
    expect(h.runner.getState()).toBe(rolling)
  })

  it('does not notify when nothing changed', () => {
    const h = harness()
    let notices = 0
    h.runner.subscribe(() => (notices += 1))
    h.runner.clear()
    expect(notices).toBe(0)
  })
})

// The two halves together: what a recorder writes down is what a render plays
// back, on the same frames.
describe('record and replay', () => {
  it('round-trips a performance', () => {
    let frame = 0
    const runner = makeAutomationRunner()
    runner.setFrameNo(() => frame)
    frame = 500
    runner.start()
    runner.tap.set('vSize', 0.25)
    frame = 530
    runner.tap.glide(look(0.75), 4)
    frame = 560
    runner.tap.apply(look(0.5))
    frame = 619
    runner.stop()

    const f = fakeSink()
    const play = playTape(runner.getTape(), f.sink)
    for (let i = 0; i < runner.getTape().frames; i++) play(i)
    expect(f.order).toEqual(['set:vSize', 'glide', 'apply'])
    expect(takeSeconds(runner.getTape().frames, 60)).toBe(2)
  })
})
