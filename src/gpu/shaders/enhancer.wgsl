// A consumer video enhancer / image stabilizer patched inline between the deck
// and the set — the kind of box (Sima SED, Vidicraft Detailer) circuit benders
// bridge jumpers across. Three of its stages, each bendable:
//
//   clamp    keyed DC restoration on the back porch. Slide the gate off the
//            porch and picture content sets black level instead of blanking;
//            shorten the coupling capacitor and level droops within the line.
//   peaking  the detail coil with the bend's own feedback wrapped around it: a
//            real two-pole resonator that rings after every edge and, past
//            unity, howls into the amplifier's rails until content knocks it.
//   regen    the stabilizer's sync separator re-stamping the pulse train from a
//            slice level that no longer sits safely under blanking.
//
// One thread per line, walking the line in order: the clamp capacitor and the
// resonator are both recurrences along the sample axis, so there is nothing to
// win by splitting a line across threads. Writes back into the buffer it reads
// — safe because a thread only ever touches its own line, and only behind the
// sample it has already consumed.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> comp: array<f32>;

// Correct clamp gate: back porch, between the end of burst and active video.
const CLAMP_KEY = f32(BURST_START + BURST_LEN + ACTIVE_START) * 0.5;
// The output amplifier's supply swing. A bent peaking stage past unity gain
// grows until it hits this and stays there, which is why a howling enhancer
// lays down flat-topped bars rather than diverging.
const RAIL = 120.0;
// The sync separator's integrator: ~300 kHz, so a 4.7 us pulse gets through
// and 3.58 MHz burst (attenuated ~30x) never trips the slicer.
const SEP_ALPHA = 0.123;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let row = gid.x;
  if (row >= NLINES) {
    return;
  }
  let base = row * SPL;

  // Vertical sync has no back porch to key against, and the box inhibits the
  // gate across it, so those lines pass on whatever charge the cap already
  // holds. Taking that as the settled charge is what keeps a clamp fault a
  // brightness fault: gate the broad pulses instead and every setting clamps
  // them up to blanking, turning the whole control into a vertical-lock fault.
  let clamping = (P.enhClampOff != 0.0 || P.enhDroop > 0.0) && row >= 12u;
  let key = u32(clamp(CLAMP_KEY + P.enhClampOff, 0.0, f32(SPL - 1u)));
  // The charge the gate leaves on the coupling capacitor is what the rest of
  // the line rides on. Physically it holds until the *next* gate, i.e. into the
  // following line; taking this line's own gate instead costs one line of
  // vertical lag and keeps every line's state inside its own thread.
  var vcap = select(0.0, comp[base + key] - IRE_BLANK, clamping);

  let peaking = P.enhPeakFc > 0.0 && P.enhPeakBoost > 0.0;
  let a1 = 2.0 * P.enhPeakR * cos(2.0 * PI * P.enhPeakFc);
  let a2 = -P.enhPeakR * P.enhPeakR;
  // Input trim that holds in-band gain near unity as the pole approaches the
  // unit circle, so the boost knob reads the same at every ring length. Past
  // unity it is only a starting amplitude — the pole does the rest.
  let drive = max(1.0 - P.enhPeakR, 0.02);
  var z1 = 0.0;
  var z2 = 0.0;

  var sep = IRE_BLANK;
  var pulse = 0u;

  for (var s = 0u; s < SPL; s = s + 1u) {
    let n = base + s;
    var y = comp[n];

    if (clamping) {
      y = y - vcap;
      if (s == key) {
        vcap = comp[n] - IRE_BLANK;
        y = IRE_BLANK;
      }
      // The capacitor charges toward the signal's own average, dragging the
      // output back to blanking: bright content sags and leaves the dark streak
      // trailing it that a short coupling cap always does.
      vcap = vcap + (y - IRE_BLANK) * P.enhDroop;
    }

    if (peaking) {
      let v = clamp(drive * y + a1 * z1 + a2 * z2, -RAIL, RAIL);
      z2 = z1;
      z1 = v;
      y = y + P.enhPeakBoost * v;
    }

    // Sync regenerator. The separator slices its own lowpassed copy, so burst
    // and detail cannot trip it; every crossing stamps one fixed-width pulse on
    // top of the video the box passes through. At the standard slice the stamp
    // lands on the real tip and nothing moves. Raise it into picture territory
    // and dark content mints pulses of its own, mid-line, and the set's PLL is
    // handed a line rate the image is writing.
    if (P.enhSync > 0.0) {
      sep = sep + (y - sep) * SEP_ALPHA;
      if (pulse > 0u) {
        pulse = pulse - 1u;
      } else if (sep < P.enhSlice) {
        pulse = SYNC_LEN;
      }
      // Burst survives the stamp: the box gates it out of the video, rebuilds
      // the pulse train, and re-inserts it, the way any proc-amp does. Without
      // that, a slice raised above blanking finds the back porch too and buries
      // burst under a pulse, and a sync bend arrives as a dead color killer
      // instead of the tearing it actually is.
      let onBurst = s >= BURST_START && s < BURST_START + BURST_LEN;
      if (pulse > 0u && !onBurst) {
        y = mix(y, IRE_SYNC, P.enhSync);
      }
    }

    comp[n] = y;
  }
}
