// Bandpass the composite around fsc to isolate the chroma signal. Feeds both
// the luma path (composite - chroma = chroma trap) and the color-under path.

@group(0) @binding(0) var<storage, read> filters: array<f32>;
@group(0) @binding(1) var<storage, read> comp: array<f32>;
@group(0) @binding(2) var<storage, read_write> chroma: array<f32>;

var<workgroup> tile: array<f32, TILE>;

@compute @workgroup_size(TILE_WG, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(row * SPL + wid.x * TILE_WG) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + TILE_WG) {
    tile[i] = comp[clampIdx(base + i32(i))];
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL) {
    return;
  }
  // Folded on the kernel's own symmetry (every bank section but the demod is
  // linear-phase): mirrored taps share one coefficient, halving the multiplies
  // and the coefficient loads.
  let m = (CHROMA_BP_TAPS - 1u) / 2u;
  let c = lid.x + HALO;
  var acc = filters[SEC_CHROMA_BP * FILTER_STRIDE + m] * tile[c];
  for (var k = 0u; k < m; k = k + 1u) {
    acc = acc + filters[SEC_CHROMA_BP * FILTER_STRIDE + k] * (tile[c + k - m] + tile[c + m - k]);
  }
  chroma[row * SPL + s] = acc;
}
