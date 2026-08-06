// Source B is a second, fully-formed NTSC signal. Two ways to combine it:
//
// - Dirty sum (default): B is NOT genlocked to A. Its line timing slips and
//   skews (line-frequency offset), its frame rolls (field-rate offset), and its
//   subcarrier is detuned off the sampling lattice. B arrives as a real
//   waveform on its own raster (encode_composite_b, optionally through its
//   feed), and this pass resamples it at the slipped position and sums it
//   (optionally ring-modulated) BEFORE the channel, sync separator, and burst
//   measurement — so fighting sync, rolling bars, tilted tears, and chroma
//   beat patterns all emerge downstream instead of being painted.
//
// - Clean dissolve (bGenlock): B is genlocked to the house reference and
//   re-encoded on A's carrier and raster, then combined as a CROSSFADE, not a
//   sum — a production switcher dissolve/wipe. bGain is the fader; the wipe
//   pattern shapes the fade spatially so B replaces A rather than adding to it.
//   B's detune/roll/skew and ring mod do not apply on this path.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> yuvB: array<vec4f>;
@group(0) @binding(2) var<storage, read> uvfB: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> comp: array<f32>;
@group(0) @binding(4) var<storage, read> bComp: array<f32>;

// B re-encoded on the house carrier: chroma from yuvB[bIdx] modulated onto the
// A-locked subcarrier at output sample houseN (B's proc-amp hue trim only). This
// is the genlocked path — used by the clean dissolve and the PiP DVE — so B
// dot-crawls like real video but does not beat or roll. The encoder chroma
// bandlimit is precomputed per B sample by encode_chroma_b — B's raster
// position is per-sample here, so running the FIR inline read 33 unstaged
// storage taps per consumer sample.
fn encodeBHouse(houseN: u32, bIdx: u32) -> f32 {
  let uv = uvfB[bIdx];
  return activeComposite(yuvB[bIdx].x, uv.x, uv.y, carrierRot(houseN, P.frame, P.bHue), P.bVidGain, P.bInv);
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;

  // wipe pattern generator, running on the output (house) raster. A switcher
  // only switches during active picture — blanking stays on the program bus —
  // so an engaged wipe excludes B's sync and burst; wipe off is a full-frame
  // fade (gate = 1 everywhere), the hardwired dirty sum blanking and all.
  var gate = 1.0;
  if (P.wipeMode > 0.5) {
    let u = (f32(s) - f32(ACTIVE_START)) / f32(ACTIVE_W);
    let v = (f32(row) - f32(ACTIVE_TOP)) / f32(ACTIVE_H);
    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
      gate = 0.0;
    } else {
      var d = P.wipePos - u;
      if (P.wipeMode > 1.5 && P.wipeMode < 2.5) {
        d = P.wipePos - v;
      } else if (P.wipeMode > 2.5 && P.wipeMode < 3.5) {
        d = P.wipePos - max(abs(u - 0.5), abs(v - 0.5)) * 2.0;
      } else if (P.wipeMode > 3.5) {
        d = P.wipePos - (abs(u - 0.5) + abs(v - 0.5));
      }
      gate = smoothstep(-max(P.wipeSoft, 0.002), max(P.wipeSoft, 0.002), d);
    }
  }

  let a = comp[n];
  let inActive = s >= ACTIVE_START && s < ACTIVE_START + ACTIVE_W &&
    row >= ACTIVE_TOP && row < ACTIVE_TOP + ACTIVE_H;

  if (P.bGenlock > 0.5) {
    // Clean switcher: crossfade genlocked B over A on active video only; sync,
    // burst and blanking stay on the program bus. bGain is the fader level, the
    // wipe gate shapes it spatially — so B replaces A instead of summing.
    if (inActive) {
      comp[n] = mix(a, encodeBHouse(n, n), clamp(gate * P.bGain, 0.0, 1.0));
    }
  } else {
    // Dirty sum: B free-runs. Its raster position for this output sample is the
    // accumulated horizontal slip plus per-line skew, and vertical roll.
    let spl = f32(SPL);
    var sp = f32(s) + P.bShift0 + P.bShiftLine * f32(row);
    // The pause button. The drum re-reads one track with the capstan servo
    // defeated, so on top of the slow wander (folded into bShift0 by MixState)
    // each line's timing scatters on its own, and the head loses its track
    // approaching the mistrack stripe — a coherent hook that drags the lines
    // above the crossing sideways. When the walking stripe drifts through B's
    // vertical interval it takes B's broad pulses with it, and the summed
    // sync fight downstream turns into intermittent rolls nobody scheduled.
    var dBar = 0.0;
    if (P.bPause > 0.0) {
      let dr = abs(f32(row) - P.bPauseBar);
      dBar = min(dr, f32(NLINES) - dr);
      sp = sp + P.bPause * 7.0 * (rand01(pcg(row * 613u + P.frame * 40961u)) - 0.5)
        + P.bPause * 28.0 * exp(-dBar / 9.0);
    }
    let su = sp - floor(sp / spl) * spl;
    let si = u32(su);
    let frac = su - f32(si);
    let srow = wrapRow(i32(row) + i32(floor(P.bRowOff)));
    let np = i32(srow * SPL + si);
    // B is a real waveform now, so the slip is a genuine resample: the
    // fractional part re-times B's carrier against the house lattice, and the
    // 90-degrees-per-sample hue rotation that used to be an explicit phase
    // term falls out of the interpolation. Catmull keeps the carrier's
    // amplitude flat where linear interpolation would pump it (see prelude).
    var b = catmull(bComp[clampIdx(np - 1)], bComp[clampIdx(np)], bComp[clampIdx(np + 1)], bComp[clampIdx(np + 2)], frac);
    // The mistrack stripe itself: where the parked head sweeps off the
    // recorded track the RF nulls and the deck's detector hands back snow —
    // sync, burst and all, since the null does not care what it lands on.
    if (P.bPause > 0.0) {
      let half = 5.0 + 13.0 * P.bPause;
      if (dBar < half) {
        let edge = 1.0 - dBar / half;
        let snow = 45.0 * gauss(u32(n) ^ pcg(P.frame * 15187u + row * 5u));
        b = mix(b, snow, clamp(edge * 1.6 * P.bPause, 0.0, 0.95));
      }
    }

    // sum at the composite level; A rides its own bus fader (signed, so a
    // negative aGain inverts A into a difference key), ring mod multiplies
    comp[n] = P.aGain * a + gate * (P.bGain * b + P.bRing * a * b * 0.01);
  }

  // Picture-in-picture: source B squeezed into a positionable window and keyed
  // over the program. Like the clean dissolve above, the inset is re-encoded
  // with the HOUSE carrier (genlocked, as a DVE re-times it through its frame
  // store) — so it dot-crawls but doesn't chroma-beat, and it sits rock-steady
  // where B's own sync would otherwise fight. Active picture only; blanking,
  // sync and burst stay on the program bus.
  if (P.pipMix > 0.001 && inActive) {
    let u = (f32(s) - f32(ACTIVE_START)) / f32(ACTIVE_W);
    let v = (f32(row) - f32(ACTIVE_TOP)) / f32(ACTIVE_H);
    let x0 = P.pipX - 0.5 * P.pipW;
    let y0 = P.pipY - 0.5 * P.pipH;
    // signed distance to the nearest window edge: >0 inside, grows toward center
    let dIn = min(min(u - x0, x0 + P.pipW - u), min(v - y0, y0 + P.pipH - v));
    let soft = max(P.pipSoft, 0.0005);
    let key = smoothstep(0.0, soft, dIn);
    if (key > 0.0) {
      // remap the window onto B's full active picture, then re-encode chroma
      let bu = clamp((u - x0) / P.pipW, 0.0, 1.0);
      let bv = clamp((v - y0) / P.pipH, 0.0, 1.0);
      let bsi = ACTIVE_START + u32(bu * f32(ACTIVE_W - 1u));
      let bsrow = ACTIVE_TOP + u32(bv * f32(ACTIVE_H - 1u));
      let bnp = bsrow * SPL + bsi;
      var bp = encodeBHouse(n, bnp);
      // matte border: a solid frame just inside the window edge
      let isBorder = dIn < P.pipBorder;
      let inset = select(bp, IRE_BLACK + VIDEO_RANGE * 0.9, isBorder);
      // luma key: drop the inset where B's own luma crosses the slice, so a
      // dark/bright matte in B lets the program show through (the border stays
      // solid). Negative key inverts which side is kept.
      var kg = 1.0;
      if (P.pipKey != 0.0) {
        var g = smoothstep(P.pipKeyLevel - P.pipKeySoft, P.pipKeyLevel + P.pipKeySoft, yuvB[bnp].x);
        if (P.pipKey < 0.0) {
          g = 1.0 - g;
        }
        kg = select(mix(1.0, g, abs(P.pipKey)), 1.0, isBorder);
      }
      comp[n] = mix(comp[n], inset, key * P.pipMix * kg);
    }
  }
}
