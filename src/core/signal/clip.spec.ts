import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { CLIP_POINTS, ClipContact, clipPointAt, clipPointDef } from './clip'

import type { ClipPlan } from './clip'

// A hand on the board rather than a setting on the rig: what the contacts do
// between them, and the two things about one contact that are not a switch.

const PLAN: ClipPlan = {
  hz: 4,
  bite: 1,
  dwellMs: 90,
  chatter: 0,
  point: 'sync',
}

// A deterministic hand, so a run is a run rather than a sample. 0.5 through the
// exponential is a gap of ln(2) / hz — about 173 ms at 4 a second.
const steady = () => 0.5

// The depth on each of `frames` frames, from a fresh contact.
const run = (
  plan: Partial<ClipPlan>,
  frames: number,
  rand: () => number = steady,
): number[] => {
  const clip = new ClipContact()
  return Array.from(
    { length: frames },
    () => clip.step({ ...PLAN, ...plan }, rand)?.depth ?? 0,
  )
}

describe('a contact', () => {
  it('is nothing at all while the hand is off the board', () => {
    const clip = new ClipContact()
    for (let i = 0; i < 240; i++) {
      expect(clip.step({ ...PLAN, hz: 0 }, steady)).toBe(null)
    }
  })

  it('arrives over a few frames rather than in one', () => {
    // The rise is the whole difference between a paperclip and a gate: a bite
    // that reached full depth on its first frame would be a one-frame cut,
    // which the stab gate already is.
    const depths = run({}, 8).filter(d => d > 0)
    expect(depths[0]).toBeLessThan(0.9)
    expect(depths.findIndex(d => d > 0.95)).toBeGreaterThan(1)
  })

  it('lets go slower than it lands', () => {
    // 8 ms of dwell is one frame of contact, and what is on screen after it is
    // the set getting over it — which takes longer than the short took to
    // arrive, because those are different events.
    const depths = run({ dwellMs: 8, hz: 0.5 }, 14)
    const peak = depths.indexOf(Math.max(...depths))
    const after = depths.slice(peak + 1)
    expect(after.filter(d => d > 0.05).length).toBeGreaterThan(peak + 1)
    // Monotone down, so the tail is a recovery and not a second bite.
    for (let i = 1; i < after.length; i++) {
      expect(after[i]).toBeLessThanOrEqual(after[i - 1])
    }
  })

  it('never goes deeper than the bite asked for', () => {
    const depths = run({ bite: 0.4, dwellMs: 600 }, 120)
    expect(Math.max(...depths)).toBeLessThanOrEqual(0.4)
  })

  it('bites on gaps a hand makes rather than on a clock', () => {
    // Two runs of the same plan against different dice have to differ, which is
    // what separates this from the stab gate. A metronome would not.
    let n = 1
    const jittery = () =>
      (n = (n * 1103515245 + 12345) % 2147483648) / 2147483648
    const a = run({ dwellMs: 16 }, 200, jittery)
    n = 7
    const b = run({ dwellMs: 16 }, 200, jittery)
    expect(a).not.toEqual(b)
    // And both are actually biting, so the difference is not two silences.
    expect(a.some(d => d > 0.2)).toBe(true)
    expect(b.some(d => d > 0.2)).toBe(true)
  })

  it('takes the contact clean off when it chatters, not down a bit', () => {
    // A scrape is intermittent contact. `chatter: 1` rolls against 0.55, so a
    // long hold under it has to spend frames heading for zero rather than
    // sitting at a lower level.
    const always = () => 0
    const depths = run({ chatter: 1, dwellMs: 400, hz: 1 }, 60, always)
    expect(Math.max(...depths)).toBeLessThan(0.2)
  })
})

describe('where the metal lands', () => {
  it('names controls that exist', () => {
    for (const p of CLIP_POINTS) {
      for (const k of Object.keys(p.peak)) {
        expect(Object.hasOwn(DEFAULT_CONTROLS, k), `${p.value}: ${k}`).toBe(
          true,
        )
      }
    }
  })

  it('shorts something at every point', () => {
    // A recipe that matched stock everywhere would be a point that does
    // nothing, which reads as the clip being broken rather than as the point
    // being subtle.
    for (const p of CLIP_POINTS) {
      const moved = Object.entries(p.peak).filter(
        ([k, v]) => v !== DEFAULT_CONTROLS[k as keyof typeof DEFAULT_CONTROLS],
      )
      expect(moved.length, p.value).toBeGreaterThan(0)
    }
  })

  it('picks a point off the slider position, whatever lands on it', () => {
    expect(clipPointAt(0)).toBe(CLIP_POINTS[0].value)
    expect(clipPointAt(CLIP_POINTS.length - 1)).toBe(
      CLIP_POINTS[CLIP_POINTS.length - 1].value,
    )
    // A preset blend, a link and the mutator all write this key, and none of
    // them owes it an integer inside the range.
    expect(clipPointAt(-3)).toBe(CLIP_POINTS[0].value)
    expect(clipPointAt(99)).toBe(CLIP_POINTS[CLIP_POINTS.length - 1].value)
    expect(clipPointAt(1.4)).toBe(CLIP_POINTS[1].value)
    expect(clipPointAt(Number.NaN)).toBe(CLIP_POINTS[0].value)
  })

  it('keeps each point inside one domain', () => {
    // The invariant that makes five points read as five faults rather than as
    // five mixes of one (docs/ARCHITECTURE.md › The three domains). Named here
    // rather than derived, because which domain a control belongs to is a fact
    // about the mechanism and not about the key.
    const domain: Record<string, string> = {
      hHold: 'sync',
      vHold: 'sync',
      syncBendUs: 'sync',
      vSize: 'deflection',
      vFreqHz: 'deflection',
      hvSagUs: 'deflection',
      abl: 'deflection',
      burstLock: 'decode',
      demodAxisDeg: 'decode',
      chromaGain: 'decode',
      agc: 'decode',
      matrixClip: 'decode',
    }
    for (const p of CLIP_POINTS) {
      const domains = new Set(Object.keys(p.peak).map(k => domain[k]))
      expect([...domains], p.value).toHaveLength(1)
      expect(
        [...domains][0],
        `${p.value} names an unclassified control`,
      ).not.toBe(undefined)
    }
  })

  it('has a def for every point the table offers', () => {
    for (const p of CLIP_POINTS) expect(clipPointDef(p.value)).toBe(p)
  })
})
