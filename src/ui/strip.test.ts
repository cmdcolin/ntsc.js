import { describe, expect, it } from 'vitest'

import { MORPH_SECONDS } from './morph'
import { PROFILE_NAME_MAX } from './savedProfiles'
import {
  DEFAULT_HOLD,
  HOLD_BARS,
  derivedLabel,
  named,
  renameRow,
  MAX_DRIFT,
  STOPPED,
  addRow,
  advance,
  cycleArrive,
  cycleHold,
  duplicateRow,
  fire,
  fireEffects,
  holdFrames,
  holdLabel,
  holdProgress,
  moveRow,
  readStrip,
  removeRow,
  rowFill,
  rowLabel,
  seedFor,
  start,
  stepArrive,
  stepHold,
  walking,
} from './strip'

import type { Clock, Effect, Hold, Row, Strip, Walk } from './strip'

// 120bpm at 60fps: one bar is 2 seconds is 120 frames, so a 4-bar hold is 480.
// Chosen so every expectation below is a round number a reader can check by
// hand rather than by re-running the arithmetic this file is testing.
const CLOCK = (frame: number): Clock => ({ frame, bpm: 120, fps: 60 })

const row = (over: Partial<Row> = {}): Row => ({
  id: 'r1',
  name: '',
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
    let hold: Hold = { bars: 1, drift: 0.25 }
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
