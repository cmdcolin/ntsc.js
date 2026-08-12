// The fault, stabbed in. A second board with the whole look poked into it for a
// few tens of milliseconds, several times a second — the kill switch a bender
// keeps a thumb on, rather than a fade between two settings.
//
// That second board is stock by default, which is the gate this started as: a
// clean picture with the fault stabbed through it. Hand it a *held look*
// instead and the same gate is a hard flip between two looks — no fade, on the
// beat — which is the one shape of "modulate between two settings" this app can
// afford. The far end is the caller's (`pipeline.applyStab`); what lives here is
// the train, which does not care what is at either end of it.
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
//   a stab     — the whole board replaced by a second board for a frame or two
//                and handed straight back. Per frame and restored, like
//                modulation, but every key at once and to a fixed destination
//                rather than a wiggle around where each one sits.
//
// The third is why a hard flip between two looks belongs here and not in the
// bay: a routing drives one ControlKey, and two looks is every key at once. It
// is also the only version of it that is affordable. The filter bank is redesigned
// whenever a filter control moves, so a *fade* between two looks would be a FIR
// redesign every frame; a flip changes on the two edges of a cycle and nowhere
// in between, which is what `changed` below is for.
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
  // Whether this frame renders the gate's far board rather than the look.
  // Called `far` rather than `clean` because stock is only its default end: with
  // a look held at the other side this frame is not clean, it is the other look.
  far: boolean
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
  private wasFar = false

  // The stab is the pulse and the far board is the gap between them, so a far
  // frame is simply one the gate is not open on — including the guaranteed one
  // per cycle, which is what keeps a stab shorter than a frame from being
  // dropped. The phase survives a settings change: dialing the rate, the length
  // or the duty while it runs does not restart the train.
  step(plan: StabPlan, nowMs: number): StabStep {
    const far = !this.gate.open(plan, nowMs)
    const changed = far !== this.wasFar
    this.wasFar = far
    return { far, changed }
  }
}
