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

// What the gate is set to. `hz` at 0 is off — the look runs continuously, which
// is what every session that has never touched this has.
export interface StabPlan {
  hz: number
  // How long each stab of the look lasts, in milliseconds — an absolute length
  // rather than a fraction of the cycle. Doubling the rate on a duty-cycle gate
  // halves the stab, so the one number a set actually wants to hold still (how
  // hard the hit reads) is the one that moves. Below one frame it is one frame:
  // see `step`.
  ms: number
}

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
  // Which cycle we last let a stab through on, so a stab shorter than a frame
  // still lands. Wall clock rather than a frame count throughout: a rate asked
  // for in Hz — or locked to a beat — has to be that rate under a frame lock, on
  // a 144Hz panel, and in a tab that has just come back from the background.
  // ModState deliberately does not do this (it advances on a fixed 1/60), which
  // is why a 2Hz LFO runs at 1Hz on a 30fps machine; a gate you are counting
  // along with cannot afford that.
  private cycle = -1
  private wasClean = false

  // Whether the phase the gate is in survives a settings change: it does, so
  // dialing the rate or the length while it runs does not restart the train.
  step(plan: StabPlan, nowMs: number): StabStep {
    const clean = this.isClean(plan, nowMs)
    const changed = clean !== this.wasClean
    this.wasClean = clean
    return { clean, changed }
  }

  private isClean(plan: StabPlan, nowMs: number): boolean {
    if (!(plan.hz > 0)) {
      // Off, and the cycle count goes with it: switching the gate back on should
      // start a fresh train rather than resume one from before it was parked.
      this.cycle = -1
      return false
    }
    const period = 1000 / plan.hz
    const cycle = Math.floor(nowMs / period)
    // One guaranteed dirty frame per cycle. A 20ms stab at 60fps is shorter than
    // the gap between frames, so sampling `now % period < ms` alone drops most of
    // them — and a stab train that silently skips hits reads as the rate control
    // being broken rather than as the length being under a frame.
    if (cycle !== this.cycle) {
      this.cycle = cycle
      return false
    }
    return nowMs % period >= plan.ms
  }
}
