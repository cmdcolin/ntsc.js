// The modulation patchbay, as data. Everything about slots that isn't React:
// what a routing is, how a stored one is repaired, and how the UI's view of the
// bay is turned into the flat list the render loop applies.
//
// Split out of ModSection because motion stopped being one panel section's
// private state: a preset carries it, a link carries it, undo restores it, and
// any control row can claim a slot. All of those need the same rules, and none
// of them should have to mount a section to get at them.

import { clamp } from '../math'
import { SLIDER_BY_KEY } from './controls'
import { SYNC_DIVISIONS } from './midi'

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
  // Which SYNC_DIVISIONS entry the rate is locked to, if it is locked at all.
  //
  // Unlike the run switch this *is* part of the look and travels with a link: a
  // wobble on eighth notes is a statement about the patch, and the reader's own
  // tempo is what it should land against — which is the whole point of saying
  // it in beats rather than in Hz. `rateHz` rides along untouched underneath, so
  // a reader with no tempo at all still gets the rate it was authored at.
  syncDiv?: number
}

// A slot as the panel holds it: same fields, plus the off state. Position is
// identity — see normalizeSlots.
export interface UiSlot {
  target: ControlKey | '' // '' = slot off
  source: ModSource
  rateHz: number
  depth: number
  // The clock division this slot's rate is locked to — see ModRouting. Set, the
  // Hz above is what the slot falls back to rather than what it runs at, so
  // dropping the lock returns the rate you had dialed in before it.
  syncDiv?: number
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
  // The one you play. Everything above answers "what is this knob doing"
  // continuously; this answers "what did you just do", which is why it is last —
  // it is a different kind of thing from the seven drifts above it.
  { value: 'trig', label: 'one-shot (fire)' },
]

export const RATE_MIN = 0.02
export const RATE_MAX = 10

// The stab gate as the panel holds it (see signal/stab.ts for the mechanism).
//
// In the bay rather than in DEFAULT_CONTROLS on purpose, and it is the decision
// worth understanding before moving it: a stab rate is not a setting on the
// signal path, it is a clock driving the whole board — the same family as the
// routings it sits with, and it wants the tempo row already at the top of this
// section. Making it a control instead would mean a slider in some GROUP (the
// panel gives every control exactly one row and a test holds that), which means a
// stage on the chain map for a thing that gates every stage; it would also have
// to be exempted from mutate and from the gate's own sweep to stock, since a
// control that cleans itself twice a second stops being a control.
export interface Stab {
  // Stabs per second. 0 is off — the look runs continuously, which is what every
  // session that has never touched this has, so it is also the resting value.
  hz: number
  // How long each stab lasts, in milliseconds. Absolute rather than a fraction of
  // the cycle: doubling the rate on a duty-cycle gate halves the hit, so the one
  // number a set wants to hold still is the one that would move.
  ms: number
  // Which SYNC_DIVISIONS entry the rate is locked to, if it is locked at all —
  // the same lock a slot's rate carries, and for a stronger reason. "Twice a
  // second" is already a musical statement, so a stab train is the thing in this
  // panel most worth locking to the beat.
  syncDiv?: number
}

// Off, at a length that reads as a hit rather than a flicker. 60ms is about four
// frames: long enough for the phosphor and the loops to take a visible bite out
// of the clean picture behind it, short enough that the clean side is what you
// are looking at.
export const DEFAULT_STAB: Stab = { hz: 0, ms: 60 }

export const STAB_HZ_MAX = 12
export const STAB_MS_MIN = 8
export const STAB_MS_MAX = 400

// What the bay is holding: the number the map's MODULATION box wears its amber
// for, and the clause that says what the number counts.
//
// Both, from one function, because the number alone is the mark a *stage of the
// rig* wears — "3 controls off stock" — and that is the wrong sentence about a
// bay. Nothing here is a control moved off its resting value: they are slots
// with something patched into them, and the count is what the section header's
// dot used to say while the bay was a fold in the sidebar.
//
// The gate counts, and it is the reason this is a function rather than a
// `.length`: it is the one thing in the bay that moves the picture without
// occupying a slot, so a box drawn idle while the whole board is being cut in
// and out four times a second would leave the panel's most visible effect with
// nothing anywhere pointing at where it lives. It is also why the clause is
// built here rather than at the two drawings — "2 slots patched" is a lie when
// one of the two is the gate, and that is exactly the kind of thing two callers
// phrase differently.
//
// A parked routing (`on: false`) still counts, on the same rule: it is patched,
// it is holding a slot, and the switch that restarts it is inside the bay.
export interface BayLoad {
  n: number
  // Reads as a clause on its own — "2 slots patched" — because both drawings
  // drop it into a sentence of theirs: the box's hover puts it in brackets after
  // the blurb, the stage heading puts it in front of what a click would do.
  // Empty when the bay is holding nothing, which is also when neither draws it.
  say: string
}

export function bayLoad(slots: readonly UiSlot[], stab: Stab): BayLoad {
  const patched = slots.filter(s => s.target !== '').length
  const gate = stab.hz > 0
  const slotsSay = `${patched} slot${patched === 1 ? '' : 's'} patched`
  return {
    n: patched + (gate ? 1 : 0),
    say: !gate
      ? patched === 0
        ? ''
        : slotsSay
      : patched === 0
        ? 'the stab gate running'
        : `${slotsSay}, and the stab gate running`,
  }
}

// What the gate runs at: the tempo-derived rate while it is locked and something
// is providing a tempo, the dialed Hz otherwise. Same rule (and the same reason)
// as slotRate above, except that 0 stays 0 — an off gate that a tempo lock could
// silently start is a gate that turns itself on.
export function stabRate(stab: Stab, bpm: number | null): number {
  const div = stab.syncDiv
  return div === undefined || bpm === null || stab.hz === 0
    ? stab.hz
    : clamp(bpm / 60 / SYNC_DIVISIONS[div].beats, 0, STAB_HZ_MAX)
}

// What the gate is running at once the freeze has had its say — which is the
// number the "stabs" row reads, and the whole board's cutting rate.
//
// The freeze has to mean it. `❚❚` says "hold everything still", and a gate still
// cutting the whole board in and out four times a second while the wobbles are
// stopped would make that a lie — so the motion amount gates the stabs as an
// on/off rather than scaling them, since half a stab is just a shorter stab and
// the length is already a knob.
//
// Its own function rather than an expression inside the hook because this is the
// rule the row reads *back*: while it answered 0, the slider sat at 0 however far
// it was dragged, and there was nothing here for a test to hold. The fix for that
// lives at the write end (useModSlots lifts the freeze when the gate is dialed
// on), so what this owes the tests is the reading: frozen is 0, and a lock still
// beats the dial.
export function gateRate(
  stab: Stab,
  master: number,
  bpm: number | null,
): number {
  return master === 0 ? 0 : stabRate(stab, bpm)
}

// Off → each division → off, the same cycle a slot's rate and a rate control row
// walk. `hz` rides along untouched, so the dialed rate comes back at the end.
export function withNextStabSync(stab: Stab): Stab {
  const next = stab.syncDiv === undefined ? 0 : stab.syncDiv + 1
  if (next < SYNC_DIVISIONS.length) return { ...stab, syncDiv: next }
  const free = { ...stab }
  delete free.syncDiv
  return free
}

// A stored gate, or the default if it isn't one. Field-checked for the same
// reason readSlot is: localStorage is an untrusted string, and a stored `null`
// used to take the whole app down at mount.
export function readStab(raw: unknown): Stab {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_STAB
  const hz = field(raw, 'hz')
  const ms = field(raw, 'ms')
  return {
    hz:
      typeof hz === 'number' && Number.isFinite(hz)
        ? clamp(hz, 0, STAB_HZ_MAX)
        : DEFAULT_STAB.hz,
    ms:
      typeof ms === 'number' && Number.isFinite(ms)
        ? clamp(ms, STAB_MS_MIN, STAB_MS_MAX)
        : DEFAULT_STAB.ms,
    ...syncDivision(field(raw, 'syncDiv')),
  }
}

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

// A stored/pasted division index, as the patch to spread onto a slot: `{syncDiv}`
// when the list has one there, null when it doesn't. Handing back the patch
// rather than the number keeps "unlocked" as an *absent* key everywhere — a slot
// carrying `syncDiv: undefined` would survive JSON round-trips as a key that
// `'syncDiv' in slot` answers yes to and every reader has to re-check.
export function syncDivision(v: unknown): { syncDiv: number } | null {
  return typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 0 &&
    v < SYNC_DIVISIONS.length
    ? { syncDiv: v }
    : null
}

// What a slot's LFO actually runs at: the tempo-derived rate while it is locked
// to a division and something is providing a tempo, and the dialed Hz otherwise
// — including while a lock is set but no tempo is known, so unplugging the clock
// leaves the wobble where it was rather than stopping it.
//
// Clamped to the rate slider's own range: at 200 BPM a 1/16 lock asks for 13Hz,
// which is past what the slot can hold, and a rate the readout can't show is a
// slot that looks unlocked while running.
export function slotRate(slot: UiSlot, bpm: number | null): number {
  const div = slot.syncDiv
  return div === undefined || bpm === null
    ? slot.rateHz
    : clamp(bpm / 60 / SYNC_DIVISIONS[div].beats, RATE_MIN, RATE_MAX)
}

// Off → each division → off, the same cycle the ♩ on a rate control row walks.
// `rateHz` is deliberately untouched on the way through: it is what the slot
// comes back to at the end of the cycle.
export function withNextSync(slot: UiSlot): UiSlot {
  const next = slot.syncDiv === undefined ? 0 : slot.syncDiv + 1
  if (next < SYNC_DIVISIONS.length) return { ...slot, syncDiv: next }
  const free = { ...slot }
  delete free.syncDiv
  return free
}

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
    // A lock on a division this build no longer has is dropped rather than
    // kept, on the same rule useClockSync's loader follows: every read of it
    // indexes straight into SYNC_DIVISIONS, so a stale index would throw at the
    // first frame instead of degrading to a free-running rate.
    ...syncDivision(field(raw, 'syncDiv')),
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
//
// `bpm` is what a clock-locked slot's rate is derived from. Resolved here rather
// than written into the slot so the lock stays a lock: the tempo moves, every
// locked rate follows it, and nothing has to write the bay back on each tick.
export function toEngineSlots(
  slots: readonly UiSlot[],
  master = 1,
  bpm: number | null = null,
): ModSlot[] {
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
            rateHz: slotRate(s, bpm),
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

// What the look is made of, for a link or a saved look. A *parked* routing is still
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
            ...(s.syncDiv === undefined ? {} : { syncDiv: s.syncDiv }),
          },
        ],
  )
}
