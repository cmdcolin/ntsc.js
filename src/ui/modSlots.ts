// The modulation patchbay, as data. Everything about slots that isn't React:
// what a routing is, how a stored one is repaired, and how the UI's view of the
// bay is turned into the flat list the render loop applies.
//
// Split out of ModSection because motion stopped being one panel section's
// private state: a preset carries it, a link carries it, undo restores it, and
// any control row can claim a slot. All of those need the same rules, and none
// of them should have to mount a section to get at them.

import { SLIDER_BY_KEY } from './controls'

import type { ControlKey, ModSlot } from '../controls'
import type { ModSource } from '../signal/modstate'

// Eight rather than four: with a ∿ on every control row, a slot is claimed by
// asking rather than by opening a dedicated panel, and four ran out in about a
// minute of that.
export const N_SLOTS = 8

// A routing with no UI state in it: what is moving, driven by what, how fast
// and how far. Deliberately without min/max — those come from the control's own
// slider at apply time, so a routing stored in localStorage or pasted in a link
// can't pin a range that has since been retuned.
export interface ModRouting {
  target: ControlKey
  source: ModSource
  rateHz: number
  depth: number
}

// A slot as the panel holds it: same fields, plus the off state. Position is
// identity — see normalizeSlots.
export interface UiSlot {
  target: ControlKey | '' // '' = slot off
  source: ModSource
  rateHz: number
  depth: number
  // Whether this routing is running, as opposed to whether it exists. A patch
  // you can park: `remove` throws the routing away and dragging depth to zero
  // throws away the depth you dialed in, so neither was a way to see the picture
  // without one wobble and then have it back the way it was.
  //
  // Deliberately *not* part of ModRouting, on the same rule the motion amount
  // follows: the routing is the look and the switch is a gesture, so a link
  // hands over the patch and leaves the reader to decide what runs. Absent from
  // a stored bay it reads as on, so every localStorage entry and every link
  // written before this existed still loads as a bay that moves.
  on: boolean
}

// What an unrouted slot holds, and what a row claims when it first asks for
// motion: slow enough to read as drift rather than flicker, deep enough that
// the picture visibly moves on the first click.
export const EMPTY_SLOT: UiSlot = {
  target: '',
  source: 'sine',
  rateHz: 0.5,
  depth: 0.2,
  on: true,
}

export const MOD_SOURCES: { value: ModSource; label: string }[] = [
  { value: 'sine', label: 'sine LFO' },
  { value: 'triangle', label: 'triangle LFO' },
  { value: 'walk', label: 'random walk' },
  { value: 'smooth', label: 'smooth noise' },
  { value: 'hold', label: 'sample & hold' },
  { value: 'lorenz', label: 'lorenz chaos' },
  { value: 'level', label: 'audio level' },
  { value: 'hit', label: 'audio hit' },
]

export const RATE_MIN = 0.02
export const RATE_MAX = 10

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v))

// The schema lookups, written to hand back the typed value rather than to
// assert one: a link and a localStorage entry are both untrusted strings, and
// "is this in the table" is the only honest way to find out what they name.
export function modTarget(v: unknown): ControlKey | null {
  for (const key of SLIDER_BY_KEY.keys()) {
    if (key === v) return key
  }
  return null
}

export function modSource(v: unknown): ModSource | null {
  return MOD_SOURCES.find(s => s.value === v)?.value ?? null
}

const field = (o: object, k: string): unknown =>
  k in o ? Reflect.get(o, k) : undefined

// One stored/pasted entry, or null if it isn't one. Field-checked rather than
// trusted: `readArray` guards the parse, not the shape, and a stored `[null]`
// used to throw out of the loader at mount and take the whole app with it.
function readSlot(raw: unknown): UiSlot | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rawTarget = field(raw, 'target')
  const target = rawTarget === '' ? '' : modTarget(rawTarget)
  const source = modSource(field(raw, 'source'))
  const rateHz = field(raw, 'rateHz')
  const depth = field(raw, 'depth')
  if (target === null || source === null) return null
  if (typeof rateHz !== 'number' || !Number.isFinite(rateHz)) return null
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return null
  return {
    target,
    source,
    rateHz: clamp(rateHz, RATE_MIN, RATE_MAX),
    depth: clamp(depth, 0, 1),
    // Only an explicit `false` parks a routing. Anything else — a bay stored
    // before the switch existed, a link's ModRouting, a hand-edited entry — is
    // a routing that should run, and reading it as parked would silently stop
    // every wobble a returning user had patched.
    on: field(raw, 'on') !== false,
  }
}

// Pad a stored bay out to N_SLOTS, blanking bad entries **in place**.
//
// Position is what ModState keys a wave's phase and noise seed by, so a stale
// entry must leave a hole rather than be filtered out: compacting and then
// padding (which is what this used to do) hands slot 2's running phase to slot
// 1 and restarts everything below it — a Lorenz slot re-enters somewhere else
// on the attractor and every LFO jumps, for the sake of one dead routing.
export function normalizeSlots(stored: readonly unknown[]): UiSlot[] {
  return Array.from(
    { length: N_SLOTS },
    (_, i) => readSlot(stored[i]) ?? EMPTY_SLOT,
  )
}

// The bay as the render loop takes it: off and zero-depth slots dropped, the
// target's live range attached, and the slot's position carried along as `id`.
//
// The id has to travel because this list is compacted: keyed by index into the
// compacted list, switching one slot off would hand its neighbour's accumulated
// phase over and restart the rest.
//
// `master` scales every depth at once — the motion amount. At 0 nothing routes,
// so the loop skips modulation entirely and every wave holds its phase, which
// is what makes the freeze resume rather than restart.
export function toEngineSlots(slots: readonly UiSlot[], master = 1): ModSlot[] {
  return slots.flatMap((s, id): ModSlot[] => {
    const def =
      s.target === '' || !s.on ? undefined : SLIDER_BY_KEY.get(s.target)
    const depth = s.depth * master
    return def === undefined || depth === 0
      ? []
      : [
          {
            id,
            source: s.source,
            rateHz: s.rateHz,
            depth,
            target: def.key,
            min: def.min,
            max: def.max,
          },
        ]
  })
}

// A bay from a preset's or a link's routings: positional, padded, capped.
export function routingsToSlots(mod: readonly ModRouting[]): UiSlot[] {
  return normalizeSlots(mod.slice(0, N_SLOTS))
}

// What the look is made of, for a link or a scene. A *parked* routing is still
// a routing and goes in: the patch is the look, the switch is a gesture on top
// of it (the same division the motion amount is on the wrong side of the URL
// for), so a link carries the routing and the browser that threw the switch is
// the one that remembers it — see loadSlots.
export function slotsToRoutings(slots: readonly UiSlot[]): ModRouting[] {
  return slots.flatMap((s): ModRouting[] =>
    s.target === '' || s.depth === 0
      ? []
      : [
          {
            target: s.target,
            source: s.source,
            rateHz: s.rateHz,
            depth: s.depth,
          },
        ],
  )
}
