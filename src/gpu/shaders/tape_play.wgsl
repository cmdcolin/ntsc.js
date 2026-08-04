// Play heads of the loop bin — up to four of them, sited at their own stretches
// of tape further round the loop than the record head, summed onto the mixer
// bus. This is the loop-echo arrangement: one lap hands back the picture once
// per head, so the heads are a rhythm and the loop is the bar line.
//
// The generation structure that falls out of that is worth stating, because it
// is not the obvious one. A piece of tape is written once and then read by every
// head as it goes past, so all of a lap's taps are the *same* generation — what
// ages is the lap. The pattern therefore repeats intact and the whole of it goes
// a generation darker each time round, rather than decaying across the taps.
//
// This is what makes a loop of tape different from a delay line. Anything that
// survives the crossfade is recorded again on its way past the record head, so
// material still circulating after ten laps has been through the medium ten
// times: the repeats decay through generation loss rather than through a fader,
// and they decay the way tape does — colour first, then detail, with the
// medium's own noise building underneath.
//
// Three of the four losses here belong to the *tape* rather than to the moment,
// which is what tells a loop apart from a deck playing a long recording: the
// grain, the worn patches and the splice all sit at fixed positions on the loop
// and come round again on a period you can see.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> tape: array<u32>;
@group(0) @binding(2) var<storage, read_write> comp: array<f32>;

// A splice is roughly a millimetre of tape, and VHS writes at about 5.8 m/s
// head-to-tape, so the joint takes ~170 us to cross the head — call it three
// lines of lost contact.
const SPLICE_LEN = 3.0 * f32(SPL);

// How many playback heads will fit in the path. Three is the classic tape-echo
// count; four leaves room to overrun it.
const MAX_HEADS = 4u;

// Position on the loop, wrapped. u32 throughout: the loop holds 57 million
// samples, well past the 2^24 where an f32 stops counting integers one at a
// time. That is also why the delay arrives split into whole frames plus a
// remainder instead of as one sample count.
fn tapePos(base: u32, off: i32) -> u32 {
  return u32((i32(base) + off + i32(TAPE_LEN)) % i32(TAPE_LEN));
}

fn tapeAt(p: u32) -> f32 {
  let pair = unpack2x16float(tape[p >> 1u]);
  return select(pair.x, pair.y, (p & 1u) == 1u);
}

// The tape between samples. `read` is the floor of the play position and t runs
// backwards from it, so t = 1 lands exactly on `read` and t = 0 one sample
// earlier — the sub-sample part of a delay the capstan is still moving.
//
// t = 1 is the common case and worth the branch, not just an edge case: only
// the far head carries the delay's fractional part at all (the others are whole
// samples by construction), and colour framing puts the far head on a whole
// sample too. So the default configuration lands here for every head, at a
// quarter of the tape reads. The branch is uniform across the dispatch.
fn playAt(read: u32, t: f32) -> f32 {
  if (t >= 1.0) {
    return tapeAt(read);
  }
  return catmull(
    tapeAt(tapePos(read, -2)),
    tapeAt(tapePos(read, -1)),
    tapeAt(read),
    tapeAt(tapePos(read, 1)),
    t,
  );
}

// Everything one head does to what it lifts off the tape. All the heads in the
// path are the same part reading the same oxide, so none of this is per-head
// trim — what separates their outputs is only where they are standing.
fn headOutput(read: u32, t: f32, n: u32) -> f32 {
  var v = playAt(read, t);

  // Head and tape lose the top of the band on every pass. A 1-2-1 kernel is
  // -6 dB at Fsc and barely -1 dB down at picture frequencies, so chroma dies
  // several times faster than the luma carrying it — which is why a dub goes
  // grey before it goes soft, and why the tail of a long loop is monochrome.
  // Compounding it once per lap is the whole of generation loss.
  if (P.tapeHfLoss > 0.0) {
    let lo = playAt(tapePos(read, -1), t);
    let hi = playAt(tapePos(read, 1), t);
    v = mix(v, 0.25 * (lo + 2.0 * v + hi), P.tapeHfLoss);
  }

  // Tape noise belongs to the medium, not to the moment: the same grain is on
  // the same millimetre of oxide every lap. Seeding it on position rather than
  // on frame means it is re-recorded each time round instead of averaging away
  // like snow, so it builds into standing streaks — and slides bodily through
  // the picture when the capstan wanders the delay. Two heads reading the same
  // stretch therefore lift the same grain, a lap apart.
  if (P.tapeNoise > 0.0) {
    v = v + P.tapeNoise * gauss(read ^ 0x5bd1e995u);
  }

  // Oxide worn off a patch of the loop. Fixed to the tape, so the same lines
  // drop out every lap; the head recovers nothing there and reads its own
  // noise floor.
  if (P.tapeWear > 0.0 && rand01(pcg((read / SPL) ^ 0x9e3779b9u)) < P.tapeWear) {
    v = mix(v, 55.0 + 45.0 * gauss(n ^ pcg(P.frame * 977u)), 0.9);
  }
  return v;
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;

  // The stretch of tape the heads are running over, and how far round it they
  // have got. While the record head is down this window is the frame being laid
  // down now and the phase is zero, so the arithmetic below reduces to "the far
  // head trails the write pointer by the whole loop". Lift the record head and
  // the window stays put while the phase keeps walking: the tape goes on
  // circulating over the same oxide, which is what makes a held loop repeat
  // instead of running off the back of itself into older ring content.
  let holdBase = P.tapeHoldSlot * BUF_LEN;
  let phase = P.tapeHoldFrames * BUF_LEN + u32(floor(P.tapeHoldRem));
  let loopLen = P.tapeDelayFrames * BUF_LEN + u32(floor(P.tapeDelaySamples));
  let frac = fract(P.tapeDelaySamples);
  let heads = clamp(u32(P.tapeHeads + 0.5), 1u, MAX_HEADS);
  let splicePast = P.tapeSpliceFrames * BUF_LEN + u32(floor(P.tapeSpliceRem));

  var acc = 0.0;
  for (var k = 1u; k <= heads; k = k + 1u) {
    // Where head k is bolted along the path. The far head is the whole loop and
    // is taken exactly, so a single head is bit-identical to having no others.
    var d = loopLen;
    var t = 1.0 - frac;
    if (k < heads) {
      // `spread` is the head layout: 1 puts them at even subdivisions, below 1
      // crowds them toward the far end, above 1 toward the record head.
      let r = pow(f32(k) / f32(heads), P.tapeHeadSpread);
      // f32 stops counting samples singly around 2^24 and the loop runs to 57
      // million, so this lands within a handful of samples of the true ratio —
      // half a microsecond, against tap spacings of tenths of a second. What is
      // NOT negotiable at that scale is subcarrier phase, so when the transport
      // is colour framed the position is snapped back onto a whole cycle rather
      // than left whereverf32 dropped it.
      d = max(u32(round(f32(loopLen) * r)), BUF_LEN);
      if (P.tapeColourFrame >= 0.5) {
        d = (d / 4u) * 4u;
      }
      t = 1.0;
    }
    // How far round the loop this head is reading. Wrapping inside the window
    // is what holds a lifted record head to the same oxide lap after lap.
    //
    // Scrub reads in tape order rather than sweep order. A helical machine in
    // reverse still sweeps each track forwards, which is why normal reverse
    // only turns the frames around; stall the drum and the head recovers the
    // magnetisation in whatever order the tape drags past it, so the sample
    // index counts DOWN through the frame and what comes back is the waveform
    // itself reversed. Nothing below draws a consequence of that — the sync
    // tips arrive at the wrong end of each line, the burst reads phase-flipped
    // because a time-reversed sinusoid is, and the raster comes off end-first.
    // Whatever the receiver makes of that is the receiver's business.
    var inLoop = (phase + n + loopLen - d) % loopLen;
    if (P.tapeScrub > 0.5) {
      inLoop = (phase + 2u * loopLen - n - d) % loopLen;
    }
    let read = tapePos(holdBase, i32(inLoop) - i32(loopLen));
    var v = headOutput(read, t, n);

    // The splice. A loop is a loop because someone joined the ends, and the
    // joint runs the path once per lap, drawing level with each head in turn:
    // the head lifts for the three lines it takes to cross and the RF goes with
    // it. So the bump walks the tap rhythm rather than landing once a lap.
    // Modulo the loop, not a plain difference: the far head sits at the whole
    // loop length, so it draws level with the joint exactly when the joint is
    // back at the record head — a lap boundary the subtraction alone misses.
    if (P.tapeSplice > 0.0) {
      let m = i32((d + loopLen - splicePast) % loopLen);
      let at = f32(n) - f32(m);
      if (m < i32(BUF_LEN) && at >= 0.0 && at < SPLICE_LEN) {
        let edge = 1.0 - at / SPLICE_LEN;
        v = mix(v, 45.0 * gauss(n ^ pcg(P.frame * 6151u + k * 7919u)),
                clamp(P.tapeSplice * edge * 1.4, 0.0, 0.95));
      }
    }
    acc = acc + v;
  }

  // Unity-gain summing bus, so adding a head changes the pattern and not the
  // level — otherwise the fader means something different at every head count.
  // A fader is a crossfade, not a sum, which is why a loop left up regresses
  // instead of whiting out. Amplifier rails clip whatever gets past it.
  let out = acc / f32(heads);
  comp[n] = clamp(mix(comp[n], P.tapeGain * out, P.tapeMix), -60.0, 140.0);
}
