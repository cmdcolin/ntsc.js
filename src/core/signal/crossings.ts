// Head-crossing precession: where the bar pattern has drifted to, for a head
// that is no longer following one track.
//
// Off play speed the head stops staying on a single recorded track. Each sweep
// crosses |speed - 1| of them and the RF nulls at every crossing, which is one
// bar standing still at a pause and four sweeping at five times play. It falls
// out of the arithmetic that a loop running backwards crosses two per sweep, so
// reverse is not clean either, and never was on a two-head machine.
//
// Here rather than in either caller because there are two decks in this app —
// the shuttle on the program path (Engine.advanceShuttle) and the delay loop's own
// transport (signal/tapeloop.ts) — and they are the same mechanism, feeding the
// same `shuttleNull` in gpu/prelude.ts. The constants were written twice and
// stayed byte-identical by luck rather than by construction. Same reason
// pulsegate.ts exists.
//
// The wrap is far out (1024, not 1) on purpose: `shuttleNull` takes `fract` of
// this, so any integer would do for the pattern, but the shader also seeds strip
// identities off it — wrapping at 1 would reroll every strip at once, once per
// crossing, where wrapping here buys one invisible reroll under the bar noise.
// The small constant term is the servo hunt: a transport never sits on an exact
// multiple of play speed, so the bars sweep rather than hold still.
const PER_CROSSING = 0.0035
const SERVO_HUNT = 0.0008
const WRAP = 1024

// Advance one deck's pattern by a frame. `bars` is the crossing count for that
// frame — the transport's speed as a multiple of play, less one — and zero is a
// head tracking properly, which has no pattern to move.
export const advanceCrossings = (phase: number, bars: number): number =>
  bars === 0 ? phase : (phase + bars * PER_CROSSING + SERVO_HUNT) % WRAP
