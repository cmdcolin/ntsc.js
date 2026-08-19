// Source B materialized as a real composite waveform on its own raster —
// sync, burst and picture on B's detuned carrier. Until this pass existed, B
// was synthesized analytically inside mix_b per output sample, so there was
// no B signal for a per-source fault (feedB) to damage. Now there is: mix_b's
// dirty path resamples this buffer at the slipped position, and the hue
// rotation that used to be an explicit 0.5*PI*frac term falls out of the
// interpolation, the way a real carrier picks up phase when its raster slips
// against the house clock.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> yuvB: array<vec4f>;
@group(0) @binding(2) var<storage, read> uvfB: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> outB: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;
  // B's accumulated subcarrier detune plus the proc-amp hue trim. Line-uniform,
  // so it bakes into the generated waveform; the fractional-slip term does NOT
  // belong here — it emerges downstream when mix_b resamples. Genlocked, B is
  // re-timed to the house reference, so only the hue trim survives: the
  // dissolve reads this buffer at the output sample directly, which is what
  // lets feedB's damage ride through a clean production dissolve.
  var delta = P.bHue;
  if (P.bGenlock < 0.5) {
    delta = delta + P.bPhase0 + P.bPhaseLine * f32(row);
  }
  let slot = ntscLineSlot(row, s, n, P.frame, delta);
  var b = slot.value;
  if (slot.picture) {
    let uv = uvfB[n];
    b = activeComposite(yuvB[n].x, uv.x, uv.y, carrierRot(n, P.frame, delta), P.bVidGain, P.bInv);
  }
  outB[n] = b;
}
