// Sync flywheel PLL + vertical hold + AGC — the TV side of horizontal and
// vertical hold. Line tearing, head-switch bend, and vertical rolling all
// emerge from sync pulses being genuinely hard to find in the mangled
// waveform. The waveform itself is scanned in parallel by sync_measure; this
// single thread only runs the line-to-line recurrences over those
// measurements.
//
// timing[0..524]      per-line horizontal offset the deflection actually used
// timing[525]         vertical oscillator phase error, lines (persistent, signed)
// timing[526]         PLL state (persistent)
// timing[527]         AGC gain state (persistent): IF gain normalizing the
//                     measured sync-tip depth to 40 IRE, slewed per frame
// timing[ABL_GAIN/VEL]   beam-limiter servo state (persistent): the video
//                     drive the flyback can afford, plus its slew velocity
// timing[IRIS_GAIN/VEL]  camera auto-iris servo state (persistent): exposure
//                     correction on the feedback loop, plus its velocity
// timing[SAG_BASE..]  normalized deflection sag per *raster* line (not source
//                     row), scaled by hvSag at read time

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> measure: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> timing: array<f32>;
@group(0) @binding(3) var<storage, read> audio: array<f32>;

// How far the vertical hold can drag the oscillator back per frame at full
// authority — the pull-in range. Detune the free-run rate past this and no
// incoming pulse can ever catch the raster, so the picture breaks into a
// continuous scroll instead of settling.
const V_PULL_MAX = 30.0;

// Same idea for the horizontal loop, in samples of phase correction per line.
// Set generously: ordinary jitter tracking stays untouched and only a real
// oscillator detune can outrun it.
const H_PULL_MAX = 40.0;

// wrap into [-NLINES/2, NLINES/2): the oscillator locks to whichever field
// boundary is nearest, not always the one below.
fn wrapLines(v: f32) -> f32 {
  let n = f32(NLINES);
  return v - n * floor(v / n + 0.5);
}

@compute @workgroup_size(1, 1, 1)
fn main() {
  var pll = timing[526u];
  var vroll = timing[525u];

  // vertical sync check: broad pulses should sit at sync level mid-line
  var vscore = 0.0;
  for (var r = VSYNC_FIRST; r <= VSYNC_LAST; r = r + 1u) {
    vscore = vscore + measure[r].w;
  }

  // Free-running vertical oscillator. The deflection generator runs at its own
  // rate and an incoming vsync pulse only *triggers* it early — it is not a
  // servo. Detuning the oscillator off the field rate (the vertical hold pot)
  // therefore drifts the raster start by vRollRate lines every frame.
  vroll = wrapLines(vroll + P.vRollRate);
  if (vscore < 3.0) {
    // no recognizable vsync in the waveform: nothing triggers the oscillator
    vroll = wrapLines(vroll + 3.0 + 40.0 * rand01(pcg(P.frame * 719u)));
  } else {
    // Triggered pull-in, limited by the hold control's authority. Inside the
    // range a steady detune settles at a steady vertical *offset* (pull
    // balancing drift) rather than rolling — a mis-set vertical hold shifts
    // the picture before it scrolls, exactly as on a real set.
    let auth = V_PULL_MAX * P.vHold;
    vroll = vroll + clamp(-0.35 * vroll, -auth, auth);
    if (abs(vroll) < 0.6) {
      vroll = 0.0;
    }
  }

  // Deflection sag. The horizontal output stage and the HV supply are one LC
  // tank shared with the beam, so drawing current bends the scan. Damped, it is
  // the droop every cheap set has — bright lines pull wider, and because it
  // integrates down the raster in scan order a bright band drags everything
  // below it. Wound toward resonance the tank rings for tens of lines and the
  // flyback saturates (the clamp), so this stops tracking the content and
  // starts beating against it: a busy or heavily mixed picture drives the
  // geometry into a pattern that never quite repeats. Feed it the dirty mixer
  // or either feedback loop and the bend becomes part of the loop, since next
  // frame's beam load is read off the picture this bend just distorted.
  //
  // Indexed by raster line, so the sag stays put on the glass while a rolling
  // picture slides through it — the roll offset selects the source row here.
  // Last frame's beam-limiter drive. The limiter throttles the guns, and beam
  // current is what loads the supply — so a limiter clamping down relieves the
  // very sag the bright content caused, one field late. Fresh state (zeros)
  // means no correction yet, not zero drive.
  var ablHeld = timing[ABL_GAIN];
  if (ablHeld < 0.05) {
    ablHeld = 1.0;
  }

  if (P.hvSag != 0.0) {
    let ring = clamp(P.hvRing, 0.0, 1.0);
    let w = mix(0.35, 0.08, ring); // tank frequency, rad/line
    let damp = mix(0.55, 0.015, ring); // loss per line
    let roll = i32(floor(vroll));
    var sag = 0.0;
    var vel = 0.0;
    for (var ry = 0u; ry < NLINES; ry = ry + 1u) {
      // beam current plus whatever audio is patched in: the tank cannot tell
      // them apart, so a bass transient rings the geometry exactly like a
      // bright band does
      let load = (measure[wrapRow(i32(ry) + roll)].z * ablHeld - 50.0) / 50.0
        + P.audioLoad * audio[ry];
      vel = vel + w * (load - sag) - damp * vel;
      sag = clamp(sag + w * vel, -3.0, 3.0);
      timing[SAG_BASE + ry] = sag;
    }
  }

  var depthSum = 0.0;
  var depthCount = 0.0;
  var loadSum = 0.0;
  var loadCount = 0.0;
  for (var row = 0u; row < NLINES; row = row + 1u) {
    // Vertical retrace hammers the sync separator: serrations and equalizing
    // pulses run at twice line rate right through the blanking interval, so the
    // PLL has nothing honest to lock to until real line sync resumes at the top
    // of active video — that is where the disturbance is injected, and the
    // flywheel below drags it out over the first lines of picture as the
    // top-of-frame hook. Recovery runs at the hHold rate, so a set with sloppy
    // horizontal hold flags further down the picture. Keyed off the source row,
    // so the hook rides the rolling seam.
    if (row == ACTIVE_TOP) {
      pll = pll + P.syncBend;
    }
    // Horizontal oscillator free-run, the exact counterpart of the vertical
    // above: the H-osc keeps its own time and sync only corrects it. Inside the
    // loop's authority the flywheel absorbs a detune as a static phase error —
    // the picture simply sits off-center — but past it the phase gains a little
    // more every line and the raster shears into diagonal bars.
    pll = pll + P.hRate;
    let m = measure[row];
    // beam current is drawn whether or not this line's sync was findable
    if (row > VSYNC_LAST + 3u) {
      loadSum = loadSum + m.z;
      loadCount = loadCount + 1.0;
    }
    if (m.x > -999.0) {
      // flywheel: blend measurement in at the hold gain, within pull-in range
      let auth = P.hHold * H_PULL_MAX;
      pll = pll + clamp(P.hHold * (m.x - pll), -auth, auth);
      // gated AGC depth on picture lines
      if (row > VSYNC_LAST + 3u) {
        depthSum = depthSum + m.y;
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
    // sync_measure reports depth post-IF-gain (the separator sits inside the
    // AGC loop), so divide out the gain that was actually applied before
    // recomputing the wanted one — otherwise the servo squares its own
    // correction. mix() is the same expression sync_measure applied, so at
    // agc = 0 this degenerates to exactly the open-loop update.
    let applied = mix(1.0, agc, P.agc);
    let want = applied * 40.0 / clamp(depthSum / depthCount, 5.0, 160.0);
    agc = agc + 0.25 * (want - agc);
  }

  // Mean beam current over the picture, in IRE — the sense input for both gain
  // servos below. Post-IF, because the guns are driven by the gain-corrected
  // video: a pumping AGC feeds its pumping straight into both loops.
  let beamIre = clamp(loadSum / max(loadCount, 1.0), 0.0, 160.0);

  // Automatic beam limiter. The flyback can only source so much average beam
  // current; past that the set pulls video drive down to protect it. The sense
  // point is the current the picture asks for and the loop has a real time
  // constant, so the correction always lands after the content that provoked
  // it — and because the target is one-sided (a limiter only ever pulls down,
  // it never boosts past full drive) a marginal picture is answered with a
  // relaxation pump rather than a settled dim one. The knob undersizes the
  // flyback and strips the servo's damping: wound up, the loop gain outruns
  // its phase margin and the whole picture hunts at the servo's own couple of
  // Hz — a rhythm set by nothing on screen. Feed either feedback loop and the
  // drive term is inside the loop, so the servo and the loop beat against
  // each other instead of settling.
  var ablG = timing[ABL_GAIN];
  var ablV = timing[ABL_VEL];
  if (ablG < 0.05) {
    ablG = 1.0;
  }
  if (P.abl > 0.0) {
    // what the supply can sustain: the knob shrinks the flyback
    let ceilIre = mix(85.0, 28.0, P.abl);
    let want = min(1.0, ceilIre / max(beamIre, 6.0));
    let wn = 0.16; // servo natural frequency, rad/frame (~1.5 Hz)
    let zeta = mix(0.9, 0.1, P.abl); // damping the knob takes away
    ablV = clamp(ablV + wn * wn * (want - ablG) - 2.0 * zeta * wn * ablV, -0.25, 0.25);
    // headroom past 1: the AC-coupled drive overshoots on release, which is
    // the rebound flash after a clamp-down
    ablG = clamp(ablG + ablV, 0.06, 1.15);
  } else {
    ablG = 1.0;
    ablV = 0.0;
  }

  // Camera auto-iris on the feedback loop. The camera meters the screen it is
  // pointed at — beam current times the drive the limiter just granted — and
  // servos its aperture toward mid-grey through a mechanical lag. The exposure
  // it settles on multiplies the loop gain (compose reads it next frame), so
  // the iris is metering a loop it is part of: brighten the loop and the iris
  // clamps, the loop starves, the iris reopens, and round again. Its natural
  // frequency is deliberately unequal to the beam limiter's, so when both hunt
  // the two rhythms beat.
  var irisG = timing[IRIS_GAIN];
  var irisV = timing[IRIS_VEL];
  if (irisG < 0.05) {
    irisG = 1.0;
  }
  if (P.fbIris > 0.0) {
    let light = max(beamIre, 4.0) / 50.0 * ablG;
    let want = clamp(1.0 / light, 0.08, 4.0);
    let wn = 0.34; // rad/frame (~3 Hz): a faster servo than the ABL
    let zeta = mix(0.85, 0.07, P.fbIris);
    irisV = clamp(irisV + wn * wn * (want - irisG) - 2.0 * zeta * wn * irisV, -0.5, 0.5);
    irisG = clamp(irisG + irisV, 0.05, 4.0);
  } else {
    irisG = 1.0;
    irisV = 0.0;
  }

  timing[525u] = vroll;
  // A detuned H-osc ramps the phase every line without ever relocking, so the
  // carried-over state has to wrap or it grows without bound. One full line of
  // offset reads the next line's content, which is where a diagonal tear wraps
  // anyway — so the wrap is invisible.
  let spl = f32(SPL);
  timing[526u] = pll - spl * floor(pll / spl + 0.5);
  timing[527u] = clamp(agc, 0.25, 4.0);
  timing[ABL_GAIN] = ablG;
  timing[ABL_VEL] = ablV;
  timing[IRIS_GAIN] = irisG;
  timing[IRIS_VEL] = irisV;
}
