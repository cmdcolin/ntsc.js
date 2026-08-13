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

import { clamp01 } from '../math'

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

// The fourth shape, and the one that fits the most controls: a knob whose whole
// point is the neighbourhood of its stock setting, on a track long enough to
// reach the far end of the mechanism.
//
// The feedback loop's rotate is the clearest. Its travel is ±180°, because a
// camera can be bolted on at any angle, but what anyone is hunting is the first
// degree or two either side of zero — that is where a spiral goes from a slow
// unwind to a pinwheel. Linear, one pixel of a 150px track is 2.4°, so the
// useful range is four pixels wide and the other 146 are all the same picture
// turning over. The same is true of every detune (zero is locked, ±1 Hz is a
// slow crawl, the rest is diagonal hash), of the loop's shift and zoom, and of
// the deflection bends.
//
// So: expand away from the stock value rather than from the left stop. Travel
// on each side of stock is exponential in the value, which makes an equal move
// of the pointer an equal *ratio* of the offset — the log slider that gets
// coarser the further out you drag.
//
//   v(a) = stock ± edge · expm1(k·a) / expm1(k)     a = 0..1 along that side
//
// k is not a taste knob. It is solved per control so that one notch of travel
// at the stock end moves the value by one of the control's own steps: the track
// resolves everything the control can represent and wastes nothing on moves too
// small to store. That falls out of data already in the SliderDef, so a control
// opts in by naming the curve and nothing else, and it self-tunes — a control
// whose step is already fine relative to its span gets a nearly straight track,
// and rotate (36,000 steps across the span) gets a hard bend. It also lands
// where hand-tuning would: for every control here the redline — the range the
// mechanism was tuned to before the travel was widened past it — comes out at
// roughly two thirds of the way out, rather than in the first few pixels.
//
// The cost is at the far end, and it is the point: out past the redline a notch
// is worth several degrees, which is the resolution that territory deserves.

// The step Slider.tsx puts on a curved control's range input — how many
// positions the track has, and what one arrow key moves. The curve is shaped
// against it, so the two have to be the same number.
export const TRAVEL_STEP = 0.002

interface FineSpan {
  min: number
  max: number
  step: number
}

// expm1(k)/k — the ratio between a curve's coarsest and finest resolution, and
// what has to equal `ratio` below. Rises from 1 (a straight track) with k.
const spread = (k: number) => (k < 1e-9 ? 1 : Math.expm1(k) / k)

// The k that spreads a control's steps over its travel. Bisection rather than a
// closed form: the inverse is a Lambert W, and this runs a few dozen times over
// the life of a session (memoized per control below) against a monotone
// function on a bounded interval.
const solveK = (ratio: number): number => {
  if (!(ratio > 1.0001)) return 0 // already fine enough: leave it straight
  let hi = 1
  while (spread(hi) < ratio && hi < 64) hi *= 2
  let lo = 0
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (spread(mid) < ratio) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// Per control rather than per call: this is read on every render of every
// curved row (the track fill) and on every frame of a drag.
const kBySpan = new Map<string, number>()
const curveK = (span: FineSpan): number => {
  const id = `${span.min}:${span.max}:${span.step}`
  const hit = kBySpan.get(id)
  if (hit !== undefined) return hit
  // How many of the control's own steps one notch of travel jumps today. That
  // is exactly the factor the curve has to take out at the stock end.
  const k = solveK(((span.max - span.min) * TRAVEL_STEP) / span.step)
  kBySpan.set(id, k)
  return k
}

// 0..1 along one side of stock → 0..1 of that side's value range, and back.
const expand = (k: number, a: number) =>
  k === 0 ? a : Math.expm1(k * a) / Math.expm1(k)
const compress = (k: number, x: number) =>
  k === 0 ? x : Math.log1p(x * Math.expm1(k)) / k

// Where the fine point sits on the track: exactly where it sat linearly, so
// each side keeps the travel it always had and only spends it differently. A
// bipolar control's zero stays mid-track; ×1 on the loop's 0.2..4 zoom stays a
// fifth of the way in, with the compressed 1..4 beyond it.
const stockAt = (span: FineSpan, stock: number) =>
  clamp01((stock - span.min) / (span.max - span.min))

export const fineToValue = (span: FineSpan, stock: number, t: number) => {
  const k = curveK(span)
  const p = stockAt(span, stock)
  return t >= p
    ? stock +
        (span.max - stock) * expand(k, p >= 1 ? 0 : clamp01((t - p) / (1 - p)))
    : stock - (stock - span.min) * expand(k, p <= 0 ? 0 : clamp01((p - t) / p))
}

export const fineToTravel = (span: FineSpan, stock: number, v: number) => {
  const k = curveK(span)
  const p = stockAt(span, stock)
  if (v >= stock) {
    const edge = span.max - stock
    return edge <= 0
      ? p
      : p + compress(k, clamp01((v - stock) / edge)) * (1 - p)
  }
  const edge = stock - span.min
  return edge <= 0 ? p : p - compress(k, clamp01((stock - v) / edge)) * p
}
