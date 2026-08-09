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
  private keys: ControlKey[] = []
  private vals: number[] = []
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
