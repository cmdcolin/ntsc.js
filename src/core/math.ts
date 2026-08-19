// The three numeric helpers that had grown a private copy in nearly every file
// that wanted one: eight definitions of three functions, all of them identical.
//
// Small enough that duplicating them was never expensive, which is exactly why
// it kept happening — but `wrap` in particular is the one place a sign error
// hides, since JS `%` keeps the sign of the dividend and every caller here is
// wrapping something that can run backwards (a tape transport, a rolling field,
// an RF phase). One definition is one place for that to be right.
//
// At the root rather than under signal/ or ui/ because both layers want them and
// neither owns them: these are facts about numbers, not about the raster or the
// panel.

// Bound a value to a range. Written min-of-max so a NaN passes through rather
// than being silently pinned to a bound.
export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v))

export const clamp01 = (v: number): number => clamp(v, 0, 1)

// Positive modulo: the remainder JS `%` would give if it did not keep the sign
// of the dividend. `-1 % 525` is -1, which as a line index reads off the end of
// the raster; this answers 524.
export const wrap = (x: number, m: number): number => ((x % m) + m) % m
