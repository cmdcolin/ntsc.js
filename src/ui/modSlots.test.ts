import { describe, expect, it } from 'vitest'

import { SLIDER_BY_KEY } from './controls'
import { SYNC_DIVISIONS } from './midi'
import {
  EMPTY_SLOT,
  N_SLOTS,
  RATE_MAX,
  normalizeSlots,
  routingsToSlots,
  slotsToRoutings,
  toEngineSlots,
  withNextSync,
} from './modSlots'

import type { ModRouting, UiSlot } from './modSlots'

const slot = (patch: Partial<UiSlot> = {}): UiSlot => ({
  ...EMPTY_SLOT,
  target: 'fbMix',
  ...patch,
})

describe('normalizeSlots', () => {
  it('pads a short bay out to the full count', () => {
    const out = normalizeSlots([slot()])
    expect(out).toHaveLength(N_SLOTS)
    expect(out[0].target).toBe('fbMix')
    expect(out[1]).toEqual(EMPTY_SLOT)
  })

  it('blanks a stale entry in place instead of compacting it away', () => {
    // Position is what ModState keys a wave's phase by. Compacting would slide
    // the second routing into slot 0 and hand it slot 0's running phase.
    const out = normalizeSlots([
      { target: 'noSuchControl', source: 'sine', rateHz: 1, depth: 0.5 },
      slot({ target: 'cfbMix' }),
    ])
    expect(out[0]).toEqual(EMPTY_SLOT)
    expect(out[1].target).toBe('cfbMix')
  })

  it('survives the shapes a stored bay can actually be', () => {
    expect(normalizeSlots([null, undefined, 7, 'x', {}])).toEqual(
      Array.from({ length: N_SLOTS }, () => EMPTY_SLOT),
    )
  })

  it('clamps a rate or depth that arrived out of range', () => {
    const out = normalizeSlots([slot({ rateHz: 900, depth: 40 })])
    expect(out[0].rateHz).toBe(10)
    expect(out[0].depth).toBe(1)
  })

  it('takes an old four-slot bay unchanged', () => {
    const old = [slot(), slot({ target: 'cfbMix' })]
    const out = normalizeSlots(old)
    expect(out.slice(0, 2)).toEqual(old)
  })

  it('reads a bay stored before the run switch existed as running', () => {
    // Every localStorage entry and every link written before `on` was a field
    // has to load as a bay that moves; anything else silently stops the wobbles
    // a returning user had patched.
    const out = normalizeSlots([
      { target: 'fbMix', source: 'sine', rateHz: 1, depth: 0.5 },
    ])
    expect(out[0].on).toBe(true)
  })

  it('parks a slot only on an explicit false', () => {
    const out = normalizeSlots([
      { target: 'fbMix', source: 'sine', rateHz: 1, depth: 0.5, on: false },
      { target: 'cfbMix', source: 'sine', rateHz: 1, depth: 0.5, on: 'yes' },
    ])
    expect(out.map(s => s.on).slice(0, 2)).toEqual([false, true])
  })
})

describe('toEngineSlots', () => {
  it('carries position as id through the compaction', () => {
    const out = toEngineSlots([
      EMPTY_SLOT,
      slot({ target: 'cfbMix' }),
      EMPTY_SLOT,
      slot({ target: 'fbZoom' }),
    ])
    expect(out.map(s => s.id)).toEqual([1, 3])
  })

  it('attaches the target range from the live schema', () => {
    // Read from the schema rather than repeating a pair of numbers: depth is a
    // fraction of this span, so the span moving is exactly what this has to
    // keep following. Written out, it just asserted a range that has since been
    // widened, and failed for the one reason it should not have.
    const def = SLIDER_BY_KEY.get('fbZoom')
    const [out] = toEngineSlots([slot({ target: 'fbZoom' })])
    expect(out.min).toBe(def?.min)
    expect(out.max).toBe(def?.max)
  })

  it('drops off and zero-depth slots', () => {
    expect(toEngineSlots([EMPTY_SLOT, slot({ depth: 0 })])).toEqual([])
  })

  it('drops a parked routing but keeps its neighbours on their own ids', () => {
    // The park must not compact the bay either: slot 1 keeps id 1 whether or
    // not slot 0 is running, or holding one still would restart the other.
    const out = toEngineSlots([slot({ on: false }), slot({ target: 'cfbMix' })])
    expect(out.map(s => s.id)).toEqual([1])
  })

  it('scales every depth by the motion amount', () => {
    const [out] = toEngineSlots([slot({ depth: 0.5 })], 0.5)
    expect(out.depth).toBe(0.25)
  })

  it('routes nothing at all when motion is frozen', () => {
    // Not merely inaudible: an empty list means the loop skips modulation, so
    // every wave holds its phase and unfreezing resumes rather than restarts.
    expect(toEngineSlots([slot(), slot({ target: 'cfbMix' })], 0)).toEqual([])
  })
})

describe('a rate locked to the beat', () => {
  // 1/4 is one cycle per quarter note, so 120 BPM is two a second.
  const QUARTER = SYNC_DIVISIONS.findIndex(d => d.label === '1/4')

  it('runs at the tempo rather than at the dialed Hz', () => {
    const [out] = toEngineSlots(
      [slot({ rateHz: 0.5, syncDiv: QUARTER })],
      1,
      120,
    )
    expect(out.rateHz).toBe(2)
  })

  it('follows the tempo without the bay being rewritten', () => {
    const bay = [slot({ rateHz: 0.5, syncDiv: QUARTER })]
    expect(toEngineSlots(bay, 1, 60)[0].rateHz).toBe(1)
    expect(toEngineSlots(bay, 1, 180)[0].rateHz).toBe(3)
    // The slot itself never moved: the dialed rate is what comes back when the
    // lock cycles off.
    expect(bay[0].rateHz).toBe(0.5)
  })

  it('holds the dialed rate while nothing is providing a tempo', () => {
    // Unplugging the clock leaves the wobble where it was rather than stopping
    // it, which is the only reading that doesn't look like a broken patch.
    expect(
      toEngineSlots([slot({ rateHz: 0.5, syncDiv: QUARTER })])[0].rateHz,
    ).toBe(0.5)
  })

  it('clamps a division the rate slider cannot reach', () => {
    const fastest = SYNC_DIVISIONS.length - 1
    const [out] = toEngineSlots([slot({ syncDiv: fastest })], 1, 300)
    expect(out.rateHz).toBe(RATE_MAX)
  })

  it('cycles off → every division → off, keeping the rate underneath', () => {
    const walk: (number | undefined)[] = []
    let s = slot({ rateHz: 0.5 })
    for (let i = 0; i <= SYNC_DIVISIONS.length; i++) {
      s = withNextSync(s)
      walk.push(s.syncDiv)
    }
    expect(walk).toEqual([
      ...SYNC_DIVISIONS.map((_, i) => i),
      undefined, // back to free-running
    ])
    expect(s.rateHz).toBe(0.5)
    // Absent, not present-and-undefined: the readers all ask `=== undefined`,
    // and a key that JSON keeps would survive storage as a lock that isn't one.
    expect('syncDiv' in s).toBe(false)
  })

  it('drops a stored lock on a division this build no longer has', () => {
    const [out] = normalizeSlots([{ ...slot(), syncDiv: 99 }])
    expect(out.target).toBe('fbMix')
    expect(out.syncDiv).toBeUndefined()
  })

  it('carries the lock onto a link, since it is part of the look', () => {
    const mod: ModRouting[] = [
      { target: 'fbMix', source: 'sine', rateHz: 0.5, depth: 0.2, syncDiv: 1 },
    ]
    expect(slotsToRoutings(routingsToSlots(mod))).toEqual(mod)
  })
})

describe('routings', () => {
  it('round-trips through the bay', () => {
    const mod: ModRouting[] = [
      { target: 'fbMix', source: 'sine', rateHz: 0.5, depth: 0.2 },
      { target: 'cfbMix', source: 'lorenz', rateHz: 2, depth: 0.4 },
    ]
    expect(slotsToRoutings(routingsToSlots(mod))).toEqual(mod)
  })

  it('caps a link that asks for more routings than there are slots', () => {
    const many: ModRouting[] = Array.from({ length: 20 }, () => ({
      target: 'fbMix' as const,
      source: 'sine' as const,
      rateHz: 1,
      depth: 0.3,
    }))
    expect(routingsToSlots(many)).toHaveLength(N_SLOTS)
    expect(slotsToRoutings(routingsToSlots(many))).toHaveLength(N_SLOTS)
  })

  it('leaves a zero-depth slot out of the routings it reports', () => {
    expect(slotsToRoutings([slot({ depth: 0 })])).toEqual([])
  })

  it('reports a parked routing, since the patch is still part of the look', () => {
    // Only the switch is a gesture. Dropping the routing here would mean the
    // ?mod= rewrite erased it on the next keystroke, so parking a wobble in
    // your own tab and reloading would lose the patch outright.
    expect(slotsToRoutings([slot({ on: false })])).toHaveLength(1)
  })

  it('starts every routing a link brings in', () => {
    expect(
      routingsToSlots([
        { target: 'fbMix', source: 'sine', rateHz: 1, depth: 0.3 },
      ])[0].on,
    ).toBe(true)
  })
})
