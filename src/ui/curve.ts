// Non-linear slider travel.
//
// Some controls are naturally read as their own reciprocal. Magnification is the
// clearest: 4x is "a quarter of the screen left in view", so a linear track from
// 1x to 12x spends four fifths of its travel between 3x and 12x — the deep end
// you visit once — and crams the useful 1x..2x into the first nine percent.
// Interpolating the reciprocal instead spreads the travel evenly over how much
// is still in view: the first fifth covers 1x to 1.25x, and only the last notch
// goes all the way in.
//
// Both directions are exact inverses, so a value round-trips through the track
// without creeping.

export const travelToValue = (min: number, max: number, t: number) =>
  1 / ((1 - t) / min + t / max)

export const valueToTravel = (min: number, max: number, v: number) =>
  (1 / min - 1 / v) / (1 / min - 1 / max)

// Phosphor persistence is the other shape: read as a duration, and duration
// runs geometric in what the layer keeps back. Retention 0.9 holds about ten
// fields, 0.99 a hundred, 0.999 a thousand — four decades of trail crammed into
// the last thousandth of a linear track, while the whole lower half covers
// holds too short to see. Spreading travel over log(1 - v) instead makes every
// equal move the same *ratio* of trail length, roughly a decade per third of
// the track, which is how a duration reads to the eye anyway.
//
// Only the track changes: the stored control is the same retention fraction the
// shader has always read, so presets keep their numbers.
const PERSIST_FLOOR = 0.0005 // 1 - the slider's top retention

// t = 0 lands exactly on 0, which is the control's own off rather than a
// merely-very-short hold — the shader branches on it.
export const persistToValue = (t: number) =>
  t <= 0 ? 0 : 1 - PERSIST_FLOOR ** t

export const persistToTravel = (v: number) =>
  v <= 0
    ? 0
    : Math.log(1 - Math.min(v, 1 - PERSIST_FLOOR)) / Math.log(PERSIST_FLOOR)
