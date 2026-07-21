import { describe, expect, it } from 'vitest'

import { formatValue } from './format'

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
