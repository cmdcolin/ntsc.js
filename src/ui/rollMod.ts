// Rolling the bay: a random patch of routings, as `mutate` is a random patch of
// values.
//
// The two rolls in the look bar moved where the board *rests* — `random look`
// stacks presets, `random nudge` jitters every control around where it sits —
// and neither could produce motion that nobody had written down. `random look`
// re-cables the bay, but only from the fourteen authored routings in
// presets.ts, so a session could go a long time without seeing an LFO on
// anything else. This is the third roll: it leaves every resting value exactly
// where it is and rolls *what is moving*.
//
// The whole difficulty is depth. The engine swings a target by
// `depth * (max - min)` (gpu/pipeline.ts › applyMod), a fraction of the raw
// slider span — and the spans are not comparable. The authored routings run
// 0.01 on `cfbDelayUs` and 0.5 on `bKeyHueDeg`, a fifty-fold spread, because
// what a control's span *means* differs per control. Roll one distribution over
// all of them and most slots come out either inert or a wreck, which is the
// failure that makes a random button not worth pressing twice. So the depth is
// derived per target, from what the slider definition already says about
// itself, and the hand-tuned answer wins wherever somebody has written one.

import { DEFAULT_CONTROLS } from '../controls'
import { clamp } from '../math'
import { EMPTY_SLOT, N_SLOTS, RATE_MAX, RATE_MIN } from './modSlots'
import { MUTATE_AMOUNTS } from './mutate'
import { PRESETS } from './presets'

import type { ControlKey, Controls } from '../controls'
import type { Rand } from '../rng'
import type { ModSource } from '../signal/modstate'
import type { SliderDef } from './controls'
import type { UiSlot } from './modSlots'
import type { ModRouting } from './modSlots'
import type { MutateAmount } from './mutate'

// How many routings a roll cables, per amount. A bay is read as a set — eight
// slots, each with a name and a source — so this tops out well short of N_SLOTS
// even at turbo: filling every slot makes a picture with no still part left in
// it to see the moving parts against, which reads as noise rather than as a
// board that is doing something.
const ROUTINGS: Record<MutateAmount, number> = {
  gentle: 1,
  normal: 2,
  wild: 3,
  turbo: 5,
}

// The fastest a rolled LFO may run, per amount. The authored routings sit
// between 0.03 and 0.12Hz — drift, the pace of a circuit warming up, which is
// the pace that makes a fault look like it is happening rather than like it is
// being switched. Rolling the slot's whole range instead would spend most of
// its draws in the buzz above 2Hz, where every source sounds like the same
// source.
const RATE_CEIL: Record<MutateAmount, number> = {
  gentle: 0.25,
  normal: 1,
  wild: 4,
  turbo: RATE_MAX,
}

const RATE_FLOOR = 0.03

// What a rolled slot may swing its target by, before the amount scales it — a
// fraction of the control's own span. Sized to be visible on the first press:
// the button's promise is that the picture starts moving, so a roll that lands
// under the threshold of noticing has failed even when every number in it is
// defensible.
const BASE_DEPTH = 0.18

// The sources a roll draws from, and how often. Weighted towards what the
// authored routings actually use — seven of the fourteen are `smooth`, four are
// `sine` — because that is the closest thing this app has to a record of which
// sources make a fault look mechanical rather than animated.
//
// `trig` is deliberately absent, and it is the one exclusion worth explaining:
// it is playable rather than continuous, so a slot rolled onto it sits there
// producing no motion at all until somebody presses the key that fires it. On a
// button whose whole promise is that the picture starts moving, that reads as
// the roll having silently failed. The authored presets use it freely, because
// a preset is written by somebody who knows they have to play it.
const DRIFT_SOURCES: readonly (readonly [ModSource, number])[] = [
  ['smooth', 4],
  ['sine', 3],
  ['triangle', 2],
  ['lorenz', 2],
  ['walk', 2],
  ['hold', 2],
]

// The two audio followers, drawn only when something is actually feeding them.
// A follower with no sound on the wire is the same dead patch `trig` would be —
// worse, in fact, because there is no key to press to find that out.
const AUDIO_SOURCES: readonly (readonly [ModSource, number])[] = [
  ['level', 2],
  ['hit', 2],
]

// Every routing anybody has hand-tuned, by target: fourteen of them across the
// presets, and the only per-control statement in the app about how much
// modulation a given control wants. Read off PRESETS rather than copied, so
// retuning a preset's routing retunes what a roll does with that target.
//
// Deepest wins where a target carries several (`bendUs` has three), because the
// authored depths are a range somebody found usable and the top of it is still
// inside it.
export const AUTHORED_DEPTH: ReadonlyMap<ControlKey, number> = new Map(
  PRESETS.flatMap(p => p.mod ?? []).reduce<[ControlKey, number][]>(
    (acc, m: ModRouting) => {
      const at = acc.find(([k]) => k === m.target)
      if (at === undefined) acc.push([m.target, m.depth])
      else at[1] = Math.max(at[1], m.depth)
      return acc
    },
    [],
  ),
)

// How far a routing on this control may swing it, as a fraction of its span.
//
// Derived from the definition rather than stored per control, because the
// definition already says everything needed and a second table of two hundred
// numbers is two hundred numbers nobody would ever check:
//
//   `redline` is the range the control was tuned to before its travel was
//   extended past what the hardware would do. Depth is a fraction of the *whole*
//   span, so on a control whose span has since doubled the same number is now
//   twice the swing it was — which is exactly the case the redline marks. So the
//   budget is measured against the tuned range and scaled back into the widened
//   one, and a widened control ends up modulated over the part of its travel it
//   was designed for.
//
//   `curve` marks a control whose whole mechanism lives in the first percent of
//   its span (SliderDef › curve). The travel is expanded around stock for
//   exactly that reason, and a depth that ignores it swings the control across
//   the flat far end where nothing happens, then slams it back through the part
//   that does.
//
// A hand-tuned depth beats both: it is a measurement, and these are inferences.
export function depthBudget(def: SliderDef): number {
  const authored = AUTHORED_DEPTH.get(def.key)
  if (authored !== undefined) return authored
  const span = def.max - def.min
  const tuned =
    def.redline === undefined || span === 0
      ? 1
      : (def.redline[1] - def.redline[0]) / span
  const curved = def.curve === 'zero' || def.curve === 'unity' ? 0.25 : 1
  return BASE_DEPTH * tuned * curved
}

// How likely this control is to be picked, relative to the others. Zero is
// never.
//
// The weights are the whole difference between a roll worth pressing and a
// lottery over two hundred knobs, and each is a guess about the same question:
// is a wobble here going to be *visible*?
//
//   A control somebody has already written a routing for is proof rather than a
//   guess — six times.
//
//   A control that is off its resting value is in a circuit the current look is
//   using: the tape wow on a board with the tape path bypassed moves nothing at
//   all, and there are a great many such controls at any moment. Three times.
//   This is what makes the button answer the look on the board rather than
//   answering the app.
//
//   `fine` marks a trim — it adjusts the character of an effect some other
//   control turns on — so a wobble on one is a wobble on a detail of a detail.
//
//   `choices` is a mode select, and the engine does not snap a modulated value
//   to its steps: a routing on one slides between modes on thresholds, which is
//   a switch flipping rather than a fault breathing. Only at turbo, where the
//   wreck is the point.
function weightFor(def: SliderDef, controls: Controls, enums: boolean): number {
  if (def.choices !== undefined) return enums ? 0.5 : 0
  const authored = AUTHORED_DEPTH.has(def.key) ? 6 : 1
  const live = controls[def.key] !== DEFAULT_CONTROLS[def.key] ? 3 : 1
  const trim = def.fine === true ? 0.35 : 1
  return authored * live * trim
}

// One draw from a weighted list, without replacement — the picked entry is
// spliced out, so a bay never gets two routings onto one control. Two slots on
// one target do stack by design (applyMod says so), but as the *result of a
// roll* it reads as the roll having wasted a slot.
function drawWeighted<T>(pool: { item: T; w: number }[], rand: Rand): T | null {
  const total = pool.reduce((sum, e) => sum + e.w, 0)
  if (total <= 0) return null
  let r = rand() * total
  for (let i = 0; i < pool.length; i++) {
    r -= pool[i].w
    if (r <= 0) return pool.splice(i, 1)[0].item
  }
  return pool.splice(pool.length - 1, 1)[0].item
}

// Log-uniform, so the draw spends as much of itself between 0.03 and 0.3Hz as
// between 0.3 and 3 — which is what "pick a rate" means on a control where the
// interesting range is three decades wide and the readable one is the bottom.
function drawRate(ceil: number, rand: Rand): number {
  const lo = Math.log(RATE_FLOOR)
  const hi = Math.log(Math.max(ceil, RATE_FLOOR))
  return clamp(Math.exp(lo + (hi - lo) * rand()), RATE_MIN, RATE_MAX)
}

export interface RollBayArgs {
  // How hard, on the same ladder the mutate buttons walk — so alt/shift/ctrl
  // mean the same thing on this button as on the one beside it.
  amount: MutateAmount
  // Every control a roll may drive. `MUTATE_SLIDERS` at the call site: the view
  // controls are excluded from a jitter for the same reason they must be
  // excluded here, and more sharply — a wobbling magnifier reads as a bug in
  // the app, and a modulated `timeScale` presents exactly like the lost
  // rendering step in ADR 0004.
  sliders: readonly SliderDef[]
  // What is on the board, for the weighting above. Read at roll time rather
  // than closed over: the look moves constantly and a stale copy would weight
  // the roll towards the circuits of a look that is no longer up.
  controls: Controls
  // Whether anything is feeding the audio followers.
  audioLive: boolean
}

// A whole bay, rolled. Positional and padded to N_SLOTS, like every other
// producer of a bay — the routings land in the first slots and the rest come
// back empty.
//
// It replaces rather than adds, which is the one thing about this button worth
// knowing before pressing it: the bay is part of the look, `random look`
// already re-cables it outright, and a roll that layered onto what was there
// would fill the bay after four presses and then quietly stop doing anything.
// What makes that safe is undo — see useMix, where a motion roll banks a step
// of its own.
export function rollBay(args: RollBayArgs, rand: Rand = Math.random): UiSlot[] {
  const { amount, controls, audioLive } = args
  const enums = amount === 'turbo'
  // The same ladder the jitter walks, as a multiplier on the depth budget:
  // normal is the budget, gentle a third of it, turbo five times it — which is
  // past every budget here and lands most targets against their own rails,
  // which is what turbo promises everywhere else.
  const scale = MUTATE_AMOUNTS[amount] / MUTATE_AMOUNTS.normal
  const targets = args.sliders
    .map(def => ({ item: def, w: weightFor(def, controls, enums) }))
    .filter(e => e.w > 0)
  const sources = [...DRIFT_SOURCES, ...(audioLive ? AUDIO_SOURCES : [])].map(
    ([item, w]) => ({ item, w }),
  )
  const out: UiSlot[] = []
  for (let i = 0; i < ROUTINGS[amount]; i++) {
    const def = drawWeighted(targets, rand)
    if (def === null) break
    // Drawn from a copy: sources are not spent, only targets are.
    const source = drawWeighted([...sources], rand) ?? EMPTY_SLOT.source
    out.push({
      target: def.key,
      source,
      rateHz: drawRate(RATE_CEIL[amount], rand),
      // Never quite the whole budget and never nothing: the bottom of the range
      // is where a rolled slot is patched, named on its row, and invisible.
      depth: clamp(depthBudget(def) * scale * (0.4 + 0.6 * rand()), 0.005, 1),
      on: true,
      // Deliberately unlocked. A slot's ♩ is a statement that this wobble is
      // *in time*, and a lock rolled onto a random division is a statement
      // nobody made — the tempo row is right there for anyone who means it.
    })
  }
  return Array.from({ length: N_SLOTS }, (_, i) => out[i] ?? EMPTY_SLOT)
}
