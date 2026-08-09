// A cue point on a clip's own timeline, and the loop that can hang off it.
//
// **This is not the loop bin.** `signal/tapeloop.ts` is 120 frames of
// already-damaged signal threaded through the feedback path, with its own record
// head and shuttle; it is the right mechanism for "hold the last two seconds of
// what I am seeing" and the wrong domain for this. What is here is upstream of
// the whole chain: a position in the source file, before anything has happened to
// the picture. Two features that share a word.
//
// The arrangement is the one a CDJ uses, and it is worth stating why rather than
// leaving it to be inferred from the state machine. The **in-point is the
// primary thing** — a cue you can drop and jump back to, which is useful on its
// own with no loop anywhere near it. A **loop is that same jump, fired
// automatically** when the playhead reaches an out-point. So one press marks the
// cue, a second marks the out-point and the loop engages, a third re-arms a new
// cue and the loop drops. One button, no mode to remember, and every state
// reachable from every other.
//
// Pure, and tested on its own: the gesture is the part where an off-by-one turns
// into "the loop button sometimes does nothing", which a browser is an expensive
// place to find out about.

// Shortest loop that still plays, in seconds of the clip's own time. A tap closer
// than this to the in-point is widened to it rather than rejected: a fast
// double-tap is how you ask for the shortest stutter the clip can do, and a
// gesture that silently did nothing would read as a broken button.
//
// It is a fixed duration and not a frame count, which is the honest limitation
// here — the element does not report its frame rate, so there is nothing to
// derive one from without sampling rVFC for a while first. 0.1s is three frames
// of 30fps footage and six of 60, but only one and a half of the 15fps Popeye
// clip on the shelf, where the shortest loop therefore shows one or two frames
// rather than three. That is a fair stutter rather than a fault, so it is left
// alone; what it must not become is a *hard* still, and it cannot — the wrap only
// re-seeks once the playhead has passed the end, so at least one frame is always
// delivered per lap.
export const MIN_CUE_LOOP = 0.1

export interface Cue {
  // Where a retrigger lands, and where a running loop restarts. Always set: a
  // cue exists from the moment it is marked.
  in: number
  // The out-point, once there is one. Null is "cued but not looping" — the
  // retrigger works and the playhead runs on past, which is the state the first
  // press leaves behind.
  out: number | null
}

const clampTo = (t: number, duration: number): number =>
  duration > 0 ? Math.min(duration, Math.max(0, t)) : Math.max(0, t)

// A cue that has both marks. Named so the check below can narrow to it: a
// predicate returning `cue is Cue` proves only non-null, which left every caller
// re-testing `cue.out !== null` to convince the compiler of the thing it had just
// been told.
export interface LoopingCue extends Cue {
  out: number
}

// Whether this cue is actually looping, as opposed to merely marked.
export const cueLooping = (cue: Cue | null): cue is LoopingCue =>
  cue !== null && cue.out !== null

// What the pump should clamp to, or null when nothing should be clamped. The
// engine takes this rather than the Cue itself, so a cue with no out-point
// cannot be mistaken for a zero-length region anywhere downstream.
export const cueRegion = (
  cue: Cue | null,
): { start: number; end: number } | null =>
  cueLooping(cue) ? { start: cue.in, end: cue.out } : null

// One press of the cue button, at `time` on a clip of `duration`.
//
// The two marks define an interval, and they are sorted rather than required in
// order: marking in, scrubbing back, then marking out is a thing hands do, and
// the alternative is a loop that runs from the later point to the earlier one and
// never wraps at all.
export function tapCue(cue: Cue | null, time: number, duration: number): Cue {
  const t = clampTo(time, duration)
  // Nothing marked, or a loop already running: this press starts a new cue and
  // whatever loop was running drops. Same branch, because "re-arm" and "arm" are
  // the same act — the only difference is what was there before.
  if (cue === null || cue.out !== null) return { in: t, out: null }
  const lo = Math.min(cue.in, t)
  const hi = Math.max(cue.in, t)
  return { in: lo, out: clampTo(Math.max(hi, lo + MIN_CUE_LOOP), duration) }
}

// Let go of the loop but keep the cue. What a seek out of the region does: the
// in-point is still where you want to jump back to, but a scrub bar that hauled
// you back inside the loop on every drag would be unusable.
export const dropLoop = (cue: Cue | null): Cue | null =>
  cue === null ? null : { in: cue.in, out: null }

// Whether a position is inside the running loop. Used to decide whether a seek
// counts as leaving it — a drag that lands inside the region is someone moving
// around within the loop, and should not drop it.
export const insideCue = (cue: Cue | null, time: number): boolean =>
  cueLooping(cue) && time >= cue.in && time <= cue.out

// How a cue reads in a link: `in,out`, or just `in` when there is no loop.
// Rounded to milliseconds, which is finer than anything a hand can mark and
// keeps a shared link from carrying sixteen digits of float.
const ms3 = (v: number): string => String(+v.toFixed(3))
export const formatCue = (cue: Cue | null): string =>
  cue === null
    ? ''
    : cue.out === null
      ? ms3(cue.in)
      : `${ms3(cue.in)},${ms3(cue.out)}`

// The other half of that contract. Anything malformed is dropped rather than
// half-applied: a link is untrusted input, and a cue with a NaN in it would clamp
// the playhead to nowhere and freeze the slot on one frame.
export function parseCue(raw: string | null): Cue | null {
  if (raw === null || raw === '') return null
  const parts = raw.split(',').map(Number)
  if (parts.length > 2 || parts.some(n => !Number.isFinite(n) || n < 0))
    return null
  const [a, b] = parts
  if (parts.length === 1) return { in: a, out: null }
  // Sorted and length-checked on the way in as well, so a hand-edited link
  // cannot install a region the tap gesture would never have produced.
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return { in: lo, out: Math.max(hi, lo + MIN_CUE_LOOP) }
}
