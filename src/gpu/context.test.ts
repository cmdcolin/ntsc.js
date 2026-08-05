import { describe, expect, it } from 'vitest'

import { gpuPowerFromSearch } from './context'

describe('gpuPowerFromSearch', () => {
  it('asks for the discrete GPU by default', () => {
    // The signal path is heavy enough that the integrated chip a hybrid laptop
    // hands out by default was costing 3x the frame time, so the default has to
    // be the fast one — an unset param must never mean "whatever the browser
    // felt like".
    expect(gpuPowerFromSearch('')).toBe('high-performance')
    expect(gpuPowerFromSearch('?preset=vhs')).toBe('high-performance')
  })

  it('sends the session to the integrated chip on request', () => {
    expect(gpuPowerFromSearch('?gpu=low-power')).toBe('low-power')
    expect(gpuPowerFromSearch('?preset=vhs&gpu=low-power')).toBe('low-power')
  })

  it('treats anything it does not recognise as the default', () => {
    // A typo must not silently strand the session on the slow GPU — that reads
    // as the app having got slower for no reason.
    expect(gpuPowerFromSearch('?gpu=integrated')).toBe('high-performance')
    expect(gpuPowerFromSearch('?gpu=')).toBe('high-performance')
    expect(gpuPowerFromSearch('?gpu=LOW-POWER')).toBe('high-performance')
  })
})
