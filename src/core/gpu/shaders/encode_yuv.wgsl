// RGB -> YUV baseband, written on the signal raster (active region only).
// Kept separate from composite assembly so U/V can be band-limited by a real
// FIR before modulation, like a broadcast encoder.

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<storage, read_write> yuv: array<vec4f>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  let uv = vec2f((f32(gid.x) + 0.5) / f32(ACTIVE_W), (f32(gid.y) + 0.5) / f32(ACTIVE_H));
  let rgb = textureSampleLevel(inputTex, samp, uv, 0.0).rgb;
  let y = dot(rgb, vec3f(0.299, 0.587, 0.114));
  let u = 0.492 * (rgb.b - y);
  let v = 0.877 * (rgb.r - y);
  let row = ACTIVE_TOP + gid.y;
  yuv[row * SPL + ACTIVE_START + gid.x] = vec4f(y, u, v, 0.0);
}
