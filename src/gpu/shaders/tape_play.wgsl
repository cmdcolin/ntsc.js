// Play head of the loop bin, sited a stretch of tape further round the loop
// than the record head, and crossfaded back onto the mixer bus.
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
fn playAt(read: u32, t: f32) -> f32 {
  return catmull(
    tapeAt(tapePos(read, -2)),
    tapeAt(tapePos(read, -1)),
    tapeAt(read),
    tapeAt(tapePos(read, 1)),
    t,
  );
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;

  // Where this sample is coming off the loop: the record head is laying down
  // frame `tapeSlot`, and the play head trails it by whole frames plus a
  // remainder.
  let write = P.tapeSlot * BUF_LEN + n;
  let back = P.tapeDelayFrames * BUF_LEN + u32(floor(P.tapeDelaySamples));
  let read = tapePos(write, -i32(back));
  let t = 1.0 - fract(P.tapeDelaySamples);

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
  // the picture when the capstan wanders the delay.
  if (P.tapeNoise > 0.0) {
    v = v + P.tapeNoise * gauss(read ^ 0x5bd1e995u);
  }

  // Oxide worn off a patch of the loop. Fixed to the tape, so the same lines
  // drop out every lap; the head recovers nothing there and reads its own
  // noise floor.
  if (P.tapeWear > 0.0 && rand01(pcg((read / SPL) ^ 0x9e3779b9u)) < P.tapeWear) {
    v = mix(v, 55.0 + 45.0 * gauss(n ^ pcg(P.frame * 977u)), 0.9);
  }

  // The splice. A loop is a loop because someone joined the ends, and the joint
  // passes the play head once per lap: the head lifts for the few lines it takes
  // to cross and the RF goes with it. `tapeSpliceAt` is the sample it crosses at,
  // or negative on a frame it does not reach the head in.
  if (P.tapeSplice > 0.0 && P.tapeSpliceAt >= 0.0) {
    let d = f32(n) - P.tapeSpliceAt;
    if (d >= 0.0 && d < SPLICE_LEN) {
      let edge = 1.0 - d / SPLICE_LEN;
      v = mix(v, 45.0 * gauss(n ^ pcg(P.frame * 6151u)),
              clamp(P.tapeSplice * edge * 1.4, 0.0, 0.95));
    }
  }

  // A fader is a crossfade, not a sum, which is why a loop left up regresses
  // instead of whiting out. Amplifier rails clip whatever gets past it.
  comp[n] = clamp(mix(comp[n], P.tapeGain * v, P.tapeMix), -60.0, 140.0);
}
