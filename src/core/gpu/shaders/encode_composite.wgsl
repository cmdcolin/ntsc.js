// Assemble the full composite waveform in IRE: sync tips, breezeway, 9-cycle
// colorburst, band-limited quadrature-modulated chroma on the subcarrier.
// Everything downstream sees only this 1D signal.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> comp: array<f32>;

// RGB -> YUV read straight off the picture into the tile. This was a pass of
// its own, writing a vec4 per sample (7.6 MB a frame) that only this pass
// read one dispatch later; the texel is a quarter the bytes and is already
// what the staging loop wanted. Worth 0.23 ms of a 2.29 ms stock frame on the
// dev box (scripts/gpuprof); B's encoders read their texture the same way.
// Zero outside active picture, which is what the blanking samples of the old
// buffer held.
fn yuvAt(s: i32, row: u32) -> vec3f {
  let x = s - i32(ACTIVE_START);
  let y = i32(row) - i32(ACTIVE_TOP);
  if (x < 0 || x >= i32(ACTIVE_W) || y < 0 || y >= i32(ACTIVE_H)) {
    return vec3f(0.0);
  }
  return yuvOf(textureLoad(inputTex, vec2i(x, y), 0).rgb);
}

var<workgroup> tileUV: array<vec2f, TILE>;

@compute @workgroup_size(TILE_WG, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(wid.x * TILE_WG) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + TILE_WG) {
    tileUV[i] = yuvAt(base + i32(i), row).yz;
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
    out = activeComposite(yuvAt(i32(s), row).x, uv.x, uv.y, carrier(n, P.frame), 1.0, P.invert);
  }

  // What broadcasters actually parked in the vertical interval: test and
  // reference signals on 17-19 and caption data on 21, invisible in normal
  // framing and then real content in the roll bar or an underscanned raster.
  // Multiburst's fifth packet sits on the subcarrier itself, so the decoder
  // colours it; the modulated staircase on 18 is the DG/DP instrument line;
  // 19 is a VIR-shaped reference; 21 is a clock run-in and dashes that
  // re-roll per frame, because captions are live data.
  if (P.vbi > 0.5 && row >= 17u && row <= 21u && row != 20u
      && s >= ACTIVE_START && s < ACTIVE_START + ACTIVE_W) {
    let x = s - ACTIVE_START;
    if (row == 17u) {
      if (x < 70u) {
        out = 100.0; // the white flag multiburst opens with
      } else {
        let pk = (x - 70u) / 114u;
        let xin = (x - 70u) % 114u;
        out = 50.0;
        if (pk < 6u && xin < 92u) {
          // packet frequencies stepping 0.5 -> 4.2 MHz, in cycles/sample;
          // the 0.25 packet is 3.58 MHz exactly — the subcarrier
          var cps = 0.0349;
          if (pk == 1u) { cps = 0.0698; }
          else if (pk == 2u) { cps = 0.1397; }
          else if (pk == 3u) { cps = 0.2095; }
          else if (pk == 4u) { cps = 0.25; }
          else if (pk == 5u) { cps = 0.2933; }
          out = 50.0 + 25.0 * sin(2.0 * PI * cps * f32(x));
        }
      }
    } else if (row == 18u) {
      // five-step staircase with the subcarrier riding every step
      let stair = f32(min(x / 151u, 4u));
      out = 10.0 + 20.0 * stair + 10.0 * carrier(n, P.frame).y;
    } else if (row == 19u) {
      // VIR: chroma reference at burst phase on 70 IRE, then luma and black
      if (x < 380u) {
        out = 70.0 - 20.0 * carrierRot(n, P.frame, 0.0).x;
      } else if (x < 570u) {
        out = 50.0;
      } else {
        out = 7.5;
      }
    } else {
      // line 21: caption clock run-in, a start bit, and two characters of
      // data at 32 cycles per line (the 503 kHz caption clock)
      let cellW = f32(SPL) / 32.0;
      let cell = u32(f32(x) / cellW);
      if (cell < 7u) {
        out = 25.0 + 25.0 * sin(2.0 * PI * f32(x) / cellW);
      } else if (cell >= 8u && cell < 27u) {
        let bit = (pcg((P.frame * 40503u) ^ 0x2101u) >> (cell - 8u)) & 1u;
        out = select(0.0, 50.0, bit == 1u || cell == 8u);
      } else {
        out = 0.0;
      }
    }
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
