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

var<workgroup> tileLc: array<f32, TILE>; // luma-path source: comp - chroma
var<workgroup> tileUn: array<f32, TILE>; // color-under signal
// Snow, one deviate per sample plus a neighbour either side. The 1-2-1 kernel
// below reads its two neighbours' deviates, and every thread's neighbours are
// some other thread's centre, so generating them per-thread draws each of these
// three times over. gauss() is Box-Muller — two hashes, a log and a cos — which
// makes that the most expensive redundancy in the pass.
var<workgroup> tileNs: array<f32, 66>;

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(row * SPL + wid.x * 64u) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + 64u) {
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
    for (var i = lid.x; i < TILE; i = i + 64u) {
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
    let n0 = row * SPL + wid.x * 64u;
    for (var i = lid.x; i < 66u; i = i + 64u) {
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

  // RF dropout: per-line chance, a span of the line collapses to demodulated snow
  let lp = lineParams[row];
  if (lp.w < P.dropoutRate / f32(NLINES)) {
    let h = pcg(bitcast<u32>(lp.w) ^ 0x51ed270bu);
    let start = f32(h % SPL);
    let len = P.dropoutLen * (0.4 + 1.2 * rand01(h ^ 0x9134u));
    let fs = f32(s);
    if (fs >= start && fs < start + len) {
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
