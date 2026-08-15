// The other half of a `useSyncExternalStore` pair: who to tell, and telling
// them. The `get` half is always specific to what is being published; this half
// never is.
//
// Seven of them run — the engine's controls, its morph and its frame rate; the
// rundown, the walk, and the walk's per-frame progress; the automation tape —
// and they were seven copies of the same two operations in three spellings:
// class fields with the notify loop written out at each site, a pair of module
// helpers over a bare `Set`, and a closure over one. None of them was wrong and
// all of them were the same four lines.
//
// At the root rather than under `gpu/` or `ui/` for the reason `math.ts` gives:
// both layers want it and neither owns it. The engine publishes three of these
// from a class the UI never constructs, and the strip publishes three from a
// closure the engine has never heard of.

export class Listeners {
  private readonly fns = new Set<() => void>()

  // A bound field rather than a method, and that is load-bearing:
  // `useSyncExternalStore` re-subscribes whenever the identity of what it was
  // handed changes, so a method read off its owner — a fresh bound function per
  // read — would tear the subscription down and rebuild it on every render.
  // Every publisher here hands this out directly for the same reason.
  readonly subscribe = (fn: () => void): (() => void) => {
    this.fns.add(fn)
    return () => {
      this.fns.delete(fn)
    }
  }

  // Walked live rather than over a copy. A listener that unsubscribes during a
  // notify is safe — `Set` iteration skips an entry deleted before it is
  // reached — and three of these fire on the frame path, where a copy per
  // notify is an allocation per frame on the thread feeding the GPU.
  emit(): void {
    for (const fn of this.fns) fn()
  }
}
