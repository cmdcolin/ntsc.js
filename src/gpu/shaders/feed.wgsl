// One source's feed: the cable and head-end between that input and the mixer,
// so a fault here damages one signal alone and everything downstream — the
// other input, the sync fight, the receiver — reacts to the difference. The
// same pipeline runs this shader twice (feedA, feedB) against different
// uniform buffers: pipeline.ts packs the per-source control values into the
// standard Params fields (scramble, termination, noiseSigma, polarityFlip),
// so the mechanisms stay written in exactly one place and `gen` decorrelates
// this instance's noise from the program-bus channel's.
//
// Only per-sample, stateless damage lives here. Anything needing the FIR bank
// or the color-under path (luma bandwidth, rainbow instability) stays on the
// program bus — duplicating that per source would triple the expensive work
// for effects whose per-source value is low.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;

// Snow deviates staged once per workgroup: the 1-2-1 band-limit below reads
// each neighbour's deviate, and gauss() is Box-Muller — the same redundancy
// channel.wgsl stages away.
var<workgroup> tileNs: array<f32, 66>;

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  if (P.noiseSigma > 0.0) {
    let ns = pcg(P.frame * 2654435761u + P.gen * 2246822519u);
    // slot 1 is this workgroup's first sample, so slot i is global index n0+i-1
    let n0 = row * SPL + wid.x * 64u;
    for (var i = lid.x; i < 66u; i = i + 64u) {
      tileNs[i] = gauss((n0 + i - 1u) ^ ns);
    }
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;
  var out = src[n];

  // Head-end scrambling on this feed alone — a premium channel is scrambled
  // per channel by nature. Same mechanism as the program-bus copy in
  // channel.wgsl: the carrier is lifted during the line-rate sync gate, and
  // SSAVI inverts the active video on top (burst untouched, so hue survives).
  if (P.scramble > 0.0 && (P.scrambleMode < 0.5 || P.scrambleMode > 1.5 || (row & 1u) == 0u)) {
    if (s < SYNC_LEN) {
      out = mix(out, IRE_BLANK, P.scramble);
    }
    let picture = s >= ACTIVE_START && s < ACTIVE_START + ACTIVE_W
      && row >= ACTIVE_TOP && row < ACTIVE_TOP + ACTIVE_H;
    if (P.scrambleMode > 1.5 && picture) {
      out = mix(out, 2.0 * IRE_BLACK + VIDEO_RANGE - out, P.scramble);
    }
  }

  // additive noise (snow), 1-2-1 band-limited like the receiver-side copy
  if (P.noiseSigma > 0.0) {
    let cn = lid.x + 1u;
    out = out + P.noiseSigma * 0.4082 * (tileNs[cn - 1u] + 2.0 * tileNs[cn] + tileNs[cn + 1u]);
  }

  // Hard polarity flip on this feed's connector: whole waveform negated, sync
  // and burst included. Unlike a negative bus gain this holds regardless of
  // what the mixer is doing — the fault is in the cable, not the fader.
  out = mix(out, -out, P.polarityFlip);

  // Cable termination fault on this feed. Open (>0) runs hot and rings with a
  // short round-trip echo; double-terminated (<0) halves the signal toward a
  // dim, barely-locking picture.
  if (P.termination != 0.0) {
    out = out * pow(2.0, P.termination);
    let refl = max(P.termination, 0.0);
    if (refl > 0.0) {
      out = out + refl * 0.6 * src[clampIdx(i32(n) - 5)];
    }
  }

  dst[n] = out;
}
