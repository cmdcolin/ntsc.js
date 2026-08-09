// The pulse train both of the app's gates are built on: something happens for a
// short stretch of every cycle, and the rest of the cycle it does not. The stab
// (signal/stab.ts) pokes the whole look into a clean picture on it; the strobe
// (signal/strobe.ts) lets the beam through on it. Neither gate wants the other's
// meaning, but the timing underneath is one thing, and it was written twice
// before this file existed — including both of the rules below, which are the
// hard-won half.
//
// **The rate is read off the wall clock, never a frame count.** A rate asked for
// in Hz — or locked to a beat — has to be that rate under a frame lock, on a
// 144 Hz panel, and in a tab that has just come back from the background.
// (ModState deliberately does not do this, advancing on a fixed 1/60, which is
// why a 2 Hz LFO runs at 1 Hz on a 30 fps machine. A gate you are counting along
// with cannot afford that; a wobble can.)
//
// **Every cycle gets its pulse, however short the pulse is asked to be.** A 20 ms
// stab or a 5 ms flash at 60 fps is shorter than the gap between two frames, so
// testing `now % period < ms` alone drops most of them — the picture simply goes
// dark, or the stabs silently thin out, and both read as the *rate* control being
// broken rather than as the length being under a frame.

export interface PulsePlan {
  // 0 is off. What "off" means is the caller's to say, but the gate answers the
  // same way for both of them: permanently open, because the stab's off state is
  // the look running continuously and the strobe's is the beam scanning
  // continuously, and those are the same sentence.
  hz: number
  // How long the pulse lasts, in milliseconds. Absolute rather than a duty
  // cycle, deliberately: on a duty-cycle gate, doubling the rate halves the
  // pulse, so the one number a set wants to hold still — how hard the hit reads
  // — is the one that moves when you change the tempo.
  ms: number
}

export class PulseGate {
  // Which cycle last got its guaranteed pulse. See the second rule above.
  private cycle = -1

  // True while the pulse is on. Phase survives a settings change, so dialing the
  // rate or the length while it runs does not restart the train.
  open(plan: PulsePlan, nowMs: number): boolean {
    if (!(plan.hz > 0)) {
      // Off, and the cycle count goes with it, so switching it back on starts a
      // fresh train rather than resuming one from before it was parked.
      this.cycle = -1
      return true
    }
    const period = 1000 / plan.hz
    const cycle = Math.floor(nowMs / period)
    if (cycle !== this.cycle) {
      this.cycle = cycle
      return true
    }
    return nowMs % period < plan.ms
  }
}
