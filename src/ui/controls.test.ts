import { describe, expect, it } from 'vitest'

import { CONTROL_KEYS } from '../controls'
import {
  ALL_SLIDERS,
  GROUPS,
  NEEDS,
  SLIDER_BY_KEY,
  sliderFor,
} from './controls'

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
