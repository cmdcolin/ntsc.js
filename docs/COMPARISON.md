# Choosing an analog-video tool

There are several good tools for making video look like it went through
composite, tape and a CRT, and they are not really competing — they resolve the
same premise for different jobs. This page is here so you can find the right one
quickly, including when that is not this one.

Everything below is free and open source unless noted.

## Start here

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

### [ntsc-rs](https://github.com/ntsc-rs/ntsc-rs)

The closest relative to this project and the most capable of the file-based
tools. It shares the core premise — simulate the NTSC/VHS signal path rather
than draw the look — and it is the one to reach for when the work lives in a
timeline.

It ships as a standalone application, a browser version, and plugins for After
Effects, Premiere and OpenFX, which means it works in DaVinci Resolve (free and
Studio), Vegas, HitFilm and Natron. The processing is CPU-side Rust,
multithreaded with rayon and SIMD-accelerated, and it runs at resolutions well
above the 480i that real NTSC footage was captured at.

Two of those are advantages this project does not have and is not trying to
have: **it integrates with editing software**, and **it is not locked to the
NTSC raster**, so modern high-resolution footage keeps its resolution.

### ntscQT

The Python-based predecessor in the same line, and one of the sources ntsc-rs
draws its algorithms from. Still around and still works; slower, and not
real-time at higher resolutions. Mostly of interest now as history.

### [composite-video-simulator](https://github.com/joncampbell123/composite-video-simulator)

The C reference NTSC codec much of this lineage traces back to, including this
project's. Not an application you'd hand to an artist — it is the thing to read
when you want to know how the encode and decode actually work.

### Blargg's NTSC filters (`nes_ntsc`, `snes_ntsc`) and RetroArch CRT shaders

A related but distinct problem. Blargg's filters model composite artifacts for a
specific console's video output, very fast and very accurate for that narrow
case — this is what makes NES dithering blend into extra colours the way it did
on a real TV. The RetroArch CRT shaders (`crt-royale`, `crt-guest-advanced`)
mostly model the **display**: shadow mask, scanlines, phosphor, geometry, glow.
If your source is a game and you want it to look right on a period television,
that pairing is the mature answer.

### Hardware

LZX Industries and the surrounding Eurorack video-synthesis scene make the real
thing: analog video hardware you patch. Nothing in software is a substitute for
it, and this project is best understood as reaching in its direction from the
opposite side. It is priced like hardware.

## Where ntsc.js fits

This project is a **live instrument** rather than a file processor, and that is
a consequence of how it is built rather than a marketing position.

The entire signal path runs as WebGPU compute shaders — encode to composite,
damage it through tape and RF, then decode it with a receiver model that has to
find sync in whatever it is handed. Because those passes stay resident on the
GPU, changing a control is a uniform-buffer write rather than a re-render. That
budget is what the rest of the app is built on:

- **230+ controls** across wiring, tape, RF, the receiver and the screen
- **Two feedback loops** — a camera aimed at its own monitor, and a mixer
  patched back into itself at the signal level
- **Modulation on any slider** — LFO, random walk, sample-and-hold, Lorenz
  attractor, or the level of whatever audio is playing
- **MIDI** with per-device automap, pickup, and rate controls locked to incoming
  clock
- **Audio into the signal** — bass into the field oscillator, level into line
  hold, the waveform into the deflection coils
- **Live input** — webcam (so an RCA capture dongle works), or a shared window,
  tab or display, so a game or a TouchDesigner patch can be the source
- **No install, and a link carries the look** — the whole state fits in a URL

### What it does not do

Stated plainly, because these are the cases where another tool is the right
answer:

- **No NLE integration.** There is no plugin. Capture the window with OBS, or
  record to webm in-app.
- **The raster is fixed** at 910×525 samples with a 754×480 active picture, so a
  4K source is sampled down to NTSC resolution. That is faithful, and it is also
  a real limitation if you want your delivery resolution back.
- **Recording is real-time**, not a deterministic offline render, so a capture
  is subject to whatever the machine was doing at the time.
- **It needs a WebGPU browser**, and on Linux that currently means Firefox
  Nightly or Chrome.
- **The model is progressive** 525/60 rather than interlaced at field rate — the
  largest remaining authenticity gap, noted in
  [ARCHITECTURE.md](ARCHITECTURE.md).

## A note on this page

Comparisons written by one project about another go stale, and this one is
written from the outside — from the other projects' own documentation, not from
benchmarks run here. Nothing on this page is a performance claim about anyone
else's code. If something is out of date or unfair, please open an issue; being
wrong about a neighbouring project is worth fixing quickly.
