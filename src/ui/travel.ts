// How a slider's travel maps onto its value.
//
// Most controls are linear and need nothing here. The ones that aren't were
// each spelled out at their call sites — the panel slider, the MIDI CC map and
// the track fill all asking `curve === 'magnifier'` and reaching for lens.ts
// directly — which meant a second curve would have been a third copy of the
// same branch. One table instead, so adding a curve is adding a row.

import { persistToTravel, persistToValue } from './curve'
import { zoomAtTravel, zoomTravel } from './lens'

export type CurveName = 'magnifier' | 'persistence'

// The span a curved control is read through. Structural rather than SliderDef
// itself: MIDI binds against a subset, and this module sits below the schema.
export interface TravelSpan {
  min: number
  max: number
  curve?: CurveName
}

const CURVES: Record<
  CurveName,
  { toValue: (t: number) => number; toTravel: (v: number) => number }
> = {
  magnifier: { toValue: zoomAtTravel, toTravel: zoomTravel },
  persistence: { toValue: persistToValue, toTravel: persistToTravel },
}

// Value → 0..1 track position. Uncurved controls are their own position.
export const toTravel = (span: TravelSpan, v: number): number =>
  span.curve === undefined
    ? (v - span.min) / (span.max - span.min)
    : CURVES[span.curve].toTravel(v)

// 0..1 track position → value. Callers still snap to the control's step grid;
// the curve decides where the travel lands, not what is representable.
export const fromTravel = (span: TravelSpan, t: number): number =>
  span.curve === undefined
    ? span.min + t * (span.max - span.min)
    : CURVES[span.curve].toValue(t)
