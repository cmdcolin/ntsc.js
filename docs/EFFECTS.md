# Effects and features

Every control here breaks a piece of hardware rather than drawing an artifact.
Dot crawl, rainbows, tearing, rolling and hue drift are what falls out — nobody
draws them, and that is why two controls compound instead of just stacking.

**This page is the map, not the manual.** Every slider in the app carries a **?**
that explains the fault it models, and the filter box and `ctrl+k` palette both
search that help text — so you can find an artifact without knowing its knob.
Read this to see what territory exists; use the app to read the detail.

| Stage                                     | Is                                                  |
| ----------------------------------------- | --------------------------------------------------- |
| [Sources and wiring](#sources-and-wiring) | what you can feed it, and the cable it arrives on   |
| [Feedback loops](#feedback-loops)         | camera, mixer and tape, folding the end back in     |
| [A/B mix](#ab-mix)                        | a second source, genlocked or not                   |
| [Tape and channel](#tape-and-channel)     | VHS, and the RF path a broadcast arrives over       |
| [Enhancer](#enhancer)                     | a consumer picture enhancer with its jumpers moved  |
| [Receiver](#receiver)                     | the TV: sync, deflection, comb filter, chroma demod |
| [Screen](#screen)                         | the beam, the phosphor and the glass in front of it |
| [Audio-reactive](#audio-reactive)         | audio patched into any of the above                 |
| [The rig](#the-rig)                       | modulation, MIDI, presets, capture, interface       |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="img/pipeline-simple-dark.svg">
  <img alt="Signal path — overview: Source → Encoder → Channel → Receiver → Display, with a composite feedback loop from Channel back to Encoder and an image feedback loop from Display back to Source" src="img/pipeline-simple-light.svg">
</picture>

## Sources and wiring

Two decks, A and B. Either takes a still, a video file, a webcam (an RCA capture
dongle counts), a shared screen or window, colour bars, TV static, a video
synth, or a teletype card you type and draw on. There is also a shelf of your
own clips and a roll out of Wikimedia Commons and archive.org, browsable with a
thumbnail grid. Both decks cue and loop independently.

Then the faults, which start at the connector. Some are ordinary — **snow**, a
**loose plug**, a **ground loop**, a **termination fault** — and some are
specific: **chroma-pin only** is S-video miswired into composite, so you get
bare subcarrier with no luma and no sync; **hard polarity flip** swaps signal
and ground, so sync goes with it and the set tears hunting for it up in peak
white.

The copy-protection family is worth knowing about because it is where the
receiver's own circuits get played against it. **Cable scrambling** suppresses
sync at the head end: a little just fools the AGC, past the slicer the line
oscillator free-runs and the raster shears. **Macrovision AGC pulses** land on
vertical-interval lines 12–19 — exactly the window this receiver averages sync
depth over — so the set crushes gain on a signal that was never hot and the
picture breathes. **Colorstripe** rotates bursts on walking bands of lines off
house phase, so the decoder corrects each the wrong way and hue bands crawl.

Each input also has **its own deck and cable** carrying the same faults, ahead
of the mixer. That plays differently: the two sources stop agreeing, and the
rest of the rig has to cope. Knock out one input's sync and the receiver locks
to the other, so geometry snaps between two pictures.

## Feedback loops

Three of them, and they differ in what goes round.

**Camera at the monitor** sends the lit tube face back in optically — zoom,
rotate, shift, defocus, vignette, a black cut that snaps trails off, and an
auto-iris servo that beats against the beam limiter. It photographs an emissive
screen, so scan lines and glow compound on every pass.

**Mixer loop** patches the composite waveform back into itself. The subcarrier
goes round with it, which is why colour does things optical feedback cannot: the
loop delay doubles as a hue rotation (70 ns is 90°), a ring mod against the live
program mints colours neither frame contained, and a luma key makes the loop
follow the subject around.

**Tape loop** threads a second machine across the mixer. The return is recorded
again, so repeats decay by generation loss rather than by a fader — chroma dies
first, so a long tail ends up grey. Up to four playback heads hand the picture
back once each per lap; lift the record head and the loop keeps circulating what
it already has. Loop length is delay (33 mm is a second), capstan wander makes
the repeats breathe, and worn oxide drops the same lines out every time round.

## A/B mix

B can be genlocked onto A's raster for a clean dissolve, or summed **dirty** —
free-running against A's sync and burst, which is the classic two-deck rig.
Pull B's oscillators off A's for skew, rainbow crawl and vertical creep, or
multiply the two composites together with **ring mod**. **B pause** holds the
frame with the capstan servo defeated, so the timebase scatters line to line and
a mistrack stripe creeps through.

There are **wipes** (horizontal, vertical, box, diamond, with auto-sweep), a
**PiP inset**, and a **chroma key** that cuts the chroma the encoder made. That
filter has no vertical term, so mattes come out soft across and sharp down —
and run on the dirty path, B's detune walks the backing in and out of the
acceptance wedge, so the key breathes and tears.

## Tape and channel

Everything between the recorder and the set. The whole stage runs up to four
times, one per **dub generation**, each with its own noise and timebase walk.

**Bandwidth** — luma from 4.2 MHz down to worn-tape mush, plus the crispening
**peaking** VCRs fake detail back with.

**Nonlinearity** — **differential gain** drains saturation out of highlights;
**differential phase** shifts delay with brightness, and delay at 3.58 MHz is
hue. Burst sits where the shift is zero, so you cannot dial the error back out.
**FM over-deviation** folds a hard bright edge back on itself, trailing a
boiling black streak.

**Noise and interference** — tape grain and RF snow across sync and burst as
well as the picture. Noise out of an FM discriminator rises toward the top of
the band, which lands it in the chroma passband as crawling coloured speckle.
Then **ghosting** (multipath), **hum bars**, **hum modulation** inside a supply
rail, **4.5 MHz sound carrier** buzz, and **impulse noise** from arcing — where
duration decides the shape, from ringing comets to torn slabs that hit sync and
make the servos flinch.

**The tuner** — **weak signal** rides a negative-modulation carrier, so whites
boil first and sync dies last, and the picture fights through the snow rather
than sinking into it. Plus **adjacent channel** leakage, **fine tuning** off
station, and **CB ingress**, which owes nothing to any NTSC frequency and so
sits at no fixed angle and arrives in bursts with real silence between them.

**Colour-under** — VHS cannot record chroma where it lives, so it heterodynes
it down to 629 kHz and back. Everything here follows: colour bandwidth
collapses, per-line **phase jitter** turns hue into a coloured venetian blind,
**chroma noise** comes back as blotches rather than grain, and **Y/C delay**
sits colour bodily off the edge it belongs to.

**The tape and heads** — **dropouts** where oxide has shed, and the **dropout
compensator** that patches them from a delay line: one line back is 227.5
subcarrier cycles, so the patch is invisible in brightness and wrong in hue.
Then **tracking error**, **head clog** (the two heads take turns a sweep each,
so it flickers at field rate), **shuttle** noise bars, **flutter and wow**,
**sticky shed**, and **head switch** — the torn hook at the bottom of every VHS
frame.

## Enhancer

A consumer enhancer and stabiliser between the deck and the set, with jumpers
moved. The **clamp gate** pins one sample a line to blanking to fix black level
— slide it off the back porch and the picture sets its own black level, so
brightness bounces line to line. **Detail resonance** wraps feedback around the
peaking coil, and past unity the sync pulse sets it ringing and bars build
across the line. The **sync regenerator** restamps a clean pulse wherever its
slicer crosses, so bend the slice up into picture and dark content starts
minting pulses of its own.

## Receiver

A real television, and the ways one can be misadjusted. Sync faults move the
picture; decoding faults move its colour.

**Sync and deflection** — **AGC** off the sync tip, **horizontal hold** (loose
drifts and skews, tight turns waveform damage straight into a bent picture),
**vertical hold** and free-run rate, **retrace flag**, **horizontal oscillator
detune**, and **deflection bend** with flag, skew, bow and ripple. That last one
happens after decoding, so geometry warps but hue stays put. **V size** below 1
underscans and brings the raster itself into view — the vertical interval, the
head-switch band, black beyond retrace. **HV sag** stretches the scan under
bright content, and the **beam limiter** pulls drive down through a real time
constant, so the dimming arrives after the content that caused it.

**Colour decoding** — **Y/C comb** as a notch trap (with the dot crawl and
rainbows that come with it) or a proper 2- or 3-line comb. **Chroma bandwidth**
opened past about 1.5 MHz lets luma in, so a greyscale zone plate decodes in
full colour. **Tint** rotates the demodulator's reference; **demod axis** off
90° shears the colour plane rather than rotating it, so some hues survive and
others don't. **Burst lock** against a bent reference crystal sweeps hue round
the wheel. The **colour killer** drops colour in patches on weak signals, and
**chroma AGC lag** makes it answer tens of lines late, so colour blooms back
after a dropout instead of snapping.

## Screen

**The beam** — spot size and **bloom** that grows with drive, so scan lines show
in the shadows and close up in the highlights. Plus **convergence error**
fringing toward the corners, a **blanking strobe** that lets the beam through
only in flashes, and **scan velocity modulation**, the sharpness trick that
moves light across an edge rather than adding it.

**The phosphor** — **grain** fixed on the glass, selectable **primaries** (sRGB,
P22/SMPTE-C, the wide 1953 set, long-persistence green), and **persistence**
that decays second-order rather than exponentially, so a trail is a bright front
over a long faint tail that goes green as red and blue die first. **Trail
scatter** spreads held light sideways. **Purity** is a patch of mask left
magnetised by a speaker parked too close — a triad is three dots 120° apart, so
one nudge over-excites one and starves another, and the stain turns hue across
itself while a rolling picture travels through it.

The **magnifier** goes right up against the glass, so scan lines, grain, triads
and beam bleed all magnify with the picture. **Slow motion** steps the whole rig
at a fraction of display rate; at 0 the frame freezes.

## Audio-reactive

Audio patched into the electronics at one sample per scan line. It drives the
faults above rather than adding new ones: bass into **vertical hold** so the
frame lurches on the beat, level into **horizontal hold** so it skews and tears,
bass into **HV sag** so the scan smacks inward, the waveform straight into
**deflection** as an oscilloscope trace, and the waveform into the demodulator's
reference — which turns the tint 15,734 times a second, and since the reference
lives in the receiver, the bands stay on the glass while a rolling picture
slides through them.

## The rig

Everything built around the signal path.

- **Modulation** — any control can run on an LFO, random walk, smoothed noise,
  sample-and-hold, a Lorenz attractor, audio level or transients, or a one-shot
  envelope. Depth is a fraction of that control's range, so the slider stays the
  centre of the motion and a preset still holds the look. Rates lock to a tapped
  BPM or incoming MIDI clock. **Stabs** flip the whole board to clean for a few
  tens of milliseconds at a time.
- **MIDI** — any controller that sends CC, with learn, auto-map and soft
  takeover. See [MIDI.md](MIDI.md).
- **Presets and saves** — presets are also faders you can drag partway in.
  **This look** shows what you've moved as editable sliders. Random look and
  random nudge, morph between states over seconds, full undo/redo, and saved
  profiles behind a sign-in with the first nine on the number keys.
- **Sharing** — the whole board mirrors to the URL, source clip and cue points
  included, so a link is a patch rather than a preset name.
- **Capture** — stills and webm recording, or pop the controls into a second
  window and point OBS at the picture.
- **Interface** — the chain map at the head of the sidebar, a filter box and
  command palette that search help text, signal taps (composite, luma, chroma
  energy, burst state, an IRE scope, a vectorscope), and a mobile layout.
- **Platform** — WebGPU, fully client-side, with a render scale independent of
  display resolution and a frame-rate lock for a steady cadence.

---

[User guide](USER-GUIDE.md) for how to drive it.
[How it works](HOW-IT-WORKS.md) for the code.
