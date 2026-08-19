// Hardware mixer feedback: the mixer's own output (last frame's degraded
// composite, one frame sync of delay) is routed back into an input bus and
// crossfaded against the live signal — no camera, no lens. A fader is a
// crossfade, not a sum, which is why hardware loops regress instead of
// whiting out. The loop delay knob is the cable length: each 70ns sample of
// delay spins fed-back hue 90 degrees per generation. Fed-back burst replaces
// part of live burst, so ACC pumping and color killer dropout at high mix are
// emergent. The output stage compresses into its rails rather than clipping.

// The luma keyer gates the crossfade with a sliced level of the fed-back
// signal itself (self-key): the loop only regenerates where its own picture
// crosses the key level. Negative key amount inverts polarity.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> prev: array<f32>;
@group(0) @binding(2) var<storage, read_write> comp: array<f32>;

// The loop amplifier's output stage. A hard rail pins runaway energy into
// flat white; a real stage compresses into its rails, so past the knee the
// gain falls away smoothly and a loop above unity folds into glowing bands
// that keep their structure instead of whiting out. The compression also
// manufactures harmonics, which is what an overdriven bus genuinely does —
// more sidebands for the next lap to chew on. Identity below the knee, so a
// loop that never runs away never notices the stage is there.
fn rails(v: f32) -> f32 {
  if (v > 110.0) {
    let t = (v - 110.0) / 30.0;
    return 110.0 + 30.0 * t / (1.0 + t);
  }
  if (v < -50.0) {
    let t = (-50.0 - v) / 10.0;
    return -50.0 - 10.0 * t / (1.0 + t);
  }
  return v;
}

// keyer's luma lowpass: a 4-sample boxcar spans one subcarrier cycle exactly
fn keyLuma(pos: f32) -> f32 {
  let i0 = i32(floor(pos)) - 1;
  var acc = 0.0;
  for (var k = 0; k < 4; k = k + 1) {
    acc = acc + prev[clampIdx(i0 + k)];
  }
  return acc * 0.25;
}

// Bent-enhancer resonance: the bend bridges a frequency-selective network
// across the box's feedback path, so the loop gain stays flat where the wire
// was (sync and levels ride through untouched) and rises in the band the
// network favors. Once crossfade x gain x (1 + boost) passes unity inside the
// band, the loop stops echoing the picture and self-oscillates, ringing
// standing bars and mesh over live video out of whatever content excites it.
// Windowed-cosine bandpass, normalized to unity at center so the boost knob
// reads directly as added in-band loop gain.
//
// The network is a network — one set of component values, not a different one
// per sample. Its 33 taps and its normalizer are functions of the two loop
// controls alone, so building them inside the tap loop cost 33 cos and 33 exp
// at every one of the raster's 477750 samples to arrive at the same 34 numbers
// each time. Staged per workgroup instead, the same way crt_face hoisted its
// disk taps: one thread designs the filter, everyone else reads it as plain
// coefficients — 66 transcendentals per workgroup rather than per sample.
//
// The summation order is untouched, so this is not an approximation: pixdiff
// reads max 0 against a floor of 0 over 200 frames of a live sub-unity loop,
// which is the strictest available check on this pass because a one-bit error
// would compound every lap. Worth 3.22 -> 3.06 ms/frame best-of (two dev
// servers off their own worktrees, four alternating rounds, on a look with
// this resonance and a 96-line chroma AGC lag both up). Read best-of and not
// the median: another agent's WebGPU session was on the box, and it disturbed
// whichever arm it landed on — rounds 1-2 the new one, rounds 3-4 the old —
// and the new arm won all four regardless, which is the control that makes
// the direction safe even though the magnitude is a quiet-box number.
const RES_M = 16;
const RES_TAPS = 2 * RES_M + 1;
var<workgroup> resK: array<f32, RES_TAPS>;
var<workgroup> resNorm: f32;

fn loopResonance(pos: f32) -> f32 {
  let c0 = i32(round(pos));
  var acc = 0.0;
  for (var i = 0; i < RES_TAPS; i = i + 1) {
    acc = acc + resK[i] * prev[clampIdx(c0 + i - RES_M)];
  }
  return acc / resNorm;
}

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
) {
  // Ahead of the bounds return below, because the barrier has to be reached by
  // every invocation in the workgroup and 910 samples do not divide by 64.
  let resonating = P.cfbFilterFc > 0.0 && P.cfbFilterBoost != 0.0;
  if (resonating && lid.x == 0u) {
    let sigma = mix(1.2, 8.0, clamp(P.cfbFilterQ, 0.0, 1.0));
    var g = 0.0;
    for (var i = 0; i < RES_TAPS; i = i + 1) {
      let k = i - RES_M;
      let cs = cos(2.0 * PI * P.cfbFilterFc * f32(k));
      let h = exp(-f32(k * k) / (2.0 * sigma * sigma)) * cs;
      resK[i] = h;
      g = g + h * cs;
    }
    resNorm = max(g, 0.05);
  }
  workgroupBarrier();

  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;
  let pos0 = f32(n) - P.cfbDelay - P.cfbLines * f32(SPL);
  var pos = pos0;
  if (P.cfbServo != 0.0) {
    // The loop's delay trimmer replaced by a varactor hanging off the video
    // bus: the fed-back waveform tunes the very delay it is riding through.
    // Sensed through a short aperture (a control line has nothing like video
    // bandwidth), referenced to mid-video so dark and bright pull opposite
    // ways — and since a sample of delay is 90 degrees of subcarrier, the
    // picture is repainting its own hue and its own geometry at once, again
    // every generation. Sync tips are the deepest thing on the wire, so they
    // yank hardest, and once a line's pull walks its sync into the next
    // line's territory the receiver's problems compound on their own. Nothing
    // here repeats: the displacement field is the picture, and the picture is
    // the displacement field one lap later.
    var lvl = 0.0;
    let c0 = i32(round(pos0));
    for (var k = -8; k <= 7; k = k + 1) {
      lvl = lvl + prev[clampIdx(c0 + k * 2)];
    }
    pos = pos0 - P.cfbServo * (lvl / 16.0 - 40.0) / 100.0;
  }
  let i0 = i32(floor(pos));
  var fb = catmull(prev[clampIdx(i0 - 1)], prev[clampIdx(i0)], prev[clampIdx(i0 + 1)], prev[clampIdx(i0 + 2)], fract(pos));
  if (resonating) {
    fb = fb + P.cfbFilterBoost * loopResonance(pos);
  }
  if (P.cfbRing != 0.0) {
    // The loop bus multiplied against the live program in a doubly-balanced
    // bridge: both inputs referenced to mid-video, so both carriers are
    // suppressed and the product straddles zero. (Single-quadrant — raw
    // fb * live — has the DC of both inputs in it, and a loop integrates that
    // bias into a white-out within a few laps.) Every component of each beats
    // against every component of the other — subcarrier against subcarrier
    // lands chroma at sum and difference phases, sync against picture mints
    // pulses where none belong — and because one input is the loop's own
    // past, the products it makes are re-multiplied next frame.
    fb = fb + P.cfbRing * (fb - 40.0) * (comp[n] - 40.0) * 0.01;
  }
  var m = P.cfbMix;
  if (P.cfbKey != 0.0) {
    var gate = smoothstep(P.cfbKeyLevel - P.cfbKeySoft, P.cfbKeyLevel + P.cfbKeySoft, keyLuma(pos));
    if (P.cfbKey < 0.0) {
      gate = 1.0 - gate;
    }
    m = m * mix(1.0, gate, abs(P.cfbKey));
  }
  comp[n] = rails(mix(comp[n], P.cfbGain * fb, m));
}
