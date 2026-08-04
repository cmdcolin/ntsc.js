// Assemble the full composite waveform in IRE: sync tips, breezeway, 9-cycle
// colorburst, band-limited quadrature-modulated chroma on the subcarrier.
// Everything downstream sees only this 1D signal.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var<storage, read> yuv: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> comp: array<f32>;

var<workgroup> tileUV: array<vec2f, TILE>;

@compute @workgroup_size(TILE_WG, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(row * SPL + wid.x * TILE_WG) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + TILE_WG) {
    tileUV[i] = yuv[clampIdx(base + i32(i))].yz;
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL) {
    return;
  }
  let n = row * SPL + s;

  // sync/blanking/burst structure is shared with the source-B generator; only
  // active picture is filled in here, from the workgroup-tiled chroma FIR.
  let slot = ntscLineSlot(row, s, n, P.frame, 0.0);
  var out = slot.value;
  if (slot.picture) {
    // folded on the kernel's symmetry: mirrored taps share one coefficient
    let m = (ENC_CHROMA_TAPS - 1u) / 2u;
    let c = lid.x + HALO;
    var uv = filters[SEC_ENC_CHROMA * FILTER_STRIDE + m] * tileUV[c];
    for (var k = 0u; k < m; k = k + 1u) {
      uv = uv + filters[SEC_ENC_CHROMA * FILTER_STRIDE + k] * (tileUV[c + k - m] + tileUV[c + m - k]);
    }
    let uf = uv.x;
    let vf = uv.y;
    out = activeComposite(yuv[n].x, uf, vf, carrier(n, P.frame), 1.0, P.invert);
  }
  comp[n] = out;
}
