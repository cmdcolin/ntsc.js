import { describe, expect, it } from 'vitest'

import {
  cueLooping,
  cueRegion,
  dropLoop,
  formatCue,
  insideCue,
  MIN_CUE_LOOP,
  parseCue,
  tapCue,
} from './cue'

const DUR = 20

describe('tapCue', () => {
  it('first press marks a cue and no loop', () => {
    expect(tapCue(null, 4.2, DUR)).toEqual({ in: 4.2, out: null })
  })

  it('second press closes the loop', () => {
    const armed = tapCue(null, 4, DUR)
    expect(tapCue(armed, 5.5, DUR)).toEqual({ in: 4, out: 5.5 })
  })

  it('third press re-arms at the new position and drops the loop', () => {
    const looping = tapCue(tapCue(null, 4, DUR), 5.5, DUR)
    expect(cueLooping(looping)).toBe(true)
    expect(tapCue(looping, 12, DUR)).toEqual({ in: 12, out: null })
  })

  // The gesture must never be a no-op: a press that produced nothing visible
  // reads as a broken button, so a too-fast second tap becomes the shortest
  // loop the clip can play rather than being ignored.
  it('widens a too-fast second tap to the minimum instead of ignoring it', () => {
    const armed = tapCue(null, 4, DUR)
    const out = tapCue(armed, 4.01, DUR)
    expect(out).toEqual({ in: 4, out: 4 + MIN_CUE_LOOP })
    expect(cueLooping(out)).toBe(true)
  })

  // Marking in, scrubbing back, marking out. Without the sort this produces a
  // region whose end precedes its start, which never wraps.
  it('sorts the two marks so a backwards pair still loops', () => {
    const armed = tapCue(null, 8, DUR)
    expect(tapCue(armed, 6, DUR)).toEqual({ in: 6, out: 8 })
  })

  it('clamps both marks into the clip', () => {
    expect(tapCue(null, -3, DUR)).toEqual({ in: 0, out: null })
    expect(tapCue(tapCue(null, 19, DUR), 40, DUR)).toEqual({ in: 19, out: 20 })
  })

  // A slot with no timeline reports duration 0. Nothing should clamp to zero
  // there — the callers gate on duration, but a cue that silently collapsed to
  // {0,0} would be a region the pump would pin the playhead inside forever.
  it('does not clamp against an unknown duration', () => {
    expect(tapCue(null, 4.2, 0)).toEqual({ in: 4.2, out: null })
  })
})

describe('cueRegion', () => {
  it('is null until there is an out-point', () => {
    expect(cueRegion(null)).toBe(null)
    expect(cueRegion({ in: 3, out: null })).toBe(null)
  })

  it('is the marked span once looping', () => {
    expect(cueRegion({ in: 3, out: 4.5 })).toEqual({ start: 3, end: 4.5 })
  })
})

describe('dropLoop', () => {
  it('keeps the cue and lets go of the loop', () => {
    expect(dropLoop({ in: 3, out: 4.5 })).toEqual({ in: 3, out: null })
  })

  it('leaves nothing as nothing', () => {
    expect(dropLoop(null)).toBe(null)
  })
})

describe('insideCue', () => {
  it('is true only within a running loop', () => {
    const cue = { in: 3, out: 4.5 }
    expect(insideCue(cue, 3.2)).toBe(true)
    expect(insideCue(cue, 3)).toBe(true)
    expect(insideCue(cue, 4.5)).toBe(true)
    expect(insideCue(cue, 4.6)).toBe(false)
    expect(insideCue(cue, 2.9)).toBe(false)
  })

  it('is false for a cue with no loop', () => {
    expect(insideCue({ in: 3, out: null }, 3)).toBe(false)
  })
})

describe('link round-trip', () => {
  it('carries a cue with no loop', () => {
    expect(formatCue({ in: 4.25, out: null })).toBe('4.25')
    expect(parseCue('4.25')).toEqual({ in: 4.25, out: null })
  })

  it('carries a loop', () => {
    expect(formatCue({ in: 4.25, out: 5.5 })).toBe('4.25,5.5')
    expect(parseCue('4.25,5.5')).toEqual({ in: 4.25, out: 5.5 })
  })

  it('writes nothing for no cue and reads nothing back', () => {
    expect(formatCue(null)).toBe('')
    expect(parseCue('')).toBe(null)
    expect(parseCue(null)).toBe(null)
  })

  // A link is untrusted input, and a NaN reaching the pump would pin the
  // playhead against a region it can never satisfy.
  it('drops malformed values rather than half-applying them', () => {
    expect(parseCue('abc')).toBe(null)
    expect(parseCue('1,abc')).toBe(null)
    expect(parseCue('-1,2')).toBe(null)
    expect(parseCue('1,2,3')).toBe(null)
  })

  it('holds the minimum and the ordering against a hand-edited link', () => {
    expect(parseCue('5,4')).toEqual({ in: 4, out: 5 })
    expect(parseCue('4,4')).toEqual({ in: 4, out: 4 + MIN_CUE_LOOP })
  })
})
