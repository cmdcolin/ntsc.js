// Morphing the whole board: where every control was, where it is going, and how
// far along. Picking a preset, recalling a saved look or rolling a surprise normally
// lands in one frame; this is the same move taken slowly, so the picture travels
// there instead of cutting.
//
// Sibling of modstate, and here for the same reason: pure per-frame state the
// engine advances at the frame rate, with the control writes done at the
// engine's own boundary. What the two *mean* is opposite, though, and it is the
// distinction to keep hold of. Modulation is a hand on a knob that comes off
// again — it moves a value for one frame and restores it, and the resting
// setting never changes, which is why a running LFO does not invalidate a
// preset recipe. A morph is the resting setting itself moving: it lands, it
// stays landed, and the sliders end up there.
//
// Why it earns its place beyond being a smooth transition: the interesting looks
// are *between* the presets, and a jump has never shown you one. A morph walks
// the path — straight through the exact vHold where the picture gives up
// rolling, the point where the AGC starts pumping, the tbStickNs where leaning
// becomes snapping — so the same gesture that performs a change is also the only
// way to see where this model's thresholds actually are.

import { CONTROL_KEYS } from '../controls'

import type { ControlKey, Controls } from '../controls'

// Notches a coarse key moves in over the whole morph. Coarse keys are the ones
// whose every change costs a rebuild downstream — the five that redesign the FIR
// bank — and a morph moves all of them at once, which is the one way to make a
// casual gesture cost sixty bank rebuilds a second. Stepped instead: 32 notches
// is four rebuilds a second on an 8-second morph, and stepping a filter corner
// in 3% increments is inaudible against a picture that is moving anyway.
const COARSE_STEPS = 32

// Eased, not linear. A linear morph lurches into motion and stops dead, which
// reads as two cuts with a slide between them; smoothstep leaves and arrives at
// rest, so the whole thing reads as one movement.
const ease = (t: number): number => t * t * (3 - 2 * t)

// Where the board is going, and what each control is allowed to do on the way.
export interface GlidePlan {
  to: Controls
  seconds: number
  // Controls holding a mode rather than a quantity: halfway between two
  // phosphors is a tube nobody asked for. These switch at the midpoint instead
  // of travelling — a visible cut, deliberately, because there is no honest
  // in-between to draw. The set is passed in rather than derived here: the
  // slider metadata that knows which controls are modes lives in the UI layer.
  switchKeys: ReadonlySet<ControlKey>
  // Never morphed. Where you are looking is yours — the same rule surprise and
  // mutate already follow — so a morph never flies the magnifier across the
  // picture on its way to a new look.
  holdKeys: ReadonlySet<ControlKey>
}

export interface GlideStep {
  // Still running, or landed on this frame (the frame that lands writes the
  // destination exactly — see apply).
  done: boolean
  // A coarse key moved on this frame, so whatever it feeds needs rebuilding.
  coarseMoved: boolean
}

const LANDED: GlideStep = { done: true, coarseMoved: false }

export class Glide {
  // Which keys are expensive to move — see COARSE_STEPS. Handed over at
  // construction rather than named in the plan, because it is not a statement
  // about the morph: it is a fact about what the owner has to rebuild when one of
  // them changes, and the owner is the only one who knows it.
  constructor(private readonly coarseKeys: ReadonlySet<ControlKey>) {}

  private plan: GlidePlan | null = null
  private from: Controls | null = null
  // The keys that actually differ, split by how they travel. Computed once at
  // the start: a morph typically moves a few dozen of the couple of hundred
  // controls, and walking all of them every frame to find that out is work with
  // a known answer.
  private travel: ControlKey[] = []
  private coarse: ControlKey[] = []
  private switching: ControlKey[] = []
  private startMs = 0
  private notch = -1
  private t = 0

  get running(): boolean {
    return this.plan !== null
  }

  // How far along, 0..1. For a readout; nothing in the path reads it.
  get progress(): number {
    return this.t
  }

  // `from` is the engine's *live* controls, mid-morph values included, which is
  // what makes rolls chain: hitting surprise again halfway through a morph sets
  // off from where the picture actually is, so a session can wander through look
  // space continuously instead of snapping back to the last resting look first.
  start(from: Controls, plan: GlidePlan, nowMs: number): void {
    this.plan = plan
    this.from = { ...from }
    this.startMs = nowMs
    this.notch = -1
    this.t = 0
    const moved = CONTROL_KEYS.filter(
      k => !plan.holdKeys.has(k) && from[k] !== plan.to[k],
    )
    this.travel = moved.filter(
      k => !plan.switchKeys.has(k) && !this.coarseKeys.has(k),
    )
    this.coarse = moved.filter(
      k => !plan.switchKeys.has(k) && this.coarseKeys.has(k),
    )
    this.switching = moved.filter(k => plan.switchKeys.has(k))
  }

  stop(): void {
    this.plan = null
    this.from = null
    this.travel = []
    this.coarse = []
    this.switching = []
    this.t = 0
  }

  // Advance to `nowMs` and write this frame's values into `controls`, in place.
  // In place rather than returning a look because this runs every frame: a fresh
  // two-hundred-key object per frame is pure churn, and the engine's controls are
  // the thing that has to end up holding these values anyway.
  //
  // Wall clock, not a frame count, so a morph asked for in seconds takes those
  // seconds — under a frame lock, on a 144 Hz panel, or in a tab that just came
  // back from the background.
  apply(controls: Controls, nowMs: number): GlideStep {
    const plan = this.plan
    const from = this.from
    if (plan === null || from === null) return LANDED
    const raw =
      plan.seconds <= 0
        ? 1
        : Math.min(1, (nowMs - this.startMs) / (plan.seconds * 1000))
    this.t = raw
    if (raw >= 1) {
      // The landing frame assigns the destination rather than evaluating the
      // path at t=1: `from + (to - from) * 1` is not bit-identical to `to`, and
      // everything that asks "is this look that preset" compares exactly
      // (controlsEqual, matchPreset). A morph that landed a float's width away
      // from its destination would show an empty recipe for a look it had in
      // fact reached.
      for (const k of this.travel) controls[k] = plan.to[k]
      for (const k of this.coarse) controls[k] = plan.to[k]
      for (const k of this.switching) controls[k] = plan.to[k]
      const moved = this.coarse.length > 0 && this.notch !== COARSE_STEPS
      this.stop()
      return { done: true, coarseMoved: moved }
    }
    const e = ease(raw)
    for (const k of this.travel) {
      controls[k] = from[k] + (plan.to[k] - from[k]) * e
    }
    // Modes cut at the midpoint. Nothing hides that, and nothing should: it is
    // the honest rendering of "there is no half-phosphor", and on a busy morph
    // it lands while everything else is at full tilt, which is the least
    // conspicuous moment available.
    for (const k of this.switching) {
      controls[k] = e < 0.5 ? from[k] : plan.to[k]
    }
    // Coarse keys hold their last notch on the frames in between, which is what
    // makes skipping the write correct: the engine's controls persist frame to
    // frame, so an unwritten key is still holding the value this put there.
    const notch = Math.round(e * COARSE_STEPS)
    if (notch === this.notch) return { done: false, coarseMoved: false }
    this.notch = notch
    const ce = notch / COARSE_STEPS
    for (const k of this.coarse) {
      controls[k] = from[k] + (plan.to[k] - from[k]) * ce
    }
    return { done: false, coarseMoved: this.coarse.length > 0 }
  }
}
