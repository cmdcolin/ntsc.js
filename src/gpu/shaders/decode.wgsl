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
//
// The state is *linear light*, two f16 per pixel pair, not the gamma-encoded
// byte the picture is displayed as. Both halves of that matter. Encoded, a
// decaying tail spends most of its life in the top of the code range and falls
// off a cliff at the end — the opposite of how light leaves a phosphor. And at
// 8 bits a long tail quantizes to a fixed point the moment the decay rounds a
// value back to itself, so ghosts freeze on the glass instead of fading; the
// old store needed a half-LSB dither to keep trails moving at all. Half floats
// carry the same relative precision at every magnitude, so the tail thins
// smoothly for as long as the arithmetic runs and the dither is gone with it.
@group(0) @binding(6) var<storage, read> held: array<u32>;
@group(0) @binding(7) var<storage, read_write> heldNext: array<u32>;
@group(0) @binding(8) var<storage, read> audio: array<f32>;

fn heldLight(x: i32, y: i32) -> vec3f {
  let xc = u32(clamp(x, 0, i32(ACTIVE_W) - 1));
  let yc = u32(clamp(y, 0, i32(ACTIVE_H) - 1));
  let i = (yc * ACTIVE_W + xc) * 2u;
  let rg = unpack2x16float(held[i]);
  return vec3f(rg.x, rg.y, unpack2x16float(held[i + 1u]).x);
}

fn storeLight(pi: u32, e: vec3f) {
  heldNext[pi * 2u] = pack2x16float(vec2f(e.r, e.g));
  heldNext[pi * 2u + 1u] = pack2x16float(vec2f(e.b, 0.0));
}

// Gun drive is gamma-encoded; the phosphor layer works in light. Same 2.2 the
// tube identity matrix above uses, for the same reason.
fn toLight(c: vec3f) -> vec3f {
  return pow(max(c, vec3f(0.0)), vec3f(2.2));
}

fn toDrive(c: vec3f) -> vec3f {
  return pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2));
}

// Second-order (bimolecular) decay, integrated over one field.
//
// An exponential is what you get when each excited centre relaxes on its own
// clock, independent of its neighbours. ZnS phosphors — P22, P1, P7, all of
// them — do not work that way: the beam frees carriers into the lattice and
// light comes out when two of them find each other again, so the rate goes as
// the square of what is left rather than linearly. Integrating dE/dt = -kE^2
// over a field gives a hyperbola, and the hyperbola is the entire difference
// between a phosphor and a frame echo.
//
// Exponential decay scales every level by the same factor, so a moving object
// leaves a row of evenly-weighted copies of itself — which is exactly what
// `mix(prev, cur, k)` does in every cheap motion blur, and exactly why the old
// version read as digital no matter how it was tuned. Under a hyperbola the
// bright core dumps nearly all of itself in the first field or two while the
// dim remainder hangs on for hundreds, so what a moving edge leaves behind is
// a hard bright front and a faint cloud, not a stack of stencils.
fn phosphorDecay(e: vec3f, k: vec3f) -> vec3f {
  return e / (1.0 + k * e);
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

// Which raster line a screen row is scanning, before the roll offset is
// applied. Vertical size is the deflection amplitude, so it is glass geometry:
// shrinking the scan squeezes all 525 raster lines onto less screen, and what
// comes into view past the picture is the raster itself — equalizing pulses,
// the vertical interval and whatever is parked in it, the head switch — with
// beam-off black beyond the retrace, never wrapped picture. The roll offset
// still selects the *content* within the raster, so a rolling picture slides
// through an underscanned frame the same way it slides through a full-size
// one. A function of y alone, so it stays row-uniform, which is what decode's
// tiling requires of any offset.
fn rasterRowF(y: f32) -> f32 {
  return f32(ACTIVE_TOP) + 240.0 + (y - 240.0) / clamp(P.vSize, 0.2, 4.0);
}

// The scope tap (dbgView 6) draws one line of `comp` as a trace, the way a
// waveform monitor does and the way the app's own icon does: the whole 910
// samples, sync tip and burst included, against an IRE graticule. It is the
// same data the waveform tap paints as brightness — a scale on it is the
// difference between seeing that a level moved and reading how far.
//
// One line rather than all 480 overlaid: an overlay wants every sample
// scattered into a bins buffer and a finite spot drawn on the way out, which is
// a pass and a buffer, where a single line is a handful of loads inside the
// branch that was already there.
const SCOPE_H = ACTIVE_H / 3u; // the band it occupies, along the bottom
const SCOPE_Y = ACTIVE_H / 2u; // the screen row it is a trace of
const SCOPE_TOP_IRE = 120.0;
const SCOPE_BOT_IRE = -55.0;

// IRE at a screen row inside the band. Top of the band is the top of the scale,
// so the trace reads the way a level does: up is brighter.
fn scopeIre(y: f32) -> f32 {
  let t = (y - f32(ACTIVE_H - SCOPE_H)) / f32(SCOPE_H);
  return mix(SCOPE_TOP_IRE, SCOPE_BOT_IRE, t);
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
  let rrF = rasterRowF(f32(gid.y));
  let offRaster = rrF < 0.0 || rrF > f32(NLINES) - 1.0;
  let rr = u32(clamp(rrF, 0.0, f32(NLINES) - 1.0));
  let row = wrapRow(i32(rr) + i32(floor(vroll)));
  // parametric bend, the signal-driven supply sag, and audio patched straight
  // at the yoke — all deflection-domain, all indexed by raster line
  let ry = rr;
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
  // color killer when burst is gone. The amplitude decisions read the lagged
  // measurement (lineInfo.w): a real ACC's control voltage sits on an RC and
  // cannot follow line-rate damage, so gain and the killer answer a burst
  // fault tens of lines late — colour blooms back instead of snapping, and a
  // marginal burst makes the killer chatter in bands
  let li = lineInfo[row];
  let locked = li.w > P.killThresh;
  // phase error measured about the expected 180 degrees: negating the burst
  // components keeps the angle wrapped near zero, so a partial burstLock
  // scales a continuous error instead of jumping a 2*pi branch on noise
  let e = select(0.0, atan2(-li.y, -li.x), locked) * P.burstLock;
  let acc = select(0.0, clamp(BURST_AMP / max(li.w, 0.5), 0.0, 4.0), locked);
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

  // The drive the beam-limiter servo decided the flyback can afford this
  // frame (sync.wgsl). It throttles the guns as one — contrast, not black
  // level — so black stays black while everything above it breathes with the
  // servo. Ahead of the gamut fit, since it is drive into the amplifiers, not
  // light out of them.
  let ablG = timing[ABL_GAIN];
  let rgb = ablG * vec3f(
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
  if (offRaster) {
    // past the vertical retrace the beam never scans: no light, though the
    // phosphor below still owes whatever it was holding there
    outc = vec3f(0.0);
  }
  // The blanking gate held on (signal/strobe.ts). Same statement as the retrace
  // above and for the same reason — a cut gun emits nothing — but held over
  // whole frames rather than a few lines. It sits here, one line above the
  // persistence layer, on purpose: the phosphor below is handed a black frame
  // and goes on giving back the light it already holds, so the picture fades
  // through the dark at whatever rate the tube is set to instead of cutting to
  // black. Everything downstream with memory — the three loops, the loop bin,
  // the beam limiter's servo — sees the dark frames too and reacts to them.
  outc = outc * (1.0 - P.beamBlank);
  // Phosphor persistence: the screen still holds last field's decaying light.
  // Skewed rates make blue die first and green linger, so trails cool toward
  // green as they fade. Lives on outTex (not in present) so the camera-feedback
  // loop films a persisting screen, as a real camera-at-monitor rig would.
  //
  // One dispatch is one field of simulated time, which is why the decay is per
  // step and not per wall-clock millisecond: under timeScale the whole rig
  // slows together, and a phosphor that kept decaying in real time while the
  // sweep crawled would be the one part of the picture not slowing with it.
  let pi = gid.y * ACTIVE_W + gid.x;
  var emitted = toLight(outc);
  if (P.phosphor > 0.0) {
    // Held just off 1.0: at 1 the rate is zero, the layer never gives the light
    // back, and the screen keeps every field it was ever shown with nothing in
    // the pass that could clear it.
    let p = min(P.phosphor, 0.9995);
    // Rate per field. The reciprocal is what makes the control usable across
    // its range: k falls away as p approaches 1, so the top of the dial is
    // where the scope tubes live (seconds) while the middle is a hold of a
    // field or two — a real TV phosphor is gone well inside one field, so
    // anything visible as a trail on a picture tube is already past P22.
    let k = 8.0 * (1.0 - p) / p;
    let krgb = k * vec3f(1.0 + P.phosphorSkew, 1.0, 1.0 + 2.0 * P.phosphorSkew);
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
    // A hyperbola approaches zero but never reaches it, so the faint end of a
    // long tail would otherwise sit on the glass forever. A slow first-order
    // leak underneath guarantees it lands.
    let tail = phosphorDecay(glowing, krgb) * 0.9995;
    // The afterglow is only the light the layer still owes beyond what the
    // current drive sustains (a steadily driven pixel owes nothing) — the
    // subtraction keeps a static picture at unity instead of ratcheting the
    // whole screen to white, while a departed object still leaves its full
    // tail, summing over whatever dim content it crosses. Summing in light,
    // which is the only place light sums; the old peak-hold branch took a
    // max() of two gamma-encoded values, an operator no part of a tube
    // performs, and it was the source of the hard-edged stacked stencils.
    let drive = emitted;
    emitted = drive + max(tail - phosphorDecay(drive, krgb) * 0.9995, vec3f(0.0));
    outc = gamutFit(toDrive(emitted));
  }
  // Always stored, even with persistence off: the buffer is what the layer is
  // holding, and if it went stale while the control sat at 0 then turning the
  // control up would light the glass with whatever field it was parked on.
  storeLight(pi, emitted);

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
  } else if (P.dbgView == 6.0) {
    if (gid.y < ACTIVE_H - SCOPE_H) {
      // The picture stays, dimmed, above the band: a scope is for watching a
      // control move the signal, and the point of it is seeing both at once.
      // The dashes mark the line being traced.
      shown = outc * 0.4;
      if (gid.y == SCOPE_Y && (gid.x / 14u) % 2u == 0u) {
        shown = mix(shown, vec3f(0.8, 1.0, 0.5), 0.55);
      }
    } else {
      // The line under the cursor, found the way the picture finds its row, so
      // vertical size and roll carry the trace along with the content it is of.
      let srow = wrapRow(
        i32(u32(clamp(rasterRowF(f32(SCOPE_Y)), 0.0, f32(NLINES) - 1.0)))
          + i32(floor(vroll)),
      );
      // Triggered on sync the way a monitor's timebase is, off the same offset
      // the decoder locked to — and off that alone. Bend, supply sag and audio
      // at the yoke are deflection faults: they move where the raster puts a
      // sample, not where the sample is in the line, so a scope that let them
      // shift the trace would be reporting a fault the signal does not have.
      let sBase = i32(srow * SPL) + i32(round(timing[srow]));
      // The samples this column spans, plus the next column's first — sharing
      // an endpoint is what makes a steep edge draw as a connected riser
      // instead of two dots with a gap. Filling min..max is also what gives a
      // modulated column its envelope: flat luma draws as a line, and anything
      // carrying subcarrier draws as a block as tall as its swing.
      //
      // At least a whole subcarrier cycle, though. 910 samples across 754
      // columns means a column spans one sample or two, and two adjacent
      // samples on the 4x lattice are 90 degrees apart — their spread is a
      // chord, not the swing, and which chord depends on where the column
      // happened to land. Sampling a quarter of a cycle drew the envelope as a
      // picket fence.
      let c0 = i32(f32(gid.x) * f32(SPL) / f32(ACTIVE_W));
      let c1 = max(c0 + 3, i32(f32(gid.x + 1u) * f32(SPL) / f32(ACTIVE_W)));
      var lo = 1e30;
      var hi = -1e30;
      for (var i = c0; i <= c1; i = i + 1) {
        let v = comp[clampIdx(sBase + i)];
        lo = min(lo, v);
        hi = max(hi, v);
      }
      // One subcarrier cycle averaged: on the 4x lattice the chroma sums to
      // zero over four samples, so this is the luma the envelope is riding.
      let mean = 0.25 * (comp[clampIdx(sBase + c0)]
        + comp[clampIdx(sBase + c0 + 1)]
        + comp[clampIdx(sBase + c0 + 2)]
        + comp[clampIdx(sBase + c0 + 3)]);
      // …and the same four samples demodulated is the colour that column is
      // carrying, which is what the icon paints its bars with. Referenced to
      // the burst the receiver locked to on this line, plus the tint control,
      // so the block under a bar is the hue the set is about to draw — a
      // spun burst spins the trace with it. The demod axis is not in it: a
      // sheared demodulator is a receiver fault, and this is the signal.
      var cu = 0.0;
      var cv = 0.0;
      for (var k = 0; k < 4; k = k + 1) {
        let idx = clampIdx(sBase + c0 + k);
        let d = comp[idx] - mean;
        let sc = carrier(idx, P.frame);
        cu = cu + 0.5 * d * sc.x;
        cv = cv + 0.5 * d * sc.y;
      }
      let sli = lineInfo[srow];
      let sth = select(0.0, atan2(-sli.y, -sli.x), sli.w > P.killThresh)
        * P.burstLock + P.tint;
      let sce = cos(sth);
      let sse = sin(sth);
      let camp = length(vec2f(cu, cv));
      // Unit chroma: the block says *which* hue, and its height already says
      // how much, so a 10-IRE burst and a full-amplitude bar come out the same
      // colour at different sizes rather than one of them washed out.
      let cn = vec2f(cu * sce + cv * sse, cv * sce - cu * sse) / max(camp, 0.001);
      // Normalised on the widest channel rather than driven at a fixed
      // amplitude: the same matrix at a fixed drive clips blue long before
      // yellow, and a clipped channel is a rotated hue — which on the one
      // instrument that exists to be read is the wrong thing to be wrong.
      let drive = vec3f(
        1.140 * cn.y,
        -0.395 * cn.x - 0.581 * cn.y,
        2.032 * cn.x,
      );
      let hue = vec3f(0.5)
        + 0.5 * drive / max(max(abs(drive.x), abs(drive.y)), abs(drive.z));
      let ire = scopeIre(f32(gid.y));
      let perPx = (SCOPE_TOP_IRE - SCOPE_BOT_IRE) / f32(SCOPE_H);
      var v = vec3f(0.02, 0.025, 0.035);
      // Graticule at the levels worth reading against: sync tip, blanking,
      // setup, peak white. Sync depth and setup are then measurements rather
      // than impressions.
      let grat = min(
        min(abs(ire - IRE_SYNC), abs(ire - IRE_BLANK)),
        min(abs(ire - IRE_BLACK), abs(ire - (IRE_BLACK + VIDEO_RANGE))),
      );
      if (grat < perPx * 0.5) {
        v = vec3f(0.10, 0.13, 0.16);
      }
      if (ire >= lo - perPx * 0.5 && ire <= hi + perPx * 0.5) {
        // Monochrome content gets the instrument's own green rather than the
        // grey a zero-length chroma vector would give it, and the crossfade is
        // the chroma amplitude, so the trace says at a glance which parts of
        // the line are carrying colour at all.
        v = mix(
          vec3f(0.16, 0.85, 0.38),
          hue,
          clamp(camp / 6.0, 0.0, 1.0),
        );
      }
      if (abs(ire - mean) < perPx * 0.7) {
        v = vec3f(0.88, 1.0, 0.92);
      }
      shown = v;
    }
  }
  textureStore(outTex, vec2i(gid.xy), vec4f(shown, 1.0));
}
