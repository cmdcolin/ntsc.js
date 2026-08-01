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
