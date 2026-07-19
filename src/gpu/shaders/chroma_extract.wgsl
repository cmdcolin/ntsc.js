// Bandpass the composite around fsc to isolate the chroma signal. Feeds both
// the luma path (composite - chroma = chroma trap) and the color-under path.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var<storage, read> comp: array<f32>;
@group(0) @binding(3) var<storage, read_write> chroma: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;
  let m = i32((P.chromaBpTaps - 1u) / 2u);
  var acc = 0.0;
  for (var k = 0u; k < P.chromaBpTaps; k = k + 1u) {
    acc = acc + filters[SEC_CHROMA_BP * FILTER_STRIDE + k] * comp[clampIdx(i32(n) + i32(k) - m)];
  }
  chroma[n] = acc;
}
