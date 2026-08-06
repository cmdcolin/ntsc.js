// Per-line burst measurement, done on the *degraded* signal — exactly what a
// real decoder's burst gate sees. Downstream hue lock, chroma AGC, and the
// color killer all key off this, so hue drift / color dropout are emergent.
//
// lineInfo[row] = (burst U, burst V, instantaneous amplitude, lagged amplitude)
//
// The lagged amplitude is the chroma AGC's real time constant: an ACC's
// control voltage sits on an RC, so it answers what the last few dozen bursts
// did, not what this one is doing. Phase (x, y) stays instantaneous — the hue
// AFPC is a much faster loop than the gain leg. Decode's gain and killer read
// .w; at accLines 0 it equals .z and the set is ideal again.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> comp: array<f32>;
@group(0) @binding(2) var<storage, read> timing: array<f32>;
@group(0) @binding(3) var<storage, read_write> lineInfo: array<vec4f>;

fn burstUV(row: u32) -> vec2f {
  // the burst gate is keyed from the sync PLL, like the real burst gate
  let hoff = i32(round(timing[row]));
  var su = 0.0;
  var sv = 0.0;
  var cnt = 0.0;
  for (var s = BURST_START + 2u; s < BURST_START + BURST_LEN - 2u; s = s + 1u) {
    let n = clampIdx(i32(row * SPL + s) + hoff);
    let sc = carrier(n, P.frame);
    su = su + comp[n] * sc.x;
    sv = sv + comp[n] * sc.y;
    cnt = cnt + 1.0;
  }
  return vec2f(2.0 * su / cnt, 2.0 * sv / cnt);
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let row = gid.x;
  if (row >= NLINES) {
    return;
  }
  let uv = burstUV(row);
  let amp = length(uv);
  // Exponential memory over the bursts above, re-measured per line rather than
  // carried serially — the bounded-FIR shape ARCHITECTURE.md asks recurrences
  // to take instead of another single-thread loop in sync.wgsl.
  var lag = amp;
  if (P.accLines >= 1.0) {
    let tau = P.accLines;
    let span = min(u32(ceil(3.0 * tau)), 96u);
    var asum = 0.0;
    var wsum = 0.0;
    for (var k = 0u; k <= span; k = k + 1u) {
      let r = wrapRow(i32(row) - i32(k));
      // only lines that carry burst charge the RC; through the VBI it holds
      if (r > VSYNC_LAST + 1u) {
        let w = exp(-f32(k) / tau);
        asum = asum + w * length(burstUV(r));
        wsum = wsum + w;
      }
    }
    if (wsum > 1e-4) {
      lag = asum / wsum;
    }
  }
  lineInfo[row] = vec4f(uv.x, uv.y, amp, lag);
}
