// Source B is a second, fully-formed NTSC signal. Two ways to combine it:
//
// - Dirty sum (default): B is NOT genlocked to A. Its line timing slips and
//   skews (line-frequency offset), its frame rolls (field-rate offset), and its
//   subcarrier is detuned off the sampling lattice. B arrives as a real
//   waveform on its own raster (encode_composite_b, optionally through its
//   feed), and this pass resamples it at the slipped position and sums it
//   (optionally ring-modulated) BEFORE the channel, sync separator, and burst
//   measurement — so fighting sync, rolling bars, tilted tears, and chroma
//   beat patterns all emerge downstream instead of being painted.
//
// - Clean dissolve (bGenlock): B is genlocked to the house reference and
//   re-encoded on A's carrier and raster, then combined as a CROSSFADE, not a
//   sum — a production switcher dissolve/wipe. bGain is the fader; the wipe
//   pattern shapes the fade spatially so B replaces A rather than adding to it.
//   B's detune/roll/skew and ring mod do not apply on this path.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var inputTexB: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> uvfB: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> comp: array<f32>;
@group(0) @binding(4) var<storage, read> bComp: array<f32>;
// Last frame's finished composite — the mixer loop's bus, the same buffer
// fbComposite crossfades from further down the chain. Bound here so the keyer
// can take its fill off it: patching the mixer's own output back into a keyer's
// fill input is a wire someone would run, and what it buys is a loop that only
// regenerates inside the keyed shape.
@group(0) @binding(5) var<storage, read> loopBus: array<f32>;

// B's luma at a raster index inside its active picture, off the texel.
fn lumaBAt(idx: u32) -> f32 {
  let x = i32(idx % SPL) - i32(ACTIVE_START);
  let y = i32(idx / SPL) - i32(ACTIVE_TOP);
  return luma(textureLoad(inputTexB, vec2i(x, y), 0).rgb);
}

// B re-encoded on the house carrier: chroma at bIdx modulated onto the
// A-locked subcarrier at output sample houseN (B's proc-amp hue trim only). This
// is the genlocked path — used by the clean dissolve and the PiP DVE — so B
// dot-crawls like real video but does not beat or roll. The encoder chroma
// bandlimit is precomputed per B sample by encode_chroma_b — B's raster
// position is per-sample here, so running the FIR inline read 33 unstaged
// storage taps per consumer sample.
fn encodeBHouse(houseN: u32, bIdx: u32) -> f32 {
  let uv = uvfB[bIdx];
  return activeComposite(lumaBAt(bIdx), uv.x, uv.y, carrierRot(houseN, P.frame, P.bHue), P.bVidGain, P.bInv);
}

// A chroma keyer across the mixer: B's backing colour cut away so A shows
// through it. What decides the look is where the keyer is standing. A real one
// is a box on the bus, so it never sees the RGB the camera had — it slices the
// chroma the encoder made, which is `uvfB`: B's U and V after the encoder's
// bandlimit (encChromaMHz, 1.3 MHz by default). That filter has no vertical
// term, so the key it cuts is soft over about four samples across and razor
// sharp down — the lopsided, faintly stepped edge that every composite key has
// and no RGB keyer can produce. Nothing draws it, and narrowing the encoder's
// chroma widens it, because it is the same filter doing both jobs.
//
// It follows that the keyer is only as steady as B's colour is. On the dirty
// path B's subcarrier is detuned, so its chroma phase walks per line and per
// frame: the backing drifts out of the acceptance wedge and back, and the key
// breathes and tears line-wise instead of holding. That is what a keyer fed a
// non-genlocked source did, and it is why they were genlocked.
struct KeySlice {
  // 1 where B is kept, 0 where the backing has been cut away.
  gate: f32,
  // How much of this sample's chroma points at the backing colour, for the
  // suppressor below — the spill the keyer decided was not enough to cut.
  along: f32,
}

fn chromaKey(idx: u32) -> KeySlice {
  let uv = uvfB[idx];
  let kdir = vec2f(cos(P.bKeyHue), sin(P.bKeyHue));
  let soft = max(P.bKeySoft, 1e-4);
  // Below the clip there is no hue to slice: a demodulator handed an
  // unsaturated sample reports an essentially arbitrary phase, so greys, blacks
  // and the backing's own shadows stay opaque however close their angle lands
  // to the key. This is the "clip" knob, and it is why a keyer cannot hold a
  // dark subject against a dark backing.
  let satg = smoothstep(P.bKeyClip, P.bKeyClip + soft, length(uv));
  // angle to the backing, wrapped into (-PI, PI]
  var w = atan2(uv.y, uv.x) - P.bKeyHue;
  w = w - 2.0 * PI * round(w / (2.0 * PI));
  let ang = 1.0 - smoothstep(P.bKeyAccept - soft * PI, P.bKeyAccept + soft * PI, abs(w));
  var g = 1.0 - ang * satg;
  if (P.bKey < 0.0) {
    // The invert button: keep the backing and cut the subject out of it.
    g = 1.0 - g;
  }
  return KeySlice(mix(1.0, g, min(abs(P.bKey), 1.0)), max(dot(uv, kdir), 0.0) * satg);
}

// Where the keyer looks, against where the fill it is gating comes from. A real
// keyer trims this because the key path and the video path are different
// lengths of circuit, and a mis-set one lays the key beside the subject instead
// of over it: one edge keeps a rim of backing colour and the other eats a rim
// of subject.
fn keyIdx(i: i32) -> u32 {
  return clampIdx(i + i32(round(P.bKeyDelay)));
}

// Spill suppression, as the hardware did it: a chroma canceller. You cannot
// lift the green off a composite sample — luma and chroma are the same wire —
// so the box reinjects the backing's own subcarrier in antiphase and nulls the
// component lying along the phase the keyer already found. Everything it has
// guessed wrong about that phase survives, which is why a source whose carrier
// is slipping keeps a residue that breathes with the slip rather than
// cancelling flat.
fn suppress(along: f32, n: u32, delta: f32) -> f32 {
  let kdir = vec2f(cos(P.bKeyHue), sin(P.bKeyHue));
  return VIDEO_RANGE * P.bKeySpill * along * dot(kdir, carrierRot(n, P.frame, delta)) * P.bVidGain;
}

// The keyer's fill input: what shows through the hole the key cut. A real keyer
// has this as a connector on the back, and only two of the three things worth
// patching into it are other pictures — the third is the box's own matte
// generator, a flat field on the house carrier.
//
// Genlocked path only, and that is mechanical rather than a shortcut: a fill is
// what sits *behind* the foreground, which needs a crossfade to have a behind.
// The dirty sum has no layers — both signals are on the wire at once — so there
// the key gates B's contribution and the program is simply always present.
fn keyFill(program: f32, n: u32) -> f32 {
  if (P.bKeyFill > 1.5) {
    return loopBus[n];
  }
  if (P.bKeyFill > 0.5) {
    // Matte generator: flat luma plus quadrature chroma on the house carrier, so
    // the matte is a real encoded colour that dot-crawls and gets demodulated
    // like any other — not an RGB value pasted onto the output.
    let sc = carrier(n, P.frame);
    let u = P.bKeyMatteSat * cos(P.bKeyMatteHue);
    let v = P.bKeyMatteSat * sin(P.bKeyMatteHue);
    return IRE_BLACK + VIDEO_RANGE * (P.bKeyMatteY + u * sc.x + v * sc.y);
  }
  return program;
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;

  let a = comp[n];
  let inActive = s >= ACTIVE_START && s < ACTIVE_START + ACTIVE_W &&
    row >= ACTIVE_TOP && row < ACTIVE_TOP + ACTIVE_H;
  // picture coordinates, shared by the wipe pattern and the PiP window below
  let u = (f32(s) - f32(ACTIVE_START)) / f32(ACTIVE_W);
  let v = (f32(row) - f32(ACTIVE_TOP)) / f32(ACTIVE_H);

  // Wipe pattern generator, running on the output (house) raster. A wipe is a
  // pattern across the *picture*, so it is only evaluated inside active video
  // and blanking is left wide open at gate = 1.
  //
  // That distinction is load-bearing on the dirty path. Gating blanking down
  // with the picture took B's sync tips, burst and field pulses out of the sum,
  // which quietly switched off the sync fight — the entire point of a
  // non-genlocked mix — the moment a wipe was engaged; the "wipe fight" preset
  // could not do what its name says. The genlocked branch writes active video
  // only anyway, so a switcher still keeps its blanking on the program bus.
  var gate = 1.0;
  if (P.wipeMode > 0.5 && inActive) {
    var d = P.wipePos - u;
    if (P.wipeMode > 1.5 && P.wipeMode < 2.5) {
      d = P.wipePos - v;
    } else if (P.wipeMode > 2.5 && P.wipeMode < 3.5) {
      d = P.wipePos - max(abs(u - 0.5), abs(v - 0.5)) * 2.0;
    } else if (P.wipeMode > 3.5) {
      d = P.wipePos - (abs(u - 0.5) + abs(v - 0.5));
    }
    gate = smoothstep(-max(P.wipeSoft, 0.002), max(P.wipeSoft, 0.002), d);
  }

  if (P.bGenlock > 0.5) {
    // Clean switcher: crossfade genlocked B over A on active video only; sync,
    // burst and blanking stay on the program bus. bGain is the fader level, the
    // wipe gate shapes it spatially — so B replaces A instead of summing. B
    // arrives from encode_composite_b house-locked (and through feedB when its
    // faults are up), so a scrambled or ringing B survives the clean dissolve
    // — the TBC implied by genlock strips timing damage, not amplitude damage.
    if (inActive) {
      var g = gate;
      var fill = bComp[n];
      // What sits behind B. Program A unless the keyer is actually cutting, and
      // that condition is the point: the fill is a connector on the *keyer*, so
      // with the key at zero the mixer is a plain A/B crossfade and the box in
      // front of it is out of circuit. Substituting unconditionally made the
      // fader and the wipe reveal the matte generator — or the loop bus — in
      // place of program A, which is not a look anyone patched, and left an
      // unloaded keyer able to take A off the bus entirely.
      var behind = a;
      if (P.bKey != 0.0) {
        // Genlocked, B sits on the house raster, so the keyer reads its chroma
        // at the output sample and B's carrier carries only the proc-amp hue
        // trim — the one path where the suppressor knows the backing's phase
        // exactly and can null it flat.
        let k = chromaKey(keyIdx(i32(n)));
        g = g * k.gate;
        if (P.bKeySpill > 0.0) {
          fill = fill - suppress(k.along, n, P.bHue);
        }
        behind = keyFill(a, n);
      }
      comp[n] = mix(behind, fill, clamp(g * P.bGain, 0.0, 1.0));
    }
  } else {
    // Dirty sum: B free-runs. Its raster position for this output sample is the
    // accumulated horizontal slip plus per-line skew, and vertical roll. The
    // pause button lives upstream in feedB — a paused deck's scatter and
    // mistrack stripe are damage on B's own raster, which is what makes the
    // stripe roll with B's picture through this resample instead of parking
    // on the output raster.
    let spl = f32(SPL);
    let sp = f32(s) + P.bShift0 + P.bShiftLine * f32(row);
    let su = sp - floor(sp / spl) * spl;
    let si = u32(su);
    let frac = su - f32(si);
    let srow = wrapRow(i32(row) + i32(floor(P.bRowOff)));
    let np = i32(srow * SPL + si);
    // B is a real waveform now, so the slip is a genuine resample: the
    // fractional part re-times B's carrier against the house lattice, and the
    // 90-degrees-per-sample hue rotation that used to be an explicit phase
    // term falls out of the interpolation. Catmull keeps the carrier's
    // amplitude flat where linear interpolation would pump it (see prelude).
    let b = catmull(bComp[clampIdx(np - 1)], bComp[clampIdx(np)], bComp[clampIdx(np + 1)], bComp[clampIdx(np + 2)], frac);

    var g = gate;
    var fill = b;
    if (P.bKey != 0.0) {
      // The keyer slices B's chroma at B's OWN raster position, not at the
      // output sample — the same index the fill was resampled from. That is
      // what makes the key travel with B's picture through the slip and the
      // roll, instead of the subject rolling out from under a hole parked on
      // the output. (The three domains, in one line: this displacement is in
      // the signal, so the key moves with it.)
      let k = chromaKey(keyIdx(np));
      g = g * k.gate;
      if (P.bKeySpill > 0.0) {
        // B's carrier here is the one encode_composite_b baked in — its detune
        // walked per line. The fractional slip rotates it further between
        // samples, which the suppressor has no way to follow, so the null is
        // imperfect by exactly the amount B is running away.
        fill = fill - suppress(k.along, clampIdx(np), P.bHue + P.bPhase0 + P.bPhaseLine * f32(srow));
      }
    }
    // sum at the composite level; A rides its own bus fader (signed, so a
    // negative aGain inverts A into a difference key), ring mod multiplies
    comp[n] = P.aGain * a + g * (P.bGain * fill + P.bRing * a * fill * 0.01);
  }

  // Picture-in-picture: source B squeezed into a positionable window and keyed
  // over the program. Like the clean dissolve above, the inset is re-encoded
  // with the HOUSE carrier (genlocked, as a DVE re-times it through its frame
  // store) — so it dot-crawls but doesn't chroma-beat, and it sits rock-steady
  // where B's own sync would otherwise fight. Active picture only; blanking,
  // sync and burst stay on the program bus.
  if (P.pipMix > 0.001 && inActive) {
    let x0 = P.pipX - 0.5 * P.pipW;
    let y0 = P.pipY - 0.5 * P.pipH;
    // signed distance to the nearest window edge: >0 inside, grows toward center
    let dIn = min(min(u - x0, x0 + P.pipW - u), min(v - y0, y0 + P.pipH - v));
    let soft = max(P.pipSoft, 0.0005);
    let key = smoothstep(0.0, soft, dIn);
    if (key > 0.0) {
      // remap the window onto B's full active picture, then re-encode chroma
      let bu = clamp((u - x0) / P.pipW, 0.0, 1.0);
      let bv = clamp((v - y0) / P.pipH, 0.0, 1.0);
      let bsi = ACTIVE_START + u32(bu * f32(ACTIVE_W - 1u));
      let bsrow = ACTIVE_TOP + u32(bv * f32(ACTIVE_H - 1u));
      let bnp = bsrow * SPL + bsi;
      let bp = encodeBHouse(n, bnp);
      // matte border: a solid frame just inside the window edge
      let isBorder = dIn < P.pipBorder;
      let inset = select(bp, IRE_BLACK + VIDEO_RANGE * 0.9, isBorder);
      // luma key: drop the inset where B's own luma crosses the slice, so a
      // dark/bright matte in B lets the program show through (the border stays
      // solid). Negative key inverts which side is kept.
      var kg = 1.0;
      if (P.pipKey != 0.0) {
        var g = smoothstep(P.pipKeyLevel - P.pipKeySoft, P.pipKeyLevel + P.pipKeySoft, lumaBAt(bnp));
        if (P.pipKey < 0.0) {
          g = 1.0 - g;
        }
        kg = select(mix(1.0, g, abs(P.pipKey)), 1.0, isBorder);
      }
      comp[n] = mix(comp[n], inset, key * P.pipMix * kg);
    }
  }
}
