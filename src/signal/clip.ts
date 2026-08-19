// A paperclip held against a point inside the set.
//
// Fifth sibling of glide, modstate, stab and fault, and it is worth placing
// against the four it sits with (signal/fault.ts carries the other four):
//
//   modulation — a hand on one knob that comes off again, continuously.
//   a stab     — the whole board replaced by stock on a clock.
//   a fault    — a few controls driven away from rest and back, once, over a
//                span, with a frame in the middle marked as the one to cut on.
//   a clip     — a few controls *shorted* toward a destination for as long as a
//                piece of metal is touching them, several times a second, at a
//                point you choose. Repeating like a stab, travelling like a
//                fault, and timed like neither.
//
// The timing is the whole of it, and it is why this is not the stab gate with a
// different recipe. A stab is a clock; a hand scraping a wire is not. Contacts
// arrive at *roughly* a rate and never on it — exponentially distributed gaps,
// which is what a Poisson process gives and what a hand doing something
// deliberate but unrehearsed actually produces. Two bites land together, then a
// second and a half of nothing. A metronome reads as an effect; this reads as
// somebody's hand.
//
// The other half is that a contact is not a switch. Bare metal on a pin bounces
// and scrapes, which is `chatter` — and the set does not recover the instant the
// metal lifts, which is the asymmetric slew below. A bite lands in two or three
// frames and takes five or six to let go.

import { clamp01 } from '../math'

import type { Controls } from '../controls'

export type ClipPoint = 'sync' | 'vertical' | 'supply' | 'chroma' | 'video'

// Where the metal lands, and what is shorted while it is down.
//
// A destination the board travels to rather than an offset, exactly like
// FaultPlan.peak: `hHold` has to reach the bottom of its range for the receiver
// to lose the line whether it was resting loose or tight, and an offset could
// not say that.
//
// Every recipe here names controls in ONE domain, which is the invariant that
// makes the five read as five different faults rather than five mixes of the
// same one (docs/ARCHITECTURE.md › The three domains). A short at the sync
// separator moves the picture and takes hue with it; a short at the supply
// moves the scan and must not touch hue at all.
export interface ClipPointDef {
  value: ClipPoint
  label: string
  peak: Partial<Controls>
}

export const CLIP_POINTS: readonly ClipPointDef[] = [
  {
    value: 'sync',
    label: 'sync separator',
    // The set stops being told where the line starts. Sync domain: the burst
    // gate is keyed off the same timing, so hue goes with the picture.
    peak: { hHold: 0.02, vHold: 0, syncBendUs: 34 },
  },
  {
    value: 'vertical',
    label: 'vertical oscillator',
    // The scan collapses toward a band and springs back out. Deflection: the
    // raster is bent under a picture that is decoded correctly throughout.
    peak: { vSize: 0.35, vFreqHz: 44 },
  },
  {
    value: 'supply',
    label: 'EHT / beam supply',
    // The high-tension rail droops, so the picture swells and the limiter
    // hauls the drive down after it — late, because the sense loop has a real
    // time constant. Deflection again, and the one point where the fault
    // outlasts the contact by itself.
    peak: { hvSagUs: 62, abl: 0.85 },
  },
  {
    value: 'chroma',
    label: 'chroma demodulator',
    // The reference network is shorted: the decoder stops trusting the burst
    // and its two demodulators stop being 90° apart, so hue shears rather than
    // rotating. Nothing here moves the picture.
    peak: { burstLock: 0, demodAxisDeg: 22, chromaGain: 6 },
  },
  {
    value: 'video',
    label: 'video output stage',
    // The drive to the guns runs out of headroom and the level loop stops
    // catching it, so the picture blows out and the first gun to hit its rail
    // drags the hue with it.
    peak: { agc: 0, matrixClip: 1, chromaGain: 3.2 },
  },
]

export interface ClipPlan {
  // Contacts a second, on average. 0 is off — the hand is not on the board,
  // which is where every session that has not touched this sits.
  hz: number
  // How hard the metal lands: the depth the short reaches while it is down.
  bite: number
  // How long one contact lasts, in milliseconds.
  dwellMs: number
  // How much the contact breaks up while it is down, 0 to 1. Bare metal on a
  // pin does not sit still.
  chatter: number
  point: ClipPoint
}

const DT = 1000 / 60

// How fast the short arrives, and how long the set takes to get over it.
//
// Neither is the paperclip's own RC, and that is the correction worth keeping:
// bare metal on a pin against whatever stray capacitance is there settles in
// microseconds, three orders under a frame, so a model that scaled the tail off
// how long the clip was held was describing nothing. What actually decays is
// the *set* — the flywheel hauling itself back onto sync, the level loop
// finding the tip again, the supply recharging — and none of those care how
// long the metal was down. So the release is a constant of the receiver, and
// the dwell only says how long the contact lasts.
const RISE_MS = 25
const RECOVER_MS = 90

const POINT_BY_VALUE = new Map(CLIP_POINTS.map(p => [p.value, p]))

export const clipPointDef = (p: ClipPoint): ClipPointDef => {
  const def = POINT_BY_VALUE.get(p)
  if (def === undefined) throw new Error(`no clip point ${p}`)
  return def
}

// The control's numeric position as a point. Clamped rather than checked: the
// slider is the only thing that writes it, but a link, a preset blend and the
// mutator all land on this key too, and a fractional or out-of-range one should
// pick a point rather than throw inside a frame.
export const clipPointAt = (i: number): ClipPoint =>
  CLIP_POINTS[Math.min(CLIP_POINTS.length - 1, Math.max(0, Math.round(i) || 0))]
    .value

export interface ClipStep {
  peak: Partial<Controls>
  // 0..1. How far toward the short the board is this frame.
  depth: number
}

export class ClipContact {
  // Milliseconds until the metal next lands. Drawn fresh each time from an
  // exponential, so the gaps are a hand's rather than a clock's.
  private untilBite = 0
  // Milliseconds of contact left. Zero when the metal is off the board.
  private downFor = 0
  // How much of the short is actually showing, which lags the contact going on
  // and lags it further coming off.
  private level = 0
  // Whether this frame's contact is bouncing. Held for the frame rather than
  // re-rolled per read, so everything downstream sees one answer.
  private bouncing = false

  // One frame. Returns null when nothing is touching the board and nothing is
  // still discharging, so the caller can skip the layer entirely.
  step(plan: ClipPlan, rand: () => number): ClipStep | null {
    if (plan.hz <= 0) {
      // The hand comes off, and what was charged runs out rather than being
      // cut: letting go of a control mid-bite should not be a step in the
      // picture. `untilBite` is reset so putting the hand back does not fire
      // instantly off a gap that elapsed while the rate was at zero.
      this.untilBite = 0
      this.downFor = 0
      return this.decay(plan)
    }
    if (this.downFor > 0) {
      this.downFor -= DT
    } else {
      this.untilBite -= DT
      if (this.untilBite <= 0) {
        // Exponentially distributed gaps: the interval between two contacts is
        // memoryless, so a hand that has just bitten is no less likely to bite
        // again than one that has been still for a second. That is what makes
        // the rhythm read as a hand — two together, then a gap.
        this.untilBite = -Math.log(Math.max(rand(), 1e-6)) * (1000 / plan.hz)
        this.downFor = Math.max(plan.dwellMs, DT)
        this.bouncing = false
      }
    }
    const down = this.downFor > 0
    // The bounce is rolled once per frame while the metal is down, and it takes
    // the contact clean off rather than reducing it: a scrape is intermittent
    // contact, not a softer one, and the charge tail below is what stops that
    // reading as a stutter.
    if (down) this.bouncing = rand() < plan.chatter * 0.55
    const target = down && !this.bouncing ? clamp01(plan.bite) : 0
    this.slew(target)
    return this.stepOf(plan)
  }

  // What is left after the hand comes off: the set still getting over the last
  // contact.
  private decay(plan: ClipPlan): ClipStep | null {
    if (this.level <= 1e-4) {
      this.level = 0
      return null
    }
    this.slew(0)
    return this.stepOf(plan)
  }

  // One pole toward the target, up quickly and down slowly. Asymmetric because
  // the two directions are different events: a short lands, and a receiver
  // recovers.
  private slew(target: number): void {
    const tau = target > this.level ? RISE_MS : RECOVER_MS
    this.level += (target - this.level) * Math.min(1, DT / tau)
  }

  private stepOf(plan: ClipPlan): ClipStep | null {
    if (this.level <= 1e-4) return null
    return { peak: clipPointDef(plan.point).peak, depth: this.level }
  }
}
