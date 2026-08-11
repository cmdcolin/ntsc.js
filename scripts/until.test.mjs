import { describe, expect, it } from 'vitest'

import { until } from './until.mjs'

// The harness helper, tested where it belongs: it is a loop and a deadline, and
// the browser has nothing to say about either. What sent it here is that the
// two bugs it was written for were both found by *soaking* a puppeteer run —
// which is a slow, weak instrument for a race, and no instrument at all for
// "what does this return when it gives up".
describe('until', () => {
  const ticking = values => {
    let at = 0
    return () => Promise.resolve(values[Math.min(at++, values.length - 1)])
  }

  it('returns the first reading that satisfies the predicate', async () => {
    const read = ticking(['no track', 'no track', 'tone.wav'])
    const got = await until(read, t => t === 'tone.wav', { every: 1 })
    expect(got).toBe('tone.wav')
  })

  it('reads once and stops when the answer is already there', async () => {
    let reads = 0
    const read = () => {
      reads += 1
      return Promise.resolve('ready')
    }
    expect(await until(read, t => t === 'ready', { every: 1 })).toBe('ready')
    expect(reads).toBe(1)
  })

  // The property `waitForFunction` does not have, and the reason this exists: a
  // check downstream has to be able to report what it actually saw, so giving
  // up is a value rather than a throw that abandons the rest of the run.
  it('hands back the last reading when it gives up, rather than throwing', async () => {
    const got = await until(
      () => Promise.resolve('no track'),
      t => t === 'x',
      {
        budget: 20,
        every: 1,
      },
    )
    expect(got).toBe('no track')
  })

  it('gives up inside its budget rather than polling forever', async () => {
    const began = Date.now()
    await until(
      () => Promise.resolve(0),
      n => n === 1,
      {
        budget: 40,
        every: 1,
      },
    )
    // Generous: what is being pinned is that a deadline exists at all, not the
    // scheduler's accuracy on a loaded box.
    expect(Date.now() - began).toBeLessThan(2000)
  })

  // A reading that only becomes true late still counts — the loop keeps asking
  // rather than sampling twice and concluding.
  it('keeps asking across many polls', async () => {
    let n = 0
    const got = await until(
      () => Promise.resolve(++n),
      v => v >= 5,
      { every: 1 },
    )
    expect(got).toBe(5)
  })
})
