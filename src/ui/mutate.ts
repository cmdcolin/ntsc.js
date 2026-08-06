import { snapToStep } from './controls'

import type { Controls } from '../controls'
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
export const MUTATE_AMOUNTS = {
  gentle: 0.04,
  normal: 0.12,
  wild: 0.3,
  turbo: 0.6,
}
export type MutateAmount = keyof typeof MUTATE_AMOUNTS

// Which roll a click is asking for. Shared by the panel's two mutate buttons —
// the bar's and each stage's ⚄ — so the modifiers cannot drift apart between
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

// Nudge every control by a random fraction of its own slider range — the
// bender's hand brushing all the pots at once. Jittering *around* the current
// look rather than picking fresh-random values keeps sync, colour, and geometry
// roughly intact, so the result reads as a variation worth keeping instead of
// the black-screen mush a full randomize usually collapses to.
export function mutate(
  controls: Controls,
  sliders: readonly SliderDef[],
  amt = 0.12,
  rand: () => number = Math.random,
): Controls {
  const next = { ...controls }
  for (const s of sliders) {
    const jitter = (rand() * 2 - 1) * amt * (s.max - s.min)
    // snapToStep lands mode-select controls (step 1) on whole integers rather
    // than a fractional index no shader branch expects.
    next[s.key] = snapToStep(s, controls[s.key] + jitter)
  }
  return next
}
