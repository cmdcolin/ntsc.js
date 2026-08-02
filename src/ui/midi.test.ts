import { describe, expect, it } from 'vitest'

import { sliderFor } from './controls'
import { hasCaught } from './midi'

// A 0..1 control, so a knob step is 1/127 and the pickup window is 1/64.
const def = sliderFor('fbMix')

describe('hasCaught', () => {
  it('accepts the first message when nothing is on screen to catch', () => {
    expect(hasCaught(def, undefined, undefined, 0.9)).toBe(true)
  })

  it('accepts a knob that opens close to the on-screen value', () => {
    expect(hasCaught(def, 0.5, undefined, 0.51)).toBe(true)
  })

  it('rejects a knob that opens away from it', () => {
    expect(hasCaught(def, 0.5, undefined, 0.7)).toBe(false)
  })

  it('rejects movement that stays on one side', () => {
    expect(hasCaught(def, 0.5, 0.8, 0.7)).toBe(false)
    expect(hasCaught(def, 0.5, 0.2, 0.3)).toBe(false)
  })

  it('catches once the knob sweeps through, from either direction', () => {
    expect(hasCaught(def, 0.5, 0.8, 0.3)).toBe(true)
    expect(hasCaught(def, 0.5, 0.2, 0.7)).toBe(true)
  })

  it('catches when the knob lands exactly on the value', () => {
    expect(hasCaught(def, 0.5, 0.8, 0.5)).toBe(true)
  })
})
