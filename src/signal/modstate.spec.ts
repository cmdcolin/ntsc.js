import { describe, expect, it } from 'vitest'

import { ModState } from './modstate'

const step = (
  m: ModState,
  waves: Parameters<ModState['update']>[0],
  n: number,
  rand: () => number = () => 0.5,
) => {
  let out: number[] = []
  for (let i = 0; i < n; i++) out = m.update(waves, 0.3, 0.9, rand)
  return out
}

const spread = (a: number[]) => Math.max(...a) - Math.min(...a)

describe('ModState', () => {
  it('sine reaches +1 a quarter cycle in and is periodic', () => {
    const m = new ModState()
    const wave = [{ id: 0, source: 'sine', rateHz: 1 } as const]
    expect(step(m, wave, 15)[0]).toBeCloseTo(1, 6)
    expect(step(m, wave, 45)[0]).toBeCloseTo(0, 6) // full cycle from start
  })

  it('triangle spans -1..1 bipolar', () => {
    const m = new ModState()
    const wave = [{ id: 0, source: 'triangle', rateHz: 1 } as const]
    expect(step(m, wave, 30)[0]).toBeCloseTo(1, 6) // half cycle = peak
    expect(step(m, wave, 30)[0]).toBeCloseTo(-1, 6) // wrap = trough
  })

  it('walk slews toward the sampled destination and stays bounded', () => {
    const m = new ModState()
    const wave = [{ id: 0, source: 'walk', rateHz: 2 } as const]
    const vals = Array.from(
      { length: 120 },
      () => m.update(wave, 0, 0, () => 1)[0], // dest pinned at +1
    )
    expect(Math.max(...vals.map(Math.abs))).toBeLessThanOrEqual(1)
    expect(vals[119]).toBeGreaterThan(0.9) // converged toward +1
    expect(vals[10]).toBeLessThan(vals[60]) // monotone-ish approach
  })

  it('audio followers pass the envelope through', () => {
    const m = new ModState()
    const out = m.update(
      [
        { id: 0, source: 'level', rateHz: 1 },
        { id: 1, source: 'hit', rateHz: 1 },
      ],
      0.3,
      0.9,
      () => 0.5,
    )
    expect(out).toEqual([0.3, 0.9])
  })

  it('sample & hold latches a stepped value once per cycle', () => {
    const m = new ModState()
    const wave = [{ id: 0, source: 'hold', rateHz: 1 } as const]
    // held value only changes on the cycle wrap, so within a cycle it is flat
    const a = step(m, wave, 20, () => 0.75)
    const b = step(m, wave, 10, () => 0.75)
    expect(a[0]).toBe(b[0]) // still inside the same held step
    expect(a[0]).toBeGreaterThanOrEqual(-1)
    expect(a[0]).toBeLessThanOrEqual(1)
  })

  it('smooth noise is bounded and continuous', () => {
    const m = new ModState()
    const wave = [{ id: 0, source: 'smooth', rateHz: 3 } as const]
    let prev = m.update(wave, 0, 0)[0]
    for (let i = 0; i < 200; i++) {
      const v = m.update(wave, 0, 0)[0]
      expect(Math.abs(v)).toBeLessThanOrEqual(1)
      expect(Math.abs(v - prev)).toBeLessThan(0.5) // no jumps
      prev = v
    }
  })

  it('lorenz stays bounded and is aperiodic', () => {
    const m = new ModState()
    const wave = [{ id: 0, source: 'lorenz', rateHz: 4 } as const]
    const vals = Array.from({ length: 400 }, () => m.update(wave, 0, 0)[0])
    expect(Math.max(...vals.map(Math.abs))).toBeLessThanOrEqual(1)
    // never settles: the second half keeps moving as much as the first
    expect(spread(vals.slice(200))).toBeGreaterThan(0.3)
  })

  it('keeps a slot on its own phase when another slot is enabled', () => {
    // The caller compacts its slot list, so a wave's position shifts when an
    // earlier slot switches on. State follows the id, not the position: slot 1
    // must not inherit slot 3's running phase (nor restart it).
    const m = new ModState()
    const slot3 = { id: 3, source: 'sine', rateHz: 1 } as const
    step(m, [slot3], 15) // a quarter cycle in, alone in the list
    const [slot1Val, slot3Val] = m.update(
      [{ id: 1, source: 'sine', rateHz: 1 }, slot3],
      0,
      0,
      () => 0.5,
    )
    // slot 3 carried its own phase into frame 16; slot 1 began at zero. Keyed
    // by position these two would be swapped.
    expect(slot3Val).toBeCloseTo(Math.sin((2 * Math.PI * 16) / 60), 6)
    expect(slot1Val).toBeCloseTo(Math.sin((2 * Math.PI) / 60), 6)
  })

  it('resumes a slot where it left off after being switched off', () => {
    const m = new ModState()
    const wave = [{ id: 0, source: 'sine', rateHz: 1 } as const]
    step(m, wave, 15) // phase a quarter cycle in
    step(m, [], 10) // slot off: nothing advances it
    // picks up at frame 16, rather than restarting from zero
    expect(step(m, wave, 1)[0]).toBeCloseTo(
      Math.sin((2 * Math.PI * 16) / 60),
      6,
    )
  })

  describe('one-shot envelope', () => {
    const TRIG = [{ id: 0, source: 'trig', rateHz: 1 } as const]

    it('rests at zero until it is fired', () => {
      const m = new ModState()
      expect(step(m, TRIG, 120)[0]).toBe(0)
    })

    // The reason `fired` is a set rather than a flag read in the same call: a
    // press lands between two frames, and the next frame has to still see it.
    it('strikes to full on the first frame after a press', () => {
      const m = new ModState()
      m.fire(0)
      // one frame of decay has already run by the time the value comes back
      expect(step(m, TRIG, 1)[0]).toBeCloseTo(Math.exp(-1 / 60), 6)
    })

    it('decays to 1/e in a second at 1 Hz', () => {
      const m = new ModState()
      m.fire(0)
      expect(step(m, TRIG, 60)[0]).toBeCloseTo(Math.exp(-1), 4)
    })

    it('is unipolar and never overshoots', () => {
      const m = new ModState()
      m.fire(0)
      for (let f = 0; f < 90; f++) {
        const v = step(m, TRIG, 1)[0]
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    })

    it('settles exactly on rest rather than approaching it forever', () => {
      const m = new ModState()
      m.fire(0)
      expect(step(m, TRIG, 900)[0]).toBe(0)
    })

    it('re-strikes from full rather than adding to what is left', () => {
      const m = new ModState()
      m.fire(0)
      const half = step(m, TRIG, 30)[0]
      expect(half).toBeLessThan(1)
      m.fire(0)
      expect(step(m, TRIG, 1)[0]).toBeCloseTo(Math.exp(-1 / 60), 6)
    })

    it('fires every trigger in the bay at once and leaves the LFOs alone', () => {
      const m = new ModState()
      const waves = [
        { id: 0, source: 'trig', rateHz: 1 },
        { id: 1, source: 'sine', rateHz: 1 },
        { id: 2, source: 'trig', rateHz: 4 },
      ] as const
      m.fireAll(waves)
      const out = step(m, waves, 1)
      expect(out[0]).toBeGreaterThan(0.9)
      expect(out[2]).toBeGreaterThan(0.9)
      // the faster decay is already further down, which is what makes two
      // rates fired together read as one gesture with a tail
      expect(out[2]).toBeLessThan(out[0])
    })

    // Slot position is identity everywhere else in this file, and a trigger is
    // no exception: firing slot 0 must not strike slot 1's envelope.
    it('fires only the slot it was aimed at', () => {
      const m = new ModState()
      const waves = [
        { id: 0, source: 'trig', rateHz: 1 },
        { id: 1, source: 'trig', rateHz: 1 },
      ] as const
      m.fire(1)
      const out = step(m, waves, 1)
      expect(out[0]).toBe(0)
      expect(out[1]).toBeGreaterThan(0.9)
    })
  })

  it('tracks independent phase per slot', () => {
    const m = new ModState()
    const waves = [
      { id: 0, source: 'sine', rateHz: 1 },
      { id: 1, source: 'sine', rateHz: 2 },
    ] as const
    const out = step(m, waves, 15)
    expect(out[0]).toBeCloseTo(1, 6)
    expect(out[1]).toBeCloseTo(0, 6) // twice the rate: half cycle
  })
})
