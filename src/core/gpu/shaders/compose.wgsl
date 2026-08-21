// Camera-at-monitor feedback: the previous frame's CRT face (faceTex, the
// glowing screen from crt_face — not the raw decode) is re-photographed through
// a camera model — affine reframe, lens defocus + vignette, then the sensor's
// black cut and full-well saturation — and mixed with the live source.
// The nonlinearity is what makes the loop organic: bright cores bloom, dim
// trails decay into black instead of hovering as gray copies. The result is
// the encoder input, so every generation traverses the full analog chain.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var prevTex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var inputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var<storage, read> timing: array<f32>;

// The slot's picture as the file holds it. Bob-deinterlace: a capture card
// weaves NTSC's two time-staggered fields into one raster, so motion combs.
// Rebuild the whole frame from the even field alone by interpolating between
// its lines — combing gone, at half the vertical resolution (authentic 240p).
// Landing the linear sampler on exact even-line centers keeps each field line
// clean; only the vertical fill lerps.
fn pick(suv: vec2f) -> vec3f {
  if (P.deint < 0.5) {
    return textureSampleLevel(srcTex, samp, suv, 0.0).rgb;
  }
  let sh = f32(textureDimensions(srcTex).y);
  let sy = suv.y * sh - 0.5;
  let e = floor(sy * 0.5) * 2.0;
  let f = clamp((sy - e) * 0.5, 0.0, 1.0);
  let a = textureSampleLevel(srcTex, samp, vec2f(suv.x, (e + 0.5) / sh), 0.0).rgb;
  let b = textureSampleLevel(srcTex, samp, vec2f(suv.x, (e + 2.5) / sh), 0.0).rgb;
  return mix(a, b, f);
}

// The I and Q axes as RGB directions, both zero under luma()'s weights, so
// carrier noise lands as a hue and saturation error and never as brightness.
const I_DIR = vec3f(0.956, -0.272, -1.106);
const Q_DIR = vec3f(0.621, -0.647, 1.703);

fn gaussW(d: f32, sigma: f32) -> f32 {
  return exp(-0.5 * d * d / (sigma * sigma));
}

// A file digitised off a tape carries the deck's Y/C output through the
// capture card: luma through the FM path's band, chroma through color-under's
// far narrower one and a little late behind it, each with its own path's noise.
// Horizontal only, as the tape's losses are; the vertical half of a capture is
// the bob in pick(). All of it is in the file before this chain encodes it,
// which is the whole point: the tape damage downstream lands on a picture that
// was already a tape.
//
// Each band is a Gaussian gather of at most nine taps: past sigma = 1 the taps
// spread out with it rather than multiplying, the sampler's bilinear fill
// covering the gaps, so the narrowest band costs what a wide one does. The
// chroma carrier's noise had to come back through that same narrow band, which
// is why it arrives as blotches rather than speckle: it is drawn on a lattice
// of the band's correlation length — a half-cycle of B, which is 3.8 sigma —
// instead of under the sparse taps, where it would have come out per-pixel
// again. Per line and seeded on the deck's frame,
// so the blotches streak along the sweep and a paused deck holds its grain with
// its picture. `sx` is one active sample in source uv.
fn tapSpan(sigma: f32) -> vec2f {
  if (sigma <= 1.0) {
    return vec2f(ceil(sigma * 3.0), 1.0);
  }
  return vec2f(4.0, sigma * 0.75);
}

fn capture(suv: vec2f, sx: f32, xy: vec2u) -> vec3f {
  let seed = P.srcFrame * 2654435761u + xy.y * 40961u;
  let ls = tapSpan(P.capLumaSigma);
  let lsig = max(P.capLumaSigma, 1e-3);
  var y = 0.0;
  var wy = 0.0;
  for (var d = -ls.x; d <= ls.x; d += 1.0) {
    let w = gaussW(d * ls.y, lsig);
    y += luma(pick(suv + vec2f(d * ls.y * sx, 0.0))) * w;
    wy += w;
  }
  let cs = tapSpan(P.capChromaSigma);
  let csig = max(P.capChromaSigma, 1e-3);
  var c = vec3f(0.0);
  var wc = 0.0;
  for (var d = -cs.x; d <= cs.x; d += 1.0) {
    let w = gaussW(d * cs.y, csig);
    let p = pick(suv + vec2f((d * cs.y - P.capYcDelay) * sx, 0.0));
    c += (p - vec3f(luma(p))) * w;
    wc += w;
  }
  let cell = f32(xy.x) / max(1.0, 3.8 * P.capChromaSigma);
  let i = u32(floor(cell));
  let s0 = pcg(seed + i * 613u);
  let s1 = pcg(seed + (i + 1u) * 613u);
  let n = mix(
    vec2f(gauss(s0), gauss(s0 ^ 0x68E31DA4u)),
    vec2f(gauss(s1), gauss(s1 ^ 0x68E31DA4u)),
    smoothstep(0.0, 1.0, fract(cell)),
  );
  let grain = gauss(pcg(seed + xy.x * 613u + 0x9E3779B9u)) * P.capNoise;
  return vec3f(y / wy + grain) + c / wc + (n.x * I_DIR + n.y * Q_DIR) * P.capChromaNoise;
}

// lens defocus: center tap + 6-point ring at the focus radius
fn cam(uv: vec2f) -> vec3f {
  let r = vec2f(P.fbFocus / f32(ACTIVE_W), P.fbFocus / f32(ACTIVE_H));
  var acc = textureSampleLevel(prevTex, samp, uv, 0.0).rgb * 0.25;
  for (var i = 0u; i < 6u; i = i + 1u) {
    let a = f32(i) * PI / 3.0;
    acc = acc + textureSampleLevel(prevTex, samp, uv + vec2f(cos(a), sin(a)) * r, 0.0).rgb * 0.125;
  }
  return acc;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  let uv = vec2f((f32(gid.x) + 0.5) / f32(ACTIVE_W), (f32(gid.y) + 0.5) / f32(ACTIVE_H));
  // cover-fit the source into the 4:3 frame
  let disp = 4.0 / 3.0;
  var suv = uv;
  if (P.srcAspect > disp) {
    suv.x = 0.5 + (uv.x - 0.5) * (disp / P.srcAspect);
  } else {
    suv.y = 0.5 + (uv.y - 0.5) * (P.srcAspect / disp);
  }
  let captured = P.capLumaSigma > 0.0 || P.capChromaSigma > 0.0 || P.capYcDelay != 0.0
    || P.capNoise > 0.0 || P.capChromaNoise > 0.0;
  var src: vec3f;
  if (P.srcNoise < 0.5 && captured) {
    let sx = select(1.0, disp / P.srcAspect, P.srcAspect > disp) / f32(ACTIVE_W);
    src = capture(suv, sx, gid.xy);
  } else {
    src = pick(suv);
  }
  if (P.srcNoise > 2.5) {
    // A signal generator on the bench, not a deck: it free-runs whether or not
    // the transport in front of it is held, which is why this one reads no
    // srcFrame. Its phase comes in already advanced for this frame. Patched
    // instead of a picture there is nothing to FM it with, so the modulation
    // input is grounded.
    src = videoSynth(gid.xy, synthPatch(P), 0.0);
  } else if (P.srcNoise > 0.5) {
    // srcFrame rather than frame: a paused A deck holds its picture, and the
    // crawl was on the tape — composeB freezes the same way by skipping, but
    // this pass must keep running for the feedback camera below.
    src = snowSource(
      P.srcNoise,
      gid.xy,
      noiseFrame(P.srcFrame, P.srcNoiseHold),
      P.srcNoiseGrain,
      P.srcNoiseLine,
      P.srcNoiseLevel,
    );
  }
  // The synth patched *over* the picture rather than instead of it, which is
  // the arrangement the frequency-modulation input needs: something has to be
  // on the slot for its luma to drive anything. Slot A only — compose_b writes
  // its texture rather than reading one, so B has no picture in hand here.
  if (P.srcNoise < 2.5 && P.synthOver > 0.0) {
    src = mix(src, videoSynth(gid.xy, synthPatch(P), luma(src)), P.synthOver);
  }

  // transform in 4:3 aspect space so rotation doesn't shear
  let asp = vec2f(4.0 / 3.0, 1.0);
  let rel0 = (uv - vec2f(0.5)) * asp;
  let c = cos(P.fbRotate);
  let s = sin(P.fbRotate);
  let rel = mat2x2f(c, s, -s, c) * rel0;
  let fuv = rel / max(P.fbZoom, 0.05) / asp + vec2f(0.5) + vec2f(P.fbShiftX, P.fbShiftY);

  // The camera only runs while it is patched in: at fbMix 0 the gather below
  // was seven texture taps a pixel for a value mix() then multiplied by zero.
  let inside = P.fbMix > 0.0 && all(fuv >= vec2f(0.0)) && all(fuv <= vec2f(1.0));
  var fb = vec3f(0.0);
  if (inside) {
    // Auto-iris: the exposure the camera's own metering servo picked, one
    // frame late (sync.wgsl runs the servo after this pass; see the loop it
    // closes there). Fresh state — zeros before the first sync — means no
    // correction yet, not a closed aperture.
    var iris = timing[IRIS_GAIN];
    if (iris < 0.05) {
      iris = 1.0;
    }
    fb = cam(fuv) * P.fbGain * iris;
    // lens vignette, in sensor coordinates
    fb = fb * max(1.0 - P.fbVign * 1.45 * dot(rel0, rel0), 0.0);
    // sensor black cut, then full-well saturation
    fb = max(fb - vec3f(P.fbBlack), vec3f(0.0)) / (1.0 - P.fbBlack);
    // A photosite has a finite well: highlights roll into a shoulder and
    // asymptote at clip, they never gain past it. That falling gain is what
    // stabilizes the loop — once the fed-back level climbs into the shoulder the
    // round-trip gain drops below unity, so a loop that would otherwise run away
    // settles into a bright fixed point instead of pinning the whole raster
    // white. fbKnee sets where the well starts to fill: 0 is a hard clip (no
    // shoulder, the loop can still white out), 1 rolls off early and gently.
    let knee = mix(1.0, 0.3, clamp(P.fbKnee, 0.0, 1.0));
    let over = max(fb - vec3f(knee), vec3f(0.0));
    fb = min(fb, vec3f(knee)) + (1.0 - knee) * over / (1.0 - knee + over);
  }
  let outc = mix(src, fb, P.fbMix);
  textureStore(inputTex, vec2i(gid.xy), vec4f(outc, 1.0));
}
