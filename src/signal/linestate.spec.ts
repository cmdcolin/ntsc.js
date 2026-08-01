import { describe, expect, it } from 'vitest'

import { HEAD_SWITCH_LINE, LINES, usToSamples } from './constants'
import { LineState } from './linestate'

import type { LineStateControls } from './linestate'

const CLEAN: LineStateControls = {
  tbJitterNs: 0,
  tbWowNs: 0,
  underJitterDeg: 0,
  headSwitchShiftUs: 0,
  trackAmt: 0,
  trackPos: 0.85,
  shuttleBars: 0,
  shuttlePhase: 0,
}

// Pinned randomness: 0.5 is the midpoint every bipolar term is centred on, so
// anything that still moves is the deterministic part of the model.
const mid = () => 0.5
const offsets = (data: Float32Array) =>
  Array.from({ length: LINES }, (_, row) => data[row * 4])
const phase = (data: Float32Array, row: number) => data[row * 4 + 1]

describe('LineState', () => {
  it('leaves every line untouched with a clean transport', () => {
    const ls = new LineState(mid)
    const out = offsets(ls.update(CLEAN, 0))
    expect(out.every(v => v === 0)).toBe(true)
  })

  it('shifts only the lines after the head switch point', () => {
    const ls = new LineState(mid)
    const shift = 0.8
    const out = offsets(ls.update({ ...CLEAN, headSwitchShiftUs: shift }, 0))
    expect(out[HEAD_SWITCH_LINE - 1]).toBe(0)
    expect(out[HEAD_SWITCH_LINE]).toBeCloseTo(usToSamples(shift), 6)
    expect(out[LINES - 1]).toBeCloseTo(usToSamples(shift), 6)
  })

  it('marks the head-switch lines with a color-under phase step', () => {
    const ls = new LineState(mid)
    const data = ls.update(CLEAN, 0)
    expect(data[(HEAD_SWITCH_LINE - 1) * 4 + 2]).toBeCloseTo(0, 6)
    expect(data[HEAD_SWITCH_LINE * 4 + 2]).toBeCloseTo(0.9, 6)
  })

  it('confines the tracking tear to a band around its position', () => {
    const ls = new LineState(mid)
    const trackPos = 0.5
    const out = offsets(
      ls.update({ ...CLEAN, trackAmt: 0.5, trackPos }, 0),
    ).map(Math.abs)
    const centre = Math.round(trackPos * LINES)
    expect(out[centre]).toBeGreaterThan(0)
    // half-width is 3 + 18*trackAmt lines, so well outside it must be clean
    expect(out[centre - 40]).toBe(0)
    expect(out[centre + 40]).toBe(0)
    // strongest at the middle of the band, tapering to its edges
    expect(out[centre]).toBeGreaterThan(out[centre + 8])
  })

  it('gives each shuttle strip its own offset, repeating per crossing', () => {
    const ls = new LineState(mid)
    // 5 crossings per field: strips are deterministic per crossing index, so
    // the same phase must reproduce the same pattern on a fresh state
    const a = offsets(ls.update({ ...CLEAN, shuttleBars: 5 }, 0))
    const b = offsets(
      new LineState(mid).update({ ...CLEAN, shuttleBars: 5 }, 0),
    )
    expect(a).toEqual(b)
    expect(a.some(v => v !== 0)).toBe(true)
    // distinct strips, not one uniform shift across the frame
    expect(new Set(a.map(v => v.toFixed(4))).size).toBeGreaterThan(1)
  })

  it('keeps the flutter walk bounded by its restoring pull', () => {
    // Worst case: the walk pushed the same direction on every single line, so
    // only the 0.995 decay holds it in. A per-line step s against that decay
    // settles at s * 0.995 / (1 - 0.995) = 199s — bounded, not a free walk.
    const ls = new LineState(() => 1)
    let peak = 0
    for (let frame = 0; frame < 20; frame++) {
      for (const v of offsets(
        ls.update({ ...CLEAN, tbJitterNs: 800 }, frame),
      )) {
        peak = Math.max(peak, Math.abs(v))
      }
    }
    const step = usToSamples(800 * 1e-3) * 0.7 * 0.5
    expect(peak).toBeLessThan(step * 200)
    expect(peak).toBeGreaterThan(step * 190) // and it does reach the plateau
  })

  it('runs the wow clock on frames, not on dub generations', () => {
    // The engine calls update() once per dub generation, all within one frame.
    // Wall time must advance once regardless, or wow runs at dubGens times its
    // rate; and generation 0 must land identically either way, since the second
    // deck is a different transport and cannot reach back into the first.
    const wowy = { ...CLEAN, tbWowNs: 900 }
    const single = new LineState(mid)
    single.update(wowy, 0)
    const plain = offsets(single.update(wowy, 1))

    const dubbed = new LineState(mid)
    dubbed.update(wowy, 0)
    dubbed.update(wowy, 0) // generation 2 of the same frame
    const withDub = offsets(dubbed.update(wowy, 1))

    expect(withDub).toEqual(plain)
    expect(plain.some(v => v !== 0)).toBe(true)
  })

  it('gives each dub generation its own transport', () => {
    // Same instant, different deck: the generations must wander independently,
    // or their offsets sum coherently into one deeper wobble. Needs a rand that
    // actually varies — a constant one makes every transport identical by
    // construction, which is the thing under test.
    let seed = 1
    const lcg = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const ls = new LineState(lcg)
    const gen0 = offsets(ls.update({ ...CLEAN, tbWowNs: 900 }, 0))
    const gen1 = offsets(ls.update({ ...CLEAN, tbWowNs: 900 }, 0))
    expect(gen1).not.toEqual(gen0)
  })

  it('alternates the color-under base phase 180 deg line to line', () => {
    // update() hands back its live internal buffer, so each frame is copied
    // before the next call overwrites it.
    const ls = new LineState(mid)
    const f0 = Float32Array.from(ls.update(CLEAN, 0))
    // 187.5 heterodyne cycles per line puts consecutive lines a half cycle
    // apart — the color-under counterpart of the subcarrier's line alternation.
    expect(phase(f0, 0)).toBeCloseTo(0, 5)
    expect(phase(f0, 1)).toBeCloseTo(Math.PI, 5)
    expect(phase(f0, 2)).toBeCloseTo(0, 5)
    // 525 lines is odd, so a frame boundary flips the phase too: frame 1 line 0
    // picks the ramp up where frame 0 left off instead of restarting at 0.
    const f1 = Float32Array.from(ls.update(CLEAN, 1))
    expect(phase(f1, 0)).toBeCloseTo(Math.PI, 5)
  })
})
