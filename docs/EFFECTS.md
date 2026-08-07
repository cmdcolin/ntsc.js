# Analog effects

Every effect models the hardware mechanism that causes an artifact, not the
artifact itself. Dot crawl, rainbowing, tearing, rolling and hue drift are never
drawn — they fall out of the signal path once something upstream is broken.

Effects are grouped by the stage of the chain they damage, the same order as the
control panel and the same order the signal travels.

| Stage                               | Where it sits                                       |
| ----------------------------------- | --------------------------------------------------- |
| [Source / wiring](#source--wiring)  | the cable between the deck and everything else      |
| [Per-input feeds](#per-input-feeds) | one input's own deck and cable, ahead of the mixer  |
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

- **No-signal sources** — an untuned tuner and a blank tape, which are one
  generator with its statistics exposed rather than two fixed pictures. What
  separates them is where the noise is detected: an envelope detector handed
  noise and no carrier recovers a Rayleigh field, which is why snow is sparse
  hard specks over a dense dark floor, while a demodulator's limiter free-runs
  and hands back a bounded level wandering around the DC its deemphasis sets,
  which is why blank tape is grey. Everything else is a property of the path —
  the bandwidth it arrived through (which is the grain, because noise cannot
  change faster than the circuit carrying it), the per-sweep gain error of an
  AGC hunting on the noise it is measuring, the power reaching the detector, and
  the rate the field re-rolls. Both are monochrome: neither source carries a
  subcarrier, so any colour is the receiver failing on noise — which is why
  winding the bandwidth down drains the colour out of static without touching a
  colour control, once the grain no longer reaches the chroma passband.
- **Polarity invert** — the composite waveform negated after the encoder; full
  negative at 1, solarized midpoints partway, hue flipping with it.
- **Hard polarity flip** — signal/ground swapped at the connector, sync
  included, so the receiver tears and rolls hunting for sync in peak white.
- **Termination fault** — double-terminated (dim picture, color killer biting)
  or unterminated (hot signal, ringing overshoot on every edge).
- **Chroma-pin only** — S-video miswired into composite: bare subcarrier with no
  luma or sync, floating color over an unlocked black raster.
- **Loose connector** — intermittent contact, decided per band of lines and
  re-rolled every frame the way a plug hanging on its own cable weight makes and
  breaks. An RCA plug has two contacts and they fail into two different
  pictures. The **centre pin** breaks the signal path, so the jack sees an open
  through its own terminator and those bands collapse to the input stage's noise
  floor — sync included, so they tear. The **shell** breaks the ground reference
  and leaves the signal alone: the return current goes looking for the mains
  earth through both boxes' supplies, so a ground loop's hum lands on the bad
  bands and the level walks and buzzes while the picture and its sync survive.
  Both is a genuinely wiggled plug, the two on independent bands so they
  interleave rather than doubling one fault.
- **Ground loop** — two earthed boxes joined by a shield, the loop's current
  landing in series with the video. It belongs to one cable run, which is why it
  is a per-input fault (below) rather than only a program-bus one: a hum bar on
  the mixed output cannot say which cable is carrying it. Signed, because the
  two legs of a split-phase service are 180° apart.
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

## Per-input feeds

Everything above damages the **program bus** — the mixed output, so both sources
share it. Each input also has a feed of its own: the deck it comes off, the
head-end that recorded it, and the cable between that one source and the mixer.
The same faults again, on one signal alone.

That difference is the whole point. A fault on the bus is something you see; a
fault on one feed is something the rig has to _react_ to, because the two inputs
stop agreeing and everything downstream — the other input, the sync fight, the
receiver's AGC and hold — is downstream of the disagreement. Nothing new is
drawn. The panel files each input's faults as two groups, the deck and the
cable, because those are two different diagnoses.

**The deck** carries the pause button (a held frame with the capstan servo
defeated — see the A/B section), dropouts on that input's own tape, and head-end
scrambling of that channel. Damage here is placed on the _tape_, so a held deck
re-reads it in place: the gaps come back in the same places, carried by the same
resample as the picture around them.

**The cable** carries the loose plug and the ground loop described above, snow,
a termination fault and a hard polarity flip. Damage here is placed on the
_output_ raster, because it happens after the deck, on the way to the mixer.

Three things fall out of the split that no single-signal version can do:

- **Sync hand-off.** A break that takes one input's sync tips leaves the
  receiver the _other_ input's pulses to lock to, so the line start is handed
  over for the length of a bad band and taken back when contact returns. The
  picture snaps between two geometries and nothing draws the switch.
- **A ground loop that rolls.** Hum on one feed lifts that input's sync tips
  with its picture, so which source wins the sync fight alternates with the hum
  phase — the reason a ground loop in a two-deck rig rolls the picture rather
  than merely barring it. Two feeds on opposite mains legs push against each
  other.
- **Damage that travels with its own picture.** B's feed damage lands on B's
  raster and is then resampled by the dirty sum, so B's hum bar, snow and
  dropouts slip and roll with B's picture while A's stay put on the glass. That
  is what tells the two cables apart on screen.

What is deliberately _not_ per-input: anything needing the FIR bank or the
color-under path (luma bandwidth, rainbow instability). Duplicating those would
triple the expensive work for effects whose per-source value is low, so they
stay on the program bus.

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
- **Auto-iris hunt** — exposure handed to the camera's own metering servo, which
  is metering the monitor it feeds: the loop brightens, the iris clamps a beat
  late, the loop starves, the iris reopens. Underdamped it never settles, and it
  runs at a different rhythm from the beam limiter, so the two pumps beat.
- **CRT faceplate** — what the camera photographs: beam cutoff, gun gamma,
  saturation, bloom, warm halation, faceplate glow — each compounded per pass.
- **Halation ∝ beam current** — glass scatter grows with drive, so a peak white
  throws light further into the faceplate than a mid grey does. Keys the halo
  radius off local drive; at zero the halo is one fixed width, which is the tell
  that gives a drawn glow away.

## Mixer loop

The previous frame's composite waveform patched electrically back into the input
— the subcarrier goes around too, so color does things optics cannot.

- **Loop mix / gain** — crossfader toward the loop bus; negative gain alternates
  polarity frame to frame.
- **Loop delay** — microseconds on the return; since chroma rides the same wire,
  delay is also a hue rotation (70 ns = 90°).
- **Loop timebase pull** — the delay trimmer replaced by a varactor hanging off
  the video bus, so the fed-back waveform tunes the delay it rides through.
  Bright content and sync tips pull opposite ways, every 70 ns of pull is
  another 90° of hue, and the displacement field is the picture itself one
  generation late — so geometry, colour and sync integrity all become functions
  of the image, compounding per lap, and none of it can repeat.
- **Loop ring mod** — the loop bus multiplied against the live program in a
  doubly-balanced bridge: colour lands at sum and difference phases neither
  frame contained, sync against picture mints pulses mid-line, and every product
  goes round to be re-multiplied a lap later.
- **Soft rails** — the loop amplifier compresses into its rails instead of
  clipping flat, so a loop past unity folds into glowing structure rather than
  whiting out, and the compression manufactures harmonics for the next lap.
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

- **Record head** — lift it and the tape keeps circulating with whatever is
  already on it: the loop repeats indefinitely and stops taking in the live
  picture, which is what makes this a looper rather than an echo. It does not
  fade. Playback loss is what the head does on the way past, not damage to the
  oxide, so a held loop comes back identical every lap — down to the same grain
  in the same places, since the grain belongs to the tape. Drop the head again
  and it records over what it has.
- **Transport** — which way a held loop runs past the heads, and whether the
  drum is still turning. Only means anything with the record head up: laying
  tape down is forward by definition.
  - _Reverse_ plays the frames back in the order they were laid down, each one
    whole. The scanner still sweeps the same way, so it is the track order that
    reverses: motion runs backwards while the picture stays a picture.
  - _Stopped_ parks the tape while the drum re-reads one sweep — a still frame
    you can play live over.
  - _Shuttle_ is how fast it runs, as a multiple of play — the switch gives the
    direction, the wheel the speed. Off play speed the head no longer follows a
    single recorded track: each sweep crosses several, the RF nulls at every
    crossing, and that many noise bars sweep the picture. The same mechanism as
    the deck's shuttle, but running over the loop you captured rather than the
    incoming signal, so you can cue and review through your own two seconds. It
    is also where a paused loop's bar comes from, and a reversed loop's two: at
    a standstill the head still crosses one track per sweep, and backwards it
    crosses two. Only at exactly play speed forwards is a loop clean.
  - _Scrub_ stalls the drum and keeps pulling. With nothing sweeping, the head
    recovers the magnetisation in the order the tape drags past it, so what
    comes back is the waveform itself reversed. Everything that then goes wrong
    is the receiver's problem and none of it is drawn: sync tips arrive at the
    wrong end of every line so the separator locks somewhere else, the burst
    reads phase-flipped because a time-reversed sinusoid is, and the frame comes
    off end-first — which lands the raster upside down and mirrored, with the
    hue somewhere else entirely. This is the difference between playing a tape
    backwards and dragging one backwards.
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
  Tape runs at 33.35 mm/s, so the length _is_ the delay: 0.6 mm is a frame, 33
  mm a second, 66 mm the whole bin. It is authored as a length rather than a
  time because that is what makes the next one work.
- **Capstan wander** — speed error on a fixed length of tape is delay error, so
  the echo breathes in and out of time. Nothing time-base corrects the return: a
  delay that grows by half a frame hands back a picture displaced half a screen,
  and the repeats slide vertically. This is the fault frame synchronizers were
  invented to fix.
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
  difference key, and negative B gain flips B's whole signal, sync included.
- **B pause** — the pause button on the B deck. The frame holds (the drum
  re-reads one parked track) but the capstan servo is defeated, so B's timebase
  wanders and scatters line to line; the head sweeps off-track through a
  mistrack stripe of snow that creeps on its own; and the drum's two reads never
  had their colour-under phase interleaved, so hue flickers at frame rate.
  Summed dirty against A this is the classic rig — a paused VCR into a mixer,
  two fighting syncs, one of them broken — and when the stripe drifts through
  B's vertical interval the fight turns into rolls.
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

### Nonlinearity

The electronics are not flat against the level they carry — the two numbers on
every VTR spec sheet, and the FM cliff a white-clip circuit exists to guard.

- **Differential gain** — the video amplifier's gain moves with the brightness
  it is amplifying at that instant, so the colour subcarrier riding bright
  picture comes through smaller than the same colour on dark picture: saturation
  drains out of the highlights while the shadows keep theirs. Negative is the
  opposite misdesign, colour swelling in the brights.
- **Differential phase** — the same amplifier's delay moves with brightness, and
  a delay at 3.58 MHz is a phase shift, so hue swings with the luma under it.
  The burst sits at blanking level where the shift is zero, so the decoder's
  reference never moves: this is hue error against a still reference, not a tint
  that could be dialled back out — and inside the mixer loop it separates a
  feedback trail into colour layers by brightness.
- **FM over-deviation** — the deck records luma as FM with the video
  pre-emphasized, and a hard dark→bright edge overshoots the deviation the head
  and tape can carry; past the response cliff the discriminator folds back, so
  more frequency comes out as _less_ video. Every sharp bright edge trails a
  black streak that smears rightward for about a microsecond (the deemphasis
  recovery, on its own trim) and boils frame to frame, because the fold sits on
  a threshold the demod's own noise keeps re-deciding. Colour is recorded
  separately (color-under), so it rides straight through the fold and the
  streaks carry saturated colour over black. Only edges trigger it, so it lives
  where the picture has detail and moves with the image.

### Noise and interference

- **Noise** — tape grain and RF snow on the whole waveform, degrading sync and
  burst along with the picture.
- **Noise spectrum** — which of the two that floor is, because they are not the
  same colour. Noise through the tuner's IF is flat across the video band; noise
  out of a deck's FM discriminator is not, because recovering frequency from
  phase differentiates whatever rides along, so it comes back with its energy
  rising toward the top of the band — the triangular spectrum every deemphasis
  network exists to tilt back. What survives that tilt is why tape hiss is not
  grey: it sits up near 3.58 MHz, lands inside the chroma bandpass, and decodes
  as crawling coloured speckle while the luma stays comparatively clean. Nobody
  draws the colour; a first difference in place of a running sum is the whole
  mechanism, and the level is held constant across the knob so what changes is
  character rather than amount.
- **Impulse noise (arcs)** — ignition, arcing contacts, a dying flyback next
  door: sparse events at carrier-scale amplitude whose _duration_ decides their
  shape, since an arc is a run of signal time and does not respect line
  boundaries. Tens of microseconds is a ringing comet whose tone the decoder
  turns into a colour streak; hundreds fold into stepped diagonal streaks;
  milliseconds are torn slabs of hash that land on sync tips and the beam load,
  so the raster tears and the sag and beam-limiter servos flinch at the hit —
  the rig reacting is most of the look. Hits arrive in storms, an optional
  ignition train draws drifting dash lattices, big strikes get their own rate,
  and a dimmer lock bunches hits into bands that roll with the hum.
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
- **Y/C delay** — the chroma path through a deck or proc amp runs its own
  filters and delay lines, and mistrimmed against the luma path the colour
  arrives late or early: every coloured area sits bodily sideways off the edge
  it belongs to. The burst travels the same mistrimmed path, so the decoder's
  reference moves with the picture's chroma and hue stays correct — displaced
  colour, not rotated, which is what tells this from a timebase error.

### The tape and the heads

- **Dropouts** — shed oxide; the head reads nothing for a moment, leaving white
  streaks and scarred lines.
- **Dropout compensator** — the circuit that patches those streaks out of a
  delay line holding what played a line or two ago, rather than letting the
  head's silence reach the screen. A line of NTSC is 227.5 subcarrier cycles, so
  one line back the colour arrives exactly out of phase: the patch is invisible
  in brightness and comes out in the _complementary hue_, which is the coloured
  streak a cheap deck leaves down a worn tape. Two lines back is a whole number
  of cycles, so the hue is right — at the price of a patch two lines stale,
  which smears across anything moving. Neither can help where the line it is
  holding lost the same samples, and there the raw dropout shows through. Nobody
  draws any of that; it falls out of where the half cycle lands.
- **Tracking error** — the head reading off-track: a band of noise the picture
  tears and bends through, parked where you set it.
- **Head clog** — oxide packed into the gap of one of the two spinning heads, so
  that head reads weak or nothing. The heads take turns, one sweep each, which
  is why a clogged head never shows as a steady veil: picture and snow alternate
  at field rate, a hard flicker between the good head's sweep and the dead
  one's. The head switch near the bottom of the picture is where the other head
  is already reading, so a few last lines always belong to the opposite head —
  they survive the snowed sweeps and die on the clean ones. Sync goes down with
  the sweep, so the receiver tears through the snow instead of framing it.
- **Shuttle (picture search)** — off play speed each head sweep crosses several
  recorded tracks; the RF nulls at every crossing sweep the frame as noise bars,
  and each strip between them is a different track with its own timing and
  color-under phase. Pause at 0, cue past 1, review negative.
- **Flutter / wow** — fast and slow timebase error; signal-domain, so the burst
  moves with the picture and hue wobbles too.
- **Sticky shed** — binder hydrolysis making the tape grab the drum: tension
  builds, breaks free, re-sticks — a relaxation oscillator, chaotic rather than
  periodic, the mechanism behind squealing tapes. Bands of shear lean further
  line by line, snap back in a few, and hang where a strong patch holds; every
  grab's grip is random and a re-grab caught mid-recoil strands tension, so the
  rhythm never repeats. Signal-domain like its neighbours, so the color-under
  phase rainbows at every slip boundary.
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
- **Beam limiter** — the flyback can only source so much average beam current,
  so past a threshold the set pulls video drive down to protect it, through a
  real time constant: the dimming lands after the content that caused it, an
  undersized supply pumps the whole picture at a couple of Hz, and inside any
  feedback loop the drive term joins the loop and beats against it. It also
  throttles the very beam current HV sag integrates.

### Color decoding

- **Y/C comb** — notch trap (dot crawl, rainbow fringing) versus 2-/3-line combs
  that separate luma and chroma properly.
- **S-video bleed** — Y/C shorted: the subcarrier itself appears as a moving dot
  pattern over anything colored.
- **Chroma bandwidth / trail / upsample error / gain** — how fast, how
  asymmetrically, how coarsely and how hot color is demodulated. Opened past
  about 1.5 MHz the passband stops being a color filter and starts admitting
  luma, so every edge and every fine texture arrives as cross-color: a greyscale
  zone plate decodes in full color.
- **Tint** — the knob on the front of the set, rotating the demodulator's
  reference against the incoming color. Every hue turns together; at ±180° the
  reference is backwards and the picture comes out complementary with its
  brightness untouched. It sits after the burst correction, which is why turning
  it never un-corrects itself.
- **Demod axis** — the angle between the set's two synchronous demodulators. 90°
  only because the reference network says so, and cheap sets used non-quadrature
  X/Z axes on purpose. Off 90 the color plane is _sheared_ rather than rotated —
  hues that were opposite stop being opposite, so a picture keeps some of its
  colors and loses others. Wound toward 0 both demodulators read the same phase
  and every hue collapses onto one axis.
- **Burst lock / subcarrier detune** — trust in the measured burst versus a bent
  reference crystal; unlocked, hue sweeps the whole wheel.
- **Color killer** — the burst level below which the set decides the signal is
  monochrome; weak signals make color cut out in patches.
- **Chroma AGC lag** — the ACC's control voltage sits on an RC, so colour gain
  and the killer answer burst damage tens of lines late: colour blooms back
  after a dropout band instead of snapping, overshoots on scene changes, and a
  marginal burst makes the killer chatter down the frame.
- **Output stage clip** — how the RGB amplifiers run out of headroom. Fitted
  back into gamut, overdriven color stays vivid and keeps its hue; run into the
  rails instead and the three guns clip one at a time, so the first to go drags
  the hue toward the two still in range. Saturated content migrates toward the
  primaries as it blows out.

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
- **Waveform → hue** — the same waveform driven into the color demodulator's
  reference oscillator, which is the wire the tint knob sits on: the sound turns
  the tint 15,734 times a second. Bass swings the whole picture's hue on the
  beat; content up near line rate paints hue in bands that dance down the frame.
  The reference lives in the receiver, so the bands stay on the glass while a
  rolling picture slides through them.
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
- **Convergence error** — three guns fire through one mask from three positions,
  so they can only be registered over part of the screen. Nulled in the middle
  and worsening toward the corners, which is why an old tube is clean in the
  centre and fringes red and blue at the edges. On the glass, so the magnifier
  shows it; negative crosses the guns the other way.
- **Scan velocity modulation** — the sharpness circuit consumer sets used:
  differentiated luma patched into an extra deflection coil, so the beam
  decelerates through a dark-to-bright transition and accelerates through a
  bright-to-dark one. Emission follows dwell time, so light is _moved_ across
  the edge rather than added — a white overshoot on one side, a black notch on
  the other, and the asymmetry is the whole complaint people had about it.
  Measured on bars, an edge completes in about two pixels instead of five while
  total row luma holds within a percent.

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
- **Purity (magnetised patch)** — a patch of the mask left magnetised by a
  speaker set too close, or a set moved without degaussing. The field bends all
  three beams together, but a triad is three dots 120° apart, so the same nudge
  over-excites the dot it moves toward and starves the one opposite. The stain
  turns hue across itself rather than tinting flat, and it is fixed on the glass
  — a rolling picture travels through it instead of carrying it along.

### Looking at it

- **Magnifier** — where your eye is. Past 1× it goes against the glass, and
  everything that lives on the screen rather than in the image magnifies with
  it: triads, scanline gaps, grain, the beam spot's bleed between samples. Below
  1× it pulls back off the set instead — the faceplate bulges the way a real one
  does, and the cabinet holding it comes out of the dark. The crosshair button
  at the top right of the panel says which of the two a drag on the picture is —
  boxing a region to close in, or moving around the glass — with shift-drag
  always the other one; double-click for 1×.
- **Slow motion** — the whole rig stepped at a fraction of display rate: noise,
  rolls, sweeps, feedback and phosphor all crawl together; 0 freezes the frame.
  Pairs with the vaporwave source-speed control to slow the footage to match.
