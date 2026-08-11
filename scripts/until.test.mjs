import { describe, expect, it } from 'vitest'

import { appUp, until } from './until.mjs'

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

// The boot wait every harness here shares, which is worth a test of its own
// because the two ways it can be wrong are both silent: answering `true` off a
// realm the harness will not use, and answering at all when `evaluate` threw.
describe('appUp', () => {
  const fakePage = answers => {
    let at = 0
    return {
      evaluate: () => {
        const a = answers[Math.min(at++, answers.length - 1)]
        return a instanceof Error ? Promise.reject(a) : Promise.resolve(a)
      },
    }
  }

  it('answers true once the app is there', async () => {
    expect(await appUp(fakePage([false, false, true]), 500)).toBe(true)
  })

  // The window that used to be a five-second sleep: a boot slower than the
  // budget answers false rather than hanging or throwing, so the harness can
  // report it as one failed check at the top instead of twelve underneath.
  it('answers false when the budget runs out, without throwing', async () => {
    expect(await appUp(fakePage([false]), 20)).toBe(false)
  })

  // An `evaluate` that rejects — a detached frame, a realm swapped out from
  // under it — is "not up yet", not a crash: the page may still be arriving.
  it('treats an evaluate that throws as not up yet', async () => {
    const page = fakePage([new Error('frame detached'), true])
    expect(await appUp(page, 500)).toBe(true)
  })
})
