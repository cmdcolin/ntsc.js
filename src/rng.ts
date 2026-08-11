// Randomness this app can be asked to do again.
//
// Everything that rolls — a look, a jitter, a file out of a pool — takes a
// generator rather than reaching for `Math.random`, so the same seed produces
// the same roll in a browser, in a test, and in an offline re-render. That rule
// is [`docs/EDITOR.md`](../docs/EDITOR.md) › _Seeding_, and its reason is the
// strip: a take whose rows roll is unreproducible by construction, and the whole
// point of rendering one at quality afterwards is that you can get back to the
// four good minutes you just performed.
//
// The convention is a trailing `rand` argument defaulting to `Math.random`,
// which is what `mutate()`, `randomPresetMix()` and `ModState` already do — a
// caller that has a seed passes it, and every existing caller keeps the
// behaviour it had. That default is not laziness: live, unseeded is the right
// answer, since a session nobody is recording should not walk one fixed
// sequence from page load.
//
// At the root, beside `math.ts`, on the same grounds: signal, sources and ui all
// roll, and none of them owns the idea.

// A generator in [0, 1). Named so the seam is visible in a signature — a
// function taking one of these is a function whose output is reproducible, and
// that is worth being able to read off the type.
export type Rand = () => number

// mulberry32, spelled out rather than pulled in: 32 bits of state, no
// dependency, and the same sequence everywhere. Written here rather than in
// `vote/candidates.ts`, where it used to live and where the vote page still
// needs it — the dataset's whole claim is that a recorded seed re-renders the
// look it labelled, which is this module's claim with a different noun.
export function rngFor(seed: number): Rand {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// An index into something of this length. Zero-length answers 0, which is not a
// valid index — but every caller indexes a list it has already established is
// non-empty (a constant pool, or a page `pickOne` has length-checked), so
// answering null or throwing would only add a branch describing a case none of
// them can reach. `pickOne` below is where the empty case is actually handled.
export const randomIndex = (length: number, rand: Rand = Math.random): number =>
  Math.floor(rand() * length)

// One of them, or null when there are none. The null is the point: both pool
// sources call this on candidates that came back from a network request, where
// "the page held nothing usable" is an ordinary outcome and not an error.
export const pickOne = <T>(
  xs: readonly T[],
  rand: Rand = Math.random,
): T | null =>
  xs.length === 0 ? null : (xs[randomIndex(xs.length, rand)] ?? null)
