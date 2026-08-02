# ntscythe

![One NTSC line of 75% color bars on a waveform monitor: horizontal sync, color burst, then the luma staircase with the chroma subcarrier riding on each bar](docs/logo.svg)

> A real-time **NTSC / VHS / composite-video glitch** simulator, running
> entirely in **WebGPU** compute shaders

**[Live demo](https://cmdcolin.github.io/ntscythe/)** — needs a WebGPU-enabled
browser.

Each frame gets encoded into a real composite video waveform, mangled like it
went through tape and RF, then decoded by an imperfect TV. Dot crawl, ringing,
hue drift, tearing, head-switch bend, dropouts — you don't draw any of that. It
comes out of the signal on its own, same as on the real gear.

## Screenshot

[![A photo dubbed to VHS inside the ntscythe app, alongside its full control panel](img/1.png)](https://cmdcolinphotos.s3.amazonaws.com/phosphene/demo-v2.mp4)

<sub>▶ **In motion:**
[watch the 7-second clip](https://cmdcolinphotos.s3.amazonaws.com/phosphene/demo-v2.mp4)
(or click the image above) · or open the
[live demo](https://cmdcolin.github.io/ntscythe/) and load your own
footage.</sub>

## Features

- ~150 controls in 18 groups, each a hardware fault rather than a drawn artifact
- Sources: bars, sweep, TV/VHS static, bundled photo, image/video file, webcam
  or capture device, YouTube (dev server only) — plus a second source to mix in
- Two feedback loops: a camera pointed at its own monitor, and a hardware-mixer
  loop in the signal
- 40+ presets, 9 scene slots, surprise-me, mutate, undo
- Modulation: LFOs, random walk, sample-and-hold, Lorenz or audio level/onset
  onto any slider
- Audio in: mic or file into field lurch, line tear, HV sag, deflection and the
  video input
- MIDI: per-control learn, whole-device automap, soft takeover, clock lock
- Record webm, save png, pop the controls out into their own window
- Shareable links that carry a whole look (`?preset=`, `?set=`, `?iurl=`, …)
- Diagnostics: scope views, render scale, FPS, chain map, per-pass GPU timings

## Run

```
pnpm install
pnpm dev
```

## Docs

- [**EFFECTS.md**](EFFECTS.md) — every effect and the hardware fault it models
- [**docs/HOW-IT-WORKS.md**](docs/HOW-IT-WORKS.md) — the signal path, pass by
  pass, with diagrams
- [**docs/DEVELOPMENT.md**](docs/DEVELOPMENT.md) — build, test, screenshot
  harness, YouTube source, URL params
- [**agent-docs/ARCHITECTURE.md**](agent-docs/ARCHITECTURE.md) — pass graph,
  buffer layouts, adding a control end to end

## Related / prior art

ntscythe sits in a small family of analog-video emulators. If you like it, also
look at:

- **[ntsc-rs](https://github.com/valadaptive/ntsc-rs)** and **ntscQT** —
  NTSC/VHS emulation for video files and OBS.
- **[composite-video-simulator](https://github.com/joncampbell123/composite-video-simulator)**
  — the C reference NTSC codec much of this lineage traces back to.
- **Blargg's NTSC filters** (`nes_ntsc` / `snes_ntsc`) and **RetroArch CRT
  shaders** (`crt-royale`, `crt-guest-advanced`) — the emulator/shader side of
  the same idea.
- Hardware roots: **Rutt–Etra** video synthesis, **no-input video feedback**,
  and time-base correctors — the gear ntscythe imitates in software.

What's different here: ntscythe models the whole signal _path_ end-to-end in
real time — encode → tape/RF damage → imperfect decode → CRT — so the artifacts
interact the way they do on real hardware instead of being independent filters.

---

Note: this project is extensively vibecoded. The initial signal-path design was
one-shotted by [Fable](https://claude.com/), which nailed the "signal level"
idea behind the glitches.
