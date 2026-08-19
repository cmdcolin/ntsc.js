# Choosing an analog-video tool

Several good tools make video look like it went through composite, tape and a
CRT, and they mostly differ in the job they are for. This page points at the
right one quickly, including when that is not this one.

- That look on a clip in your edit → **ntsc-rs**
- Four sources, a mixer, and every kind of glitch → **BENDR**
- Games on a period TV → **Blargg's filters and the RetroArch CRT shaders**
- One signal, bent live, its faults interacting → **ntsc.js**, this one
- A real tape, decoded rather than simulated → **vhs-decode**

## The tools

### ntsc-rs

[ntsc-rs](https://github.com/ntsc-rs/ntsc-rs) has a very similar premise —
simulate the path, don't draw the look. It ships standalone, in a browser, and
as AE / Premiere / OpenFX plugins, so Resolve, Vegas, HitFilm and Natron all
reach it. Multithreaded, SIMD-accelerated Rust on the CPU, and it runs in real
time well above NTSC resolution — two advantages this project does not have. If
what you want is this look on a clip in an edit, that is the one to reach for:
ntsc.js has no plugin and is not going to have one ([FAQ.md](FAQ.md)).

### BENDR

[BENDR](https://github.com/clickysteve/bendr) is the closest neighbour — another
live browser tool, and a much broader one: four channels, a reorderable chain on
each, three mix buses, keys and wipes, all in one self-contained HTML file that
a phone will run. It works on the picture. Chroma bleed, rainbow fringing, dot
crawl and ringing are each an effect with its own slider, and the sync faults
are drawn on top, line by line. Nothing has to be a signal for that to look
right, which is what lets the stages reorder freely.

ntsc.js has no dot-crawl slider, because it builds the signal instead. A picture
becomes an actual composite waveform — sync pulses, colour burst, colour carried
on the subcarrier the way a real encoder carries it. The model damages that
waveform, and a model of a TV has to lock to it and decode it back. Dot crawl
and rainbow fringing are then leftovers of a decoder that could not separate
colour from brightness cleanly: nobody draws them, and they change whenever
anything upstream does. That is the trade — far narrower, and every fault lands
on the same signal, so they affect each other without being wired together.

### ntscQT

The Python predecessor, and one of ntsc-rs's sources. Slower and not real-time,
so mostly of historical interest now.

### composite-video-simulator

[The C reference](https://github.com/joncampbell123/composite-video-simulator)
much of this lineage traces back to, this project included. Something to read
rather than an app to use.

### vhs-decode / ld-decode

[vhs-decode](https://github.com/oyvindln/vhs-decode) runs the other way. It taps
the RF straight off a working deck's head amp, captures it with a CX card or a
Domesday Duplicator, and decodes the tape in software — VHS, SVHS, U-Matic,
Betamax, Video8 and more — out to timebase-corrected luma and chroma files.
Nothing about it is synthesised, so with the tape and the hardware in hand, that
is where a real signal comes from, and where a claim made here can be checked
against one.

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

ntsc.js works best as a **live instrument** rather than an offline signal
processor, and that follows from how it is built: the signal path stays resident
on the GPU as compute shaders, so a control change is a uniform-buffer write,
not a re-render. That buys:

- **A control for every stage** of the path — wiring, tape, RF, the receiver and
  the screen
- **Three feedback loops** — a camera at its own monitor, a mixer patched into
  itself at signal level, and a tape loop with up to eight heads
- **Modulation on any slider** — LFO, random walk, sample-and-hold, Lorenz
  attractor, or live audio
- **MIDI** with automap, soft takeover, and rates locked to incoming clock
- **Audio into the signal** — bass into the field oscillator, level into line
  hold, the waveform into the deflection coils
- **Live input** — webcam (so an RCA capture dongle works), or a shared window,
  tab or display
- **A file out** — a take renders offline, faster than real time, to
  constant-framerate H.264 an editor will conform
- **No install, and a link carries the look**

### What it does not do

- **No plugin, and no timeline.** Clips line up in a rundown, not on an NLE
  timeline, and none of this becomes a plugin for somebody else's — deliberately
  ([EDITOR.md](EDITOR.md)). A rendered take carries no audio track either.
- **The raster is fixed** at 910×525 samples, 754×480 active, so a 4K source is
  sampled down to NTSC resolution.
- **A take is only reproducible from clips.** Offline renders of one take come
  out identical, but a camera, a screen share or the mic cannot be re-rendered,
  so those are real-time capture.
- **It needs a WebGPU browser** — on Linux, Firefox Nightly or Chrome.
- **The model is progressive** 525/60 rather than interlaced at field rate, the
  largest remaining authenticity gap ([ARCHITECTURE.md](ARCHITECTURE.md)).

<sub>All free and open source, except the hardware. Written from the other
projects' own documentation and source, not from benchmarks run here — nothing
above is a performance claim about anyone else's code. If something is out of
date or unfair, please open an issue.</sub>
