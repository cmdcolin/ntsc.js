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
// Sibling of signal/stab.ts, and it borrows that file's two hard-won rules:
// the rate is read off the wall clock rather than a frame count, and each cycle
// is guaranteed one lit frame however short the flash is asked to be.

export interface StrobePlan {
  hz: number // 0 = off, beam scanning normally
  // How long the beam is let through per cycle, in milliseconds. Absolute
  // rather than a duty cycle, for stab.ts's reason: doubling the rate must not
  // halve the flash, or the one number that sets how the hit reads is the one
  // that moves when you change the tempo.
  ms: number
}

export class StrobeGate {
  // Which cycle last got its guaranteed flash. A 5ms flash at 60fps is shorter
  // than the gap between frames, so testing `now % period < ms` alone drops most
  // of them and the picture simply goes dark — which reads as the rate control
  // being broken rather than as the flash being under a frame.
  private cycle = -1

  // 0 while the beam is scanning, 1 while it is cut. Returned as the uniform's
  // own units rather than a boolean so the shader needs no branch and a future
  // soft-edged gate is a change here alone.
  //
  // Phase survives a settings change: dialing the rate or the length while it
  // runs does not restart the train.
  step(plan: StrobePlan, nowMs: number): number {
    if (!(plan.hz > 0)) {
      // Off, and the cycle count goes with it, so switching it back on starts a
      // fresh train rather than resuming one from before it was parked.
      this.cycle = -1
      return 0
    }
    const period = 1000 / plan.hz
    const cycle = Math.floor(nowMs / period)
    if (cycle !== this.cycle) {
      this.cycle = cycle
      return 0
    }
    return nowMs % period < plan.ms ? 0 : 1
  }
}
