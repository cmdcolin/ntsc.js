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
  var d = max(c - vec3f(P.crtCutoff), vec3f(0.0)) / max(1.0 - P.crtCutoff, 1e-3);
  d = pow(max(d, vec3f(0.0)), vec3f(P.crtGamma));
  let l = luma(d);
  return mix(vec3f(l), d, P.crtSat);
}

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

  // Golden-angle disk taps sampled at three radii: the beam spot itself, a
  // tight cluster for bloom, a wide one for halation. The feedback loop
  // compounds the spread over frames, so a modest single-pass kernel is enough.
  // Both tap sets are gated on their own params — the branches are uniform
  // across the dispatch, so an unused radius costs nothing.
  var spot = center;
  var sw = 1.0;
  var bloom = vec3f(0.0);
  var halo = vec3f(0.0);
  let rb = 3.5;
  let rh = 15.0;
  let scatters = P.crtBloom + P.crtHalation > 0.0;
  for (var i = 0u; i < 16u; i = i + 1u) {
    let a = f32(i) * 2.3999632;
    let rr = sqrt((f32(i) + 0.5) / 16.0);
    let dir = vec2f(cos(a), sin(a)) * rr;
    // Beam spot: the gun writes a gaussian of finite width, so a sample's light
    // lands partly on its neighbours' phosphor and every edge is a ramp. Unlike
    // bloom this is not thresholded — dim picture bleeds too, which is why a
    // real tube never resolves into a grid of hard pixels.
    if (P.crtSpot > 0.0) {
      let w = exp(-2.0 * rr * rr);
      spot = spot + beam(textureSampleLevel(srcTex, samp, uv + dir * P.crtSpot / dim, 0.0).rgb) * w;
      sw = sw + w;
    }
    if (scatters) {
      bloom = bloom + bright(textureSampleLevel(srcTex, samp, uv + dir * rb / dim, 0.0).rgb, 0.55);
      halo = halo + bright(textureSampleLevel(srcTex, samp, uv + dir * rh / dim, 0.0).rgb, 0.35);
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
