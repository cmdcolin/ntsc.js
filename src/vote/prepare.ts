import { DEFAULT_CONTROLS } from '../core/controls'
import { smpteBars, sweep } from '../sources/pattern'
import { routingsToSlots, toEngineSlots } from '../ui/modSlots'
import { recipeControls, recipeMod, samplePair } from './candidates'

import type { EngineApi } from '../core/gpu/engineapi'
import type { Recipe } from './candidates'

// Putting a pair of candidates on the two engines, live.
//
// There used to be a recorder here: with one engine the two candidates could not
// be on screen at once, so each was rendered in turn and captured to a webm the
// page looped in a `<video>`. Two engines make that whole apparatus pointless —
// the canvases *are* the previews — and dropping it was not just simplification:
//
//   - The develop time stopped being dead waiting. A recorded clip could not be
//     shown until it existed, so every pair began with a stare at nothing; a live
//     canvas is watchable from the first frame, and watching a feedback look bloom
//     is part of judging it.
//   - No codec between the labeller and the pixels. VP9 on grain and dot crawl is
//     worst-case for a codec — every frame a fresh noise field — and if it mangled
//     one candidate's texture differently from the other's, the vote was partly
//     about the encoder.
//   - The pair is now simultaneous in the strongest sense: not the same number of
//     frames each, but literally the same frames, on the same clock.
//   - And the failure mode went away. A clip recorded in a throttled tab came back
//     with a handful of frames and had to be detected and discarded; a live canvas
//     in a throttled tab is just a slow canvas, on both sides equally.

// The names first, so a string off a <select> can be narrowed back to one with a
// `.find` rather than an assertion — same shape the URL reader uses for source
// modes.
export const VOTE_SOURCE_NAMES = ['bars', 'sweep'] as const
export type VoteSource = (typeof VOTE_SOURCE_NAMES)[number]

// The sources a pair can be judged over. Deliberately only the two synthetic
// generators: both are produced on the spot by a pure function, identical on
// every machine and every run, with no fetch to fail and no decode timing to vary
// between the two sides. The bundled clips and the cat photo would each bring
// their own content into the comparison, and a moving source would mean the two
// candidates saw different input frames — precisely the confound this page exists
// to avoid.
const VOTE_SOURCES: Record<VoteSource, () => OffscreenCanvas> = {
  bars: smpteBars,
  sweep,
}

// How long a pair is left to develop before it can be voted on.
//
// Feedback and tape looks bloom over hundreds of frames — the gallery harness
// steps 150-900 for exactly this reason — so a vote cast at frame 3 systematically
// misjudges every look whose character arrives late. The buttons stay disabled
// until this passes.
//
// Wall-clock rather than a frame count, and that is a deliberate change from the
// recorded version: two engines on one device run at roughly half the rate one
// does, so a fixed frame count stretched the wait in proportion to how busy the
// GPU was. Seconds are what the labeller actually experiences, and both sides
// develop for the same seconds whatever rate the loop is managing.
export const DEVELOP_MS = 3000

// Milliseconds of stock signal between pairs.
//
// Two engines fixed the contamination *within* a pair — neither candidate develops
// in the other's leftovers any more. What is left is *across* pairs: the left
// engine goes from this pair's left candidate straight to the next pair's left
// candidate, and a look developing on top of an unrelated look's residue is not
// the same stimulus as the same look developing from clean. It is also what a
// candidate re-rendered later from its recorded link would get, so this is what
// keeps the stored look and the judged look the same thing.
//
// Both engines flush at the same time, so it costs this once rather than twice.
export const FLUSH_MS = 600

export interface LivePair {
  seed: number
  source: VoteSource
  // In display order — left, right. Which recipe landed on which side is decided
  // here, from the seed, so it is reproducible and recorded rather than a fresh
  // coin flip the dataset cannot see.
  left: Recipe
  right: Recipe
}

// Hold both engines on stock controls, so neither candidate inherits what the
// last pair left in its feedback buffers.
export function flushEngines(engines: readonly EngineApi[]) {
  for (const engine of engines) {
    engine.applyControls(DEFAULT_CONTROLS)
    engine.setModSlots([])
  }
}

// Put one recipe on one engine.
function show(engine: EngineApi, recipe: Recipe) {
  engine.applyControls(recipeControls(recipe))
  // Motion goes through the same conversion the panel uses, rather than a second
  // reading of what a routing means: `routingsToSlots` pads and caps the bay
  // positionally and `toEngineSlots` resolves each slider's range, so a
  // candidate's wobble here is the wobble the app would reproduce from the
  // recorded link.
  engine.setModSlots(toEngineSlots(routingsToSlots(recipeMod(recipe))))
}

// Roll a pair from a seed and put it on the two engines. Synchronous — the engines
// are already running, so this is two uniform writes each and the picture follows
// on the next frame.
export function showPair(
  engines: readonly [EngineApi, EngineApi],
  seed: number,
  source: VoteSource,
): LivePair {
  const [first, second] = samplePair(seed)
  // Side assignment from the seed rather than from Math.random: the record says
  // which candidate was on the left, and a left-hand bias is only measurable
  // afterwards if the assignment is part of the reproducible pair.
  const swap = seed % 2 === 1
  const [left, right] = swap ? [second, first] : [first, second]
  for (const engine of engines) engine.setImageSource(VOTE_SOURCES[source]())
  show(engines[0], left)
  show(engines[1], right)
  return { seed, source, left, right }
}
