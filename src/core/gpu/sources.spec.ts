import { describe, expect, it } from 'vitest'

import { ACTIVE_HEIGHT, ACTIVE_WIDTH } from '../signal/constants'
import { coverFit43, fitSrc } from './sources'

describe('fitSrc', () => {
  it('leaves a source already inside the cap alone', () => {
    expect(fitSrc(640, 480)).toEqual([640, 480])
    expect(fitSrc(ACTIVE_WIDTH, ACTIVE_HEIGHT)).toEqual([
      ACTIVE_WIDTH,
      ACTIVE_HEIGHT,
    ])
  })

  it('caps the long edge while preserving aspect', () => {
    const [w, h] = fitSrc(3840, 2160)
    expect(Math.max(w, h)).toBe(1536)
    expect(w / h).toBeCloseTo(3840 / 2160, 2)
  })

  it('caps on height for a portrait source', () => {
    const [w, h] = fitSrc(2160, 3840)
    expect(Math.max(w, h)).toBe(1536)
    expect(w / h).toBeCloseTo(2160 / 3840, 2)
  })

  it('never collapses an extreme aspect to a zero edge', () => {
    // A panorama's short edge rounds toward 0 — a 0-wide texture is invalid and
    // would fail texture creation outright.
    const [w, h] = fitSrc(20000, 30)
    expect(w).toBeGreaterThan(0)
    expect(h).toBeGreaterThan(0)
  })
})

describe('coverFit43', () => {
  it('takes the whole frame when the source is already 4:3', () => {
    expect(coverFit43(640, 480)).toEqual([0, 0, 640, 480])
  })

  it('crops the sides of a wide source, centered', () => {
    const [sx, sy, sw, sh] = coverFit43(1920, 1080)
    expect(sh).toBe(1080) // full height kept
    expect(sw).toBeCloseTo(1440, 6) // 1080 * 4/3
    expect(sx).toBeCloseTo((1920 - 1440) / 2, 6) // centered
    expect(sy).toBe(0)
    expect(sw / sh).toBeCloseTo(4 / 3, 6)
  })

  it('crops top and bottom of a tall source, centered', () => {
    const [sx, sy, sw, sh] = coverFit43(1080, 1920)
    expect(sw).toBe(1080) // full width kept
    expect(sh).toBeCloseTo(810, 6) // 1080 * 3/4
    expect(sx).toBe(0)
    expect(sy).toBeCloseTo((1920 - 810) / 2, 6)
    expect(sw / sh).toBeCloseTo(4 / 3, 6)
  })

  it('always yields a 4:3 window inside the source bounds', () => {
    for (const [w, h] of [
      [100, 100],
      [1000, 30],
      [30, 1000],
      [754, 480],
      [16, 9],
    ]) {
      const [sx, sy, sw, sh] = coverFit43(w, h)
      expect(sw / sh).toBeCloseTo(4 / 3, 6)
      expect(sx).toBeGreaterThanOrEqual(0)
      expect(sy).toBeGreaterThanOrEqual(0)
      expect(sx + sw).toBeLessThanOrEqual(w + 1e-9)
      expect(sy + sh).toBeLessThanOrEqual(h + 1e-9)
    }
  })
})
