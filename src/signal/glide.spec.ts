import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { Glide } from './glide'

import type { ControlKey, Controls } from '../controls'
import type { GlidePlan } from './glide'

const set = (over: Partial<Controls>): Controls => ({
  ...DEFAULT_CONTROLS,
  ...over,
})

// A mode control, a plain one, a filter corner (the expensive kind) and the
// magnifier, which a morph must never touch.
const plan = (to: Controls, over: Partial<GlidePlan> = {}): GlidePlan => ({
  to,
  seconds: 1,
  switchKeys: new Set<ControlKey>(['phosphor']),
  holdKeys: new Set<ControlKey>(['crtZoom']),
  ...over,
})

const COARSE: ReadonlySet<ControlKey> = new Set<ControlKey>(['lumaMHz'])

const at = (
  g: Glide,
  controls: Controls,
  through: GlidePlan,
  fraction: number,
): Controls => {
  g.start(controls, through, 0)
  g.apply(controls, through.seconds * 1000 * fraction)
  return controls
}

describe('Glide', () => {
  it('lands on the destination exactly', () => {
    // Everything that asks "is this look that preset" compares exactly
    // (controlsEqual, matchPreset), and `from + (to - from) * 1` is not
    // bit-identical to `to`. A morph that stopped a float's width away would
    // show an empty recipe for a look it had in fact reached.
    const g = new Glide(COARSE)
    const to = set({ noiseIre: 7.3, lumaMHz: 2.2, tbJitterNs: 400 })
    const live = { ...DEFAULT_CONTROLS }
    g.start(live, plan(to), 0)
    const step = g.apply(live, 1000)
    expect(step.done).toBe(true)
    expect(live.noiseIre).toBe(7.3)
    expect(live.lumaMHz).toBe(2.2)
    expect(live.tbJitterNs).toBe(400)
    expect(g.running).toBe(false)
  })

  it('is on its way but not there at the half-way point', () => {
    const g = new Glide(COARSE)
    const live = at(
      g,
      { ...DEFAULT_CONTROLS },
      plan(set({ noiseIre: 10 })),
      0.5,
    )
    expect(live.noiseIre).toBeGreaterThan(0)
    expect(live.noiseIre).toBeLessThan(10)
  })

  it('eases in and out rather than travelling flat', () => {
    // A linear morph lurches into motion and stops dead, which reads as two cuts
    // with a slide between them. Smoothstep is behind at a quarter through and
    // ahead at three quarters, and exactly half way at half way.
    const to = set({ noiseIre: 100 })
    const q = at(new Glide(COARSE), { ...DEFAULT_CONTROLS }, plan(to), 0.25)
    const h = at(new Glide(COARSE), { ...DEFAULT_CONTROLS }, plan(to), 0.5)
    const t = at(new Glide(COARSE), { ...DEFAULT_CONTROLS }, plan(to), 0.75)
    expect(q.noiseIre).toBeLessThan(25)
    expect(h.noiseIre).toBeCloseTo(50, 5)
    expect(t.noiseIre).toBeGreaterThan(75)
  })

  it('cuts a mode at the mid-point instead of travelling through it', () => {
    // Halfway between two phosphors is a tube nobody asked for.
    const to = set({ phosphor: 3 })
    const before = at(new Glide(COARSE), { ...DEFAULT_CONTROLS }, plan(to), 0.4)
    const after = at(new Glide(COARSE), { ...DEFAULT_CONTROLS }, plan(to), 0.6)
    expect(before.phosphor).toBe(DEFAULT_CONTROLS.phosphor)
    expect(after.phosphor).toBe(3)
  })

  it('never moves a held key', () => {
    // Where you are looking is yours: a morph that flew the magnifier across the
    // picture would read as the app having done something wrong.
    const g = new Glide(COARSE)
    const live = { ...DEFAULT_CONTROLS, crtZoom: 4 }
    g.start(live, plan(set({ crtZoom: 1, noiseIre: 5 })), 0)
    g.apply(live, 500)
    expect(live.crtZoom).toBe(4)
    g.apply(live, 1000)
    expect(live.crtZoom).toBe(4)
  })

  it('steps an expensive key instead of moving it every frame', () => {
    // The five filter controls redesign the FIR bank on every change, so a morph
    // that moved them per frame would be sixty bank rebuilds a second. They move
    // in notches, and the caller is told only on the frames one moved.
    const g = new Glide(COARSE)
    const live = { ...DEFAULT_CONTROLS }
    g.start(live, plan(set({ lumaMHz: 2, noiseIre: 9 }), { seconds: 10 }), 0)
    let rebuilds = 0
    let frames = 0
    for (let ms = 16; ms <= 10_000; ms += 16) {
      frames++
      if (g.apply(live, ms).coarseMoved) rebuilds++
    }
    expect(frames).toBeGreaterThan(500)
    expect(rebuilds).toBeLessThanOrEqual(33)
    expect(live.lumaMHz).toBe(2)
  })

  it('sets off from wherever the last morph had got to', () => {
    // What makes rolls chain: hitting surprise mid-flight carries on from the
    // tween rather than snapping back and starting over.
    const g = new Glide(COARSE)
    const live = { ...DEFAULT_CONTROLS }
    g.start(live, plan(set({ noiseIre: 10 })), 0)
    g.apply(live, 500)
    const mid = live.noiseIre
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(10)
    // A second morph, started from the live controls the way the engine does it.
    g.start(live, plan(set({ noiseIre: 0 })), 1000)
    g.apply(live, 1000)
    expect(live.noiseIre).toBe(mid)
    g.apply(live, 2000)
    expect(live.noiseIre).toBe(0)
  })

  it('leaves the board where it stands when stopped', () => {
    const g = new Glide(COARSE)
    const live = { ...DEFAULT_CONTROLS }
    g.start(live, plan(set({ noiseIre: 10 })), 0)
    g.apply(live, 500)
    const mid = live.noiseIre
    g.stop()
    expect(g.running).toBe(false)
    expect(g.apply(live, 900).done).toBe(true)
    expect(live.noiseIre).toBe(mid)
  })

  it('lands in one step when asked for no time at all', () => {
    // `cut` never reaches the engine — useMix writes instead — but a zero must
    // not divide its way into a morph that never finishes.
    const g = new Glide(COARSE)
    const live = { ...DEFAULT_CONTROLS }
    g.start(live, plan(set({ noiseIre: 4 }), { seconds: 0 }), 0)
    expect(g.apply(live, 0).done).toBe(true)
    expect(live.noiseIre).toBe(4)
  })

  it('reports progress while it runs and nothing when it does not', () => {
    const g = new Glide(COARSE)
    const live = { ...DEFAULT_CONTROLS }
    expect(g.running).toBe(false)
    g.start(live, plan(set({ noiseIre: 4 })), 0)
    g.apply(live, 250)
    expect(g.progress).toBeCloseTo(0.25, 5)
    g.apply(live, 1000)
    expect(g.running).toBe(false)
  })

  // What the undo walk banks mid-morph, so a step back is retraceable rather
  // than pointing at a tween. It has to go quiet the moment the morph is over
  // however it ended — landed, or cut short by a hand on a slider.
  it('offers its destination while it runs and nothing when it does not', () => {
    const g = new Glide(COARSE)
    const live = { ...DEFAULT_CONTROLS }
    expect(g.target).toBeNull()
    const p = plan(set({ noiseIre: 4 }))
    g.start(live, p, 0)
    g.apply(live, 500)
    expect(g.target).toBe(p.to)
    g.stop()
    expect(g.target).toBeNull()
    g.start(live, p, 0)
    g.apply(live, 1000)
    expect(g.target).toBeNull()
  })
})
