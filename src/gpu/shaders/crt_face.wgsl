// CRT faceplate: turn the decoded signal into a picture of a glowing tube, so
// both the feedback camera (compose) and the display (present) photograph an
// emissive screen instead of the raw signal buffer. The beam spot spreads all
// light over a finite area of glass, the granular deposit mottles what it
// emits, highlight bloom spreads bright cores, halation adds a wide warm
// glass-scatter halo, a phosphor floor lifts blacks into a faint haze, and
// overbright phosphors clip toward white.
// Beam/scanline/mask geometry stays in present — it is sub-raster here; this
// pass is the photographic light behaviour that makes the loop read as a camera
// pointed at a monitor rather than a signal fed back on itself.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var faceTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<storage, read> timing: array<f32>;

// P22 glass scatter is red-dominant, so bloom haze and the black-level glow
// both warm toward amber.
const WARM = vec3f(1.0, 0.62, 0.38);

// Beam transfer: how gun drive becomes emitted phosphor light. Cutoff makes the
// background true black (drive below the knee emits nothing), gamma is the gun's
// luminance response (highlights bloom, shadows recede), saturation is applied
// around luma *after* the transfer so vivid mids survive without posterizing.
// Identity at cutoff=0, gamma=1, sat=1, so presets that don't set it are
// untouched.
fn beam(c: vec3f) -> vec3f {
  // Every tap below goes through this, so a stock gun is worth branching
  // around entirely: texture values are already in [0,1], so cutoff 0 /
  // gamma 1 / sat 1 is exactly the identity. The params are uniform, so the
  // branch is free.
  if (P.crtCutoff <= 0.0 && P.crtGamma == 1.0 && P.crtSat == 1.0) {
    return c;
  }
  var d = max(c - vec3f(P.crtCutoff), vec3f(0.0)) / max(1.0 - P.crtCutoff, 1e-3);
  if (P.crtGamma != 1.0) {
    d = pow(d, vec3f(P.crtGamma));
  }
  let l = luma(d);
  return mix(vec3f(l), d, P.crtSat);
}

// Golden-angle disk taps, hoisted to tables: xy is direction times radius
// fraction, z the beam gaussian weight exp(-2 r^2). Computing these in the tap
// loop cost cos/sin/sqrt/exp per tap — ~64 transcendentals per pixel, the
// single most expensive thing in the pass. The spot picks a sparser table when
// its radius is small: a sub-pixel gaussian reaching the glass through the
// bilinear sampler is fully captured by a few taps, and the default 0.6 px
// spot was paying for sixteen.
const DISK4 = array<vec3f, 4>(
  vec3f(0.353553, 0.000000, 0.778801),
  vec3f(-0.451544, 0.413652, 0.472367),
  vec3f(0.069116, -0.787542, 0.286505),
  vec3f(0.569143, 0.742345, 0.173774),
);
const DISK8 = array<vec3f, 8>(
  vec3f(0.250000, 0.000000, 0.882497),
  vec3f(-0.319290, 0.292496, 0.687289),
  vec3f(0.048872, -0.556877, 0.535261),
  vec3f(0.402445, 0.524918, 0.416862),
  vec3f(-0.738535, -0.130636, 0.324652),
  vec3f(0.699605, -0.445031, 0.252840),
  vec3f(-0.234004, 0.870484, 0.196912),
  vec3f(-0.446271, -0.859268, 0.153355),
);
const DISK16 = array<vec3f, 16>(
  vec3f(0.176777, 0.000000, 0.939413),
  vec3f(-0.225772, 0.206826, 0.829029),
  vec3f(0.034558, -0.393771, 0.731616),
  vec3f(0.284571, 0.371173, 0.645649),
  vec3f(-0.522223, -0.092374, 0.569783),
  vec3f(0.494695, -0.314685, 0.502832),
  vec3f(-0.165466, 0.615525, 0.443747),
  vec3f(-0.315562, -0.607594, 0.391606),
  vec3f(0.684642, 0.250030, 0.345591),
  vec3f(-0.712256, 0.294009, 0.304983),
  vec3f(0.343354, -0.733729, 0.269146),
  vec3f(0.253731, 0.808932, 0.237521),
  vec3f(-0.764746, -0.443186, 0.209611),
  vec3f(0.897134, -0.197233, 0.184981),
  vec3f(-0.547507, 0.778772, 0.163246),
  vec3f(-0.126487, -0.976090, 0.144064),
);

// over-threshold colour, hue preserved: only the part of a pixel brighter than
// t contributes light to its neighbours. Taps go through the beam transfer so
// bloom spreads gamma-expanded cores, not raw decoder voltages.
fn bright(c: vec3f, t: f32) -> vec3f {
  let b = beam(c);
  let l = luma(b);
  return b * max(l - t, 0.0) / max(l, 1e-3);
}

// Static value noise on a lattice of GRAIN_PX cells: hash the four surrounding
// cells and smoothstep between them, so the mottling is blobby rather than
// per-pixel sparkle. Two octaves because a real deposit is clumpy at more than
// one scale. Lives in active-picture space, i.e. on the glass — it does not
// crawl with the picture, and the zoom magnifies it.
const GRAIN_PX = 2.3;
fn cellHash(c: vec2u) -> f32 {
  return rand01(pcg(c.x ^ pcg(c.y * 2654435761u)));
}
fn valueNoise(p: vec2f) -> f32 {
  let i = vec2u(floor(p));
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = mix(cellHash(i), cellHash(i + vec2u(1u, 0u)), w.x);
  let b = mix(cellHash(i + vec2u(0u, 1u)), cellHash(i + vec2u(1u, 1u)), w.x);
  return mix(a, b, w.y);
}
fn grain(p: vec2f) -> f32 {
  return 0.62 * valueNoise(p / GRAIN_PX) + 0.38 * valueNoise(p / (GRAIN_PX * 0.37) + vec2f(31.7, 11.3));
}

// One gun's direct emission: the beam-spot integral around a landing point.
// Factored out of main because convergence re-runs it per channel — each gun
// writes its own slightly displaced raster, and blurring a shared sample would
// average the landing error away instead of leaving it as a fringe. The tap
// count still scales with the spot: a sub-pixel gaussian reaching the glass
// through the bilinear sampler is fully captured by a few taps.
fn spotAt(uv: vec2f, dim: vec2f) -> vec3f {
  var acc = beam(textureSampleLevel(srcTex, samp, uv, 0.0).rgb);
  var w = 1.0;
  if (P.crtSpot > 0.0) {
    if (P.crtSpot <= 0.8) {
      for (var i = 0u; i < 4u; i = i + 1u) {
        let t = DISK4[i];
        acc = acc + beam(textureSampleLevel(srcTex, samp, uv + t.xy * P.crtSpot / dim, 0.0).rgb) * t.z;
        w = w + t.z;
      }
    } else if (P.crtSpot <= 2.0) {
      for (var i = 0u; i < 8u; i = i + 1u) {
        let t = DISK8[i];
        acc = acc + beam(textureSampleLevel(srcTex, samp, uv + t.xy * P.crtSpot / dim, 0.0).rgb) * t.z;
        w = w + t.z;
      }
    } else {
      for (var i = 0u; i < 16u; i = i + 1u) {
        let t = DISK16[i];
        acc = acc + beam(textureSampleLevel(srcTex, samp, uv + t.xy * P.crtSpot / dim, 0.0).rgb) * t.z;
        w = w + t.z;
      }
    }
  }
  return acc / w;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  let dim = vec2f(f32(ACTIVE_W), f32(ACTIVE_H));
  // Vertical deflection is analog: decode rolls the raster in whole lines
  // (floor of the v-osc phase), and the fractional remainder is a sub-line
  // offset of the entire scan, applied here in the deflection domain. A
  // rolling or settling picture glides instead of stepping line by line.
  // Identity when locked — the oscillator phase rests at exactly 0.
  let uv = (vec2f(gid.xy) + vec2f(0.5, 0.5 + fract(timing[525u]))) / dim;
  // Beam transfer → saturate → gamut-fit is the emissive stage: put it here so
  // the feedback camera photographs phosphor light, not decoder voltages.
  let center = beam(textureSampleLevel(srcTex, samp, uv, 0.0).rgb);
  var col = gamutFit(center);

  // Identity copy when the light behaviour is disabled: keeps a clean signal
  // clean and skips the tap work. (The beam transfer above still ran, but it is
  // identity unless a preset set cutoff/gamma/sat.)
  // Every mechanism below has to appear in this sum, or turning one on alone
  // would take the identity path and read as a dead control. The three faults
  // take abs() because their controls are signed: crossed guns and a reversed
  // SVM coil are as real as the nominal polarity.
  if (P.crtSpot + P.crtGrain + P.crtBloom + P.crtHalation + P.crtGlow
      + abs(P.crtConverge) + abs(P.crtPurity) + abs(P.crtSvm) <= 0.0) {
    textureStore(faceTex, vec2i(gid.xy), vec4f(col, 1.0));
    return;
  }

  // Disk taps at three radii: the beam spot itself, a tight cluster for bloom,
  // a wide one for halation. The feedback loop compounds the spread over
  // frames, so a modest single-pass kernel is enough. Each tap set is gated on
  // its own control — the branches are uniform across the dispatch, so an
  // unused radius costs nothing.
  // Beam spot: the gun writes a gaussian of finite width, so a sample's light
  // lands partly on its neighbours' phosphor and every edge is a ramp. Unlike
  // bloom this is not thresholded — dim picture bleeds too, which is why a
  // real tube never resolves into a grid of hard pixels.
  let px = vec2f(gid.xy) + vec2f(0.5, 0.5);
  var direct = spotAt(uv, dim);

  // Convergence: three guns firing through one mask from three positions can
  // only be registered over part of the screen. The error is nulled at the
  // centre and grows toward the corners, so red lands outward and blue inward
  // of green, and edges pick up colour fringes that get worse the further out
  // they are. Only the direct emission is converged — the scatter below
  // integrates over a patch of glass far wider than any landing error, so it
  // comes back out registered no matter where the beams went in.
  if (P.crtConverge != 0.0) {
    let d = px - dim * 0.5;
    let q = d / (dim * 0.5);
    let rr = clamp(dot(q, q), 0.0, 2.0);
    let dir = d / max(length(d), 1e-6);
    let off = dir * (P.crtConverge * rr) / dim;
    let cr = spotAt(uv + off, dim);
    let cb = spotAt(uv - off, dim);
    direct = vec3f(cr.r, direct.g, cb.b);
  }

  // Scan velocity modulation: consumer sets patched differentiated luma into an
  // auxiliary deflection coil, so the beam decelerates through a dark→bright
  // transition and accelerates through a bright→dark one. Emission per unit
  // length goes as dwell time, so the light is *redistributed* across the edge
  // rather than added — a white overshoot on the rising side, a black notch on
  // the falling one. That asymmetry is the mechanism, not a bug; it is what SVM
  // was always criticised for. A negative amount is the coil wired backwards,
  // which swaps which side of every edge glows.
  if (P.crtSvm != 0.0) {
    let ap = max(P.crtSvmWidth, 0.25) / dim.x;
    let ll = luma(textureSampleLevel(srcTex, samp, uv - vec2f(ap, 0.0), 0.0).rgb);
    let lr = luma(textureSampleLevel(srcTex, samp, uv + vec2f(ap, 0.0), 0.0).rgb);
    direct = direct * max(1.0 + P.crtSvm * (lr - ll), 0.0);
  }

  // Purity: a magnetised patch of the shadow mask. The field bends all three
  // beams the same way, but a triad is three phosphor dots 120° apart, so one
  // displacement over-excites whichever dot it moves toward and starves the one
  // opposite. What comes out is a soft stain whose hue turns through the patch
  // rather than a flat tint — and it is fixed on the glass, so a rolling
  // picture travels through it instead of carrying it along.
  if (P.crtPurity != 0.0) {
    let pr = max(P.crtPuritySize, 1e-3) * dim.y;
    let dv = (px - vec2f(P.crtPurityX, P.crtPurityY) * dim) / pr;
    let land = P.crtPurity * exp(-2.0 * dot(dv, dv)) * dv;
    let g = vec3f(
      dot(land, vec2f(1.0, 0.0)),
      dot(land, vec2f(-0.5, 0.8660254)),
      dot(land, vec2f(-0.5, -0.8660254)),
    );
    direct = direct * max(vec3f(1.0) + g, vec3f(0.0));
  }

  // A loop each, gated on its own control. These used to share one gate and one
  // loop body, so either control being up ran both radii — a look with bloom up
  // and halation down paid a sixteen-tap gather across a 15-pixel disk for a
  // result that was then multiplied by zero, and a halo with no bloom under it
  // paid the same way round. Worth 0.12 ms of a 4.87 ms frame with bloom zeroed
  // (4.87 -> 4.75, three interleaved rounds, reproducible to the third digit).
  //
  // What this whole gather costs, measured by deleting both loops outright: 0.30
  // ms of a 4.90 ms frame, 6%. Cost is LINEAR in tap count at ~0.0094 ms/tap and
  // does not care about radius — dropping eight taps saves 0.08 ms whether they
  // sit on the 3.5-pixel bloom disk or the 15-pixel halo one, which were measured
  // separately and came out indistinguishable. So there is no locality win hiding
  // here and no superlinearity to exploit: the only lever on this gather is how
  // many taps run, and tiering (below) is the whole of it.
  //
  // Note when re-measuring: cost here reads as bimodal, ~0.8 ms apart, in whole
  // batches. That is not this pass and not the GPU's clocks — the discrete card
  // pins at its top DPM level and holds it, and 20 batches in one session vary by
  // 0.10 ms. It is another GPU client on the box. A second stepped session costs
  // 3.6 ms; one idle app tab left presenting costs 0.17 ms. Best-of survives it
  // and the median does not, so read `perf.mjs`'s per-batch list, compare best-of,
  // and check nothing else is holding a WebGPU tab open — an ablate delta taken
  // in the slow mode against one taken clean is how the numbers this comment used
  // to carry came out 8x too large.
  var bloom = vec3f(0.0);
  let rb = 3.5;
  if (P.crtBloom > 0.0) {
    // Tap count tiered on strength, the way spotAt tiers it on radius. The disk
    // is a fixed 3.5 px, so what decides whether sixteen taps are visible is not
    // how far they reach but how hard the result gets multiplied in. Against a
    // pinned frame (bars, feedback off, field parity cancelled), 8 taps differ
    // from 16 by at most 3/255 at the default 0.2 and 8/255 at 0.6, with under
    // 0.03% of pixels off by more than 4 — and by 18/255 at 1.0 and 65/255 at
    // 3.0, where it does show. 78 of the 80 presets sit at 0.6 or below and take
    // the cheap path; the two that lean on bloom keep the full disk. Worth 0.08
    // ms of a 4.90 ms frame (4.90 -> 4.82, three interleaved rounds).
    //
    // The threshold is a hard step, so sweeping the control through 0.6 pops the
    // bloom by that 8/255. Same bargain spotAt already makes at 0.8 and 2.0.
    if (P.crtBloom <= 0.6) {
      for (var i = 0u; i < 8u; i = i + 1u) {
        bloom = bloom + bright(textureSampleLevel(srcTex, samp, uv + DISK8[i].xy * rb / dim, 0.0).rgb, 0.55) * 2.0;
      }
    } else {
      for (var i = 0u; i < 16u; i = i + 1u) {
        bloom = bloom + bright(textureSampleLevel(srcTex, samp, uv + DISK16[i].xy * rb / dim, 0.0).rgb, 0.55);
      }
    }
  }

  // Glass scatter grows with beam current: a peak white drives far more light
  // into the faceplate than a mid grey does, and it spreads further before it
  // finds its way back out. Keying the halo radius off the local drive is what
  // stops halation reading as a fixed-width outline traced round anything
  // bright, which is the one way the shipped fixed radius gives itself away.
  var halo = vec3f(0.0);
  if (P.crtHalation > 0.0) {
    let rh = 15.0 * (1.0 + P.crtHaloKey * luma(center));
    for (var i = 0u; i < 16u; i = i + 1u) {
      halo = halo + bright(textureSampleLevel(srcTex, samp, uv + DISK16[i].xy * rh / dim, 0.0).rgb, 0.35);
    }
  }
  col = gamutFit(direct);

  // Granular deposit: the coating is a layer of crystallites, not a uniform
  // film, so emission is mottled. The modulation peaks in the mids — black
  // grains emit nothing to vary, and a fully driven grain has no headroom left
  // to vary in — which is why grain reads as screen texture rather than noise.
  // Direct emission only: the scattered light added below integrates over many
  // grains on its way through the glass and comes out smooth.
  if (P.crtGrain > 0.0) {
    let l = luma(col);
    col = col * (1.0 + P.crtGrain * (grain(vec2f(gid.xy)) - 0.5) * 4.0 * l * (1.0 - l));
  }

  col = col + P.crtBloom * bloom / 16.0 + P.crtHalation * luma(halo / 16.0) * WARM;

  // Phosphor glow floor: the glass is never truly black — a faint warm haze
  // that lifts with nearby light, plus a small ambient pedestal.
  col = col + P.crtGlow * WARM * (0.02 + 0.10 * luma(col));

  // Overbright phosphors desaturate toward white as the beam saturates.
  let l = luma(col);
  col = mix(col, vec3f(l), clamp((l - 0.85) * 3.0, 0.0, 0.6));

  textureStore(faceTex, vec2i(gid.xy), vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0));
}
