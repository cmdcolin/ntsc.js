// Assemble the full composite waveform in IRE: sync tips, breezeway, 9-cycle
// colorburst, band-limited quadrature-modulated chroma on the subcarrier.
// Everything downstream sees only this 1D signal.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var<storage, read> yuv: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> comp: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;
  var out = IRE_BLANK;

  if (row < VSYNC_FIRST || (row > VSYNC_LAST && row < 12u)) {
    // equalizing pulses: narrow half-line-rate pulses flanking vsync
    out = select(IRE_BLANK, IRE_SYNC, (s % 455u) < 33u);
  } else if (row >= VSYNC_FIRST && row <= VSYNC_LAST) {
    // serrated broad pulses: mostly at sync level, rising near each half-line end
    let serration = (s >= 430u && s < 498u) || s >= 880u;
    out = select(IRE_SYNC, IRE_BLANK, serration);
  } else if (s < SYNC_LEN) {
    out = IRE_SYNC;
  } else if (s >= BURST_START && s < BURST_START + BURST_LEN && row > VSYNC_LAST + 1u) {
    // burst at 180 degrees on the U axis: -A*sin
    out = -BURST_AMP * carrier(n, P.frame).x;
  } else if (s >= ACTIVE_START && s < ACTIVE_START + ACTIVE_W && row >= ACTIVE_TOP && row < ACTIVE_TOP + ACTIVE_H) {
    let m = i32((P.encChromaTaps - 1u) / 2u);
    var uf = 0.0;
    var vf = 0.0;
    for (var k = 0u; k < P.encChromaTaps; k = k + 1u) {
      let idx = clampIdx(i32(n) + i32(k) - m);
      let h = filters[SEC_ENC_CHROMA * FILTER_STRIDE + k];
      uf = uf + h * yuv[idx].y;
      vf = vf + h * yuv[idx].z;
    }
    let sc = carrier(n, P.frame);
    out = IRE_BLACK + VIDEO_RANGE * yuv[n].x + VIDEO_RANGE * (uf * sc.x + vf * sc.y);
  }
  comp[n] = out;
}
