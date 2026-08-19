// Source B's encoder chroma bandlimit, precomputed over B's active raster.
// mix_b's three consumers (dirty sum, genlocked dissolve, PiP inset) each ran
// this FIR per output sample with unstaged storage reads — 33 vec4f loads per
// picture sample, the most bandwidth-hungry thing the landing look does. Here
// it runs once per B sample with workgroup tiling, and the consumers read one
// vec2f. The fold below matches bChroma's old summation order exactly, so the
// consumers see bit-identical values.

@group(0) @binding(0) var<storage, read> filters: array<f32>;
@group(0) @binding(1) var<storage, read> yuvB: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> uvfB: array<vec2f>;

var<workgroup> tileUV: array<vec2f, TILE>;

@compute @workgroup_size(TILE_WG, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  // Every consumer keys off the active region before reading, so the dispatch
  // covers only active rows and columns; the rest of uvfB stays zero.
  let row = ACTIVE_TOP + wid.y;
  let base = i32(row * SPL + ACTIVE_START + wid.x * TILE_WG) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + TILE_WG) {
    tileUV[i] = yuvB[clampIdx(base + i32(i))].yz;
  }
  workgroupBarrier();

  if (gid.x >= ACTIVE_W) {
    return;
  }
  // folded on the kernel's symmetry: mirrored taps share one coefficient
  let m = (ENC_CHROMA_TAPS - 1u) / 2u;
  let c = lid.x + HALO;
  var uv = filters[SEC_ENC_CHROMA * FILTER_STRIDE + m] * tileUV[c];
  for (var k = 0u; k < m; k = k + 1u) {
    uv = uv + filters[SEC_ENC_CHROMA * FILTER_STRIDE + k] * (tileUV[c + k - m] + tileUV[c + m - k]);
  }
  uvfB[row * SPL + ACTIVE_START + gid.x] = uv;
}
