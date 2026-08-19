import { describe, expect, it } from 'vitest'

import { driveAt, driveSlots } from '../core/signal/modstate'
import {
  BAY_TARGETS,
  EMPTY_SLOT,
  N_SLOTS,
  bayDefFor,
  bayKeyFor,
  modTarget,
  routingsToSlots,
  slotsToRoutings,
  targetLabel,
  toEngineSlots,
} from './modSlots'

import type { ModSlot } from '../core/controls'
import type { UiSlot } from './modSlots'

// A wire landed on another wire: one routing driving how far or how fast a
// second one runs. The rules that are not obvious from either end of it —
// what survives a link, what the engine is handed, and the one patch that is
// refused.

const slot = (patch: Partial<UiSlot>): UiSlot => ({ ...EMPTY_SLOT, ...patch })

// A bay with a wire in slot 0 onto slot 1's depth, and slot 1 driving a
// control. The shape every case below starts from.
const wired = (patch: Partial<UiSlot> = {}): UiSlot[] => {
  const slots = Array.from({ length: N_SLOTS }, () => slot({}))
  slots[0] = slot({ target: bayKeyFor(1, 'depth'), source: 'walk', depth: 0.5 })
  slots[1] = slot({ target: 'bendUs', depth: 0.3, ...patch })
  return slots
}

describe('the bay as a modulation target', () => {
  it('offers both knobs of every slot, and no more', () => {
    expect(BAY_TARGETS.length).toBe(N_SLOTS * 2)
    // The key space is written out as literals in controls.ts (a template type
    // over `number` would let `bayDepth99` past the parser that repairs a
    // stored bay), so this is what holds the two to the same eight.
    for (const def of BAY_TARGETS) expect(modTarget(def.key)).toBe(def.key)
  })

  it('refuses a key naming a slot the bay has not got', () => {
    expect(modTarget('bayDepth0')).toBe(null)
    expect(modTarget(`bayDepth${N_SLOTS + 1}`)).toBe(null)
    expect(modTarget('bayDepth')).toBe(null)
  })

  it('names itself the way the bay numbers its slots', () => {
    // 1-based on screen, 0-based in the link — the one place the two meet.
    expect(targetLabel(bayKeyFor(2, 'depth'))).toBe('slot 3 depth')
    expect(bayDefFor(bayKeyFor(2, 'depth'))?.slot).toBe(2)
  })
})

describe('what the engine is handed', () => {
  it('carries the driven slot and knob rather than a control', () => {
    const eng = toEngineSlots(wired())
    const wire = eng.find(s => s.bay !== undefined)
    expect(wire?.bay).toEqual({ slot: 1, field: 'depth' })
    // The driven knob's own range, so `depth` on a wire means what it means
    // everywhere else: a fraction of the target's span.
    expect(wire?.min).toBe(0)
    expect(wire?.max).toBe(1)
  })

  it('keeps a routing resting at zero depth when a wire is driving it', () => {
    // The whole point of a depth wire: the wobble is absent until the driver
    // brings it in. Dropping the routing for being silent would leave the
    // driver with nothing to bring.
    const eng = toEngineSlots(wired({ depth: 0 }))
    expect(eng.map(s => s.target)).toContain('bendUs')
  })

  it('still drops a routing at zero depth that nothing is driving', () => {
    const slots = wired({ depth: 0 })
    slots[0] = slot({}) // the wire goes, the silent routing goes with it
    expect(toEngineSlots(slots).map(s => s.target)).not.toContain('bendUs')
  })

  it('does not let a rate wire keep a silent routing alive', () => {
    // A routing at zero depth is silent however fast it runs, so only a depth
    // wire is a reason to keep one on the engine's list.
    const slots = wired({ depth: 0 })
    slots[0] = slot({ target: bayKeyFor(1, 'rate'), depth: 0.5 })
    expect(toEngineSlots(slots).map(s => s.target)).not.toContain('bendUs')
  })

  it('refuses a wire onto its own slot', () => {
    const slots = Array.from({ length: N_SLOTS }, () => slot({}))
    slots[2] = slot({ target: bayKeyFor(2, 'depth'), depth: 0.5 })
    expect(toEngineSlots(slots)).toEqual([])
  })
})

describe('what a link carries', () => {
  it('renumbers a wire across the compaction', () => {
    // Routings are compacted into a link and padded back out positionally, so
    // a hole above the driven slot slides it up. The wire has to move with it
    // or it lands on whatever took its place.
    const slots = Array.from({ length: N_SLOTS }, () => slot({}))
    slots[3] = slot({ target: bayKeyFor(6, 'depth'), depth: 0.5 })
    slots[6] = slot({ target: 'bendUs', depth: 0.3 })
    const back = routingsToSlots(slotsToRoutings(slots))
    // Both moved to the top of the bay, and the wire still names the routing.
    expect(back[1].target).toBe('bendUs')
    expect(back[0].target).toBe(bayKeyFor(1, 'depth'))
  })

  it('keeps a driven routing that rests at zero depth', () => {
    const back = routingsToSlots(slotsToRoutings(wired({ depth: 0 })))
    expect(back[1].target).toBe('bendUs')
    expect(back[0].target).toBe(bayKeyFor(1, 'depth'))
  })

  it('drops a wire whose routing did not survive', () => {
    // A link arriving with a wire pointing at an empty slot is a wobble that
    // does nothing, which reads as the link being broken.
    const slots = wired()
    slots[0] = slot({ target: bayKeyFor(4, 'depth'), depth: 0.5 })
    const routings = slotsToRoutings(slots)
    expect(routings.map(r => r.target)).toEqual(['bendUs'])
  })
})

describe('resolving a wire, a frame later', () => {
  const eng: ModSlot[] = [
    {
      id: 0,
      source: 'sine',
      rateHz: 1,
      depth: 0.4,
      target: 'bendUs',
      min: 0,
      max: 10,
    },
  ]

  it('hands the list straight back with nothing driving', () => {
    // Identity, not equality: this runs on the frame path, and the copy is the
    // only allocation in it.
    expect(driveSlots(eng, new Map())).toBe(eng)
  })

  it('folds a drive into the knob it landed on', () => {
    const drive = new Map([[driveAt(0, 'depth'), 0.25]])
    expect(driveSlots(eng, drive)[0].depth).toBeCloseTo(0.65)
  })

  it('parks a deep wire at the end of the knob rather than inverting it', () => {
    const deep = new Map([[driveAt(0, 'depth'), 5]])
    expect(driveSlots(eng, deep)[0].depth).toBe(1)
    const back = new Map([[driveAt(0, 'depth'), -5]])
    expect(driveSlots(eng, back)[0].depth).toBe(0)
  })

  it('lets a wire stop an LFO dead but never run it backwards', () => {
    // A negative rate walks the phase backwards past the wrap ModState reads a
    // completed cycle off, which would leave `walk` and `hold` re-rolling every
    // frame instead of once a cycle.
    const stop = new Map([[driveAt(0, 'rate'), -4]])
    expect(driveSlots(eng, stop)[0].rateHz).toBe(0)
  })

  it('leaves a slot no wire landed on exactly as it was', () => {
    const other = new Map([[driveAt(3, 'depth'), 0.5]])
    expect(driveSlots(eng, other)[0]).toBe(eng[0])
  })
})
