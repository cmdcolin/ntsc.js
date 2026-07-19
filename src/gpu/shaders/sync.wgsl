// Sync separator + flywheel PLL, running on the degraded signal — the TV side
// of horizontal/vertical hold. Line tearing, head-switch bend at the bottom,
// and vertical rolling all emerge from sync pulses being genuinely hard to
// find in the mangled waveform.
//
// timing[0..524]  per-line horizontal offset the deflection actually used
// timing[525]     vertical roll offset (persistent)
// timing[526]     PLL state (persistent)
// timing[527]     AGC gain state (persistent): IF gain normalizing the
//                 measured sync-tip depth to 40 IRE, slewed per frame

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> comp: array<f32>;
@group(0) @binding(2) var<storage, read_write> timing: array<f32>;

const SLICE = -20.0; // IRE slicing level

fn levelAt(n: i32) -> f32 {
  // small boxcar lowpass, the sync separator's RC filter
  var acc = 0.0;
  for (var k = -2; k <= 2; k = k + 1) {
    acc = acc + comp[clampIdx(n + k)];
  }
  return acc / 5.0;
}

@compute @workgroup_size(1, 1, 1)
fn main() {
  var pll = timing[526u];
  var vroll = timing[525u];

  // vertical sync check: broad pulses should sit at sync level mid-line
  var vscore = 0.0;
  for (var r = VSYNC_FIRST; r <= VSYNC_LAST; r = r + 1u) {
    if (levelAt(i32(r * SPL + 200u)) < SLICE) {
      vscore = vscore + 1.0;
    }
  }
  if (P.vHold > 0.0) {
    if (vscore < 3.0) {
      vroll = vroll + 3.0 + 40.0 * rand01(pcg(P.frame * 719u));
    } else {
      // pull back into lock
      vroll = vroll * (1.0 - 0.35 * P.vHold);
      if (abs(vroll) < 0.6) {
        vroll = 0.0;
      }
    }
    vroll = vroll % f32(ACTIVE_H);
  } else {
    vroll = 0.0;
  }

  var depthSum = 0.0;
  var depthCount = 0.0;
  for (var row = 0u; row < NLINES; row = row + 1u) {
    // hunt for the falling sync edge near the expected line start
    let base = i32(row * SPL);
    var edge = -1000.0;
    var prev = levelAt(base - 30);
    for (var s = -29; s < 55; s = s + 1) {
      let cur = levelAt(base + s);
      if (prev >= SLICE && cur < SLICE) {
        edge = f32(s);
        break;
      }
      prev = cur;
    }
    if (edge > -999.0) {
      // flywheel: blend measurement in at the hold gain
      pll = pll + P.hHold * (edge - pll);
      // gated AGC: sample mid-tip and back porch on picture lines
      if (row > VSYNC_LAST + 3u) {
        let tip = levelAt(base + i32(edge) + 20);
        let porch = levelAt(base + i32(edge) + i32(SYNC_LEN) + 8);
        depthSum = depthSum + (porch - tip);
        depthCount = depthCount + 1.0;
      }
    } else {
      // free-run with slight drift when sync is lost
      pll = pll + 0.15 * (rand01(pcg(row * 7919u + P.frame * 104729u)) - 0.45);
    }
    timing[row] = pll;
  }

  var agc = timing[527u];
  if (agc < 0.05) {
    agc = 1.0;
  }
  if (depthCount > 0.0) {
    let want = 40.0 / clamp(depthSum / depthCount, 5.0, 160.0);
    agc = agc + 0.25 * (want - agc);
  }

  timing[525u] = vroll;
  timing[526u] = pll;
  timing[527u] = clamp(agc, 0.25, 4.0);
}
