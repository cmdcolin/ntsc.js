import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HOLD,
  MAX_DRIFT,
  STOPPED,
  advance,
  fire,
  fireEffects,
  holdFrames,
  holdProgress,
  readStrip,
  rowFill,
  seedFor,
  start,
  walking,
} from './strip'

import type { Clock, Effect, Row, Strip, Walk } from './strip'

// 120bpm at 60fps: one bar is 2 seconds is 120 frames, so a 4-bar hold is 480.
// Chosen so every expectation below is a round number a reader can check by
// hand rather than by re-running the arithmetic this file is testing.
const CLOCK = (frame: number): Clock => ({ frame, bpm: 120, fps: 60 })

const row = (over: Partial<Row> = {}): Row => ({
  id: 'r1',
  session: 'set=&mod=',
  fill: { kind: 'clip' },
  hold: { bars: 4, drift: 0 },
  arrive: { seconds: 1 },
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
    const out = fireEffects(row({ arrive: { seconds: 0 } }), 1)
    expect(out[0]).toMatchObject({ kind: 'session', seconds: 0 })
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

describe('readStrip', () => {
  it('reads back what it stores', () => {
    const original = strip([
      row({ id: 'a', fill: { kind: 'roll', origin: 'commons' } }),
      row({ id: 'b', hold: { bars: null, drift: 0 } }),
    ])
    expect(readStrip(JSON.parse(JSON.stringify(original)))).toEqual(original)
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
          arrive: { seconds: 7 },
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
