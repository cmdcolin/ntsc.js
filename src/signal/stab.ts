// The fault, stabbed in. A clean picture with the whole look poked into it for a
// few tens of milliseconds, several times a second — the kill switch a bender
// keeps a thumb on, rather than a fade between two settings.
//
// Sibling of modstate and glide, and here for the same reason both are: pure
// per-frame state the engine advances at the frame rate, with the control writes
// done at the engine's own boundary. What it *means* is a third thing again, and
// the distinction is the one to keep hold of:
//
//   modulation — a hand on one knob that comes off again. Per frame, restored,
//                resting value untouched.
//   a morph    — the resting settings themselves travelling somewhere and
//                staying there.
//   a stab     — the whole board replaced by stock for a frame or two and handed
//                straight back. Per frame and restored, like modulation, but
//                every key at once and to a fixed destination rather than a
//                wiggle around where each one sits.
//
// Why it earns its place: the picture between the stabs is not clean. Everything
// with memory across frames — phosphor decay, the three feedback loops, the loop
// bin — keeps accumulating straight through the flip, so a 60ms stab of heavy
// fault leaves a trail that decays over the clean 440ms behind it. That is a
// mechanism you cannot get by drawing an effect on top of a clean picture, and
// it is the reason this is worth having as a gate rather than as an overlay.
//
// It also makes an unaffordable look affordable: the expensive frames are the
// dirty ones, and at a 60ms stab twice a second there are four of them a second.

import { PulseGate } from './pulsegate'

import type { PulsePlan } from './pulsegate'

// What the gate is set to. The stab is the pulse: `hz` at 0 is off — the look
// runs continuously, which is what every session that has never touched this has
// — and `ms` is how long each stab of the look lasts. Both rules that make those
// two numbers behave (absolute length rather than a duty cycle; below one frame
// it is still one frame) are stated on PulsePlan, which the strobe shares.
export type StabPlan = PulsePlan

export interface StabStep {
  // Whether this frame renders stock rather than the look.
  clean: boolean
  // Whether that answer differs from the previous frame's. The engine's filter
  // bank is rebuilt from the controls it is about to render, so it has to be
  // redesigned on the two edges of each cycle — and on none of the frames in
  // between, which all hold the same values. Marking every clean frame dirty
  // instead is a FIR bank redesign at the frame rate, which is the whole cost of
  // this feature landing in the wrong place.
  changed: boolean
}

export class StabGate {
  private gate = new PulseGate()
  private wasClean = false

  // The stab is the pulse and the clean picture is the gap between them, so a
  // clean frame is simply one the gate is not open on — including the guaranteed
  // one per cycle, which is what keeps a stab shorter than a frame from being
  // dropped. The phase survives a settings change: dialing the rate or the
  // length while it runs does not restart the train.
  step(plan: StabPlan, nowMs: number): StabStep {
    const clean = !this.gate.open(plan, nowMs)
    const changed = clean !== this.wasClean
    this.wasClean = clean
    return { clean, changed }
  }
}
