import { describe, expect, it } from 'vitest'

import { ALL_SLIDERS, SLIDER_BY_KEY, snapToStep } from './controls'
import { formatFine, formatValue } from './format'
import { atCents, CENT_MAX, CENT_MIN, centsOf, notchOf } from './vernier'

import type { SliderDef } from './controls'

const zoom = SLIDER_BY_KEY.get('fbZoom')
const rotate = SLIDER_BY_KEY.get('fbRotateDeg')

const span = (def: SliderDef | undefined) => {
  if (def === undefined) throw new Error('control gone from the schema')
  return def
}

describe('vernier', () => {
  it('reads a trimmed value as its notch plus the cents', () => {
    const s = span(zoom)
    const v = atCents(s, 1, 37)
    expect(v).toBe(1.00037)
    expect(notchOf(s, v)).toBe(1)
    expect(centsOf(s, v)).toBe(37)
    // The row above is unmoved by a trim — that is what makes the card a view
    // of the value rather than a second control.
    expect(formatValue(v, s.step)).toBe(formatValue(1, s.step))
    expect(formatFine(v, s.step)).toBe('1.00037')
  })

  it('round-trips every cent position on the card', () => {
    const s = span(rotate)
    for (let c = CENT_MIN; c <= CENT_MAX; c++)
      expect(centsOf(s, atCents(s, 0, c)), `${c}¢`).toBe(c)
  })

  // Half a step above a notch is already the next notch's -50, so the card
  // never has to show a value it has no position for, and its thumb never
  // jumps stop to stop while a drag is holding it.
  it('leaves no value between two notches unreachable', () => {
    const s = span(zoom)
    const half = 1 + s.step / 2
    expect(notchOf(s, half)).toBe(1.001)
    expect(centsOf(s, half)).toBe(CENT_MIN)
  })

  it('keeps a trim off the ends of the control', () => {
    const s = span(zoom)
    expect(atCents(s, s.max, 40)).toBe(s.max)
    expect(atCents(s, s.min, -40)).toBe(s.min)
  })

  // Moving the row's own track from under a trimmed value carries the trim: it
  // is a remainder on whichever notch the value is nearest, so the two controls
  // compose instead of one wiping the other.
  it('survives the row above it moving a step', () => {
    const s = span(zoom)
    const trimmed = atCents(s, 1, -12)
    const stepped = snapToStep(s, trimmed + s.step)
    expect(centsOf(s, atCents(s, stepped, -12))).toBe(-12)
  })

  it('is only offered where a cent is printable and a mode is not', () => {
    for (const s of ALL_SLIDERS) {
      if (s.vernier !== true) continue
      expect(s.choices, s.key).toBeUndefined()
      // A card whose readout cannot show the digit it is moving would be a
      // track that changes the picture while the number stands still.
      expect(formatFine(s.step / 100, s.step), s.key).not.toBe(
        formatFine(0, s.step),
      )
    }
  })
})
