# Choosing an analog-video tool

Several good tools make video look like it went through composite, tape and a
CRT. They mostly solve the same premise for different jobs — this page is for
finding the right one quickly, including when that is not this one.

All free and open source unless noted.

| If you want to…                                              | Use                                            |
| ------------------------------------------------------------ | ---------------------------------------------- |
| Put this look on a clip in your edit                         | **ntsc-rs** (AE / Premiere / OpenFX / Resolve) |
| Render a file at above-NTSC resolution                       | **ntsc-rs**                                    |
| Play the signal live — knobs, MIDI, audio-reactive, feedback | **ntsc.js** (this project)                     |
| Try it in ten seconds with nothing installed                 | **ntsc.js** — [live demo][demo]                |
| Composite artifacts inside a game emulator                   | **Blargg's `nes_ntsc` / `snes_ntsc`**          |
| A CRT _screen_ look over anything                            | **RetroArch CRT shaders**                      |
| The reference implementation to read or build on             | **composite-video-simulator**                  |
| Real analog hardware, no simulation                          | **LZX Industries** and similar (commercial)    |

[demo]: https://cmdcolin.github.io/ntsc.js/

## The tools

- **[ntsc-rs](https://github.com/ntsc-rs/ntsc-rs)** — the closest relative, and
  the one to reach for when the work lives in a timeline. Same premise (simulate
  the signal path, don't draw the look), shipped as a standalone app, a browser
  version, and AE/Premiere/OpenFX plugins, so it works in Resolve, Vegas,
  HitFilm and Natron. CPU-side Rust, multithreaded and SIMD, and **not locked to
  the NTSC raster** — two advantages this project does not have.
- **ntscQT** — the Python predecessor in the same line, and one of ntsc-rs's
  sources. Still works, slower, not real-time. Mostly of historical interest.
- **[composite-video-simulator](https://github.com/joncampbell123/composite-video-simulator)**
  — the C reference codec much of this lineage traces back to, including this
  project's. Something to read rather than an app to use.
- **Blargg's `nes_ntsc` / `snes_ntsc` and RetroArch CRT shaders** — a related
  but distinct problem. Blargg's filters model composite artifacts for one
  console's output, fast and accurate for that narrow case; the RetroArch
  shaders (`crt-royale`, `crt-guest-advanced`) model the **display**: mask,
  scanlines, phosphor, geometry, glow. For games on a period TV, that pairing is
  the mature answer.
- **Hardware** — LZX Industries and the Eurorack video scene make the real
  thing. Nothing in software substitutes for it; this project reaches in its
  direction from the opposite side. Priced like hardware.

## Where ntsc.js fits

It is a **live instrument** rather than a file processor, and that follows from
how it is built: the whole signal path stays resident on the GPU as compute
shaders, so changing a control is a uniform-buffer write rather than a
re-render. What that budget buys:

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
