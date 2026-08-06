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

  // Macrovision, stamped where a protected pressing stamps it: the vertical
  // interval, lines 12-19 — exactly the window the receiver's AGC averages
  // sync depth over (sync.wgsl gates on row > VSYNC_LAST + 3). The process is
  // a lie told to gain control: the first pulse is parked on the back porch,
  // where sync_measure samples "porch", so measured depth balloons and the
  // AGC crushes a signal that was never hot — then a train of pseudo-sync/AGC
  // pairs fills the rest of the line for any recorder whose separator
  // free-runs into them. The pulse level walks a staircase a few seconds long
  // (the real chip cycled its amplitude so a victim's AGC could never
  // settle), which is why the picture breathes instead of sitting dim. In
  // normal framing all of this is invisible; roll the picture and the
  // flashing bar rides the vertical interval into view.
  if (P.mvAgcIre > 0.0 && row >= 12u && row < 20u) {
    let cyc = 0.5 + 0.5 * cos(2.0 * PI * fract(f32(P.frame) / 400.0));
    let env = ceil((0.2 + 0.8 * cyc) * 4.0) * 0.25;
    let lvl = P.mvAgcIre * env;
    let a = lvl / 160.0; // pseudo-sync depth tracks the pulse level
    if (s >= 70u && s < 110u) {
      out = lvl; // the porch pulse, covering sync_measure's porch sample
    } else if (s >= 110u && s < 140u) {
      out = mix(IRE_BLANK, IRE_SYNC, a);
    } else if (s >= 190u && s < 790u) {
      let t = (s - 190u) % 120u;
      if (t < 30u) {
        out = mix(IRE_BLANK, IRE_SYNC, a);
      } else if (t < 75u) {
        out = lvl;
      }
    }
  }

  // Colorstripe, the other half of the process: bursts on walking bands of
  // picture lines are rotated off the house phase. The decoder trusts the
  // burst it just gated to correct each line's hue, so every poisoned band
  // comes out rotated the other way — hue banding crawling down the picture.
  // A set that trusts its burst less (burstLock) or averages it over lines
  // (accLagLines) shrugs more of it off, which is exactly the difference
  // between a TV and the VCR the stripes were aimed at.
  if (P.mvStripe != 0.0 && row >= ACTIVE_TOP
      && s >= BURST_START && s < BURST_START + BURST_LEN) {
    let band = (row + P.frame / 3u) / 6u;
    let sel = band % 4u;
    if (sel < 2u) {
      let ph = select(P.mvStripe, -P.mvStripe, sel == 1u);
      out = -BURST_AMP * carrierRot(n, P.frame, ph).x;
    }
  }
  comp[n] = out;
}
