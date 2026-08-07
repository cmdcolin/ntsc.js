// A control's value rounded to a sensible number of decimals for its step:
// finer steps show more places. Shared by the slider readout and its help card
// so both round identically (they differ only in how they append the unit).
export const formatValue = (value: number, step: number) =>
  value.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)

// The widest reading a control can ever produce, in characters — its longer
// endpoint plus its unit.
//
// The endpoints bound the whole travel: toFixed pins the decimals, so only the
// integer part varies, and no value on the way to an end can carry more integer
// digits (or a minus sign) than the end itself. So this is a property of the
// control's *definition*, which is the whole point — it is what lets the
// readout column be sized once and stay that size through every number the
// control passes through. See .reading in Slider.module.css for why that
// matters, and Rack in Slider.tsx for how a group shares one.
export const readingChars = (
  min: number,
  max: number,
  step: number,
  unit: string,
) =>
  Math.max(formatValue(min, step).length, formatValue(max, step).length) +
  unit.length
