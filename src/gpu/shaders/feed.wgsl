// One source's feed: the cable and head-end between that input and the mixer,
// so a fault here damages one signal alone and everything downstream — the
// other input, the sync fight, the receiver — reacts to the difference. The
// same pipeline runs this shader twice (feedA, feedB) against different
// uniform buffers: pipeline.ts packs the per-source control values into the
// standard Params fields (scramble, termination, noiseSigma, polarityFlip),
// so the mechanisms stay written in exactly one place and `gen` decorrelates
// this instance's noise from the program-bus channel's.
//
// Only per-sample damage and the paused deck's per-line resample live here.
// Anything needing the FIR bank or the color-under path (luma bandwidth,
// rainbow instability) stays on the program bus — duplicating that per source
// would triple the expensive work for effects whose per-source value is low.

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

  // This feed's deck paused (bPause/bPauseBar/bShift0/bRowOff carry whichever
  // deck's values pipeline.ts packed — A's servo state for feedA; zeros for
  // feedB, whose pause still lives on the mix_b resample). The drum re-reads
  // one track with the capstan servo defeated: each line's timing scatters on
  // its own around the slow wander, the whole raster hops vertically when the
  // servo hunts, and the head loses the track approaching the mistrack stripe
  // — a coherent hook dragging nearby lines sideways. The waveform moves whole
  // — sync, burst and all — so the receiver's PLL hunts line by line and hue
  // wobbles with the displacement, exactly what a no-TBC deck hands a set.
  var echoBase = i32(n);
  var out: f32;
  var dBar = 0.0;
  if (P.bPause > 0.0) {
    let dr = abs(f32(row) - P.bPauseBar);
    dBar = min(dr, f32(NLINES) - dr);
    let off = P.bShift0
      + P.bPause * 7.0 * (rand01(pcg(row * 613u + P.frame * 40961u)) - 0.5)
      + P.bPause * 28.0 * exp(-dBar / 9.0);
    let spl = f32(SPL);
    var su = f32(s) + off;
    su = su - floor(su / spl) * spl;
    let si = u32(su);
    let frac = su - f32(si);
    let srcRow = wrapRow(i32(row) + i32(P.bRowOff));
    let np = i32(srcRow * SPL + si);
    out = catmull(src[clampIdx(np - 1)], src[clampIdx(np)], src[clampIdx(np + 1)], src[clampIdx(np + 2)], frac);
    echoBase = np;
    // The mistrack stripe itself: where the parked head sweeps off the
    // recorded track the RF nulls and the deck's detector hands back snow —
    // sync, burst and all, since the null does not care what it lands on.
    let half = 5.0 + 13.0 * P.bPause;
    if (dBar < half) {
      let edge = 1.0 - dBar / half;
      let snow = 45.0 * gauss(u32(n) ^ pcg(P.frame * 15187u + row * 5u));
      out = mix(out, snow, clamp(edge * 1.6 * P.bPause, 0.0, 0.95));
    }
  } else {
    out = src[n];
  }

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
      // the echo taps the deck's output, so under pause it follows the
      // resampled position rather than the nominal raster
      out = out + refl * 0.6 * src[clampIdx(echoBase - 5)];
    }
  }

  dst[n] = out;
}
