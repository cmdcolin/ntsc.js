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

// The video synth's oscillators are the third shape, and the most extreme: the
// useful range runs from field rate to past the subcarrier, five and a half
// decades, and every decade of it is a different instrument. A linear track
// would put the entire span from a vertical gradient to standing bars — 60 Hz
// to 15.7 kHz, which is most of what anyone patches — inside the first two
// thousandths of the travel. Geometric spacing gives each decade the same reach,
// so hunting the beat either side of line rate is a normal-sized gesture.
const SYNTH_FLOOR = 10 // Hz; below this one cycle does not fit in a frame
const SYNTH_TOP = 8e6

// t = 0 is the oscillator switched off, not merely very slow — a stopped
// oscillator is a flat field, which is a thing you want to be able to select.
export const synthToValue = (t: number) =>
  t <= 0 ? 0 : SYNTH_FLOOR * (SYNTH_TOP / SYNTH_FLOOR) ** t

export const synthToTravel = (v: number) =>
  v <= SYNTH_FLOOR
    ? 0
    : Math.log(v / SYNTH_FLOOR) / Math.log(SYNTH_TOP / SYNTH_FLOOR)
