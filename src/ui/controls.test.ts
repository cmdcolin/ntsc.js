import { describe, expect, it } from 'vitest'

import { CONTROL_KEYS } from '../controls'
import {
  ALL_SLIDERS,
  AUTOMAP_KEYS,
  GROUPS,
  NEEDS,
  SLIDER_BY_KEY,
  sliderFor,
  VIEW_KEYS,
} from './controls'

import type { ControlKey } from '../controls'

describe('control tables', () => {
  // sliderFor is total because of this: every control reaches the panel, and
  // nothing has to fall back to showing a raw key where a label belongs.
  it('gives every control exactly one slider', () => {
    expect(ALL_SLIDERS.length).toBe(CONTROL_KEYS.length)
    expect(SLIDER_BY_KEY.size).toBe(CONTROL_KEYS.length)
    for (const key of CONTROL_KEYS) expect(sliderFor(key).key).toBe(key)
  })

  it('gates controls on controls that exist', () => {
    for (const need of Object.values(NEEDS))
      expect(SLIDER_BY_KEY.has(need.key)).toBe(true)
  })

  it('names every group once', () => {
    const names = GROUPS.map(g => g.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('fine tier', () => {
  // A mode switch is never a trim: it decides which mechanism runs, so folding
  // one away hides the branch its neighbours' help text talks about.
  it('leaves mode switches on show', () => {
    for (const s of ALL_SLIDERS)
      if (s.choices !== undefined) expect(s.fine).toBeUndefined()
  })

  // Mirrors FRAMES in ControlGroup.tsx: these are already behind the
  // miniature's ▸ sliders toggle, and a second fold would bury them.
  it('leaves the miniature-backed controls on show', () => {
    const framed: ControlKey[] = [
      'wipePos',
      'pipX',
      'pipY',
      'pipW',
      'pipH',
      'crtZoomX',
      'crtZoomY',
    ]
    for (const key of framed) expect(sliderFor(key).fine).toBeUndefined()
  })

  // A disclosure is only worth its own row if it hides more than one control,
  // and only worth reading past if what stays is still a group.
  it('folds at least two rows and leaves at least three', () => {
    for (const g of GROUPS) {
      const fine = g.sliders.filter(s => s.fine === true).length
      if (fine === 0) continue
      expect(fine, g.name).toBeGreaterThanOrEqual(2)
      expect(g.sliders.length - fine, g.name).toBeGreaterThanOrEqual(3)
    }
  })

  // The groups the tier exists for: past eight rows a group stops being
  // scannable, so every one of them has to give something up.
  it('thins every long group', () => {
    for (const g of GROUPS)
      if (g.sliders.length > 8)
        expect(
          g.sliders.filter(s => s.fine === true).length,
          g.name,
        ).toBeGreaterThanOrEqual(2)
  })

  // What the auto-map ranking is for: a 64-knob controller reaches every
  // look-maker before it spends a knob on a trim or on the magnifier.
  it('ranks look-makers ahead of trims in the auto-map', () => {
    expect(AUTOMAP_KEYS.length).toBe(CONTROL_KEYS.length)
    const rank = (key: ControlKey) =>
      VIEW_KEYS.has(key) ? 2 : sliderFor(key).fine === true ? 1 : 0
    const ranks = AUTOMAP_KEYS.map(rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(AUTOMAP_KEYS.slice(-4)).toEqual([
      'crtZoom',
      'crtZoomX',
      'crtZoomY',
      'scope',
    ])
  })
})
