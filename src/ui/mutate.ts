import { DEFAULT_CONTROLS } from '../controls'
import { snapToStep } from './controls'
import { fromTravel, toTravel } from './travel'

import type { ControlKey, Controls } from '../controls'
import type { Rand } from '../rng'
import type { SliderDef } from './controls'

// How hard a jitter lands, as a fraction of each slider's range. `normal` is
// what the mutate button has always rolled; the other two exist because a
// search needs both step sizes — `gentle` to creep around a look that is nearly
// right, `wild` to get out of a corner the current one has painted you into.
//
// `turbo` is not another step of the same search: at 0.6 of a span that now
// runs well past what the hardware would do, a roll lands most controls
// somewhere they have no business being, and the point is the wreck rather than
// a variation on the look you had. It keeps the same shape as the others —
// jitter around where things sit, not fresh-random — so a turbo roll off a
// patch you like still remembers it was that patch.
// The names first and the record against them, rather than the other way round
// — the same shape `MORPH_SECONDS` and `POOL_MODES` use, and for the reason
// they use it: a stored amount read back off a strip row has to be narrowed
// from `unknown`, and a list is something `.find` can narrow through where a
// record's keys are only reachable by asserting.
const MUTATE_KEYS = ['gentle', 'normal', 'wild', 'turbo'] as const
export type MutateAmount = (typeof MUTATE_KEYS)[number]

export const MUTATE_AMOUNTS: Record<MutateAmount, number> = {
  gentle: 0.04,
  normal: 0.12,
  wild: 0.3,
  turbo: 0.6,
}

// A stored name back onto the list, or undefined for anything that is not one.
export const parseMutateAmount = (v: unknown): MutateAmount | undefined =>
  MUTATE_KEYS.find(a => a === v)

// Which roll a click is asking for. Shared by the panel's two mutate buttons —
// the bar's and each stage's die — so the modifiers cannot drift apart between
// them. Meta as well as ctrl because ctrl-click is the context menu on macOS
// and never reaches an onClick there.
export function mutateAmountFor(e: {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): MutateAmount {
  if (e.ctrlKey || e.metaKey) return 'turbo'
  if (e.shiftKey) return 'wild'
  if (e.altKey) return 'gentle'
  return 'normal'
}

// Controls a roll may vary but must never switch on from rest.
//
// `strobeHz` at 0 is a picture. A hair above it the beam-blanking gate is held
// on, and the flash length is absolute rather than a share of the cycle — 40ms
// at stock — so *every* rate a roll can reach leaves the tube dark for around
// 95% of the time (signal/strobe.ts, and the measurement in DEVELOPMENT.md's
// screening notes). That is not a variation on the look: it hides whatever else
// the roll did behind a full-field flash a few times a second, and a few times a
// second is the band where a photosensitive viewer pays for it. The rule the
// button needs is therefore narrow — a roll never *starts* a strobe. Rolled off
// a look that is already strobing it is a control like any other, which is why
// this is a set of keys and a test against rest rather than another VIEW_KEYS.
//
// All three rolls read it: the jitter below, the bay (`rollMod`, which will not
// patch modulation onto a control it may not start) and the preset roll
// (`rollControls`), which used to be the hole in it — random look picked the
// strobed tube on 3% of presses and started one anyway.
export const ROLL_NEVER_STARTS = new Set<ControlKey>(['strobeHz'])

// Nudge every control by a random fraction of its own slider *travel* — the
// bender's hand brushing all the pots at once. Jittering *around* the current
// look rather than picking fresh-random values keeps sync, colour, and geometry
// roughly intact, so the result reads as a variation worth keeping instead of
// the black-screen mush a full randomize usually collapses to.
//
// Travel rather than value, which is the same thing on the linear majority and
// not remotely the same on a curved control. Phosphor persistence is the worst
// of them: the value is geometric in the trail it gives, so a 0.12 jitter off a
// look sitting at 0.9 — a tenth of a second of afterglow — hit the top of the
// dial and half a minute of smear on about one press in twelve, wiping out
// whatever else the roll had just done. On the track those are a third of the
// travel apart, and a nudge moves the hold by a ratio the way the slider does.
//
// `wake` is what keeps the nudge a nudge. Jittering all 230 sliders moved 165
// of them per press — measured, off five rolled looks and off stock — against
// the 10 to 35 those looks had off rest in the first place. That is not a
// variation on a look, it is every fault in the rig switched faintly on at
// once, over whatever you had dialed in; the button read "nudge" and behaved
// like a fresh randomize with the old look showing through it. So a control
// that is already doing something is always jittered, and one resting at stock
// only wakes with this probability — half the amount, so the same modifier
// ladder that makes a roll go further also makes it wake more. A press off a
// 14-control look now moves about 27 controls: the look, plus a handful of new
// things to notice.
//
// A roll aimed at one circuit passes `wake: 1` instead, and should: naming the
// stage is the whole gesture, so a stage sitting at stock has to shake.
export function mutate(
  controls: Controls,
  sliders: readonly SliderDef[],
  amt = 0.12,
  rand: () => number = Math.random,
  wake = amt / 2,
): Controls {
  const next = { ...controls }
  for (const s of sliders) {
    // Both drawn before either skip, not inside the branches: a seeded jitter
    // has to roll the same look whatever it is rolled off, and a draw that only
    // sometimes happens shifts every control after it.
    const jitter = (rand() * 2 - 1) * amt
    const woken = rand() < wake
    if (ROLL_NEVER_STARTS.has(s.key) && controls[s.key] === 0) continue
    if (!woken && controls[s.key] === DEFAULT_CONTROLS[s.key]) continue
    // snapToStep lands mode-select controls (step 1) on whole integers rather
    // than a fractional index no shader branch expects, and clamps a jitter
    // that ran off either end of the track.
    next[s.key] = snapToStep(
      s,
      fromTravel(s, toTravel(s, controls[s.key]) + jitter),
    )
  }
  return next
}

// How many controls a spike throws, per amount. Small on purpose: the whole
// difference between this and `mutate` is that you can see what changed, and a
// roll that moved twelve things is a roll you read as "something else" rather
// than as "that knob, hard".
export const SPIKE_TARGETS: Record<MutateAmount, number> = {
  gentle: 1,
  normal: 2,
  wild: 4,
  turbo: 7,
}

// How far a thrown control must land from where it sat, as a share of its
// travel. Below about a third the throw reads as a nudge that happened to be
// loud; at 0.45 the control is unmistakably somewhere else, and the arithmetic
// stays simple — under 0.5 there is always somewhere legal to land, whatever
// end of the track the control was resting at.
const SPIKE_THROW = 0.45

// A few controls thrown a long way, and nothing else touched.
//
// The opposite shape of roll from `mutate`, which moves everything a little:
// this moves almost nothing, a lot. Both answer "give me an accident", and they
// are not the same accident — a dense small jitter drifts the whole look off
// its mark and leaves you unable to say what did it, where a sparse big throw
// is one fault you can name, undo, or dial back on the row it landed on. It is
// also the roll that survives being pressed on a look you like: everything you
// dialed in is still exactly where you left it.
//
// Only look-makers are eligible. A fine trim thrown to the end of its track is
// a press that appears to have done nothing, which for a two-control roll is
// half the time — where `mutate` can afford to shake the trims because it is
// shaking the look-makers in the same breath.
export function spike(
  controls: Controls,
  sliders: readonly SliderDef[],
  count: number,
  rand: Rand = Math.random,
): Controls {
  const pool = sliders.filter(
    s =>
      s.fine !== true &&
      !(ROLL_NEVER_STARTS.has(s.key) && controls[s.key] === 0),
  )
  const order = [...pool]
  const next = { ...controls }
  for (let i = 0; i < Math.min(count, order.length); i++) {
    // Clamped, because `rand` is documented as [0, 1) and a test generator that
    // answers a flat 1 is exactly the input a range check should survive.
    const j = Math.min(
      order.length - 1,
      i + Math.floor(rand() * (order.length - i)),
    )
    ;[order[i], order[j]] = [order[j], order[i]]
    const s = order[i]
    const from = toTravel(s, controls[s.key])
    // The track minus the band around where the control already is, as two
    // stretches measured end to end: draw along their total length and the
    // landing is uniform over everywhere far enough away, with no rejection
    // loop and no bias toward whichever stretch is shorter.
    const below = Math.max(0, from - SPIKE_THROW)
    const above = Math.max(0, 1 - from - SPIKE_THROW)
    const draw = rand() * (below + above)
    const t = draw < below ? draw : from + SPIKE_THROW + (draw - below)
    next[s.key] = snapToStep(s, fromTravel(s, t))
  }
  return next
}

// Half the circuits from the look on the board, the rest from a fresh roll.
//
// Neither of the other whole-look rolls can produce this. `random look` throws
// away what you had and `random nudge` keeps all of it — and what a session
// actually wants after twenty minutes is usually neither: keep the tape and the
// tube exactly as dialed, and let something else answer for the sync and the
// screen. Crossing at the circuit rather than the control is the whole point:
// the controls inside one stage were tuned against each other, so a coin
// flipped per knob would land on a stage half of one look and half of another,
// which is the mush the preset blender already goes to lengths to avoid.
//
// The last flip is forced when every other one kept: a roll that can come out
// as no change at all is a button people press twice and stop trusting.
export function crossover(
  current: Controls,
  rolled: Controls,
  circuits: readonly (readonly SliderDef[])[],
  rand: Rand = Math.random,
): Controls {
  const changing = circuits.filter(c =>
    c.some(s => rolled[s.key] !== current[s.key]),
  )
  const taken = changing.filter(() => rand() < 0.5)
  const from =
    taken.length > 0
      ? taken
      : changing.length === 0
        ? []
        : [changing[Math.floor(rand() * changing.length)]]
  const next = { ...current }
  for (const c of from) for (const s of c) next[s.key] = rolled[s.key]
  return next
}
