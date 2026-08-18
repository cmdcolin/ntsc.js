# Choosing an analog-video tool

Several good tools make video look like it went through composite, tape and a
CRT, and they mostly differ in the job they are for. This page points at the
right one quickly, including when that is not this one.

All free and open source unless noted.

| If you want to…                                              | Use                                            |
| ------------------------------------------------------------ | ---------------------------------------------- |
| Put this look on a clip in your edit                         | **ntsc-rs** (AE / Premiere / OpenFX / Resolve) |
| Render a file at above-NTSC resolution                       | **ntsc-rs**                                    |
| Play the signal live — knobs, MIDI, audio-reactive, feedback | **ntsc.js** (this project)                     |
| Try it in ten seconds with nothing installed                 | **ntsc.js** — [live demo][demo]                |
| Mix four channels live, and reorder the effect chain         | **BENDR**                                      |
| A wide glitch palette — pixel sort, datamosh, scan processor | **BENDR**                                      |
| Composite artifacts inside a game emulator                   | **Blargg's `nes_ntsc` / `snes_ntsc`**          |
| A CRT _screen_ look over anything                            | **RetroArch CRT shaders**                      |
| The reference implementation to read or build on             | **composite-video-simulator**                  |
| Real analog hardware, no simulation                          | **LZX Industries** and similar (commercial)    |

[demo]: https://cmdcolin.github.io/ntsc.js/

## The tools

### ntsc-rs

[ntsc-rs](https://github.com/ntsc-rs/ntsc-rs) is the closest relative, and the
one for work that lives in a timeline. Same premise — simulate the path, don't
draw the look. It ships standalone, in a browser, and as AE / Premiere / OpenFX
plugins, so Resolve, Vegas, HitFilm and Natron all reach it. Rust on the CPU,
and not locked to the NTSC raster: two advantages this project does not have.

### BENDR

[BENDR](https://github.com/clickysteve/bendr) is the other live browser
instrument, for when the job is a performance rather than a signal. Four
channels, each with its own source and effects, meet in two mix buses and a
master, and the chain reorders, so melting before the tape stage and melting
after it are different patches. The palette is wider than this project's: pixel
sort, a DCT, a datamosh on real WebCodecs encode and decode, a geometry-drawn
scan processor, a lens-and-glass model of what the picture is watched through,
scopes, an offline MP4 render — all in one HTML file that runs from `file://`
with the network off. BENDR treats the composite model as one stage among many;
ntsc.js builds the waveform first and lets the artifacts fall out. Two answers,
not a ranking.

### ntscQT

The Python predecessor, and one of ntsc-rs's sources. Slower and not real-time,
so mostly of historical interest now.

### composite-video-simulator

[The C reference](https://github.com/joncampbell123/composite-video-simulator)
much of this lineage traces back to, this project included. Something to read
rather than an app to use.

### Blargg's filters and the RetroArch CRT shaders

A related but distinct problem. `nes_ntsc` and `snes_ntsc` model composite
artifacts for one console's output, fast and accurate for that case; the
RetroArch shaders (`crt-royale`, `crt-guest-advanced`) model the display — mask,
scanlines, phosphor, geometry, glow. For games on a period TV, that pair is the
mature answer.

### Hardware

LZX Industries and the Eurorack video scene make the real thing, priced like
hardware. Nothing in software substitutes for it; this project reaches toward it
from the other side.

## Where ntsc.js fits

ntsc.js is a **live instrument** rather than a file processor, and that follows
from how it is built: the signal path stays resident on the GPU as compute
shaders, so a control change is a uniform-buffer write, not a re-render. That
buys:

- **A control for every stage** of the path — wiring, tape, RF, the receiver and
  the screen
- **Three feedback loops** — a camera at its own monitor, a mixer patched into
  itself at signal level, and a tape loop with up to four heads
- **Modulation on any slider** — LFO, random walk, sample-and-hold, Lorenz
  attractor, or live audio
- **MIDI** with automap, soft takeover, and rates locked to incoming clock
- **Audio into the signal** — bass into the field oscillator, level into line
  hold, the waveform into the deflection coils
- **Live input** — webcam (so an RCA capture dongle works), or a shared window,
  tab or display
- **No install, and a link carries the look**

### What it does not do

- **No NLE integration.** Capture the window with OBS, or record webm in-app.
- **The raster is fixed** at 910×525 samples, 754×480 active, so a 4K source is
  sampled down to NTSC resolution.
- **Recording is real-time**, not a deterministic offline render.
- **It needs a WebGPU browser** — on Linux, Firefox Nightly or Chrome.
- **The model is progressive** 525/60 rather than interlaced at field rate, the
  largest remaining authenticity gap ([ARCHITECTURE.md](ARCHITECTURE.md)).

<sub>Written from the other projects' own documentation, not from benchmarks run
here — nothing above is a performance claim about anyone else's code. If
something is out of date or unfair, please open an issue.</sub>
