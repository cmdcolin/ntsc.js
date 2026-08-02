// VHS color-under, record side: heterodyne the chroma from fsc down to
// 629 kHz and lowpass — the severe bandwidth loss of the color-under system.
// lineParams.y carries the per-line heterodyne base phase (accumulated in f64
// on the CPU; f32 cannot hold the running phase).

@group(0) @binding(0) var<storage, read> filters: array<f32>;
@group(0) @binding(1) var<storage, read> chroma: array<f32>;
@group(0) @binding(2) var<storage, read> lineParams: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> under: array<f32>;

// Heterodyne-and-filter in one folded pass. The lowpass is linear-phase, so a
// tap d either side of centre shares one coefficient, and the heterodyne phase
// there is just the centre phase rotated -/+ d steps:
//
//   x[-d]cos(t - dS) + x[+d]cos(t + dS)
//     = cos t cos dS (x[-d] + x[+d]) + sin t sin dS (x[-d] - x[+d])
//
// so one phasor walked outward covers both halves, and the kernel costs half
// the coefficient loads and no per-tap cos().
const DOWN_STEP = 2.0 * PI * DOWN_PER_SAMPLE;

fn downPhasor(row: u32, s: f32) -> vec2f {
  let th = lineParams[row].y + 2.0 * PI * fract(DOWN_PER_SAMPLE * s);
  return vec2f(cos(th), sin(th));
}

fn stepPhasor(p: vec2f) -> vec2f {
  let c = cos(DOWN_STEP);
  let s = sin(DOWN_STEP);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

var<workgroup> tile: array<f32, TILE>;

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(row * SPL + wid.x * 64u) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + 64u) {
    tile[i] = chroma[clampIdx(base + i32(i))];
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL) {
    return;
  }
  let m = (UNDER_TAPS - 1u) / 2u;
  let c = lid.x + HALO;
  let ph = downPhasor(row, f32(s));
  var w = vec2f(1.0, 0.0); // (cos dS, sin dS), walked outward from d = 0
  var acc = filters[SEC_UNDER * FILTER_STRIDE + m] * tile[c] * ph.x;
  for (var d = 1u; d <= m; d = d + 1u) {
    w = stepPhasor(w);
    let lo = tile[c - d];
    let hi = tile[c + d];
    acc = acc + filters[SEC_UNDER * FILTER_STRIDE + m - d]
      * (ph.x * w.x * (lo + hi) + ph.y * w.y * (lo - hi));
  }
  // the heterodyne's factor of two, out of the tap loop
  under[row * SPL + s] = 2.0 * acc;
}
