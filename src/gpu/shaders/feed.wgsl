// One source's feed: the cable and head-end between that input and the mixer,
// so a fault here damages one signal alone and everything downstream — the
// other input, the sync fight, the receiver — reacts to the difference. The
// same pipeline runs this shader twice (feedA, feedB) against different
// uniform buffers: pipeline.ts packs the per-source control values into the
// standard Params fields (scramble, termination, noiseSigma, polarityFlip,
// humAmp, connectorGlitch), so the mechanisms stay written in exactly one place
// and `gen` decorrelates this instance's noise from the program-bus channel's.
//
// The trap that arrangement sets: every other Params field arrives here still
// holding the *program bus's* value, because packFeed spreads the bus pack and
// overrides only what FEEDS names. A block added below that reads a field
// packFeed does not override will silently apply a program-bus knob to one
// source, and it will look like it works.
//
// Only per-sample damage and the paused deck's per-line resample live here.
// Anything needing the FIR bank or the color-under path (luma bandwidth,
// rainbow instability) stays on the program bus — duplicating that per source
// would triple the expensive work for effects whose per-source value is low.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;

// Snow deviates staged once per workgroup: the 1-2-1 band-limit below reads
// each neighbour's deviate, and gauss() is Box-Muller — the same redundancy
// channel.wgsl stages away.
var<workgroup> tileNs: array<f32, 66>;

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  if (P.noiseSigma > 0.0) {
    let ns = pcg(P.frame * 2654435761u + P.gen * 2246822519u);
    // slot 1 is this workgroup's first sample, so slot i is global index n0+i-1
    let n0 = row * SPL + wid.x * 64u;
    for (var i = lid.x; i < 66u; i = i + 64u) {
      tileNs[i] = gauss((n0 + i - 1u) ^ ns);
    }
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;

  // This feed's deck paused (bPause/bPauseBar/bShift0/bRowOff carry whichever
  // deck's values pipeline.ts packed — A's servo state for feedA; zeros for
  // feedB, whose pause still lives on the mix_b resample). The drum re-reads
  // one track with the capstan servo defeated: each line's timing scatters on
  // its own around the slow wander, the whole raster hops vertically when the
  // servo hunts, and the head loses the track approaching the mistrack stripe
  // — a coherent hook dragging nearby lines sideways. The waveform moves whole
  // — sync, burst and all — so the receiver's PLL hunts line by line and hue
  // wobbles with the displacement, exactly what a no-TBC deck hands a set.
  //
  // srcS/srcRow are where on this deck's own tape the output sample is reading
  // from — with the deck playing, the sample itself. They exist because
  // everything that happened UPSTREAM of the deck has to be evaluated there
  // rather than at the output position: the head-end scrambled this before it
  // was ever recorded, and a dropout is missing oxide at a fixed place on the
  // tape. Read at the output position, that damage stands still on the glass
  // while the picture it belongs to scatters around it, and the scrambler
  // lifts whatever has drifted under the sync gate instead of the sync tip —
  // measurably, a third of the lines kept a full-depth tip under a held deck.
  // The cable faults further down deliberately keep the output raster: those
  // happen after the deck, on the way to the mixer.
  var srcS = s;
  var srcRow = row;
  var echoBase = i32(n);
  var out: f32;
  if (P.bPause > 0.0) {
    let dr = abs(f32(row) - P.bPauseBar);
    let dBar = min(dr, f32(NLINES) - dr);
    let off = P.bShift0
      + P.bPause * 7.0 * (rand01(pcg(row * 613u + P.frame * 40961u)) - 0.5)
      + P.bPause * 28.0 * exp(-dBar / 9.0);
    let spl = f32(SPL);
    var su = f32(s) + off;
    su = su - floor(su / spl) * spl;
    srcS = u32(su);
    let frac = su - f32(srcS);
    srcRow = wrapRow(i32(row) + i32(P.bRowOff));
    let np = i32(srcRow * SPL + srcS);
    out = catmull(src[clampIdx(np - 1)], src[clampIdx(np)], src[clampIdx(np + 1)], src[clampIdx(np + 2)], frac);
    echoBase = np;
    // The mistrack stripe itself: where the parked head sweeps off the
    // recorded track the RF nulls and the deck's detector hands back snow —
    // sync, burst and all, since the null does not care what it lands on.
    let half = 5.0 + 13.0 * P.bPause;
    if (dBar < half) {
      let edge = 1.0 - dBar / half;
      // the deck's RF detector, which keeps running: this snow is live even
      // while the tape is parked, unlike the dropouts below
      let snow = 45.0 * gauss(n ^ pcg(P.frame * 15187u + row * 5u));
      out = mix(out, snow, clamp(edge * 1.6 * P.bPause, 0.0, 0.95));
    }
  } else {
    out = src[n];
  }
  let srcN = srcRow * SPL + srcS;

  // Dropouts on this deck's own tape: shed oxide, so for a moment the head
  // reads nothing and the detector hands back snow. Same event model as the
  // program-bus copy in channel.wgsl, but seeded inline (this pass has no
  // lineParams) and uncompensated — the feeds model cheap front ends, and the
  // deck with the delay-line compensator sits on the program bus.
  //
  // Placed and seeded on the tape, not the screen: the damage is in the oxide,
  // so a paused deck re-reading one track has to hand back the same gaps, in
  // the same places, carried by the same resample as the picture around them.
  // On frame time and the output raster a held picture sparkled with a fresh
  // set of streaks sixty times a second and each one stood still while the
  // frame jittered — an electrical fault, not a worn tape.
  if (P.dropoutRate > 0.0) {
    let h = pcg(srcRow * 7621u ^ (P.srcFrame * 2654435761u + P.gen * 97911u));
    if (rand01(h) < P.dropoutRate / f32(NLINES)) {
      let start = f32(pcg(h ^ 0x51ed270bu) % SPL);
      let len = P.dropoutLen * (0.4 + 1.2 * rand01(h ^ 0x9134u));
      let fs = f32(srcS);
      if (fs >= start && fs < start + len) {
        let snow = 55.0 + 45.0 * gauss(srcN ^ pcg(P.srcFrame * 977u + P.gen * 7919u));
        out = mix(out, snow, 0.95);
      }
    }
  }

  // Head-end scrambling on this feed alone — a premium channel is scrambled per
  // channel by nature. The mechanism itself lives in the prelude, shared with
  // the program-bus copy in channel.wgsl. On the tape position, because the
  // head-end scrambled this before the deck ever recorded it: the sync gate has
  // to follow the sync tip when a held deck displaces it.
  out = scrambleAt(out, srcRow, srcS, P.scramble, P.scrambleMode);

  // additive noise (snow), 1-2-1 band-limited like the receiver-side copy
  if (P.noiseSigma > 0.0) {
    let cn = lid.x + 1u;
    out = out + P.noiseSigma * 0.4082 * (tileNs[cn - 1u] + 2.0 * tileNs[cn] + tileNs[cn + 1u]);
  }

  // Ground loop on this input's cable alone. A loop needs two earthed boxes
  // joined by a shield, so it is a property of one *run* — this deck's mains
  // outlet against the mixer's — and a hum bar on the program bus cannot say
  // which cable is carrying it. Injected in series along the run, so it lifts
  // this source's sync tips with its picture: the receiver's AGC and hold chase
  // A's level sixty times a second while B's sits still, and which of the two
  // wins the sync fight alternates with the hum phase — the reason a ground
  // loop in a two-deck rig rolls the picture rather than just barring it.
  //
  // Signed, because the two ends of a split-phase service are 180 degrees
  // apart: same amplitude, opposite leg, and two feeds on opposite legs push
  // their bars against each other instead of together.
  //
  // The bar rides this source's own raster, so under the dirty sum B's travels
  // with B's picture through the slip and roll while A's stays put — which is
  // what tells the two cables apart on screen.
  if (P.humAmp != 0.0) {
    out = out + P.humAmp * sin(humPhase(row, P.frame));
  }

  // The plug at the mixer's input jack going intermittent, on this input alone
  // (prelude `connectorAt`). On the output raster, not the tape: the connector
  // is at the far end of the cable, downstream of everything the deck did.
  out = connectorAt(out, row, n, P.frame, P.gen, P.connectorGlitch, P.connectorMode);

  // Hard polarity flip on this feed's connector: whole waveform negated, sync
  // and burst included. Unlike a negative bus gain this holds regardless of
  // what the mixer is doing — the fault is in the cable, not the fader.
  out = mix(out, -out, P.polarityFlip);

  // Cable termination fault on this feed alone (prelude `terminate`). The echo
  // taps the deck's output, so under pause it follows the resampled position
  // rather than the nominal raster.
  if (P.termination != 0.0) {
    out = terminate(out, P.termination, src[clampIdx(echoBase - 5)]);
  }

  dst[n] = out;
}
