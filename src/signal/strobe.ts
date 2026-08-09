// Beam blanking held on: the guns cut for most of each cycle and let through in
// flashes. A strobe, but not a strobe drawn over the picture — the gate lives in
// `decode`, upstream of the persistence layer, so the light already on the glass
// keeps decaying through the dark. That is the whole reason it is worth having:
// a digital freeze-and-black cuts to black, and a blanked tube fades to black
// through whatever phosphor is fitted, taking the trail's colour skew with it.
//
// Two more things fall out of putting it there rather than in `present`. The
// beam limiter (sync.wgsl's ABL servo) sees the frame's beam current collapse
// and opens up, so the first field back after a dark stretch surges before the
// servo catches it. And the three feedback loops photograph the dark frames, so
// a strobed camera rig pumps at the strobe rate instead of running steady.
//
// Sibling of signal/stab.ts. Both are pulse trains and the timing under them is
// one thing, so it lives in signal/pulsegate.ts — including the two hard-won
// rules (wall clock rather than a frame count; every cycle gets its pulse
// however short) which this file used to restate. What is left here is the only
// part that is the strobe's own: which side of the pulse the beam is on.

import { PulseGate } from './pulsegate'

import type { PulsePlan } from './pulsegate'

// The flash is the pulse: `hz` at 0 is off, beam scanning normally, and `ms` is
// how long the beam is let through per cycle.
export type StrobePlan = PulsePlan

export class StrobeGate {
  private gate = new PulseGate()

  // 0 while the beam is scanning, 1 while it is cut. Returned as the uniform's
  // own units rather than a boolean so the shader needs no branch and a future
  // soft-edged gate is a change here alone.
  step(plan: StrobePlan, nowMs: number): number {
    return this.gate.open(plan, nowMs) ? 0 : 1
  }
}
