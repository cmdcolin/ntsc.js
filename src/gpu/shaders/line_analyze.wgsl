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

const WG = 64u;
const LAG_MAX = 96u; // deepest RC window, in lines

// The RC window each row walks is up to 97 lines deep, and consecutive rows
// walk almost the same one — so measuring per consumer re-gated the same burst
// up to 97 times over, on a dispatch narrow enough (525 threads, 9 workgroups)
// that the redundancy is latency on an idle GPU rather than throughput. A
// workgroup of 64 rows needs 64 + span measurements between them, so staging
// them is two or three gates per thread instead of ninety-seven.
//
// The gate itself is unchanged and so is the summation order, so the lag is
// the same number: pixdiff reads max 0 against a floor of 0 at accLagLines 60.
// Sized alongside the fb_composite hoist rather than alone — see the note
// there for the protocol and why best-of is the only number to read off it.
//
// Indexed backwards from the workgroup's last row: tile slot i is the burst
// amplitude of row (wid*64 + 63 - i), so the slots a thread needs run from
// 63-lid upward and the staged count follows the span rather than the ceiling.
// The RC weights are staged the same way and for the same reason — they are a
// function of k and the time constant, identical for every row in the frame.
var<workgroup> ampTile: array<f32, WG + LAG_MAX>;
var<workgroup> lagW: array<f32, LAG_MAX + 1u>;

@compute @workgroup_size(WG, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let tau = P.accLines;
  let lagging = tau >= 1.0;
  let span = min(u32(ceil(3.0 * tau)), LAG_MAX);
  if (lagging) {
    let top = i32(wid.x * WG + WG - 1u);
    for (var i = lid.x; i < WG + span; i = i + WG) {
      ampTile[i] = length(burstUV(wrapRow(top - i32(i))));
    }
    for (var k = lid.x; k <= span; k = k + WG) {
      lagW[k] = exp(-f32(k) / tau);
    }
  }
  workgroupBarrier();

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
  if (lagging) {
    let ti = WG - 1u - lid.x;
    var asum = 0.0;
    var wsum = 0.0;
    for (var k = 0u; k <= span; k = k + 1u) {
      let r = wrapRow(i32(row) - i32(k));
      // only lines that carry burst charge the RC; through the VBI it holds
      if (r > VSYNC_LAST + 1u) {
        let w = lagW[k];
        asum = asum + w * ampTile[ti + k];
        wsum = wsum + w;
      }
    }
    if (wsum > 1e-4) {
      lag = asum / wsum;
    }
  }
  lineInfo[row] = vec4f(uv.x, uv.y, amp, lag);
}
