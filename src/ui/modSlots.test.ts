import { describe, expect, it } from 'vitest'

import { SLIDER_BY_KEY } from './controls'
import { SYNC_DIVISIONS } from './midi'
import {
  DEFAULT_STAB,
  EMPTY_SLOT,
  N_SLOTS,
  RATE_MAX,
  STAB_HZ_MAX,
  STAB_MS_MAX,
  bayLoad,
  gateRate,
  normalizeSlots,
  readStab,
  routingsToSlots,
  slotsToRoutings,
  stabRate,
  toEngineSlots,
  withNextStabSync,
  withNextSync,
} from './modSlots'

import type { Stab } from './modSlots'
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

// The amber on the map's MODULATION box, and the clause under it. It is the
// only thing the box can say about the bay while it is shut, so what counts is
// worth pinning: everything holding a slot, plus the gate, which holds none and
// is the most visible thing in here.
describe('what the bay is holding', () => {
  const bay = (...some: UiSlot[]) => normalizeSlots(some)
  const GATE = { hz: 4, ms: 60 }

  it('counts a patched slot however it is set', () => {
    // Parked, and at zero depth: both are patched — they hold a slot, and the
    // switch that starts them again is inside the bay. A box drawn idle over a
    // full bay would be the panel saying there is nothing here to open.
    expect(bayLoad(bay(slot(), slot({ on: false })), DEFAULT_STAB).n).toBe(2)
    expect(bayLoad(bay(slot({ depth: 0 })), DEFAULT_STAB).n).toBe(1)
  })

  it('counts the gate, which holds no slot at all', () => {
    expect(bayLoad(bay(), DEFAULT_STAB).n).toBe(0)
    expect(bayLoad(bay(), GATE).n).toBe(1)
    expect(bayLoad(bay(slot()), GATE).n).toBe(2)
  })

  // The reason the clause is built here and not at the drawings: the gate is in
  // the number without being a slot, so "2 slots patched" is a lie in exactly
  // the case a caller would write it — and both drawings would write it.
  it('says what it counted, gate and slots apart', () => {
    expect(bayLoad(bay(), DEFAULT_STAB).say).toBe('')
    expect(bayLoad(bay(slot()), DEFAULT_STAB).say).toBe('1 slot patched')
    expect(bayLoad(bay(slot(), slot()), DEFAULT_STAB).say).toBe(
      '2 slots patched',
    )
    expect(bayLoad(bay(), GATE).say).toBe('the stab gate running')
    expect(bayLoad(bay(slot()), GATE).say).toBe(
      '1 slot patched, and the stab gate running',
    )
  })
})

describe('the stab gate', () => {
  it('reads a stored gate back as it was written', () => {
    const written = { hz: 2, ms: 60, syncDiv: 2 }
    expect(readStab(JSON.parse(JSON.stringify(written)))).toEqual(written)
  })

  it('falls back to off for anything that is not a stored gate', () => {
    // Every one of these has been in someone's localStorage: a first run, a
    // hand-edited entry, and the `[null]` shape that used to take the app down
    // at mount when the bay's own loader trusted it.
    for (const raw of [null, undefined, 0, 'stab', [], { hz: 'fast' }])
      expect(readStab(raw)).toEqual(DEFAULT_STAB)
  })

  it('clamps a stored gate into range rather than rejecting it', () => {
    expect(readStab({ hz: 999, ms: 1e6 })).toEqual({
      hz: STAB_HZ_MAX,
      ms: STAB_MS_MAX,
    })
    // A negative rate is off, not a gate running backwards.
    expect(readStab({ hz: -3, ms: 60 }).hz).toBe(0)
  })

  it('drops a lock on a division this build no longer has', () => {
    // Same rule readSlot follows: every read of syncDiv indexes straight into
    // SYNC_DIVISIONS, so a stale index would throw on the first frame instead of
    // degrading to a free-running rate.
    expect(readStab({ hz: 2, ms: 60, syncDiv: 99 })).not.toHaveProperty(
      'syncDiv',
    )
    expect('syncDiv' in readStab({ hz: 2, ms: 60 })).toBe(false)
  })

  it('runs a locked gate at the tempo, and an unlocked one at its own rate', () => {
    const locked = { hz: 2, ms: 60, syncDiv: 0 }
    // Division 0 is 1/1: one stab a whole note, which is a bar of four.
    expect(stabRate(locked, 120)).toBeCloseTo(
      120 / 60 / SYNC_DIVISIONS[0].beats,
    )
    // No tempo on the wire leaves the dialed rate running rather than stopping
    // the train — the same rule slotRate follows.
    expect(stabRate(locked, null)).toBe(2)
    expect(stabRate({ hz: 3, ms: 60 }, 120)).toBe(3)
  })

  it('leaves an off gate off however fast the clock is', () => {
    // The one place this differs from a slot's rate: a lock must not be able to
    // start a gate that is switched off, or setting a tempo would turn the
    // whole board's cutting on by itself.
    expect(stabRate({ hz: 0, ms: 60, syncDiv: 0 }, 174)).toBe(0)
  })

  it('walks the divisions and back to free-running, keeping the dialed rate', () => {
    // Annotated rather than inferred: the literal alone widens to `{hz, ms}`,
    // and every `stab.syncDiv` below is then a property access on a type that
    // has never heard of it.
    let stab: Stab = { hz: 2.5, ms: 60 }
    for (let i = 0; i < SYNC_DIVISIONS.length; i++) {
      stab = withNextStabSync(stab)
      expect(stab.syncDiv).toBe(i)
      // What the gate comes back to at the end of the cycle.
      expect(stab.hz).toBe(2.5)
    }
    expect('syncDiv' in withNextStabSync(stab)).toBe(false)
  })
})

describe('gateRate', () => {
  const running = { hz: 4, ms: 60 }

  it('runs at the dialed rate while the motion amount is up', () => {
    expect(gateRate(running, 1, null)).toBe(4)
    // Anything above zero is "not frozen": the freeze is the only thing that
    // gates the stabs, and a half-open motion fader must not half-open them.
    expect(gateRate(running, 0.01, null)).toBe(4)
  })

  it('stops the gate dead while the motion is frozen', () => {
    // ❚❚ means "hold everything still". A gate still cutting the whole board in
    // and out four times a second would make that a lie.
    expect(gateRate(running, 0, null)).toBe(0)
    // Including a locked one: a tempo cannot outvote the freeze.
    expect(gateRate({ ...running, syncDiv: 0 }, 0, 120)).toBe(0)
  })

  it('reads the tempo rather than the dial while it is locked', () => {
    // Division 2 is 1/4 — one stab a quarter note, so 120bpm is 2 a second,
    // rather than the 4 sitting under it on the slider.
    expect(gateRate({ ...running, syncDiv: 2 }, 1, 120)).toBe(2)
    // And 1/1 is a whole note, which is a bar of four: 0.5 a second at the same
    // tempo. Spelled out because "1/1" reads as "every beat" until it doesn't,
    // and this is the end that decides how fast the whole board cuts.
    expect(gateRate({ ...running, syncDiv: 0 }, 1, 120)).toBe(0.5)
  })

  it('leaves an off gate off however the freeze and the clock are set', () => {
    for (const master of [0, 0.5, 1])
      for (const bpm of [null, 174])
        expect(gateRate({ hz: 0, ms: 60, syncDiv: 0 }, master, bpm)).toBe(0)
  })

  it('is what the freeze hands back when it lets go', () => {
    // The dial survives the freeze untouched — the row goes to 0 and comes back
    // to where it was, rather than being zeroed on the way through. This is the
    // half that made the slider look dead: the value was never lost, only the
    // reading of it.
    const dialed = { hz: 7.5, ms: 60 }
    expect(gateRate(dialed, 0, null)).toBe(0)
    expect(gateRate(dialed, 1, null)).toBe(7.5)
  })
})
