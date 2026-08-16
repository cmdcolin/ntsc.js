import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  armHead,
  dropHead,
  prerolledClip,
  promoteHead,
  stopSlot,
} from './videoSlot'

import type { VideoSlot } from './videoSlot'

// The half of `videoSlot.ts` that can be held still. `armHead` builds an element
// and waits on the decoder, so it belongs to `scripts/prerollcheck.mjs` and the
// browser; `promoteHead` and `dropHead` are the *ordering* — which element goes
// on air, what is muted before what, and when a head that cannot keep up is
// given back — and none of that needs a decoder to be wrong.
//
// It is worth having here rather than only in a harness for the reason
// `memory/verification-cost.md` records: the deadline below shipped because a
// listening run caught the first cut making the worst case worse, and a browser
// run is far too expensive to be the thing that guards it from here on.

// A <video> as far as these two functions are concerned. Same shape as
// `videopump.test.ts`'s double and for the same reason — they read a few
// properties and move a listener, which is exactly what makes them separable.
type FakeVideo = HTMLVideoElement & { fire: (type: string) => void }

const videoEl = (over: Partial<HTMLVideoElement> = {}): FakeVideo => {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  return {
    // Parked and ready by default: the case a promotion is *for*.
    readyState: 4,
    seeking: false,
    currentTime: 0,
    muted: true,
    paused: false,
    src: 'blob:clip',
    play: () => Promise.resolve(),
    pause() {
      ;(this as { paused: boolean }).paused = true
    },
    removeAttribute(name: string) {
      if (name === 'src') (this as { src: string }).src = ''
    },
    addEventListener: (
      type: string,
      fn: EventListenerOrEventListenerObject,
    ) => {
      const set = listeners.get(type) ?? new Set()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener: (
      type: string,
      fn: EventListenerOrEventListenerObject,
    ) => {
      listeners.get(type)?.delete(fn)
    },
    fire: (type: string) => {
      for (const fn of listeners.get(type) ?? []) {
        if (typeof fn === 'function') fn(new Event(type))
      }
    },
    ...over,
  } as unknown as FakeVideo
}

// `stopSlot` asks `srcObject instanceof MediaStream`, so the global has to exist
// for it to run at all. Nothing in these tests is a stream — the identity is the
// whole of what is wanted.
class NotAStream {
  readonly tracks: never[] = []
}

// The slot, plus a record of the things a promotion is supposed to do in order.
const makeSlot = (live: FakeVideo | null, head: FakeVideo | null = null) => {
  const log: string[] = []
  const slot: VideoSlot = {
    id: 'a',
    ref: { current: live },
    next: { current: null },
    head: { current: head },
    typer: { current: null },
    rate: () => 1,
    attach: () => log.push('attach'),
    setImage: () => {},
    setNoise: () => {},
    setLive: () => {},
    setYtUrl: () => {},
    setName: () => {},
    card: () => null as never,
    setCard: () => {},
    onError: () => {},
    clearCue: () => log.push('clearCue'),
    release: () => log.push('release'),
    // Recorded with *what was on air at the time*: `routeAudio` reads the slot's
    // own ref, so an adopt that ran before the swap would route the element
    // stepping off the air.
    adopt: () =>
      log.push(`adopt:${slot.ref.current === live ? 'live' : 'head'}`),
  }
  return { slot, log }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Which url a parked shelf clip is holding — the question the cut has to ask
// before it opens one, and the whole of why a preroll records the id.
//
// `URL.createObjectURL` mints a fresh string per call, so a File opened twice is
// two urls and `playUrl`'s match could never fire on a shelf clip. Every cut
// between two of them loaded from scratch beside an element already holding the
// picture — preroll paying its whole cost and buying nothing.
describe('prerolledClip', () => {
  const parked = (clip: string) => {
    const { slot } = makeSlot(videoEl())
    slot.next.current = { url: 'blob:parked', el: videoEl(), clip }
    return slot
  }

  it('answers the url the clip was parked under', () => {
    expect(prerolledClip(parked('c7'), 'c7')).toBe('blob:parked')
  })

  // A rundown edited mid-bar can ask for a different clip than the boundary
  // looked ahead to, which is the same reason the url match exists at all.
  it('answers nothing for a different clip, or for none parked', () => {
    expect(prerolledClip(parked('c7'), 'c9')).toBeNull()
    const { slot } = makeSlot(videoEl())
    expect(prerolledClip(slot, 'c7')).toBeNull()
  })

  // An element parked from a plain url carries no shelf identity, and a caller
  // asking about a clip with no id must not match it — '' is "not a shelf clip"
  // on both sides, and matching two of those would promote the wrong picture.
  it('never matches an empty id against a url-only preroll', () => {
    expect(prerolledClip(parked(''), '')).toBeNull()
  })
})

describe('promoteHead', () => {
  it('is "no head" when there is none', () => {
    const { slot } = makeSlot(videoEl())
    expect(promoteHead(slot, 4, 5)).toBe(null)
  })

  // Below HAVE_FUTURE_DATA is a head that has not finished arriving. Promoting
  // it would trade the seek for a stall, which is the same silence by another
  // name.
  it('is "no head" when the head has not finished arriving', () => {
    const head = videoEl({ readyState: 2 })
    const { slot } = makeSlot(videoEl(), head)
    expect(promoteHead(slot, 4, 5)).toBe(null)
    expect(slot.head.current).toBe(head)
  })

  // The case `readyState` alone cannot see. A `blob:` is entirely buffered, so a
  // decode-bound re-park can run at HAVE_ENOUGH_DATA from start to finish while
  // `currentTime` already reads back as the target — every signal except this one
  // says the element is parked when no frame has been decoded there yet.
  it('is "no head" when the head is ready but still seeking', () => {
    const head = videoEl({ readyState: 4, seeking: true, currentTime: 4 })
    const { slot } = makeSlot(videoEl(), head)
    expect(promoteHead(slot, 4, 5)).toBe(null)
    expect(slot.head.current).toBe(head)
  })

  it('swaps the two elements and sends the outgoing one back to the in-point', () => {
    const live = videoEl({ currentTime: 5.01 })
    const head = videoEl({ currentTime: 4 })
    const { slot } = makeSlot(live, head)

    expect(promoteHead(slot, 4, 5)).toBe(head)
    expect(slot.ref.current).toBe(head)
    expect(slot.head.current).toBe(live)
    expect(live.paused).toBe(true)
    expect(live.currentTime).toBe(4)
  })

  // `routeAudio` only knows about the element the slot is holding, so the swap
  // has to happen first or the adopt routes the element stepping off the air —
  // and the outgoing one has to be muted here or it goes on sounding a lap
  // behind.
  it('mutes the outgoing element and adopts the incoming one', () => {
    const live = videoEl({ muted: false, currentTime: 5.01 })
    const head = videoEl({ currentTime: 4 })
    const { slot, log } = makeSlot(live, head)

    promoteHead(slot, 4, 5)
    expect(live.muted).toBe(true)
    expect(log).toEqual(['adopt:head'])
  })

  // Not through `attach`: that is `setVideoSource`, which comes back through the
  // pump's `retarget` and clears the region on purpose — a loop routed through it
  // ends at its first lap.
  it('does not tell the engine the source changed', () => {
    const { slot, log } = makeSlot(videoEl({ currentTime: 5.01 }), videoEl())
    promoteHead(slot, 4, 5)
    expect(log).not.toContain('attach')
  })

  describe('the lap is the deadline', () => {
    it('keeps a head that re-parks inside its lap', () => {
      vi.useFakeTimers()
      const live = videoEl({ currentTime: 5.01 })
      const { slot } = makeSlot(live, videoEl())

      promoteHead(slot, 4, 5)
      vi.advanceTimersByTime(600)
      live.fire('seeked')
      vi.advanceTimersByTime(5000)
      expect(slot.head.current).toBe(live)
    })

    // The one the first cut got wrong. It checked the elapsed time *inside*
    // `seeked`, so an overrun could not be noticed until it was over — and every
    // wrap in that span found a head that was not ready and seeked against it,
    // which is the contention the deadline exists to stop.
    it('gives the head back at the deadline, not when the re-park finishes', () => {
      vi.useFakeTimers()
      const live = videoEl({ currentTime: 5.01 })
      const { slot } = makeSlot(live, videoEl())

      promoteHead(slot, 4, 5)
      vi.advanceTimersByTime(1001)
      expect(slot.head.current).toBe(null)
    })

    // The case with no bound on it before: a decoder that gives up, or a url
    // that stops delivering, never fires `seeked` at all. Nothing retired that
    // head, so the loop seeked against a re-park that was never coming back for
    // as long as the cue lived.
    it('gives back a head whose re-park never finishes', () => {
      vi.useFakeTimers()
      const { slot } = makeSlot(videoEl({ currentTime: 5.01 }), videoEl())

      promoteHead(slot, 4, 5)
      vi.advanceTimersByTime(60_000)
      expect(slot.head.current).toBe(null)
    })

    it('leaves a head that something else has already replaced', () => {
      vi.useFakeTimers()
      const { slot } = makeSlot(videoEl({ currentTime: 5.01 }), videoEl())

      promoteHead(slot, 4, 5)
      const fresh = videoEl()
      slot.head.current = fresh
      vi.advanceTimersByTime(5000)
      expect(slot.head.current).toBe(fresh)
    })
  })
})

describe('dropHead', () => {
  // The one thing to know about it. A head is by construction the same src as
  // the element on air, so for a `blob:` they hold one object — revoking here
  // would pull the file out from under the picture.
  it('does not revoke the url it shares with the element on air', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL: revoke })
    const { slot } = makeSlot(videoEl(), videoEl({ src: 'blob:clip' }))

    dropHead(slot)
    expect(slot.head.current).toBe(null)
    expect(revoke).not.toHaveBeenCalled()
  })

  it('is safe with no head', () => {
    const { slot } = makeSlot(videoEl())
    expect(() => dropHead(slot)).not.toThrow()
  })
})

describe('stopSlot', () => {
  // The order is load-bearing: `stopSlot` revokes once, for both elements, so
  // the head has to be off the url before that and not after it.
  it('retires the head before revoking the clip', () => {
    const order: string[] = []
    vi.stubGlobal('URL', { revokeObjectURL: () => order.push('revoke') })
    vi.stubGlobal('MediaStream', NotAStream)
    const head = videoEl({
      src: 'blob:clip',
      removeAttribute: () => order.push('head off'),
    })
    const { slot } = makeSlot(videoEl({ src: 'blob:clip' }), head)

    stopSlot(slot)
    expect(order).toEqual(['head off', 'revoke'])
    expect(slot.head.current).toBe(null)
  })

  // Unlike a preroll, a head is never spent by a later load: a cue cannot outlive
  // its clip, so one that survived a source change would be a decoder on the
  // previous one.
  it('retires the head even with nothing on air', () => {
    vi.stubGlobal('URL', { revokeObjectURL: () => {} })
    vi.stubGlobal('MediaStream', NotAStream)
    const { slot } = makeSlot(null, videoEl())

    stopSlot(slot)
    expect(slot.head.current).toBe(null)
  })
})

describe('armHead', () => {
  // `?loophead=0` is what makes the A/B one run rather than two afternoons, so
  // it has to arm nothing at all — not arm one and decline to use it.
  it('arms nothing under ?loophead=0', async () => {
    vi.stubGlobal('location', { search: '?loophead=0' })
    const { slot } = makeSlot(videoEl({ src: 'blob:clip' }))

    await armHead(slot, 4)
    expect(slot.head.current).toBe(null)
  })

  it('arms nothing on a slot with no clip', async () => {
    const { slot } = makeSlot(videoEl({ src: '' }))
    await armHead(slot, 4)
    expect(slot.head.current).toBe(null)
  })

  it('retires the head it had when there is nothing to arm', async () => {
    const head = videoEl()
    const { slot } = makeSlot(videoEl({ src: '' }), head)
    await armHead(slot, 4)
    expect(slot.head.current).toBe(null)
  })
})
