# Effects and features

Everything the app does, in the order the signal meets it, then everything built
around the signal path. The effects come first because they are most of it: each
control breaks a piece of hardware rather than drawing an artifact, so dot
crawl, rainbows, tearing, rolling and hue drift all come out on their own.

| Stage                                     | Where it sits                                       |
| ----------------------------------------- | --------------------------------------------------- |
| [Sources and wiring](#sources-and-wiring) | what you can feed it, and the cable it arrives on   |
| [Per-input feeds](#per-input-feeds)       | one input's own deck and cable, ahead of the mixer  |
| [Camera feedback](#camera-feedback)       | a camera pointed at the monitor it's driving        |
| [Mixer loop](#mixer-loop)                 | the composite waveform patched back into itself     |
| [Tape loop](#tape-loop)                   | a loop of tape between a record and a play head     |
| [A/B mix](#ab-mix-source-b)               | a second source, genlocked or not                   |
| [Tape / channel](#tape--channel)          | VHS and the RF path it arrives over                 |
| [Enhancer (bent)](#enhancer-bent)         | a consumer picture enhancer with its jumpers moved  |
| [Receiver](#receiver)                     | the TV: sync, deflection, comb filter, chroma demod |
| [Audio-reactive](#audio-reactive)         | audio patched into any of the above                 |
| [Screen](#screen)                         | the beam, the phosphor and the glass in front of it |

Then: [modulation](#modulation-and-audio), [MIDI](#midi),
[presets and saves](#presets-saves-and-history), [capture](#capture-and-export),
[sharing](#sharing), [interface](#interface), [platform](#platform).

## Sources and wiring

Two decks, A and B, each with its own cable, faults and controls. Either takes:

- A still image, a video file, a webcam (an RCA capture dongle counts), or a
  shared screen, window or tab.
- Colour bars, TV static, VHS static, or a video synth.
- A teletype card you type or draw on, in a dot-matrix font coarse enough to
  give the chain something to chew on.
- A clip off your own shelf of files and folders, or a roll out of Wikimedia
  Commons and archive.org, which you can also browse with a ranked grid of
  thumbnails. Anything you keep is cached locally, so the second view is
  instant.
- YouTube URLs, through a `yt-dlp` dev-server middleware, running locally only.

Both decks cue and loop independently, with a keystroke to stab back to the cue,
and the app measures what a given loop's jump back costs. `?iurl`, `?iurlb` and
`?vurl` load sources straight from a link.

Then the faults, which start at the connector:

- **No-signal sources** — snow and blank tape, from the same noise generator. A
  tuner with no carrier gives sparse hard specks; a deck's limiter free-runs and
  gives flat grey. Neither carries a subcarrier, so any colour you see is the
  receiver failing.
- **Video synth** — two oscillators, a combiner and a colorizer, with nothing
  plugged in. Frequency against the raster is the whole picture: line rate draws
  standing bars, field rate a gradient, 3.58 MHz flat colour.
- **Polarity invert** — the composite negated after the encoder. Solarized
  partway, fully negative at 1.
- **Hard polarity flip** — signal and ground swapped at the plug. Sync goes with
  it, so the set tears looking for sync up in peak white.
- **Termination fault** — double-terminated gives a dim picture with the colour
  killer biting; unterminated gives a hot one with ringing on every edge.
- **Chroma-pin only** — S-video miswired into composite. Bare subcarrier, no
  luma and no sync.
- **Loose connector** — contact making and breaking, band by band. Lose the
  centre pin and those bands fall to noise and tear; lose the shell and you keep
  the picture but pick up hum.
- **Ground loop** — two earthed boxes joined by a shield, with the loop current
  riding along in series with the video.
- **Cable scrambling** — the head end suppressing sync. A little of it just
  fools the AGC and washes the picture out; past the slicer the line oscillator
  free-runs and the raster shears. Line-alternate zigzags instead, and SSAVI
  inverts the video while burst keeps the hue.
- **Macrovision AGC pulses** — pulses stamped on vertical-interval lines 12-19,
  which is exactly the window this receiver averages sync depth over. With the
  AGC up the set crushes gain on a signal that was never hot, and the pulse
  level walks a staircase, so the picture breathes rather than settling.
- **Colorstripe** — the other half of the same process: bursts on walking bands
  of lines rotated off house phase, so the decoder corrects each one the wrong
  way and hue bands crawl down the frame. A set that trusts its burst less
  shrugs it off.
- **VBI test signals** — the furniture broadcasters parked in the blanking
  interval: VITS multiburst and a staircase on lines 17-18, a VIR reference on
  19, caption data on 21. Invisible until you roll the picture or shrink v size.
- **Bob deinterlace** — rebuilds frames from single fields to kill capture-card
  combing. Costs half the vertical detail.

## Per-input feeds

Everything above damages the mixed output. Each input also has its own deck and
cable carrying the same faults, which plays differently: the two sources stop
agreeing and the rest of the rig has to cope.

- **Deck** — pause, dropouts, scrambling of that channel. The damage is on the
  tape, so a paused deck re-reads the same gaps in the same places.
- **Cable** — loose plug, ground loop, snow, termination, polarity. This damage
  sits on that source's own raster, so B's hum bars and dropouts roll along with
  B's picture while A's stay put.
- **Sync hand-off** — knock out one input's sync tips and the receiver locks to
  the other one instead, so the geometry snaps between two sources.
- **Rolling ground loop** — hum lifts a feed's sync tips along with its picture,
  so the winner of the sync fight changes with the hum phase and the picture
  rolls.

Luma bandwidth and rainbow instability stay on the mixed bus. They need the FIR
bank, and running it per source costs too much for what it buys.

## Camera feedback

A camera pointed at the monitor it is driving, re-shot every frame.

- **Loop mix / gain** — how much of the screen comes back, and at what exposure.
  Past unity it starts breeding structure of its own.
- **Zoom / rotate / shift** — where the camera is aimed. Tunnels and spirals,
  and where their core sits.
- **Defocus / vignette** — lens blur, which favours big soft shapes over fine
  noise, and corner falloff to keep the loop in the middle of the frame.
- **Black cut / s-curve** — a sensor floor that snaps the trails off, and
  highlight compression that turns a runaway loop into glowing bands.
- **Auto-iris hunt** — the camera's metering servo, pointed at the monitor it is
  feeding. Underdamped it never settles, and it beats against the beam limiter.
- **CRT faceplate** — what the camera is actually photographing: beam cutoff,
  gun gamma, bloom, halation, glow, compounding on every pass.
- **Halation ∝ beam current** — scatter grows with drive, so white throws light
  further into the glass than grey does. A halo of one fixed width is what gives
  a drawn glow away.

## Mixer loop

Last frame's composite patched back into the input. The subcarrier goes round
with it, so colour does things optical feedback can't.

- **Loop mix / gain** — crossfade toward the loop bus. Negative gain flips
  polarity every frame.
- **Loop delay** — microseconds on the return, which doubles as a hue rotation:
  70 ns is 90°.
- **Loop timebase pull** — the returning picture tunes the delay it rides
  through, so geometry, colour and sync all end up functions of the image.
- **Loop ring mod** — the loop bus multiplied against the live program. Colours
  turn up that neither frame contained, and sync hitting picture mints pulses
  mid-line.
- **Soft rails** — the loop amp compresses rather than clipping flat, so past
  unity it folds into glowing structure instead of whiting out.
- **Vertical offset** — a few lines of slide per generation, so trails stack up
  into ladders.
- **Luma key** — only the bright (or dark) parts feed back, so the loop follows
  the subject around.
- **Strobe hold / trails** — a frame synchroniser that stutters, and peak-hold
  smear in its store.
- **Loop resonance** — a bent enhancer inside the loop. Enough boost and it
  self-oscillates.

## Tape loop

A second machine across the mixer, threaded with a loop of tape. The return gets
recorded again, so repeats decay by generation loss rather than by a fader.

- **Record head** — lift it and the loop keeps going round with what it already
  has. It doesn't fade, because playback loss happens at the head rather than to
  the tape.
- **Transport** — reverse plays whole frames backwards, so motion runs backwards
  but the picture stays a picture. Stopped re-reads one parked sweep. Shuttle
  crosses tracks and the RF nulls draw noise bars. Scrub stalls the drum and
  drags the tape, which returns the waveform itself reversed and lands the
  raster upside down, mirrored, with the hue somewhere else.
- **Playback heads** — up to four of them, so a lap hands the picture back once
  per head. Every tap in a lap is the same generation, so the pattern repeats
  intact and the whole thing goes a generation darker each time round.
- **Head spacing** — even subdivisions at 1. Either side of that the taps bunch
  up and leave a gap before the lap turns over.
- **Loop length** — millimetres of tape. At 33.35 mm/s the length is the delay:
  0.6 mm is a frame, 33 mm a second.
- **Capstan wander** — speed error on a fixed length is delay error, and nothing
  corrects the return, so the repeats breathe and slide vertically.
- **Generation loss** — the subcarrier sits right at the top of the band, so
  chroma dies well before luma does and a long tail ends up grey.
- **Tape noise** — the medium's own grain, fixed to the oxide. It gets recorded
  again each lap instead of averaging away, so it builds into standing streaks.
- **Oxide wear** — worn patches at fixed points on the loop, so the same lines
  drop out every time round.
- **Splice** — the joint passes the head once a lap. A loop is rarely a whole
  number of frames, so the bump walks down the picture.
- **Colour framing** — delay is hue rotation, 90° a sample. Framed rounds it to
  a whole cycle; off, every change of delay repaints the repeats.

## A/B mix (source B)

- **Dirty sum vs. genlock** — B free-running against A's sync and burst, or
  re-encoded onto A's raster for a clean dissolve.
- **Ring mod** — the two composites multiplied together, putting chroma at sum
  and difference frequencies.
- **Line offset / subcarrier detune / frame roll** — B's oscillators pulled off
  A's, for skew, rainbow crawl and vertical creep.
- **B hue / gain / invert** — proc-amp trims. Inverted B against A reads as a
  difference key, and negative gain takes B's sync with it.
- **B pause** — the frame holds, but with the capstan servo defeated. The
  timebase scatters line to line, a mistrack stripe creeps through, and hue
  flickers at frame rate. Summed dirty against A it's the classic two-deck rig.
- **Wipes** — horizontal, vertical, box and diamond, with softness and an
  auto-sweep. Drag the boundary on a miniature rather than dialling coordinates.
- **PiP inset** — B squeezed into a genlocked window, with a matte border and
  luma key, placed by dragging it on a miniature.
- **Chroma key** — the keyer cuts the chroma the encoder made, and that filter
  has no vertical term, so mattes come out soft across and sharp down. Spill
  kill reinjects the backing's own subcarrier antiphase. Run it on the dirty
  path and B's detune walks the backing in and out of the acceptance wedge, so
  the key breathes and tears. Key delay registers the keyer against the video,
  since the two paths are different lengths of circuit, and off zero the matte
  lies beside the subject instead of over it. Fill decides what shows through
  the hole: the other input, a matte generator, or the mixer's last frame.

## Tape / channel

Everything between the recorder and the set, plus the RF path a broadcast
arrives over. The whole stage runs up to four times, one per dub generation.

### Bandwidth and detail

- **Luma bandwidth** — 4.2 MHz down to worn-tape mush. Vertical edges smear
  while the picture stays sharp top to bottom.
- **Peaking** — the crispening boost VCRs fake detail back with, ringing bright
  and dark outlines onto every edge.

### Nonlinearity

- **Differential gain** — the amplifier's gain moves with the brightness it's
  carrying, so saturation drains out of the highlights.
- **Differential phase** — its delay moves with brightness too, and delay at
  3.58 MHz is hue. Burst sits where the shift is zero, so the reference never
  moves and you can't dial the error back out.
- **FM over-deviation** — a hard bright edge pushes past what the head can
  carry, and the discriminator folds back, so more frequency comes out as less
  video. Every sharp edge trails a black streak that boils frame to frame.
  Colour is recorded separately and rides straight through it.

### Noise and interference

- **Noise** — tape grain and RF snow across the whole waveform, sync and burst
  along with the picture.
- **Noise spectrum** — noise through a tuner is flat, but noise out of an FM
  discriminator rises toward the top of the band. That lands it in the chroma
  passband, where it decodes as crawling coloured speckle.
- **Impulse noise (arcs)** — ignition, arcing contacts, a dying flyback next
  door. Duration decides the shape: tens of microseconds is a ringing comet,
  hundreds fold into stepped diagonals, milliseconds are torn slabs that hit
  sync and make the servos flinch.
- **Ghosting** — multipath, so a delayed and possibly inverted echo sits to the
  right of everything.
- **Hum bar** — mains hum as a soft bright bar drifting up the picture.
- **Hum modulation** — the same ripple inside a supply rail instead, moving that
  stage's gain. The picture pumps in bands and the AGC chases it.
- **Sound carrier** — 4.5 MHz intercarrier sound getting past its trap, as
  herringbone buzz.

### The tuner

- **Weak signal (snow)** — IF noise into the envelope detector. The picture
  rides a negative-modulation carrier, so the noise isn't spread evenly: whites
  boil first, blacks stay quiet longest, and sync dies last, so the picture
  fights through the snow rather than sinking into grey fuzz.
- **Adjacent channel** — how much of the next channel up the cable gets past the
  IF trap. What leaks through is carriers rather than a picture, so the detector
  turns them into beats: a 1.5 MHz weave, plus slanted dark bars from the
  neighbour's own blanking crossing the screen.
- **Fine tuning** — the knob pulled off channel. One way the sound carrier
  leaves its trap and starts beating against the video; the other slides the
  picture carrier down the response.
- **CB ingress** — a two-way radio getting in through a cracked shield. It owes
  nothing to any NTSC frequency, so the herringbone sits at no fixed angle and
  wanders with the transmitter, and it arrives in transmissions with real
  silence between them.

### Colour-under

VHS can't record chroma where it lives, so it heterodynes it down and back.
Everything here follows from that trip.

- **Colour-under** — chroma moved to 629 kHz and back. Colour bandwidth
  collapses and smears sideways while luma stays sharp.
- **Phase jitter** — per-line error in the conversion, so hue wanders line to
  line into a coloured venetian blind.
- **Chroma noise** — noise on the 629 kHz carrier, which has far less headroom
  than the luma FM. It comes back through a narrow filter as blotches of wrong
  hue rather than grain.
- **Y/C delay** — the chroma path mistrimmed against the luma path, so colour
  sits bodily off the edge it belongs to. Burst takes the same trip, so hue
  itself stays right.

### The tape and the heads

- **Dropouts** — oxide has shed and the head reads nothing there, leaving white
  streaks and scarred lines.
- **Dropout compensator** — the circuit that patches those from a delay line.
  One line back is 227.5 subcarrier cycles, so the patch is invisible in
  brightness and comes out in the complementary hue. Two lines back gets the hue
  right but is stale enough to smear anything moving.
- **Tracking error** — the head riding off the track, leaving a band of noise
  that the picture tears and bends through.
- **Head clog** — one of the two heads reads weak or nothing. They take turns a
  sweep each, so it flickers hard at field rate instead of veiling the picture.
- **Shuttle (picture search)** — off play speed, each sweep crosses several
  tracks. The RF nulls sweep the frame as noise bars, and each strip between
  them has its own timing and colour phase.
- **Flutter / wow** — fast and slow timebase error. Burst moves with the
  picture, so hue wobbles too.
- **Sticky shed** — the tape grabs the drum, tension builds, it breaks free and
  grabs again. Bands of shear lean further line by line, snap back, and never
  quite repeat.
- **Head switch** — the timing mismatch between the two heads, which is the torn
  hook at the bottom of every VHS frame.
- **Dub generations** — the whole stage run up to four times, each with its own
  noise, dropouts and timebase walk.

## Enhancer (bent)

A consumer enhancer and stabiliser patched between the deck and the set, with
jumpers moved across three of its stages.

- **Clamp gate** — the box pins one sample a line to blanking to fix black
  level. Slide the gate off the back porch and the picture sets black level
  instead, so brightness bounces line to line. Slide it onto the sync tip and
  the whole line lifts.
- **Clamp droop** — an undersized coupling capacitor, so level sags back within
  the line and bright content drags a dark streak behind it.
- **Detail resonance** — the peaking coil with the bend's feedback wrapped
  around it. It rings after every edge, and past unity the sync pulse sets it
  off and the bars build across the line. There's no Y/C split, so the same knob
  boosts the subcarrier and saturation climbs with detail.
- **Sync regenerator** — restamps a clean pulse wherever its slicer crosses.
  Bend the slice up into picture and dark content starts minting pulses of its
  own, mid-line.

## Receiver

A real television, and the ways one can be misadjusted. Sync faults move the
picture; decoding faults move its colour.

### Sync and deflection

- **AGC** — level normalisation off the sync tip. Switch it off and amplitude
  faults turn into brightness faults.
- **Horizontal hold** — how hard the PLL pulls toward sync. Loose drifts and
  skews; tight turns waveform damage straight into a bent picture.
- **Vertical hold / oscillator** — lock authority and free-run rate. Detune it
  and the frame rolls at the difference.
- **Retrace flag** — equalising pulses kicking the horizontal PLL at the
  vertical seam, giving the hooked top edge.
- **Horizontal oscillator detune** — drift off 15.734 kHz. Diagonal skew first,
  then shearing into bars once it's past pull-in range.
- **Deflection bend** — the tube's own scan displaced, with flag, skew, bow and
  ripple. It happens after decoding, so geometry warps but hue stays put.
- **V size (underscan)** — the service knob on the yoke. Below 1 the scan
  shrinks and the raster comes into view past the picture: the vertical interval
  with whatever is parked in it, the head-switch band, black beyond retrace.
  Above 1 is overscan, which is how consumer sets actually shipped.
- **HV sag / supply ring** — bright content loads the high-voltage supply and
  stretches the scan. Underdamped, a bright edge sets off a decaying wobble.
- **Beam limiter** — past a threshold the set pulls drive down to protect the
  flyback, through a real time constant, so the dimming arrives after the
  content that caused it.

### Colour decoding

- **Y/C comb** — a notch trap, with the dot crawl and rainbow fringing that come
  with it, or 2- and 3-line combs that separate luma and chroma properly.
- **S-video bleed** — Y/C shorted together, so the subcarrier shows up as a
  moving dot pattern over anything coloured.
- **Chroma bandwidth / trail / upsample error / gain** — how fast, how
  asymmetrically, how coarsely and how hot colour is demodulated. Open it past
  about 1.5 MHz and luma starts getting in, so a greyscale zone plate decodes in
  full colour.
- **Encoder chroma bandwidth** — colour bandwidth at the encode end, the
  camera's own limit rather than the decoder's. Open it wide and the chroma
  sidebands spill into the luma band and make their own cross-colour.
- **Tint** — the knob on the front of the set, rotating the demodulator's
  reference. At ±180° the picture comes out complementary with its brightness
  untouched.
- **Demod axis** — the angle between the two demodulators, 90° only because the
  reference network says so. Off 90 the colour plane shears rather than rotates,
  so some hues survive and others don't. At 0 they all collapse onto one axis.
- **Burst lock / subcarrier detune** — how much the set trusts the measured
  burst, against a bent reference crystal. Unlocked, hue sweeps the wheel.
- **Colour killer** — the burst level below which the set decides it's looking
  at a monochrome signal, so weak signals lose colour in patches.
- **Chroma AGC lag** — the control voltage sits on an RC, so gain and the killer
  answer burst damage tens of lines late. Colour blooms back after a dropout
  instead of snapping.
- **Output stage clip** — the three guns run out of headroom one at a time, so
  the first to go drags the hue toward the two still in range.

## Audio-reactive

Audio patched into the electronics, one sample per scan line. These drive the
faults above rather than adding new ones.

- **Bass → vertical hold** — kicks detune the field oscillator, so the frame
  lurches on the beat.
- **Level → horizontal hold** — loud passages pull the line oscillator, and the
  picture skews and tears.
- **Bass → HV sag** — bass loads the supply the way beam current does, so the
  scan smacks inward and springs back.
- **Audio → HV tank** — the audio riding in the high-voltage supply alongside
  the beam current, so it rings and wobbles with the music instead of only
  sagging. Needs bass → HV sag up.
- **Waveform → deflection** — the audio drawn straight into horizontal
  deflection, an oscilloscope trace bending the raster.
- **Waveform → hue** — the same audio into the demodulator's reference, which is
  the wire the tint knob sits on. It turns the tint 15,734 times a second, and
  since the reference lives in the receiver the bands stay on the glass while a
  rolling picture slides through them.
- **Audio → video input** — the wrong cable altogether: brightness bands,
  shifting colour, and torn sync on the loud parts.

## Screen

### The beam

- **Blanking strobe** — the retrace gate held on, so the beam only gets through
  in flashes. It's upstream of the phosphor, so light already on the glass keeps
  giving itself back through the dark, and the beam limiter and any feedback
  loop start pumping at the strobe rate.
- **Beam profile / bloom** — spot size and how it grows with drive. Scanlines
  show in the shadows and close up in the highlights.
- **Beam spot** — the gun writes a soft blob rather than a square, so one
  sample's light lands partly on its neighbours.
- **Reconstruction** — bilinear through cubic, for how a sampled line turns into
  continuous light.
- **Convergence error** — three guns firing through one mask from three
  positions. Clean in the middle, fringing red and blue toward the corners.
- **Scan velocity modulation** — the sharpness trick consumer sets used:
  differentiated luma into an extra coil, so the beam slows through one side of
  an edge and speeds up through the other. Light gets moved across the edge
  rather than added to it.

### The phosphor

- **Phosphor grain** — the coating is a granular deposit, so emission is
  mottled. Fixed on the glass, strongest in the mid tones.
- **Phosphor primaries** — sRGB, P22/SMPTE-C, the wide 1953 NTSC set, or
  long-persistence monochrome green.
- **Persistence / trail tint** — the decay is second-order rather than
  exponential, so a trail is a bright front over a long faint tail, and it goes
  green as red and blue die first.
- **Trail scatter** — held light spreads sideways into phosphor that's still
  glowing, so old light goes wide and cloudy while the fresh edge stays sharp.
- **Aperture grille** — the R/G/B stripe mask, which moirés near small
  whole-pixel spacings the same way photographing a CRT does.
- **Purity (magnetised patch)** — a patch of mask left magnetised by a speaker
  parked too close. A triad is three dots 120° apart, so the same nudge
  over-excites one and starves another, and the stain turns hue across itself.
  It's fixed on the glass, so a rolling picture travels through it.

### Looking at it

- **Magnifier** — goes right up against the glass, so scanline structure, grain,
  triads and the beam spot's bleed all magnify along with the picture.
- **Slow motion** — steps the whole rig at a fraction of display rate, so noise,
  rolls, feedback and phosphor crawl together. At 0 the frame freezes.

---

That's the signal path. The rest is the rig built around it.

## Modulation and audio

- Any control can run on a sine or triangle LFO, a random walk, smoothed noise,
  sample-and-hold, a Lorenz attractor, the audio level or its transients, or a
  one-shot envelope you fire from a key or a MIDI note. Depth is a fraction of
  the control's range, so the slider stays the centre of the motion.
- A Modulation bay — a box floating off the signal-path map, wired to nothing,
  because it acts on the controls rather than the signal — lists every routing
  and how many slots are left, and a motion strip gives you one amount over all
  of them plus a freeze.
- Type or tap a BPM and lock any rate to it, from 1/1 to 1/16. MIDI clock takes
  over when something is sending it.
- Stabs flip the whole board to clean for a few tens of milliseconds, several
  times a second, so the look gets poked into a clean picture rather than
  running continuously. Everything with memory — phosphor, the three loops, the
  tape bin — keeps accumulating through the flip.
- Audio comes from a mic, a track, or the clip on screen playing its own sound,
  and drives the hardware itself — see [audio-reactive](#audio-reactive) above.

## MIDI

- Any USB controller that sends CC. See [MIDI.md](MIDI.md).
- Learn one knob, or auto-map and learn-in-order to bind a whole device,
  look-makers first.
- Soft takeover, so a bound knob only takes over once it crosses the current
  value.
- Rates lock to incoming clock, and one-shots fire from a note at its velocity.

## Presets, saves and history

- Presets are a grouped picker with hover-diff and hold-to-compare, and each one
  is also a fader you can drag partway in.
- **This look** shows everything you've moved off stock as real sliders, filed
  by module, editable and revertible one at a time.
- Random look and random nudge share a gesture, with modifier keys for wilder
  and gentler rolls, and every stage heading has its own die.
- Morph, so a look can cut or travel over seconds through the states between two
  presets.
- Undo and redo through the whole history.
- Saved profiles in Firestore behind a Google sign-in, with the first nine on
  the number keys for recall and overwrite.
- Favorites, to pin a control so it surfaces whatever stage it belongs to.
- Rating and tagging looks, which feeds the tooling that fits an affinity model
  over labelled ones.

## Capture and export

- Save a still or record a webm from the browser.
- Pop the controls out into a second window and give the picture the screen,
  which is what you want with OBS pointed at it.
- Adjustable recording bitrate, and a frame-stats monitor with per-pass GPU
  timings.

## Sharing

- The whole board mirrors to the URL, controls and routings and source clip and
  cue points, so a link is a patch rather than a preset name.
- **⧉ copy link** in the UI, plus `?iurl`, `?iurlb`, `?preset`, `?set=` for
  hand-built links and `?surprise` for a look rolled from the link.

## Interface

- A chain map at the head of the sidebar: the signal path as a block diagram,
  every box a button, with the three feedback loops drawn as their own runs. An
  expandable diagram view adds what the miniature has no room for.
- A filter box and a command palette (`ctrl/⌘+k`), both searching help text
  rather than just names, so you can find an artifact without knowing its knob.
- Help cards on every control, and notes on inert ones saying what gates them.
- Collapsible sections, a wide bench mode, and a mobile layout that stacks in
  portrait and goes sidebar in landscape.
- Signal taps and a scope: composite waveform, luma, chroma energy, burst state,
  an IRE-graticule scope with persistence, and a vectorscope.
- A magnifier built into the display, so it magnifies scan lines, mask and grain
  along with the picture.
- Device-loss recovery, so a lost GPU device is rebuilt instead of ending the
  session. See [ADR 0004](adr/0004-never-destroy-a-presenting-device.md).

## Platform

- WebGPU compute-shader engine, optionally in a worker with the page as a thin
  proxy.
- `?gpu=low-power` for battery use or bisecting a driver fault, and a render
  scale independent of display resolution.
- A frame-rate lock that renders every second, third or fourth refresh, since a
  steady 24 reads calmer than a wavering 40. `auto` picks it from the loop's own
  timing.
- Fully client-side. The only thing needing a server is the local-dev YouTube
  source.
