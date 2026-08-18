import { snapToStep } from './controls'
import { fromTravel, toTravel } from './travel'

import type { ControlKey, Controls } from '../controls'
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
export function mutate(
  controls: Controls,
  sliders: readonly SliderDef[],
  amt = 0.12,
  rand: () => number = Math.random,
): Controls {
  const next = { ...controls }
  for (const s of sliders) {
    // Drawn before the skip below, not inside the branch: a seeded jitter has
    // to roll the same look whatever it is rolled off, and a draw that only
    // sometimes happens shifts every control after it.
    const jitter = (rand() * 2 - 1) * amt
    if (ROLL_NEVER_STARTS.has(s.key) && controls[s.key] === 0) continue
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
