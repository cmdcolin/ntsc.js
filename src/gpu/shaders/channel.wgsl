// The tape/transmission channel, all on the 1D composite signal:
//  - luma path: (composite - chroma) through the bandwidth/peaking FIR
//  - chroma path: direct, or up-converted back from color-under (with per-line
//    playback phase jitter -> the VHS rainbow instability), re-bandpassed
//  - multipath ghost, band-limited AM noise, 60Hz hum, RF dropouts,
//    head-switch noise band
// Runs once per dub generation; P.gen decorrelates the noise seeds.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var<storage, read> comp: array<f32>;
@group(0) @binding(3) var<storage, read> chroma: array<f32>;
@group(0) @binding(4) var<storage, read> under: array<f32>;
@group(0) @binding(5) var<storage, read> lineParams: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> outBuf: array<f32>;
@group(0) @binding(7) var<storage, read> audio: array<f32>;

// Up-convert and re-bandpass in one folded pass. The bandpass is linear-phase,
// so a tap d either side of centre shares one coefficient, and the heterodyne
// phase there is the centre phase rotated -/+ d steps:
//
//   x[-d]cos(t - dS) + x[+d]cos(t + dS)
//     = cos t cos dS (x[-d] + x[+d]) + sin t sin dS (x[-d] - x[+d])
//
// so one phasor walked outward covers both halves, and the kernel costs half
// the coefficient loads and no per-tap cos().
const UP_STEP = 2.0 * PI * DOWN_PER_SAMPLE;

fn upPhasor(row: u32, s: f32) -> vec2f {
  let lp = lineParams[row];
  let th = lp.y + lp.z + 2.0 * PI * fract(DOWN_PER_SAMPLE * s);
  return vec2f(cos(th), sin(th));
}

fn stepPhasor(p: vec2f) -> vec2f {
  let c = cos(UP_STEP);
  let s = sin(UP_STEP);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

// Is this sample inside a dropout — shed oxide, so for a moment the head reads
// nothing? Factored out of main because the compensator has to ask the same
// question of the line its delay line is holding.
fn droppedAt(row: u32, s: u32) -> bool {
  let lp = lineParams[row];
  if (lp.w >= P.dropoutRate / f32(NLINES)) {
    return false;
  }
  let h = pcg(bitcast<u32>(lp.w) ^ 0x51ed270bu);
  let start = f32(h % SPL);
  let len = P.dropoutLen * (0.4 + 1.2 * rand01(h ^ 0x9134u));
  let fs = f32(s);
  return fs >= start && fs < start + len;
}

// One impulse event's contribution at distance d past its start. The comet
// shape is the IF filter's impulse response: instant attack, exponential
// tail — and a ring at some frequency inside the passband, because a filter's
// impulse response oscillates at its own centre. Which frequency the ring
// lands on decides what the decoder makes of the streak: near the subcarrier
// the demodulator reads it as saturated colour and the comet comes out as a
// hue streak, near the band edges it stays a white dash. Per-event frequency
// and ripple depth, so a storm throws a mixture of both.
fn comet(d: f32, eh: u32, ire: f32) -> f32 {
  let len = 8.0 + 60.0 * rand01(eh ^ 0x77u);
  if (d < 0.0 || d >= len * 4.0) {
    return 0.0;
  }
  let amp = ire * (0.5 + rand01(eh ^ 0x1234u));
  let pol = select(1.0, -0.4, rand01(eh ^ 0x9u) < 0.25);
  let cyc = 0.08 + 0.34 * rand01(eh ^ 0x51u);
  let rip = 0.3 + 0.6 * rand01(eh ^ 0x33u);
  // ripple rides ON the core rather than replacing it: the dash stays a
  // bright slam whatever its ring frequency, and the ring is what the
  // decoder turns into colour
  return pol * amp * exp(-d / len) * (0.7 + 0.5 * rip * cos(2.0 * PI * cyc * d));
}

var<workgroup> tileLc: array<f32, TILE>; // luma-path source: comp - chroma
var<workgroup> tileUn: array<f32, TILE>; // color-under signal
// Snow, one deviate per sample plus a neighbour either side. The 1-2-1 kernel
// below reads its two neighbours' deviates, and every thread's neighbours are
// some other thread's centre, so generating them per-thread draws each of these
// three times over. gauss() is Box-Muller — two hashes, a log and a cos — which
// makes that the most expensive redundancy in the pass.
var<workgroup> tileNs: array<f32, TILE_WG + 2u>;

@compute @workgroup_size(TILE_WG, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(row * SPL + wid.x * TILE_WG) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + TILE_WG) {
    let ci = clampIdx(base + i32(i));
    tileLc[i] = comp[ci] - chroma[ci];
  }
  if (P.colorUnderMix > 0.0) {
    // Noise inside the color-under path, ahead of the up-conversion. VHS lays
    // chroma on a 629 kHz carrier with far less headroom than the luma FM, so
    // the two have nothing like the same SNR — and this noise still has to come
    // back through the narrow chroma bandpass, which turns it into slow
    // blotches of wrong hue instead of the fine grain luma gets. Seeded on the
    // global sample index so overlapping workgroup halos agree on it.
    let cns = pcg(P.frame * 1103515245u + P.gen * 88888933u);
    for (var i = lid.x; i < TILE; i = i + TILE_WG) {
      let ci = clampIdx(base + i32(i));
      var v = under[ci];
      if (P.chromaNoise > 0.0) {
        v = v + P.chromaNoise * gauss(ci ^ cns);
      }
      tileUn[i] = v;
    }
  }
  if (P.noiseSigma > 0.0) {
    let ns = pcg(P.frame * 2654435761u + P.gen * 2246822519u);
    // slot 1 is this workgroup's first sample, so slot i is global index n0+i-1
    let n0 = row * SPL + wid.x * TILE_WG;
    for (var i = lid.x; i < TILE_WG + 2u; i = i + TILE_WG) {
      tileNs[i] = gauss((n0 + i - 1u) ^ ns);
    }
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL) {
    return;
  }
  let n = row * SPL + s;

  // luma through the channel FIR, folded on the kernel's symmetry
  let ml = (LUMA_TAPS - 1u) / 2u;
  let cl = lid.x + HALO;
  var luma = filters[SEC_LUMA * FILTER_STRIDE + ml] * tileLc[cl];
  for (var k = 0u; k < ml; k = k + 1u) {
    luma = luma + filters[SEC_LUMA * FILTER_STRIDE + k] * (tileLc[cl + k - ml] + tileLc[cl + ml - k]);
  }

  // Tuner mistuned toward the low side: the picture carrier slides down the
  // IF's Nyquist slope and the upper sideband goes first — fine luma detail
  // here, and the chroma sitting at 3.58 MHz where `chr` is scaled below. A
  // 1-2-1 smear on top of the channel FIR is the slope's high cut.
  if (P.rfSoften > 0.0) {
    let soft = 0.25 * (tileLc[cl - 1u] + 2.0 * tileLc[cl] + tileLc[cl + 1u]);
    luma = mix(luma, soft, P.rfSoften);
  }

  // chroma: crossfade direct <-> color-under playback (up-convert + bandpass)
  var chr = chroma[n];
  if (P.colorUnderMix > 0.0) {
    let mb = (CHROMA_BP_TAPS - 1u) / 2u;
    let cb = lid.x + HALO;
    let ph = upPhasor(row, f32(s));
    var w = vec2f(1.0, 0.0); // (cos dS, sin dS), walked outward from d = 0
    var up = filters[SEC_CHROMA_BP * FILTER_STRIDE + mb] * tileUn[cb] * ph.x;
    for (var d = 1u; d <= mb; d = d + 1u) {
      w = stepPhasor(w);
      let lo = tileUn[cb - d];
      let hi = tileUn[cb + d];
      up = up + filters[SEC_CHROMA_BP * FILTER_STRIDE + mb - d]
        * (ph.x * w.x * (lo + hi) + ph.y * w.y * (lo - hi));
    }
    // the heterodyne's factor of two, out of the tap loop
    chr = mix(chr, 2.0 * up, P.colorUnderMix);
  }
  if (P.rfSoften > 0.0) {
    // the same slope taking the chroma: saturation dies, and starving the
    // burst along with it eventually trips the decoder's colour killer
    chr = chr * (1.0 - 0.85 * P.rfSoften);
  }

  // C-pin-only feed: only the chroma pin reaches the composite input, so there
  // is no luma and no sync tips — just burst-locked color that can't hold
  // vertical or horizontal lock.
  var out = luma * (1.0 - P.chromaPinOnly) + chr;

  // Analog premium-channel scrambling, applied at the head-end so everything
  // below it in this file is damage the cable adds on top. The scrambler lifts
  // the carrier during the horizontal sync interval; after envelope detection
  // that is the sync tip pulled up toward blanking, and a set with no decoder
  // box has nothing left to slice a line start out of. Past half depth the tip
  // clears the separator's -20 IRE level entirely and horizontal lock is gone.
  //
  // Only the line-rate gate is modelled, which is why the frame stays roughly
  // framed: the broad vertical pulses are far wider than the gate, so their
  // bodies still read as sync level mid-line and the vertical oscillator keeps
  // triggering. An unauthorized premium channel sheared and pumped rather than
  // tumbling, and that is the mechanism behind it.
  if (P.scramble > 0.0 && (P.scrambleMode < 0.5 || P.scrambleMode > 1.5 || (row & 1u) == 0u)) {
    if (s < SYNC_LEN) {
      out = mix(out, IRE_BLANK, P.scramble);
    }
    // SSAVI: Zenith suppressed sync *and* inverted the video, so the picture
    // that leaks through is a negative as well as an unstable one. Burst sits
    // in the back porch and is left alone, so hue survives the inversion.
    let picture = s >= ACTIVE_START && s < ACTIVE_START + ACTIVE_W
      && row >= ACTIVE_TOP && row < ACTIVE_TOP + ACTIVE_H;
    if (P.scrambleMode > 1.5 && picture) {
      out = mix(out, 2.0 * IRE_BLACK + VIDEO_RANGE - out, P.scramble);
    }
  }

  // multipath ghost of the pre-channel signal
  if (P.ghostGain != 0.0) {
    let gpos = f32(n) - P.ghostDelay;
    let g0 = i32(floor(gpos));
    out = out + P.ghostGain
      * catmull(comp[clampIdx(g0 - 1)], comp[clampIdx(g0)], comp[clampIdx(g0 + 1)], comp[clampIdx(g0 + 2)], fract(gpos));
  }

  // additive noise (snow), 1-2-1 band-limited: receiver noise comes through
  // the IF filter, so it has no energy near the top of the 14.3 MHz raster
  if (P.noiseSigma > 0.0) {
    let cn = lid.x + 1u;
    out = out + P.noiseSigma * 0.4082 * (tileNs[cn - 1u] + 2.0 * tileNs[cn] + tileNs[cn + 1u]);
  }

  // Impulse noise — ignition, arcing thermostats, a dying flyback next door.
  // The opposite texture from the Gaussian floor above: sparse events at
  // carrier-scale amplitude, nothing in between, and mostly bright, because
  // an impulse saturates toward peak carrier before the detector ever sees
  // it. An event is a run of *signal time* — an arc does not respect line
  // boundaries — so its duration decides its whole shape on screen: tens of
  // microseconds is a ringing comet on one line, hundreds is a stepped
  // diagonal streak folded across a few, milliseconds is a torn slab of hash
  // that flattens sync tips and spikes the beam load, so the PLL tears and
  // the sag and beam-limiter servos flinch with no further code. The rate
  // arrives storm-clustered from the CPU: flurries with real quiet between.
  if (P.impulseRate > 0.0) {
    let want = clamp(P.impulseRate, 0.0, 8.0);
    let fh0 = pcg(P.frame * 2654435761u + P.gen * 2246822519u + 0x1ce4u);
    for (var i = 0u; i < 8u; i = i + 1u) {
      let eh = pcg(fh0 + i * 747796405u);
      if (f32(i) + rand01(eh ^ 0xf00du) >= want) {
        continue;
      }
      let s0 = f32(eh % BUF_LEN);
      // A triac dimmer fires twice per mains cycle at its set angle, so its
      // hits bunch at two phases of the hum — bands that roll with the hum
      // bar, because they are the same mains.
      if (P.impulseMains > 0.0) {
        let mrow = s0 / f32(SPL);
        let mph = 2.0 * PI * (mrow / f32(NLINES) + f32(P.frame) * 0.0037);
        let w = pow(0.5 + 0.5 * cos(2.0 * mph - 2.2), 6.0);
        if (rand01(eh ^ 0x6fu) > mix(1.0, clamp(w * 5.0, 0.0, 1.0), P.impulseMains)) {
          continue;
        }
      }
      let d = f32(n) - s0;
      // arc duration, log-uniform from a tick to a rip
      let dur = exp(mix(log(60.0), log(22000.0), rand01(eh ^ 0x3du)));
      if (d < 0.0 || d >= dur) {
        continue;
      }
      let amp = P.impulseIre * (0.5 + rand01(eh ^ 0x1234u));
      let pol = select(1.0, -0.4, rand01(eh ^ 0x9u) < 0.15);
      let cyc = 0.08 + 0.34 * rand01(eh ^ 0x51u);
      let rip = 0.3 + 0.6 * rand01(eh ^ 0x33u);
      let env = exp(-d / (0.35 * dur));
      // short events ring cleanly; a sustained arc is chaos, so long ones
      // hand back hash with a lift instead of a tone
      let ring = 0.7 + 0.5 * rip * cos(2.0 * PI * cyc * d);
      let hash = 0.5 + 1.1 * (rand01(pcg(n ^ eh)) - 0.5);
      out = out + pol * amp * env * mix(ring, hash, smoothstep(400.0, 3000.0, dur));
    }
  }

  // Ignition train: a spark plug fires periodically, so its impulses land on
  // a strict lattice in signal time — and a period incommensurate with the
  // line rate walks the hits sideways a fixed step per event, drawing the
  // drifting diagonal dash lattices ignition interference is known by. The
  // CPU accumulates the train's phase (and wanders its rate like an engine
  // revving, which is what tilts the lattice live); here each row just asks
  // whether an event lands on it.
  if (P.impulseTrainStep > 0.0) {
    let q = (f32(row) * f32(SPL) - P.impulseTrainPos) / P.impulseTrainStep;
    let k = ceil(q);
    let start = (k - q) * P.impulseTrainStep;
    if (start < f32(SPL)) {
      let eh = pcg((P.frame * 977u) ^ (u32(max(k, 0.0)) * 7919u) ^ (P.gen * 271u));
      let jit = 8.0 * (rand01(eh ^ 0xe1u) - 0.5);
      out = out + comet(f32(s) - start - jit, eh, P.impulseIre);
    }
  }

  // The big strike: lightning, an arcing breaker, a compressor kicking on.
  // Milliseconds, not microseconds — dozens of full lines of dense hash with
  // a DC lift, decaying down the raster. Spanning whole lines is what makes
  // it punch the rest of the rig with no further code: it lands on sync tips
  // so the PLL tears at the strike, it spikes the measured beam load so HV
  // sag lurches the geometry, and the beam limiter dims and blooms back.
  if (P.strikeRate > 0.0) {
    let fh = pcg(P.frame * 68111u + P.gen * 3571u);
    if (rand01(fh) < P.strikeRate / 60.0) {
      let l0 = f32(pcg(fh ^ 0x77bu) % NLINES);
      let span = 6.0 + 26.0 * rand01(fh ^ 0x2fu);
      let dr = f32(row) - l0;
      if (dr >= 0.0 && dr < span) {
        let env = exp(-dr / (span * 0.45));
        out = out + env * P.impulseIre * (0.55 + 0.8 * (rand01(pcg(n ^ fh)) - 0.35));
      }
    }
  }

  // 60 Hz hum: one cycle per field, slowly rolling
  if (P.humAmp > 0.0 || P.humMod > 0.0) {
    let ph = 2.0 * PI * (f32(row) / f32(NLINES) + f32(P.frame) * 0.0037);
    out = out + P.humAmp * sin(ph);
    // Hum modulation: the same mains ripple, but inside the supply of an
    // amplifier in the signal path rather than on a ground loop, so it moves
    // the stage's *gain* instead of adding to its output. Rectified supplies
    // ripple mostly at 120 Hz with a 60 Hz asymmetry from the uneven half.
    // Sync scales along with the picture, so depth breathes and the receiver's
    // AGC and horizontal hold pump with the brightness rather than ignoring it.
    out = out * (1.0 + P.humMod * (0.6 * sin(2.0 * ph) + 0.4 * sin(ph)));
  }

  // Audio patched straight into the video line — the classic bend. Sampled at
  // line rate the waveform paints one level per row, so bass rolls horizontal
  // bands through the picture and a loud transient shoves whole lines past
  // the sync separator's slice level, tearing lock on the beat.
  if (P.audioIre != 0.0) {
    out = out + P.audioIre * audio[row];
  }

  // 4.5 MHz FM sound carrier leaking past the trap. It is exactly 286
  // cycles/line (fH = 4.5MHz/286), i.e. 11/35 of the sample rate, so the
  // weave is stationary until the audio FM moves it. Intercarrier buzz *is*
  // that FM leaking past the trap, so drive it from the program audio: the
  // carrier deviates with content — aperiodic for free — and silence leaves a
  // clean stationary weave rather than a coupled-to-nothing sweep.
  if (P.soundIre > 0.0) {
    let ph = f32((11u * s) % 35u) / 35.0;
    let buzz = 2.2 * audio[row];
    out = out + P.soundIre * sin(2.0 * PI * ph + buzz);
  }

  // Detector intermodulation, the other half of a mistuned tuner: with the
  // sound carrier out of its trap the video detector multiplies it against
  // everything else on the wire instead of just adding it. Chroma x sound
  // lands at 920 kHz — the coarse beat on every proc-amp spec sheet — and
  // 920 kHz luma detail lands back on 3.58 MHz, where the decoder reads it
  // as chroma: rainbow crawl on fine detail, colour manufactured by carrier
  // arithmetic alone. Same lattice and same audio FM as the leak above,
  // because it is the same loose carrier doing both.
  if (P.rfIntermod > 0.0) {
    let ph = f32((11u * s) % 35u) / 35.0;
    out = out + P.rfIntermod * out * sin(2.0 * PI * ph + 2.2 * audio[row]);
  }

  // The adjacent channel through a weak IF trap. What leaks in is not a
  // picture but the neighbour's *carriers*, and the detector renders each as
  // a beat at its spacing from our own: their vision carrier 6 MHz away
  // (exactly 44/105 of the sample rate), their sound 1.5 MHz (11/105). The
  // bare 6 MHz texture mostly dies in the video lowpass — what survives is
  // its modulation. Their raster runs on its own sync generator, P.rfAdjEps
  // off our line rate, so their blanking (peak carrier — negative modulation)
  // sweeps through as slanted bars, their vertical interval as a broad band
  // crossing at its own rate — the windshield wiper — and their picture
  // content spreads beat sidebands across our chroma band, which the decoder
  // demodulates into colour that was never in any picture. The second-order
  // term is the envelope detector's: two carriers through |.| leave B^2/2A,
  // so where the neighbour is strong the picture darkens — hardest in
  // whites, where our own carrier is weakest.
  if (P.rfAdjIre > 0.0) {
    let tp = f32(n) * (1.0 + P.rfAdjEps) + P.rfAdjTau;
    let tLine = tp / f32(SPL);
    let tRow = fract(tLine / f32(NLINES));
    let tPh = fract(tLine);
    let tl = u32(max(tLine, 0.0));
    // their (unknown) picture: block detail at two scales, re-rolled per
    // frame — enough mid-band energy to reach across 3.58 MHz
    let c1 = rand01(pcg(tl * 2246822519u ^ (u32(tPh * 24.0) * 68111u) ^ (P.frame * 40503u)));
    let c2 = rand01(pcg(tl * 104729u ^ (u32(tPh * 240.0) * 3571u) ^ (P.frame * 977u)));
    var env = 0.38 + 0.30 * c1 + 0.18 * c2;
    if (tRow < 0.04) {
      // their vertical interval: broad pulses, near-peak carrier mid-line
      env = select(0.72, 1.0, fract(tPh * 2.0) < 0.43);
    } else if (tPh < 0.074) {
      env = 1.0; // their sync tip is peak carrier
    } else if (tPh < 0.147) {
      env = 0.75; // their blanking
    }
    let b = P.rfAdjIre * env;
    let phV = 2.0 * PI * f32((44u * n) % 105u) / 105.0 + P.rfAdjPhase;
    let phS = 2.0 * PI * f32((11u * n) % 105u) / 105.0 + P.rfAdjPhaseS;
    // our own carrier at this sample: negative modulation maps sync -40 ..
    // white 100 onto 1 .. 0.125 of peak power
    let a = max(1.0 - 0.00625 * (out + 40.0), 0.12);
    out = out + b * sin(phV) + 0.45 * P.rfAdjIre * sin(phS)
      - min(b * b / (200.0 * a), 25.0);
  }

  // RF dropout: per-line chance, a span of the line loses its carrier.
  if (droppedAt(row, s)) {
    // Dropout compensator. Rather than let the head's silence reach the screen,
    // a deck patches the gap out of a delay line holding what it played a line
    // or two ago. NTSC puts 227.5 subcarrier cycles in a line, so one line back
    // the subcarrier arrives exactly out of phase: the patch is invisible in
    // luma and *complementary in hue*, which is the coloured streak a cheap 1H
    // compensator leaves down a worn tape. Two lines back is 455 cycles — a
    // whole number, so the hue is right, at the price of a patch two lines
    // stale that smears across anything moving. Nobody draws either; both fall
    // out of where the half cycle lands.
    //
    // Substituting the difference rather than the sample keeps the noise, hum
    // and buzz this line already carries: the delay line sits inside the
    // playback path, so what it hands back has come through the same channel.
    let bl = select(2u, 1u, P.dropoutComp < 1.5);
    // Nothing to patch with if the line it is holding lost the same samples, or
    // at the top of the frame where it has not seen a good line yet.
    if (P.dropoutComp > 0.5 && row >= bl && !droppedAt(row - bl, s)) {
      out = out + comp[clampIdx(i32(n) - i32(bl * SPL))] - comp[n];
    } else {
      let snow = 55.0 + 45.0 * gauss(n ^ pcg(P.frame * 977u + P.gen * 7919u));
      out = mix(out, snow, 0.95);
    }
  }

  // head-switch disturbance band at the bottom of the picture
  if (P.headSwitchNoise > 0.0 && row >= HEAD_SWITCH_LINE && row < HEAD_SWITCH_LINE + 3u) {
    out = out + P.headSwitchNoise * 25.0 * gauss(n ^ pcg(P.frame * 3121u + row + P.gen * 4423u));
  }

  // VHS tracking error: a mistracked head can't read a band of lines, which
  // collapse to demodulated snow. Strongest at the band center, tapering out.
  // The horizontal tear/bend of these lines is added by the time-base offset
  // (linestate) so it flows through the resampler like the rest.
  if (P.trackAmt > 0.0) {
    let center = P.trackPos * f32(NLINES);
    let half = 3.0 + 18.0 * P.trackAmt;
    let d = abs(f32(row) - center);
    if (d < half) {
      let edge = 1.0 - d / half;
      let snow = 45.0 * gauss(n ^ pcg(P.frame * 6151u + row + P.gen * 97u));
      out = mix(out, snow, clamp(P.trackAmt * edge * 1.3, 0.0, 0.95));
    }
  }

  // VHS picture search: off play speed the spinning head no longer follows a
  // single recorded track — each sweep crosses |speed-1| of them, and the RF
  // envelope nulls at every crossing, so that many noise bars sweep the frame.
  // The strips between bars are different tracks; their timing and color-under
  // phase offsets ride in via lineParams like the tracking tear.
  if (P.shuttleBars != 0.0) {
    let ab = abs(P.shuttleBars);
    let fx = fract(f32(row) / f32(NLINES) * ab + P.shuttlePhase);
    let dLines = min(fx, 1.0 - fx) / ab * f32(NLINES);
    let half = 8.0;
    if (dLines < half) {
      let edge = 1.0 - dLines / half;
      let snow = 45.0 * gauss(n ^ pcg(P.frame * 24593u + row * 3u + P.gen * 389u));
      out = mix(out, snow, clamp(edge * 1.7, 0.0, 0.95));
    }
  }

  // Loose connector: intermittent contact breaks whole bands of the picture to
  // snow and yanks the level down (taking sync with it), flickering frame to
  // frame the way a wiggled RCA plug drops in and out.
  if (P.connectorGlitch > 0.0) {
    let band = row / 12u;
    let r = rand01(pcg(P.frame * 2246822519u + band * 40503u + P.gen * 7u));
    if (r < P.connectorGlitch * 0.5) {
      let snow = 20.0 * gauss(n ^ pcg(P.frame * 131u + n));
      out = mix(out, snow, 0.9) - 35.0 * P.connectorGlitch;
    }
  }

  // Hard polarity flip: signal and ground fully swapped on the line. Unlike the
  // clean encoder invert (active video only), this negates the whole waveform —
  // sync tips and burst included — so the receiver's sync separator latches onto
  // the wrong level and the picture tears and rolls while the colors invert.
  out = mix(out, -out, P.polarityFlip);

  // Cable termination fault. Correct is one 75-ohm terminator (0). An open,
  // unterminated line (>0) reflects the wave back: the signal runs hot and each
  // edge rings with a short round-trip echo. Daisy-chaining a second monitor
  // double-terminates (<0), halving the signal so contrast and sync depth
  // collapse toward a dim, barely-locking roll.
  if (P.termination != 0.0) {
    out = out * pow(2.0, P.termination);
    let refl = max(P.termination, 0.0);
    if (refl > 0.0) {
      out = out + refl * 0.6 * comp[clampIdx(i32(n) - 5)];
    }
  }

  outBuf[n] = out;
}
