// A fault that resolves: something breaks, the source swaps while it is broken,
// and it heals onto the new picture.
//
// This is the shape a transition takes here, and it is the reason a transition
// here is not a wipe. An NLE composites its transitions over two *finished*
// pictures — it has both and it draws between them. This has a receiver, and
// what it can do instead is lose its grip and get it back: the frame where the
// picture is least legible is the frame that hides the edit, so the cut goes
// there and the healing does the rest. See docs/EDITOR.md › _Transitions_.
//
// Fourth sibling of glide, modstate and stab, and the distinction between the
// four is the thing to hold on to:
//
//   modulation — a hand on one knob that comes off again. Per frame, restored.
//   a morph    — the resting settings themselves travelling somewhere and
//                staying there.
//   a stab     — the whole board replaced by stock for a frame and handed back.
//   a fault    — a few controls driven *away* from wherever they rest and back,
//                over a span, with one frame in the middle marked as the one to
//                cut on. Per frame and restored, like a stab, but it travels
//                rather than flipping, and it goes to a destination rather than
//                to stock.
//
// **It travels from wherever the board rests, not from stock**, and that is what
// lets it compose with a morph instead of fighting one: `startGlide` moves the
// resting values while this runs, and each frame the fault lerps from whatever
// they are *now* towards its peak. The look walks while the fault cuts, which is
// the pairing _Transitions_ asks for.

import { clamp01 } from '../math'

import type { Controls } from '../controls'

export interface FaultPlan {
  // The fault at full depth. Read as a destination the board travels to, not as
  // an offset added to it: `vSize` has to reach 0.2 to collapse the raster
  // whether it was resting at 1 or at 3, and an offset could not say that.
  peak: Partial<Controls>
  // How long it lasts, in rendered frames. Frames rather than milliseconds
  // because the whole point is that this is right under an offline render's
  // virtual clock without a second code path (docs/EDITOR.md › _Take state_).
  frames: number
  // Where the source swap lands, 0..1 of the span. Usually 0.5 — the peak — but
  // not always: a transition whose damage should ride the *incoming* clip cuts
  // early, so more of the healing happens after the swap than before it.
  cut: number
  // Fired once, on the cut frame, before the fault is laid over the board.
  //
  // A callback rather than something the panel polls for, because the swap has
  // to land on that frame and nothing in React runs that often — the same
  // argument `setVideoRegion` already carries for living on the engine.
  onCut: () => void
}

interface FaultStep {
  peak: Partial<Controls>
  // 0..1. How far towards `peak` the board is this frame.
  depth: number
}

// Smoothstep. A linear ramp reads as a machine moving a slider; the ease-in is
// what makes the fault look like something coming loose.
const ease = (t: number): number => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

// How deep the fault is on `frame`, given its span and the frame the cut lands
// on. Exported for its test: this is the whole of the shape, and every corner it
// has is a corner the shelf is allowed to ask for.
//
// Two curves and a cut point, and they are two curves rather than one because
// the cut is not always in the middle: the rise fills [0, cutFrame] and the fall
// fills [cutFrame, last] whatever the split, so moving the cut re-times the two
// halves rather than sliding a fixed shape sideways.
//
// The ends are exactly 0 and the cut frame is exactly 1, so a fault always
// starts and finishes on an untouched board. The two degenerate cases fall out
// rather than being special-cased into existence: a cut at the very start is an
// instant attack that only heals (which is the bay's `trig` one-shot, and the
// shape _Transitions_ says is the wrong one for this), and a cut at the very end
// is a break that never heals — both reachable, neither on the shelf.
export function faultDepth(
  frame: number,
  frames: number,
  cutFrame: number,
): number {
  if (frame < 0 || frame >= frames) return 0
  if (frame === cutFrame) return 1
  const last = frames - 1
  if (frame < cutFrame) return ease(frame / cutFrame)
  return cutFrame === last ? 1 : ease((last - frame) / (last - cutFrame))
}

// Which frame the swap lands on. Rounded to a frame at the start rather than
// compared as a fraction each frame, so "the cut frame" is one number the whole
// run agrees about and `onCut` cannot fire twice or fall between two frames.
export const cutFrameOf = (frames: number, cut: number): number =>
  Math.round(clamp01(cut) * (frames - 1))

// One fault, in flight. Stateful like `Glide`, and for the same reason: the
// engine advances it once per rendered frame and nothing else may.
export class Fault {
  private plan: FaultPlan | null = null
  private cutFrame = 0
  private frame = 0

  get running(): boolean {
    return this.plan !== null
  }

  // Start, replacing whatever was running. Replacing rather than refusing: a
  // hand that hits a second transition mid-flight has said which one it wants,
  // and the board is handed back by the frame that ran, not by this one.
  //
  // A span under one frame is one frame, on `PulseGate`'s rule and for the same
  // reason — a transition asked for in a hurry should be brief, not absent.
  start(plan: FaultPlan): void {
    const frames = Math.max(1, Math.round(plan.frames))
    this.plan = { ...plan, frames }
    this.cutFrame = cutFrameOf(frames, plan.cut)
    this.frame = 0
  }

  stop(): void {
    this.plan = null
  }

  // Advance one frame. Null when nothing is running, which is nearly every
  // frame.
  //
  // **`onCut` fires from in here**, and that is the one impure thing in this
  // file. It is deliberate and it is why the order matters: it fires *before*
  // the caller lays the peak over the board, so whatever it writes is written
  // against the resting values and survives the restore at the end of the frame
  // rather than being handed back with them.
  step(): FaultStep | null {
    const plan = this.plan
    if (plan === null) return null
    const frame = this.frame
    this.frame++
    if (frame >= plan.frames) {
      this.plan = null
      return null
    }
    if (frame === this.cutFrame) plan.onCut()
    return {
      peak: plan.peak,
      depth: faultDepth(frame, plan.frames, this.cutFrame),
    }
  }
}
