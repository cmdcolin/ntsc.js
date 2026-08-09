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

// One character of the panel's mono at --fs-xs, in px. Measured against the
// theme's own --mono stack in Firefox rather than assumed off an em ratio. `ch`
// is exact for this in CSS, but there is no CSS way to *branch* on the answer,
// so the one place that has to know the number is here.
const MONO_CH = 6.62

// The four measurements the fit test below is arithmetic over, every one of them
// declared in a stylesheet. Named rather than inlined so cssModules.test.ts can
// read each back out of the sheet it came from: edit `.button`'s padding or the
// row's track floor and this file would go on quietly using the old number — in
// the direction that admits a switch which then overflows its column.
export const TRACK_FIT = {
  // .row's second grid column in Slider.module.css: minmax(5.5rem, 0.85fr)
  floorRem: 5.5,
  // what a rem is: nothing here sets a root font-size, so the browser default
  // stands — and MONO_CH was measured against the same assumption, --fs-xs's
  // 0.6875rem coming out at 11px
  rem: 16,
  // .button and .group in ToggleButtonGroup.module.css
  buttonPadX: 5,
  buttonBorder: 1,
  gap: 2,
}

// Whether a mode switch's options fit beside its label instead of under it.
//
// A row's track is its second grid column, so `floorRem` is the narrowest that
// column is ever solved to, and a group that fits *that* fits at every panel
// width, 332px sidebar through popout. Nothing here is responsive for the same
// reason the readout reserves its widest possible reading: a row that changed
// shape with its container would move the tracks under the pointer of whoever was
// dragging one.
//
// What a group spends: per option its text, plus its button's padding and border
// on both sides, plus a gap between each pair.
//
// Only the shortest switches pass, which is the intent — `off|on` comes to 59px
// where `hold|record` is 92 and `gated|alternate|ssavi` is 166. Anything wider
// keeps the stacked row, where its options get the full width of the panel
// rather than a third of it.
export const choicesFitTrack = (choices: readonly string[]) =>
  choices.reduce(
    (w, c) =>
      w +
      c.length * MONO_CH +
      2 * (TRACK_FIT.buttonPadX + TRACK_FIT.buttonBorder),
    0,
  ) +
    Math.max(0, choices.length - 1) * TRACK_FIT.gap <=
  TRACK_FIT.floorRem * TRACK_FIT.rem

// What an unknown throw reads as. Every async path in this app ends at a banner
// or a dialog note, and `String(e)` on a real Error prints "Error: …" while
// `e.message` on a rejected non-Error prints nothing at all — so both callers
// grew the same three lines rather than pick one and be wrong half the time.
export const reason = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)
