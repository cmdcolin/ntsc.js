// Composite decoder: deflection follows the sync PLL (timing buffer), chroma
// demodulated synchronously against the exact subcarrier lattice, Y/C
// separation selectable (chroma trap / 2-line comb / 3-line comb), hue and
// gain referenced to the measured burst. Residual subcarrier at color edges
// IS the dot crawl; comb modes trade it for hanging dots, authentically.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var<storage, read> comp: array<f32>;
@group(0) @binding(3) var<storage, read> lineInfo: array<vec4f>;
@group(0) @binding(4) var<storage, read> timing: array<f32>;
@group(0) @binding(5) var outTex: texture_storage_2d<rgba8unorm, write>;
// Phosphor state ping-pongs: the light the screen is still holding is read from
// one buffer and the new state written to the other, so the lateral scatter
// below reads settled neighbours instead of a buffer this dispatch is part way
// through overwriting.
@group(0) @binding(6) var<storage, read> held: array<u32>;
@group(0) @binding(7) var<storage, read_write> heldNext: array<u32>;
@group(0) @binding(8) var<storage, read> audio: array<f32>;
@group(0) @binding(9) var<storage, read_write> scope: array<atomic<u32>>;

fn heldLight(x: i32, y: i32) -> vec3f {
  let xc = u32(clamp(x, 0, i32(ACTIVE_W) - 1));
  let yc = u32(clamp(y, 0, i32(ACTIVE_H) - 1));
  return unpack4x8unorm(held[yc * ACTIVE_W + xc]).rgb;
}

// chroma-path source per Y/C separation mode
fn csrc(i: u32) -> f32 {
  if (P.combMode < 0.5) {
    return comp[i];
  }
  let up = comp[clampIdx(i32(i) - i32(SPL))];
  if (P.combMode < 1.5) {
    return 0.5 * (comp[i] - up);
  }
  let dn = comp[clampIdx(i32(i) + i32(SPL))];
  return 0.5 * comp[i] - 0.25 * (up + dn);
}

// Deflection-domain bend: distortion of the tube's own horizontal scan, so it
// is a function of the *screen* row, not the source row. Two consequences, both
// wanted: a rolling picture slides through a bend that stays put on the glass,
// and because the burst gate (line_analyze) keys off sync alone, a bent yoke
// bends the picture without spinning hue — unlike a sync error, which does.
fn bendAt(y: f32) -> f32 {
  let t = y / f32(ACTIVE_H);
  let per = max(P.bendPeriod, 1.0);
  var s = 0.0;
  if (P.bendShape < 0.5) {
    s = exp(-y / per); // flag: hooks the top lines, dies away down the picture
  } else if (P.bendShape < 1.5) {
    s = t; // skew: the whole raster leans
  } else if (P.bendShape < 2.5) {
    s = sin(PI * t); // bow: pinned top and bottom, bulging at the middle
  } else {
    s = sin(2.0 * PI * y / per); // ripple
  }
  return P.bendAmt * s;
}

// Phosphor colour identity. The YUV matrix below targets sRGB primaries, but a
// real gun drives phosphors with their own chromaticities; converting the
// emitted light to sRGB — in linear light, since the matrix acts on photons,
// not gamma-encoded drive — is what shifts the palette toward a given tube.
// Mode 1 is P22/SMPTE-C, the phosphor set NTSC-era tubes converged on: a
// gentle pull of green toward yellow and red toward orange. Mode 2 is the
// deep 1953 NTSC primaries on an Illuminant-C white — the round-tube look,
// desaturating green/red and cooling white, exactly what those phosphors
// emit when reproduced on an sRGB display. Mode 3 is a long-persistence
// mono green tube (P1 family): one phosphor, luma only.
fn phosphorRgb(c: vec3f) -> vec3f {
  if (P.phosphorMode > 2.5) {
    return vec3f(0.18, 1.0, 0.33) * clamp(luma(c), 0.0, 1.0);
  }
  var m = mat3x3f(
    vec3f(0.93954, 0.01777, -0.00162),
    vec3f(0.05018, 0.96579, -0.00437),
    vec3f(0.01028, 0.01643, 1.00599),
  );
  if (P.phosphorMode > 1.5) {
    m = mat3x3f(
      vec3f(1.37004, -0.02497, -0.02473),
      vec3f(-0.33857, 0.84991, -0.03649),
      vec3f(-0.07566, 0.06087, 1.06122),
    );
  }
  let lin = pow(max(c, vec3f(0.0)), vec3f(2.2));
  return pow(max(m * lin, vec3f(0.0)), vec3f(1.0 / 2.2));
}

// Bent 3.58 MHz crystal: the demod LO runs scDetune off-frequency, so its
// phase error grows continuously through the frame. The burst AFPC measures
// that error once per line at the burst gate and corrects what burstLock
// trusts — so within lock a pulled crystal still shears hue *across* each
// line (the error keeps growing between burst and pixel), and with lock
// reduced the uncorrected ramp shows whole and hue barber-poles down the
// frame and through time.
fn loPhaseErr(n: u32, row: u32) -> f32 {
  let phiPix = P.scDetunePhase + P.scDetunePerSample * f32(n);
  let phiBurst = P.scDetunePhase + P.scDetunePerSample * f32(row * SPL + BURST_START);
  return phiPix - P.burstLock * phiBurst;
}

// comb-filtered chroma source span for this workgroup's row; a whole
// workgroup shares one raster row (and its sync offset), so the demod FIR
// reads shared memory instead of 1-3 storage loads per tap
var<workgroup> tile: array<f32, TILE>;

// Synchronous chroma demod centered on tile index ti / global sample n0.
// Offsets stay within the halo for |off| <= HALO - (DEMOD_TAPS-1)/2.
//
// Sampling at 4x fsc puts the carrier on the four-phase lattice (0,1) (1,0)
// (0,-1) (-1,0), so at any tap exactly one of the U and V multiplies is against
// a zero — a per-tap carrier() and half the arithmetic thrown away. Which
// accumulator a tap lands in, and with what sign, depends only on k mod 4, so
// the taps sum into four buckets and the lattice is applied once at the end as
// a rotation of those buckets onto (us, vs).
fn demodAt(ti: i32, n0: i32) -> vec2f {
  let m = i32((DEMOD_TAPS - 1u) / 2u);
  let f0 = SEC_DEMOD * FILTER_STRIDE;
  var q = vec4f(0.0);
  var k = 0;
  for (; k <= i32(DEMOD_TAPS) - 4; k = k + 4) {
    q = q + vec4f(
      filters[f0 + u32(k)] * tile[u32(ti + k - m)],
      filters[f0 + u32(k + 1)] * tile[u32(ti + k + 1 - m)],
      filters[f0 + u32(k + 2)] * tile[u32(ti + k + 2 - m)],
      filters[f0 + u32(k + 3)] * tile[u32(ti + k + 3 - m)],
    );
  }
  // odd tap count leaves up to three; select rather than a dynamic vec index,
  // which would spill q to scratch for the sake of one iteration
  for (; k < i32(DEMOD_TAPS); k = k + 1) {
    let g = filters[f0 + u32(k)] * tile[u32(ti + k - m)];
    let b = k & 3;
    q = q + vec4f(
      select(0.0, g, b == 0),
      select(0.0, g, b == 1),
      select(0.0, g, b == 2),
      select(0.0, g, b == 3),
    );
  }
  // Lattice phase of the first tap. Unlike the per-tap carrier() this replaces,
  // the phase is stepped arithmetically rather than read off a clamped index,
  // so the two differ only where the tap span runs past an end of the buffer —
  // the outermost row of a picture torn far enough to reach it.
  let r = u32(n0 - m + i32(2u * (P.frame & 1u)) + 1024) & 3u;
  var mu = vec4f(0.0, 1.0, 0.0, -1.0);
  var mv = vec4f(1.0, 0.0, -1.0, 0.0);
  if (r == 1u) {
    mu = vec4f(1.0, 0.0, -1.0, 0.0);
    mv = vec4f(0.0, -1.0, 0.0, 1.0);
  } else if (r == 2u) {
    mu = vec4f(0.0, -1.0, 0.0, 1.0);
    mv = vec4f(-1.0, 0.0, 1.0, 0.0);
  } else if (r == 3u) {
    mu = vec4f(-1.0, 0.0, 1.0, 0.0);
    mv = vec4f(0.0, 1.0, 0.0, -1.0);
  }
  return vec2f(dot(q, mu), dot(q, mv));
}

@compute @workgroup_size(TILE_WG, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  // roll wraps over the whole 525-line frame, so the VBI decodes as the
  // classic rolling black bar instead of the picture wrapping seamlessly
  let vroll = timing[525u];
  let row = wrapRow(i32(ACTIVE_TOP + gid.y) + i32(floor(vroll)));
  // parametric bend, the signal-driven supply sag, and audio patched straight
  // at the yoke — all deflection-domain, all indexed by raster line
  let ry = ACTIVE_TOP + gid.y;
  let sag = P.hvSag * timing[SAG_BASE + ry];
  let hoff = i32(round(timing[row] + bendAt(f32(gid.y)) + sag + P.audioBend * audio[ry]));
  let base = i32(row * SPL + ACTIVE_START + wid.x * TILE_WG) + hoff - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + TILE_WG) {
    tile[i] = csrc(clampIdx(base + i32(i)));
  }
  workgroupBarrier();

  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  let s = ACTIVE_START + gid.x;
  let n = clampIdx(i32(row * SPL + s) + hoff);

  // Chroma reconstruction lattice: at coarse > 1 the demod runs only at every
  // coarse-th sample and pixels between get linear interpolation — the digital
  // decoder's chroma-upsampling error. Interpolated U/V re-attach to the wrong
  // subcarrier phase at edges, blooming dither and fine detail into rainbows.
  // Factor 8 keeps the farthest tap within the tile halo (20 + 8 <= 32).
  let ti = i32(lid.x + HALO);
  let coarse = u32(clamp(P.chromaCoarse, 1.0, 8.0));
  var uvd: vec2f;
  if (coarse > 1u) {
    let x0 = (gid.x / coarse) * coarse;
    let d0 = i32(x0) - i32(gid.x);
    let a = demodAt(ti + d0, i32(n) + d0);
    let b = demodAt(ti + d0 + i32(coarse), i32(n) + d0 + i32(coarse));
    uvd = mix(a, b, f32(gid.x - x0) / f32(coarse));
  } else {
    uvd = demodAt(ti, i32(n));
  }
  var us = uvd.x;
  var vs = uvd.y;
  // receiver AGC: IF gain ahead of the demod, so luma, chroma, and black
  // level all pump together when sync depth is mismeasured
  let gif = mix(1.0, timing[527u], P.agc);
  us = us * 2.0 * gif;
  vs = vs * 2.0 * gif;

  let sc0 = carrier(n, P.frame);
  // S-video miswire: the chroma trap normally subtracts reconstructed chroma to
  // recover clean luma. Cross-wiring the Y and C pins bleeds the color
  // subcarrier back into brightness — at 0.5 the trap is defeated (raw
  // composite as luma, dot crawl everywhere), past it the chroma re-adds and
  // the subcarrier crawls as a herringbone while colored detail smears into Y.
  let chromaRecon = us * sc0.x + vs * sc0.y;
  let lum = comp[n] * gif - chromaRecon * (1.0 - 2.0 * P.svideoBleed);

  // burst lock: hue from burst phase error, gain from burst amplitude (ACC),
  // color killer when burst is gone
  let li = lineInfo[row];
  let locked = li.z > P.killThresh;
  // phase error measured about the expected 180 degrees: negating the burst
  // components keeps the angle wrapped near zero, so a partial burstLock
  // scales a continuous error instead of jumping a 2*pi branch on noise
  let e = select(0.0, atan2(-li.y, -li.x), locked) * P.burstLock;
  let acc = select(0.0, clamp(BURST_AMP / max(li.z, 0.5), 0.0, 4.0), locked);
  let g = mix(1.0, acc, P.burstLock) * P.chromaGain;

  let ev = loPhaseErr(n, row);
  // Where the demodulator's reference sits. Burst error, the bent crystal's
  // drift, the set's own tint control and audio driven into the same reference
  // network all move one phase, because in a receiver they are one oscillator
  // — which is why a tint knob and a detuned crystal are indistinguishable
  // until the burst tries to correct one of them and not the other.
  let th = e + ev + P.tint + P.audioHue * audio[ry];
  let ce = cos(th);
  let se = sin(th);
  // The two synchronous demods sit 90 degrees apart only because the reference
  // network says so. Sets on a budget used non-quadrature (X/Z) axes on
  // purpose, and a misadjusted network lands anywhere. Off 90 the colour plane
  // is sheared rather than rotated, so hues that were opposite stop being
  // opposite; narrowed to nothing, both demods read the same phase and the
  // whole wheel collapses onto one hue axis.
  let ca = cos(P.demodAxis);
  let sa = sin(P.demodAxis);
  let ur = (us * ce + vs * se) * g;
  let vr = (us * (ce * ca - se * sa) + vs * (se * ca + ce * sa)) * g;

  let yn = (lum - IRE_BLACK) / VIDEO_RANGE;
  let un = ur / VIDEO_RANGE;
  let vn = vr / VIDEO_RANGE;

  // Vectorscope tap. This is a probe across the set's *own* demodulator
  // outputs, not a bench scope on the composite going in: everything the
  // receiver does to colour — burst correction, the tint control, the angle
  // between the axes, chroma gain — has already happened here, which is the
  // whole reason to tap it there. Content that overdrives the display is
  // dropped rather than clamped, so the trace leaves the graticule the way a
  // real one does instead of piling up a false bright rim.
  if (P.scope > 0.0 && (gid.x % SCOPE_STEP) == 0u && (gid.y % SCOPE_STEP) == 0u) {
    let q = vec2f(un, vn) / SCOPE_FS;
    if (max(abs(q.x), abs(q.y)) < 1.0) {
      let b = vec2u((q * 0.5 + vec2f(0.5)) * f32(SCOPE_N));
      atomicAdd(&scope[min(b.y, SCOPE_N - 1u) * SCOPE_N + min(b.x, SCOPE_N - 1u)], 1u);
    }
  }

  let rgb = vec3f(
    yn + 1.140 * vn,
    yn - 0.395 * un - 0.581 * vn,
    yn + 2.032 * un,
  );
  // Hue-preserving gamut fit instead of a per-channel clamp: saturated content
  // stays vivid at the clipping point rather than rotating hue toward whatever
  // channel didn't overflow. crt_face works in the headroom this leaves.
  //
  // A real set extends no such courtesy, and matrixClip is how much of the
  // pullback this one declines to apply: at 1 the three output amplifiers just
  // hit their rails one at a time, and the first gun to clip drags the hue
  // toward the two still in range. See gamutLimit in the prelude.
  var outc = gamutLimit(rgb, P.matrixClip);
  if (P.phosphorMode > 0.5) {
    // matrix output can leave the cube (the 1953 fit has negative lobes), so
    // fit again — same hue-preserving desaturation
    outc = gamutFit(phosphorRgb(outc));
  }
  // Phosphor persistence: the screen still holds last frame's decaying light.
  // Skewed exponents make blue die first and green linger, so trails cool
  // toward green as they fade. Peak-hold keeps a hard-edged trail (the strobe
  // presets); additive is how phosphor light actually sums — softer and more
  // photographic. Lives on outTex (not in present) so the camera-feedback loop
  // films a persisting screen, as a real camera-at-monitor rig would.
  let pi = gid.y * ACTIVE_W + gid.x;
  if (P.phosphor > 0.0) {
    let p = min(P.phosphor, 0.995);
    let decay = vec3f(pow(p, 1.0 + P.phosphorSkew), p, pow(p, 1.0 + 2.0 * P.phosphorSkew));
    var glowing = heldLight(i32(gid.x), i32(gid.y));
    // Lateral scatter in the layer: light does not leave through the grain that
    // emitted it, it bounces sideways through the deposit and the glass, and
    // what it scatters into is still glowing itself. So the spread is applied to
    // the held light every frame and compounds along the tail: the freshly
    // written edge stays sharp while old light is progressively softer and
    // wider, instead of the trail being a stack of hard copies. Moving a
    // fraction of the light to the four neighbours; a fraction, not a blur, so
    // total light is conserved.
    if (P.phosphorBleed > 0.0) {
      let side = heldLight(i32(gid.x) - 1, i32(gid.y))
        + heldLight(i32(gid.x) + 1, i32(gid.y))
        + heldLight(i32(gid.x), i32(gid.y) - 1)
        + heldLight(i32(gid.x), i32(gid.y) + 1);
      glowing = glowing + P.phosphorBleed * (side * 0.25 - glowing);
    }
    let tail = glowing * decay;
    // Additive afterglow is only the light the phosphor still owes beyond what
    // the current drive sustains (a steadily driven pixel owes nothing) — the
    // subtraction keeps a static picture at unity instead of ratcheting the
    // whole screen to white, while a departed object still leaves its full
    // tail, summing over whatever dim content it crosses.
    let glow = gamutFit(outc + max(tail - outc * decay, vec3f(0.0)));
    outc = mix(max(outc, tail), glow, P.phosphorDecayMix);
  }
  // The store is 8-bit, so a long exponential tail quantizes to a fixed point
  // once p*v rounds back to v (everything below ~25/255 at p = 0.98) and
  // ghosts freeze on screen instead of fading. Half-LSB dither makes the
  // rounding unbiased, so trails decay all the way to black.
  let dith = (rand01(pcg(pi ^ (P.frame * 668265263u))) - 0.5) / 255.0;
  heldNext[pi] = pack4x8unorm(vec4f(outc + vec3f(dith), 1.0));

  // Debug views substitute what is displayed, not what is decoded: the
  // persistence state above is still carried, so switching a view on and off
  // does not leave the ping-pong buffer holding a frame from two frames back.
  var shown = outc;
  if (P.dbgView == 2.0) {
    let sn = (u32(f32(gid.x) / f32(ACTIVE_W) * f32(SPL))) + row * SPL;
    shown = vec3f((comp[sn] + 40.0) / 140.0);
  } else if (P.dbgView == 3.0) {
    shown = vec3f((lum - IRE_BLACK) / VIDEO_RANGE);
  } else if (P.dbgView == 4.0) {
    shown = vec3f(abs(us) / 40.0, abs(vs) / 40.0, 0.0);
  } else if (P.dbgView == 5.0) {
    shown = vec3f(li.z / 40.0, abs(e) / PI, g / 2.0);
  }
  textureStore(outTex, vec2i(gid.xy), vec4f(shown, 1.0));
}
