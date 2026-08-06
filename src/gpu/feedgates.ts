// Which of source B's and the two feeds' passes have anything to do this
// frame, as pure functions of the controls. They live outside Engine because
// they are the one part of the pass graph that is decidable without a GPU —
// and because the containment between them is an invariant worth a test rather
// than a comment: break it one way and mix_b resamples a bComp buffer nothing
// wrote this frame, break it the other and a full re-encode of B runs to
// produce a frame identical to A's.
//
//   bFeedOn ⊆ bWaveOn ⊆ bOn
//
// Engine holds the same predicates as bound methods so the pass `when()`
// callbacks, the bind-group swap and the uniform packing all read one answer.

import type { ControlKey, Controls } from '../controls'

export type FeedSource = 'a' | 'b'

// The two per-source feeds, as the control keys each one reads. feed.wgsl
// states every mechanism once and reads whichever source's values its instance
// was bound to, so the two feeds differ only by this table: adding a per-source
// fault is one entry here plus one block in the shader, not a pair of symmetric
// edits that can silently fall out of step.
//
// `gen` sits far above the dub generations (0..MAX_GENS) purely to decorrelate
// each feed's noise seeds from the program-bus channel's and from each other.
export const FEEDS = {
  a: {
    gen: 101,
    scramble: 'aScramble',
    scrambleMode: 'aScrambleMode',
    termination: 'aTermination',
    noise: 'aNoiseIre',
    polarity: 'aPolarity',
    dropoutRate: 'aDropoutRate',
    dropoutLen: 'aDropoutLenUs',
    pause: 'aPause',
  },
  b: {
    gen: 102,
    scramble: 'bScramble',
    scrambleMode: 'bScrambleMode',
    termination: 'bTermination',
    noise: 'bNoiseIre',
    polarity: 'bPolarity',
    dropoutRate: 'bDropoutRate',
    dropoutLen: 'bDropoutLenUs',
    pause: 'bPause',
  },
} as const satisfies Record<
  FeedSource,
  { gen: number } & Record<
    | 'scramble'
    | 'scrambleMode'
    | 'termination'
    | 'noise'
    | 'polarity'
    | 'dropoutRate'
    | 'dropoutLen'
    | 'pause',
    ControlKey
  >
>

// Whether this source's feed carries any amplitude damage — the five faults
// both feeds share. The paused deck is deliberately not in here: A's engages
// its feed outright, B's only on the dirty path, and those two conditions are
// the whole difference between the gates below.
export function feedFaults(c: Controls, src: FeedSource): boolean {
  const f = FEEDS[src]
  return (
    c[f.scramble] > 0 ||
    c[f.termination] !== 0 ||
    c[f.noise] > 0 ||
    c[f.polarity] > 0 ||
    c[f.dropoutRate] > 0
  )
}

// A's feed runs on its own account: A is the program bus, so a fault on its
// cable bites whether or not anything is patched into the other input.
export function aFeedOn(c: Controls): boolean {
  return feedFaults(c, 'a') || c[FEEDS.a.pause] > 0
}

// Who consumes B's materialized waveform: the dirty sum resamples it, and the
// genlocked dissolve reads it at the output sample — only the PiP inset still
// re-encodes from yuvB. B reaches the bus through the fader or (dirty only) the
// ring mod, so with those at zero the buffer is never read. The genlocked fader
// is a crossfade the shader clamps to [0,1], so a negative bGain left over from
// a session on the dirty path is a closed fader, not a reason to re-encode B.
export function bWaveOn(c: Controls, bEnabled: boolean): boolean {
  return (
    bEnabled &&
    (c.bGenlock < 0.5 ? c.bGain !== 0 || c.bRing !== 0 : c.bGain > 0)
  )
}

// B's feed only exists to damage a waveform something downstream will read, so
// it is gated on that first. Genlocked, the TBC the genlock implies strips the
// timing damage, which is why a held B deck engages the feed on the dirty path
// alone — with genlock on the button is just a freeze frame.
export function bFeedOn(c: Controls, bEnabled: boolean): boolean {
  return (
    bWaveOn(c, bEnabled) &&
    (feedFaults(c, 'b') || (c.bGenlock < 0.5 && c[FEEDS.b.pause] > 0))
  )
}

// What mix_b can actually change, and so what the whole source-B chain
// (composeB, encodeYuvB, encodeChromaB, encodeCompositeB) is dispatched for.
// The genlocked path is a crossfade against the program bus, so it reads
// neither the A fader nor the ring mod: a value left on either from a session
// on the dirty path would otherwise re-encode B for a frame identical to the
// one A already wrote.
export function bOn(c: Controls, bEnabled: boolean): boolean {
  return (
    bEnabled &&
    (c.pipMix !== 0 ||
      (c.bGenlock < 0.5
        ? c.bGain !== 0 || c.bRing !== 0 || c.aGain !== 1
        : c.bGain > 0))
  )
}
