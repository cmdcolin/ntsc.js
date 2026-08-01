import { snapToStep } from './controls'

import type { Controls } from '../controls'
import type { SliderDef } from './controls'

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
