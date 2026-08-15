import type { ControlKey, Controls } from '../controls'

// What one frame overwrote on the control board, kept so the board can be handed
// back at the end of it.
//
// Two things in `pipeline.ts` lay values over the live controls for the duration
// of a frame and then undo it — the modulation bay, and the stab gate that pokes
// a clean picture through the look. Both used to keep their own record of what
// they had clobbered, and one of them kept it as a fresh array of `[key, value]`
// pairs plus a fresh closure to undo it, **every frame**. That is one allocation
// per patched routing plus two, at frame rate, on the thread that is also feeding
// the GPU. So: two parallel arrays with a live length, reused frame to frame, and
// never reallocated — the arrays only ever grow to the high-water mark.
//
// `restore` walks **backwards**, and that is the load-bearing line in this file.
// Two routings are allowed to drive the same control, and the second one stacks
// on the first — it reads the already-modulated value. So a caller that saves and
// modulates in one pass records the *stacked* value as the second slot's resting
// one, and a forward restore, where the last write wins, would hand the board
// back one frame of modulation richer. Every frame, for as long as that pair
// stayed patched, compounding. Backwards, the earliest value saved for a key is
// the one that lands, which is the resting one by definition — so a caller cannot
// get this wrong by choosing the obvious loop.
export class SavedBoard {
  private readonly keys: ControlKey[] = []
  private readonly vals: number[] = []
  private n = 0

  // Start a frame's record. Cheaper than a new instance and the point of the
  // class: the arrays survive.
  begin(): void {
    this.n = 0
  }

  // Remember this control's current value, before overwriting it.
  save(controls: Controls, key: ControlKey): void {
    this.keys[this.n] = key
    this.vals[this.n] = controls[key]
    this.n++
  }

  // Put every saved value back. Backwards — see above.
  restore(controls: Controls): void {
    for (let i = this.n - 1; i >= 0; i--) {
      controls[this.keys[i]] = this.vals[i]
    }
  }
}

// One layer over the live board for the length of a frame, and the way to take
// it off again.
//
// `render()` lays on three of them — the modulation bay, the stab gate, and a
// transition in flight — and they were three copies of the same five steps:
// start a record, clear a flag, write through the record, mark the filter bank
// if anything that moved feeds one, and hand back a bound restore that marks it
// a second time. Written out three times, the interesting half is the part that
// looks like boilerplate: **the restore has to mark the bank again**, because
// the bank was designed from the modulated value this frame and the next frame
// — possibly with the routing gone — has to start from the resting one. Two of
// the three did that and the third had no reason to, which is exactly the kind
// of difference a reader cannot tell from an oversight.
//
// The board is held rather than passed, which is what lets `restore` be one
// bound field instead of a closure built per frame: `Engine.controls` is created
// once and mutated in place for the life of the engine, so there is nothing to
// go stale, and the layers run on the thread that is also feeding the GPU.
//
// What counts as a filter key is passed in rather than known here, and so is
// what to do about one — the stab layer hands over a no-op, because it marks
// the bank on the two edges of its cycle instead and a layer that swaps two
// hundred keys would otherwise redesign the FIR bank at the frame rate.
export class Overlay {
  private readonly saved = new SavedBoard()
  private moved = false

  constructor(
    private readonly controls: Controls,
    private readonly filterKeys: ReadonlySet<ControlKey>,
    private readonly onFilterMove: () => void,
  ) {}

  // Start this frame's layer. Cheap, and the point of the class: the record's
  // arrays survive.
  begin(): void {
    this.saved.begin()
    this.moved = false
  }

  // Lay one value over the board, remembering what was under it. Callers work
  // out the value first — several read the control they are about to write.
  write(key: ControlKey, value: number): void {
    this.saved.save(this.controls, key)
    if (this.filterKeys.has(key)) this.moved = true
    this.controls[key] = value
  }

  // The layer is complete: mark what it moved, and hand back the way to take it
  // off. Separate from `write` so that can run in a loop.
  seal(): () => void {
    if (this.moved) this.onFilterMove()
    return this.restore
  }

  private readonly restore = (): void => {
    this.saved.restore(this.controls)
    if (this.moved) this.onFilterMove()
  }
}
