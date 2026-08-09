import { describe, expect, it } from 'vitest'

import { ALL_SLIDERS, GROUPS } from './controls'
import {
  choicesFitTrack,
  formatBytes,
  formatClock,
  formatValue,
  readingChars,
} from './format'

describe('formatValue', () => {
  it('scales decimals to the step: finer steps show more places', () => {
    expect(formatValue(1.23456, 0.001)).toBe('1.235')
    expect(formatValue(1.23456, 0.1)).toBe('1.23')
    expect(formatValue(60.4, 1)).toBe('60')
  })

  it('treats the 0.01 and 1 thresholds as inclusive lower bounds', () => {
    expect(formatValue(1.5, 0.01)).toBe('1.50')
    expect(formatValue(1.5, 1)).toBe('2')
  })
})

describe('choicesFitTrack', () => {
  it('passes a switch that fits the track column and fails one that does not', () => {
    expect(choicesFitTrack(['off', 'on'])).toBe(true)
    expect(choicesFitTrack(['hold', 'rec'])).toBe(true)
    // 92px against an 88px floor — four pixels, which is why the record head
    // says `rec` (controls.ts). The margin is the point of the assertion.
    expect(choicesFitTrack(['hold', 'record'])).toBe(false)
    expect(choicesFitTrack(['gated', 'alternate', 'ssavi'])).toBe(false)
  })

  it('charges each option for its own button, not just its text', () => {
    // The same five characters, split two ways: padding and a border for each
    // button it is cut into, which is what keeps a five-way switch out of the
    // column however short its words are.
    expect(choicesFitTrack(['ababa'])).toBe(true)
    expect(choicesFitTrack(['a', 'b', 'a', 'b', 'a'])).toBe(false)
  })

  it('is what decides the panel: three switches earn a one-line row', () => {
    const inline = ALL_SLIDERS.filter(
      s => s.choices !== undefined && choicesFitTrack(s.choices),
    ).map(s => s.label)
    expect(inline).toEqual(['deinterlace', 'vbi test signals', 'record head'])
  })

  // An inline switch pays into its group's shared readout width (Rack in
  // Slider.tsx), so a switch whose longest option is wider than every reading in
  // the group would widen the readout on every slider around it — and take that
  // width from the labels, which is the column the readout was trimmed to feed
  // in the first place. Free today by one character: `off`/`on`/`rec` are 3 and
  // the narrowest group holding one needs 4 for its numbers.
  it('costs its group nothing: no inline switch is the widest thing in its rack', () => {
    const overpaid = GROUPS.flatMap(g => {
      const readings = g.sliders.reduce(
        (n, s) =>
          s.choices === undefined
            ? Math.max(n, readingChars(s.min, s.max, s.step, s.unit))
            : n,
        0,
      )
      return g.sliders
        .filter(s => s.choices !== undefined && choicesFitTrack(s.choices))
        .flatMap(s => (s.choices ?? []).map(c => c.length))
        .some(len => len > readings)
        ? [g.name]
        : []
    })
    expect(overpaid).toEqual([])
  })
})

describe('formatBytes', () => {
  // A size somebody is weighing a wait against, not an exact figure. One decimal
  // below 100 and none above: "3.2 MB" and "148 MB" carry the same amount of
  // decision, where "3 MB" loses the difference between a blink and a pause.
  it.each([
    [3_214_809, '3.2 MB'],
    [147_600_000, '148 MB'],
    [64_000_000, '64.0 MB'],
    [512_000, '512 kB'],
    [900, '1 kB'],
    [0, '0 kB'],
  ])('%d reads as %s', (bytes, want) => {
    expect(formatBytes(bytes)).toBe(want)
  })
})

describe('formatClock', () => {
  it.each([
    [15, '0:15'],
    [59.911, '1:00'],
    [1494, '24:54'],
    [0.4, '0:01'],
  ])('%d seconds reads as %s', (seconds, want) => {
    expect(formatClock(seconds)).toBe(want)
  })

  // Rounded up, never down: a clip announced as shorter than it is, or as
  // `0:00`, is the readout being wrong in the direction that surprises.
  it('never rounds a clip away to nothing', () => {
    expect(formatClock(0.01)).toBe('0:01')
  })
})
