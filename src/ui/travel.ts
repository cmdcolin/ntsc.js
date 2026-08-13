// How a slider's travel maps onto its value.
//
// Most controls are linear and need nothing here. The ones that aren't were
// each spelled out at their call sites — the panel slider, the MIDI CC map and
// the track fill all asking `curve === 'magnifier'` and reaching for lens.ts
// directly — which meant a second curve would have been a third copy of the
// same branch. One table instead, so adding a curve is adding a row.

import {
  fineToTravel,
  fineToValue,
  persistToTravel,
  persistToValue,
  synthToTravel,
  synthToValue,
} from './curve'
import { zoomAtTravel, zoomTravel } from './lens'

export type CurveName = 'magnifier' | 'persistence' | 'synth' | 'zero' | 'unity'

// The span a curved control is read through. Structural rather than SliderDef
// itself: MIDI binds against a subset, and this module sits below the schema.
//
// `step` is part of it because the fine curves are shaped against it — they
// spread the control's own step grid over the travel rather than imposing a
// shape of their own. See curve.ts.
interface TravelSpan {
  min: number
  max: number
  step: number
  curve?: CurveName
}

// Two of the curves are the same shape around a different stock value: 'zero'
// for the bipolar controls where nothing is happening at 0 (every detune, the
// loop's rotate and shift, the deflection bends), 'unity' for the ones where
// the knife edge is ×1 (the loop's zoom and gain). Naming the fine point rather
// than reading a control's default keeps this module below the defaults table,
// which is where it has to sit for MIDI to bind against the same map.
const CURVES: Record<
  CurveName,
  {
    toValue: (span: TravelSpan, t: number) => number
    toTravel: (span: TravelSpan, v: number) => number
  }
> = {
  magnifier: {
    toValue: (_s, t) => zoomAtTravel(t),
    toTravel: (_s, v) => zoomTravel(v),
  },
  persistence: {
    toValue: (_s, t) => persistToValue(t),
    toTravel: (_s, v) => persistToTravel(v),
  },
  synth: {
    toValue: (_s, t) => synthToValue(t),
    toTravel: (_s, v) => synthToTravel(v),
  },
  zero: {
    toValue: (s, t) => fineToValue(s, 0, t),
    toTravel: (s, v) => fineToTravel(s, 0, v),
  },
  unity: {
    toValue: (s, t) => fineToValue(s, 1, t),
    toTravel: (s, v) => fineToTravel(s, 1, v),
  },
}

// Value → 0..1 track position. Uncurved controls are their own position.
export const toTravel = (span: TravelSpan, v: number): number =>
  span.curve === undefined
    ? (v - span.min) / (span.max - span.min)
    : CURVES[span.curve].toTravel(span, v)

// 0..1 track position → value. Callers still snap to the control's step grid;
// the curve decides where the travel lands, not what is representable.
export const fromTravel = (span: TravelSpan, t: number): number =>
  span.curve === undefined
    ? span.min + t * (span.max - span.min)
    : CURVES[span.curve].toValue(span, t)

export { TRAVEL_STEP } from './curve'
