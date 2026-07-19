// Present the decoded frame: 4:3 letterbox and a finite gaussian beam-spot
// profile across scanlines. No geometry/vignette kitsch.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var outTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(pos[vi], 0.0, 1.0);
  o.uv = pos[vi] * vec2f(0.5, -0.5) + vec2f(0.5);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  if (P.dbgView == 1.0) {
    return vec4f(in.uv, 0.5, 1.0);
  }
  let cs = vec2f(P.canvasW, P.canvasH);
  let px = in.uv * cs;
  let scale = min(cs.x / 4.0, cs.y / 3.0);
  let half = vec2f(2.0 * scale, 1.5 * scale);
  let rel = (px - cs * 0.5) / half;
  if (any(abs(rel) > vec2f(1.0))) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let tuv = rel * 0.5 + vec2f(0.5);
  let col = textureSampleLevel(outTex, samp, tuv, 0.0).rgb;
  let fr = fract(tuv.y * f32(ACTIVE_H)) - 0.5;
  let beam = 1.0 - P.scanBeam * (1.0 - exp(-fr * fr * 10.0));
  return vec4f(col * beam, 1.0);
}
