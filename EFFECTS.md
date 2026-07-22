# Analog effects

Every effect models the hardware mechanism that causes an artifact, not the
artifact itself — dot crawl, rainbowing, tearing, rolling and hue drift emerge
from the signal path on their own. Effects are grouped here by the stage of the
chain they damage, same as the control panel.

## Source / wiring

- **Polarity invert** — the composite waveform negated after the encoder; full
  negative at 1, solarized midpoints partway, hue flipping with it.
- **Hard polarity flip** — signal/ground swapped at the connector, sync
  included, so the receiver tears and rolls hunting for sync in peak white.
- **Termination fault** — double-terminated (dim picture, color killer biting)
  or unterminated (hot signal, ringing overshoot on every edge).
- **Chroma-pin only** — S-video miswired into composite: bare subcarrier with no
  luma or sync, floating color over an unlocked black raster.
- **Loose connector** — intermittent contact; bands of snow cut in and out and
  take sync with them when they land on a sync tip.
- **Bob deinterlace** — rebuilds frames from one field to kill capture-card
  combing, at the cost of half the vertical detail.

## Camera feedback

A camera pointed at its own monitor, re-photographed every frame.

- **Loop mix / gain** — how much of the screen feeds back and at what exposure;
  past unity the picture breeds structure on its own.
- **Zoom / rotate / shift** — camera framing per pass: tunnels, logarithmic
  spirals, and where their core lands.
- **Defocus / vignette** — lens blur that favors large soft structures over
  pixel noise; corner falloff that confines the loop to frame center.
- **Black cut / s-curve** — sensor floor that snaps trails off, and highlight
  compression that stabilizes runaway loops into glowing bands.
- **CRT faceplate** — what the camera photographs: beam cutoff, gun gamma,
  saturation, bloom, warm halation, faceplate glow — each compounded per pass.

## Mixer loop

The previous frame's composite waveform patched electrically back into the input
— the subcarrier goes around too, so color does things optics cannot.

- **Loop mix / gain** — crossfader toward the loop bus; negative gain alternates
  polarity frame to frame.
- **Loop delay** — microseconds on the return; since chroma rides the same wire,
  delay is also a hue rotation (70 ns = 90°).
- **Vertical offset** — lines of slide per generation; trails stack into
  ladders.
- **Luma key** — only bright (or dark) areas feed back, so feedback follows the
  subject instead of flooding the frame.
- **Strobe hold / trails** — a stuttering frame synchronizer, and peak-hold
  luminance smear in its store.
- **Loop resonance** — a bent video enhancer in the loop; enough in-band boost
  and the filter self-oscillates, generating pattern from nothing.

## A/B mix (source B)

A second source, either summed dirty (non-genlocked wiring fault) or genlocked
into a clean switcher dissolve.

- **Dirty sum vs. genlock** — free-running B beats against A's sync and burst,
  or is re-encoded on A's raster for a clean crossfade.
- **Ring mod** — the two composites multiplied, landing chroma at sum and
  difference frequencies: colors neither source contained.
- **Line offset / subcarrier detune / frame roll** — B's oscillators off A's:
  continuous sideways skew, rainbow hue crawl, independent vertical creep.
- **B hue / gain / invert** — proc-amp trims; inverted B against A reads as a
  difference key.
- **Wipes** — horizontal, vertical, box, diamond, with softness and an
  auto-sweep.
- **PiP inset** — B squeezed into a genlocked DVE window, with matte border and
  luma key.

## Tape / channel

- **Luma bandwidth** — broadcast ~4.2 MHz down to worn-tape softness; vertical
  edges smear while the picture stays sharp top to bottom.
- **Peaking** — the crispening boost VCRs fake detail back with; bright/dark
  ringing outlines on every edge.
- **Noise** — tape grain and RF snow on the whole waveform, degrading sync and
  burst along with the picture.
- **Ghosting** — multipath: a delayed, possibly phase-inverted echo displaced
  right of everything.
- **Hum bar** — ground-loop mains hum, a soft bright bar drifting up the
  picture.
- **Sound carrier** — 4.5 MHz intercarrier sound past its trap: visible
  herringbone buzz.
- **Dropouts** — shed oxide; the head reads nothing for a moment, leaving white
  streaks and scarred lines.
- **Dub generations** — the whole tape stage run up to four times, each with its
  own noise, dropouts and timebase walk.
- **Color-under** — VHS heterodynes chroma to 629 kHz and back; color bandwidth
  collapses and smears sideways while luma stays sharp.
- **Color-under phase jitter** — per-line phase error in that conversion: hue
  wanders line to line into a colored venetian-blind texture.
- **Tracking error** — the head reading off-track: a band of noise the picture
  tears and bends through, parked where you set it.
- **Shuttle (picture search)** — off play speed each head sweep crosses several
  recorded tracks; the RF nulls at every crossing sweep the frame as noise bars,
  and each strip between them is a different track with its own timing and
  color-under phase. Pause at 0, cue past 1, review negative.
- **Flutter / wow** — fast and slow timebase error; signal-domain, so the burst
  moves with the picture and hue wobbles too.
- **Head switch** — the two-head timing mismatch and settling noise that make
  the torn hook at the bottom of every VHS frame.

## Receiver

- **Horizontal hold** — the PLL's pull toward sync: loose drifts and skews,
  tight translates waveform damage straight into a bent picture.
- **Vertical hold / vertical oscillator** — lock authority and free-run rate;
  detuned, the frame rolls at the difference frequency.
- **Retrace flag** — equalizing pulses kicking the horizontal PLL at the
  vertical seam: the hooked, flagging top edge.
- **Horizontal oscillator detune** — free-run drift off 15.734 kHz: diagonal
  skew, then shearing into diagonal bars past pull-in range.
- **Deflection bend** — the tube's own scan displaced (flag, skew, bow, ripple);
  downstream of decoding, so geometry warps but hue stays put.
- **HV sag / supply ring** — bright content loads the high-voltage supply and
  stretches the scan; underdamped, a bright edge sets off decaying wobble.
- **Y/C comb** — notch trap (dot crawl, rainbow fringing) versus 2-/3-line combs
  that separate luma and chroma properly.
- **S-video bleed** — Y/C shorted: the subcarrier itself appears as a moving dot
  pattern over anything colored.
- **Chroma bandwidth / trail / upsample error / gain** — how fast, how
  asymmetrically, how coarsely and how hot color is demodulated.
- **Burst lock / subcarrier detune** — trust in the measured burst versus a bent
  reference crystal; unlocked, hue sweeps the whole wheel.
- **Color killer** — the burst level below which the set decides the signal is
  monochrome; weak signals make color cut out in patches.
- **AGC** — level normalization off the sync tip; disabled, amplitude faults
  become brightness faults.

## Audio-reactive

Audio patched into the electronics, one sample per scan line.

- **Bass → vertical hold** — kicks detune the field oscillator; the frame
  lurches on the beat because the field rate genuinely moves.
- **Level → horizontal hold** — loud passages pull the line oscillator; the
  picture skews and tears, re-locking in the gaps.
- **Bass → HV sag** — bass loads the supply like beam current; the scan smacks
  inward on each hit and springs back.
- **Waveform → deflection** — the audio waveform drawn literally into horizontal
  deflection, an oscilloscope trace bending the raster.
- **Audio → video input** — the wrong cable: brightness bands, shifting color,
  torn sync as loud passages land on the sync tips.

## Screen

- **Beam profile / bloom** — spot size and its growth with beam current;
  scanlines show in shadows and close up in highlights.
- **Reconstruction** — bilinear to cubic; how the sampled line becomes
  continuous light without pumping fine patterns.
- **Phosphor primaries** — sRGB, P22/SMPTE-C, the wide 1953 NTSC set, or
  long-persistence monochrome green.
- **Phosphor persistence / trail tint / trail sum** — afterglow in the glass;
  red and blue die faster than green, and trails either peak-hold (strobe) or
  add toward white.
- **Aperture grille** — the R/G/B stripe mask, with a pitch that moirés near
  small whole-pixel spacings, exactly as photographing a CRT does.
- **Slow motion** — the whole rig stepped at a fraction of display rate: noise,
  rolls, sweeps, feedback and phosphor all crawl together; 0 freezes the frame.
  Pairs with the vaporwave source-speed control to slow the footage to match.
