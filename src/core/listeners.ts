// Publishing a value React can subscribe to, both halves of it.
//
// Seven publishers run here — the engine's controls, its morph and its frame
// rate; the rundown, the walk and the walk's per-frame progress; the automation
// tape — and none of them shared anything. The notify half was written three
// different ways (class fields with the loop spelled out at each site, a pair of
// module helpers over a bare `Set`, and a closure over one), and the read half
// was declared three times identically, each under a comment saying it was the
// same shape as the other two.
//
// At the root rather than under `gpu/` or `ui/` for the reason `math.ts` gives:
// both layers want it and neither owns it. The engine publishes three of these
// from a class the UI never constructs; the strip publishes three from a closure
// the engine has never heard of.

// What a consumer is handed: how to hear that something changed, and how to read
// what there is now.
//
// The rule every payload has to keep is `get`'s — it must answer with the *same
// reference* while nothing has changed, because `useSyncExternalStore` compares
// snapshots by identity and a getter that builds its answer re-renders forever.
// A primitive is the easiest kind to be right about (two equal numbers are
// `===`); an object has to be replaced rather than mutated.
export interface Store<T> {
  subscribe: (fn: () => void) => () => void
  get: () => T
}

// The notify half. Always the same, whatever is being published — which is the
// whole of why it is here.

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
