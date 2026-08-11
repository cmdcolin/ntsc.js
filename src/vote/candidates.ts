import { DEFAULT_CONTROLS } from '../controls'
import { randomIndex, rngFor } from '../rng'
import { VIEW_KEYS } from '../ui/controls'
import { PRESETS, blendMod, blendPresets, randomPresetMix } from '../ui/presets'

import type { Controls } from '../controls'
import type { ModRouting } from '../ui/modSlots'
import type { PresetWeights } from '../ui/presets'

// What the vote page shows a pair of, and what the training set is ultimately a
// ranking over: a *recipe* — a sparse weighting of the authored presets, which
// `blendPresets` expands into the full 215-control board.
//
// The reason the dataset is recipes and not control vectors is sample size. A
// human casts a few hundred votes, not a few hundred thousand, and no preference
// model fits 215 free dimensions from that. The preset weighting is the same
// search space `randomPresetMix` already samples for the "surprise" button —
// ~70 presets across a dozen groups, two or three of them active at a time —
// and it is small enough that a few hundred comparisons say something. The
// resolved controls come along in the record anyway (see votes.ts), so a later
// model is free to look at them; nothing here forecloses that.
//
// It IS a call into `randomPresetMix`, now that the function takes a `rand` the
// way `mutate()` always has. It could not be before: rolling `Math.random()`
// internally, its output could not be reproduced from anything written down, and
// a label is worthless if the thing labelled cannot be rendered again. Threading
// the generator settles that — the seed goes in, the recipe carries the seed,
// and the roll comes back byte-identical.
//
// Sharing the sampler is not tidiness, it is the premise. This dataset is only
// worth collecting if it ranks the space the button actually draws from; two
// copies of "the recipe shape" drift, and the day they do, the model is being
// taught to score rolls nobody can get. The roll's own rules — one lead whole,
// followers that do not tread on what it claimed, no second whole board — are
// therefore observed here for free rather than restated.
export type RecipeKind = 'mix' | 'anchor'

export interface Recipe {
  // Reproduces the roll exactly: same seed, same weights, forever.
  seed: number
  // Preset name -> how much of it is dialed in. A plain object rather than the
  // Map `blendPresets` wants, because this shape is what goes into Firestore and
  // comes back out of an export as JSON.
  weights: Record<string, number>
  // 'anchor' is a single authored preset at full weight, injected into some
  // pairs on purpose. Two reasons, both worth the slot in the record: it
  // calibrates the scale (a rolled mix that beats a hand-tuned preset is a real
  // find), and it is the control for the failure mode where the model has only
  // learned to recognise "this is one of the 70 curated looks" rather than
  // anything about what makes a look good.
  kind: RecipeKind
}

// The presets a roll can draw from, and the two groups it cannot.
//
// 'Clean' is excluded because it is the absence of a look — it is the baseline
// every other preset departs from, and a pair with clean on one side is not a
// question about taste. 'A/B mixing' is excluded because the vote page feeds one
// source: every control in those presets addresses a second input that is not
// patched in, so they would render as near-nothing and lose every comparison for
// a reason that has nothing to do with the look. `randomPresetMix` drops the
// same group when source B is off, for the same reason.
const POOL = PRESETS.filter(
  p => p.group !== 'Clean' && p.group !== 'A/B mixing',
)
// Presets eligible to appear as an anchor — the same pool, so an anchor is
// judged against mixes drawn from the families it belongs to.
export const ANCHOR_PRESETS = POOL.map(p => p.name)

// How often a pair puts an authored preset on one side. Low enough that most
// comparisons are mix-vs-mix (which is what the model has to get good at) and
// high enough that a few hundred votes carry enough anchored pairs to check
// against.
export const ANCHOR_RATE = 0.15

// Two decimals. Weights are read by eye off the record during analysis, and a
// float with seventeen digits of tail says nothing the second digit did not.
const round2 = (v: number) => Math.round(v * 100) / 100

// One full preset plus one or two partials from *other* groups — the recipe the
// "random look" button rolls, drawn here from a seeded generator instead of
// `Math.random`. Crossing groups is what makes a roll interesting: deepening one
// family gives a slightly-more-of-the-same, while a tape fault over a sync fault
// is a picture nobody authored.
//
// `false` for source B for the same reason POOL drops 'A/B mixing': the vote
// page feeds one source, so those presets would render as near-nothing and lose
// every comparison for a reason that has nothing to do with taste.
export function sampleRecipe(seed: number): Recipe {
  const rolled = randomPresetMix(false, rngFor(seed))
  const weights: Record<string, number> = {}
  for (const [name, w] of rolled) weights[name] = round2(w)
  return { seed, weights, kind: 'mix' }
}

// A single authored preset at full weight. Its seed is the roll that chose it,
// so the pair it came from still reproduces.
export function anchorRecipe(seed: number): Recipe {
  const rand = rngFor(seed)
  const name = ANCHOR_PRESETS[randomIndex(ANCHOR_PRESETS.length, rand)]
  return { seed, weights: { [name]: 1 }, kind: 'anchor' }
}

// The two candidates for one comparison, from one seed.
//
// Derived seeds rather than two independent ones: the pair is the unit the page
// advances through and the record refers to, so one number has to regenerate
// both sides. The `* 2` / `* 2 + 1` split keeps the two halves from ever landing
// on the same recipe.
export function samplePair(seed: number): [Recipe, Recipe] {
  const rand = rngFor(seed)
  const a = seed * 2
  const b = seed * 2 + 1
  // At most one side is an anchor. A pair of authored presets is a question
  // about the preset list rather than about the search space, and it spends a
  // vote without moving the model.
  const roll = rand()
  if (roll < ANCHOR_RATE / 2) return [anchorRecipe(a), sampleRecipe(b)]
  if (roll < ANCHOR_RATE) return [sampleRecipe(a), anchorRecipe(b)]
  return [sampleRecipe(a), sampleRecipe(b)]
}

const asWeights = (recipe: Recipe): PresetWeights =>
  new Map(Object.entries(recipe.weights))

// The board this recipe means.
//
// View controls are pinned to their defaults rather than blended, which is an
// experimental control and not the same reason `useMix.surprise` pins them. In
// the app, the magnifier is where *you* are looking and a roll has no business
// moving it. Here there is no user framing to protect — the reason is that two
// candidates must be judged at the same magnification and the same crop, or the
// vote records which one happened to be zoomed in.
export function recipeControls(recipe: Recipe): Controls {
  const out = blendPresets(DEFAULT_CONTROLS, asWeights(recipe))
  for (const key of VIEW_KEYS) out[key] = DEFAULT_CONTROLS[key]
  return out
}

// How this recipe moves. An empty bay rather than `null`: the page applies a
// candidate over whatever the previous one left running, so "no opinion about
// motion" has to mean "stop moving" here, or a wobble patched by candidate A
// would still be wobbling under candidate B and the comparison would be between
// a look and itself-plus-a-leftover.
export function recipeMod(recipe: Recipe): ModRouting[] {
  return blendMod(asWeights(recipe)) ?? []
}

// A stable id for a recipe, from what it *means* rather than from the seed that
// happened to produce it. Two different seeds that land on the same weighting
// are the same candidate and should collect votes into one bucket — that is the
// whole reason the id is a hash of the weights.
//
// FNV-1a over a canonicalised weight list. Not a cryptographic hash and it does
// not need to be: a collision costs two unrelated looks sharing a row in an
// export, and 32 bits over a space this small will not produce one.
export function recipeId(recipe: Recipe): string {
  const canon = Object.entries(recipe.weights)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, w]) => `${name}:${w}`)
    .join(',')
  let h = 0x811c9dc5
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36).padStart(7, '0')
}
