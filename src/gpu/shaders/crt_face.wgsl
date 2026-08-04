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
  if (P.crtSpot + P.crtGrain + P.crtBloom + P.crtHalation + P.crtGlow <= 0.0) {
    textureStore(faceTex, vec2i(gid.xy), vec4f(col, 1.0));
    return;
  }

  // Disk taps at three radii: the beam spot itself, a tight cluster for bloom,
  // a wide one for halation. The feedback loop compounds the spread over
  // frames, so a modest single-pass kernel is enough. Each tap set is gated on
  // its own params — the branches are uniform across the dispatch, so an
  // unused radius costs nothing.
  // Beam spot: the gun writes a gaussian of finite width, so a sample's light
  // lands partly on its neighbours' phosphor and every edge is a ramp. Unlike
  // bloom this is not thresholded — dim picture bleeds too, which is why a
  // real tube never resolves into a grid of hard pixels.
  var spot = center;
  var sw = 1.0;
  if (P.crtSpot > 0.0) {
    if (P.crtSpot <= 0.8) {
      for (var i = 0u; i < 4u; i = i + 1u) {
        let t = DISK4[i];
        spot = spot + beam(textureSampleLevel(srcTex, samp, uv + t.xy * P.crtSpot / dim, 0.0).rgb) * t.z;
        sw = sw + t.z;
      }
    } else if (P.crtSpot <= 2.0) {
      for (var i = 0u; i < 8u; i = i + 1u) {
        let t = DISK8[i];
        spot = spot + beam(textureSampleLevel(srcTex, samp, uv + t.xy * P.crtSpot / dim, 0.0).rgb) * t.z;
        sw = sw + t.z;
      }
    } else {
      for (var i = 0u; i < 16u; i = i + 1u) {
        let t = DISK16[i];
        spot = spot + beam(textureSampleLevel(srcTex, samp, uv + t.xy * P.crtSpot / dim, 0.0).rgb) * t.z;
        sw = sw + t.z;
      }
    }
  }
  var bloom = vec3f(0.0);
  var halo = vec3f(0.0);
  let rb = 3.5;
  let rh = 15.0;
  let scatters = P.crtBloom + P.crtHalation > 0.0;
  if (scatters) {
    for (var i = 0u; i < 16u; i = i + 1u) {
      let d = DISK16[i].xy;
      bloom = bloom + bright(textureSampleLevel(srcTex, samp, uv + d * rb / dim, 0.0).rgb, 0.55);
      halo = halo + bright(textureSampleLevel(srcTex, samp, uv + d * rh / dim, 0.0).rgb, 0.35);
    }
  }
  col = gamutFit(spot / sw);

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
