# Analog effects

Every effect models the hardware mechanism that causes an artifact, not the
artifact itself. Dot crawl, rainbowing, tearing, rolling and hue drift are never
drawn — they fall out of the signal path once something upstream is broken.

Effects are grouped by the stage of the chain they damage, the same order as the
control panel and the same order the signal travels.

| Stage                               | Where it sits                                       |
| ----------------------------------- | --------------------------------------------------- |
| [Source / wiring](#source--wiring)  | the cable between the deck and everything else      |
| [Camera feedback](#camera-feedback) | a camera pointed at the monitor it's driving        |
| [Mixer loop](#mixer-loop)           | the composite waveform patched back into itself     |
| [Tape loop](#tape-loop)             | a loop of tape between a record and a play head     |
| [A/B mix](#ab-mix-source-b)         | a second source, genlocked or not                   |
| [Tape / channel](#tape--channel)    | VHS and the RF path it arrives over                 |
| [Enhancer (bent)](#enhancer-bent)   | a consumer picture enhancer with its jumpers moved  |
| [Receiver](#receiver)               | the TV: sync, deflection, comb filter, chroma demod |
| [Audio-reactive](#audio-reactive)   | audio patched into any of the above                 |
| [Screen](#screen)                   | the beam, the phosphor and the glass in front of it |

## Source / wiring

Faults at the connector, before the signal reaches anything that could correct
them.

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
- **Cable scrambling** — the head-end lifting the carrier over each sync pulse,
  so a set with no decoder box has nothing to slice a line start out of. Partial
  suppression only fools the AGC, which washes the picture out; past the
  slicer's level the line oscillator is left free-running and the raster shears
  at whatever rate the set's own h-osc keeps. Line-alternate is corrected half
  the time and zigzags instead. SSAVI inverts the video on top, and since burst
  is in the back porch the negative keeps its hue. Vertical stays framed either
  way: the broad pulses are wider than the line-rate gate.
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

## Tape loop

A second machine across the mixer, threaded with a loop of tape: the record head
lays down the mixer output, the tape travels, and up to four play heads further
round the loop return it seconds later. The return is recorded again, so
anything still circulating goes through the medium once per lap — which is the
whole difference between this and the mixer loop above. Repeats decay by
generation loss rather than by a fader, and they decay the way tape does.

- **Playback heads** — each at its own distance from the record head, so one lap
  hands the picture back once per head: the heads are a rhythm and the loop is
  the bar line. The generation structure this produces is not the obvious one —
  a piece of tape is written once and read by every head as it goes past, so all
  of a lap's taps are the _same_ generation. The pattern repeats intact and the
  whole of it goes a generation darker each lap, rather than decaying across the
  taps.
- **Head spacing** — even subdivisions at 1; below that they crowd toward the
  far head so the taps rush and hold, above it toward the record head so they
  come quickly and leave a gap before the lap turns over.
- **Loop length** — millimetres of tape between the record head and the far one.
  Tape runs at 33.35 mm/s, so the length _is_ the delay: 0.6 mm is a frame,
  33 mm a second, 66 mm the whole bin. It is authored as a length rather than a
  time because that is what makes the next one work.
- **Capstan wander** — speed error on a fixed length of tape is delay error, so
  the echo breathes in and out of time. Nothing time-base corrects the return:
  a delay that grows by half a frame hands back a picture displaced half a
  screen, and the repeats slide vertically. This is the fault frame
  synchronizers were invented to fix.
- **Generation loss** — the band the head and tape lose per pass. The subcarrier
  sits at the very top of it, so chroma dies several times faster than the luma
  carrying it: repeats fade to grey well before they go soft, and a long tail
  ends up monochrome. Nobody draws that — it falls out of where colour lives.
- **Tape noise** — the medium's own floor, fixed to the oxide rather than to the
  moment. The same grain is on the same millimetre every lap and is re-recorded
  each time instead of averaging away like snow, so it builds into standing
  streaks and slides bodily when the speed wanders.
- **Oxide wear** — worn patches at fixed positions on the loop, so the same
  lines drop out every lap. What tells a loop apart from a deck playing a long
  recording, where a dropout never comes back.
- **Splice** — a loop is a loop because someone joined the ends, and the joint
  crosses the play head once per lap. A loop is rarely a whole number of frames
  long, so the bump walks down the picture lap by lap: a metronome you can see,
  ticking at the delay.
- **Colour framing** — the subcarrier rides the same tape, so a delay is also a
  hue rotation (90° per sample, and 180° per frame of delay). Framed rounds the
  delay onto a whole subcarrier cycle for 140 ns of picture shift, which is what
  an edit controller insisting on colour framing is doing; off, every change of
  delay repaints the repeats a different colour.

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

Everything that happens between the recorder and the set: limited bandwidth,
noise picked up along the way, and the mechanical realities of tape. The whole
stage can run more than once — see **dub generations**.

### Bandwidth and detail

- **Luma bandwidth** — broadcast ~4.2 MHz down to worn-tape softness; vertical
  edges smear while the picture stays sharp top to bottom.
- **Peaking** — the crispening boost VCRs fake detail back with; bright/dark
  ringing outlines on every edge.

### Noise and interference

- **Noise** — tape grain and RF snow on the whole waveform, degrading sync and
  burst along with the picture.
- **Ghosting** — multipath: a delayed, possibly phase-inverted echo displaced
  right of everything.
- **Hum bar** — ground-loop mains hum, a soft bright bar drifting up the
  picture.
- **Hum modulation** — the same ripple inside an amplifier's supply instead, so
  it moves that stage's gain: the picture pumps and saturates in bands, and
  because sync is scaled too the AGC and hold chase it.
- **Sound carrier** — 4.5 MHz intercarrier sound past its trap: visible
  herringbone buzz.

### Color-under

VHS can't record chroma where it lives, so it heterodynes it down and back.
Everything below follows from that trip.

- **Color-under** — chroma moved to 629 kHz and back; color bandwidth collapses
  and smears sideways while luma stays sharp.
- **Color-under phase jitter** — per-line phase error in that conversion: hue
  wanders line to line into a colored venetian-blind texture.
- **Chroma noise** — noise on the 629 kHz carrier itself, which has far less
  headroom than the luma FM. It comes back through the narrow chroma bandpass,
  so it lands as slow smears of wrong hue rather than grain: why VHS colour is
  blotchy while its luma is merely noisy.

### The tape and the heads

- **Dropouts** — shed oxide; the head reads nothing for a moment, leaving white
  streaks and scarred lines.
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
- **Dub generations** — the whole tape stage run up to four times, each with its
  own noise, dropouts and timebase walk.

## Enhancer (bent)

A consumer image enhancer / stabilizer patched inline between the deck and the
set, with jumpers across three of its stages.

- **Clamp gate** — the box pins one sample a line to blanking to fix black
  level. Slide that gate off the back porch and the picture sets black level
  instead, so brightness bounces line to line with the image; slide it onto the
  sync tip and the whole line lifts.
- **Clamp droop** — an undersized coupling capacitor between gates: level sags
  back toward blanking within the line, so bright content drags a dark streak
  behind it while vertical edges stay sharp.
- **Detail resonance** — the peaking coil with the bend's feedback wrapped
  around it. A real two-pole resonator, so it rings after every edge, and past
  unity it is regenerative: the sync pulse at the head of each line sets it off
  and the bars build left to right until they hit the amplifier's rails. A
  composite box has no Y/C split, so parked at 3.58 the same knob boosts the
  subcarrier and saturation climbs with detail.
- **Sync regenerator** — the stabilizer half, restamping a clean pulse wherever
  its slicer crosses. Bend the slice up into picture territory and dark content
  mints pulses of its own, mid-line: the set is handed a line rate the image is
  writing. Burst is gated out and re-inserted, so this stays a sync fault.

## Receiver

A real television, and every way one can be imperfect or misadjusted. Sync
faults move the picture; decoding faults move its color.

### Sync and deflection

- **AGC** — level normalization off the sync tip; disabled, amplitude faults
  become brightness faults.
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

### Color decoding

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

## Audio-reactive

Audio patched into the electronics, one sample per scan line. These drive the
same faults listed above rather than adding new ones, so they interact with
whatever else is engaged.

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

The picture is decoded by now; what's left is how a tube turns it into light,
and what you see looking at one.

### The beam

- **Beam profile / bloom** — spot size and its growth with beam current;
  scanlines show in shadows and close up in highlights.
- **Beam spot** — the gun writes a smooth blob, not a square, so light from one
  sample lands partly on its neighbours and dim picture bleeds as much as
  highlights. Why a tube never resolves into hard pixels.
- **Reconstruction** — bilinear to cubic; how the sampled line becomes
  continuous light without pumping fine patterns.

### The phosphor

- **Phosphor grain** — the coating is a granular deposit, so emission is
  mottled; fixed on the glass and strongest in the mid tones.
- **Phosphor primaries** — sRGB, P22/SMPTE-C, the wide 1953 NTSC set, or
  long-persistence monochrome green.
- **Phosphor persistence / trail tint / trail sum** — afterglow in the glass;
  red and blue die faster than green, and trails either peak-hold (strobe) or
  add toward white.
- **Trail scatter** — held light bounces sideways through the layer into
  phosphor that is still glowing, so the spread compounds along a trail: the
  fresh edge stays sharp while old light goes wide and cloudy.
- **Aperture grille** — the R/G/B stripe mask, with a pitch that moirés near
  small whole-pixel spacings, exactly as photographing a CRT does.

### Looking at it

- **Magnifier** — where your eye is. Past 1× it goes against the glass, and
  everything that lives on the screen rather than in the image magnifies with
  it: triads, scanline gaps, grain, the beam spot's bleed between samples. Below
  1× it pulls back off the set instead — the faceplate bulges the way a real one
  does, and the cabinet holding it comes out of the dark. Scroll or drag a box
  on the picture to close in, drag to move around the glass, double-click for
  1×.
- **Slow motion** — the whole rig stepped at a fraction of display rate: noise,
  rolls, sweeps, feedback and phosphor all crawl together; 0 freezes the frame.
  Pairs with the vaporwave source-speed control to slow the footage to match.
