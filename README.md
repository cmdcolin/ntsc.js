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

- Around 150 knobs, and none of them draw an artifact — they break something in
  the signal path and let the artifact happen. They're grouped by where in the
  chain they do the damage: [wiring](EFFECTS.md#source--wiring),
  [camera feedback](EFFECTS.md#camera-feedback),
  [mixer loop](EFFECTS.md#mixer-loop), [A/B mix](EFFECTS.md#ab-mix-source-b),
  [tape and RF](EFFECTS.md#tape--channel), [enhancer](EFFECTS.md#enhancer-bent),
  [the receiver](EFFECTS.md#receiver), [audio](EFFECTS.md#audio-reactive), and
  [the screen itself](EFFECTS.md#screen).
- Feed it color bars, a sweep, TV snow, the bundled photo, any image or video
  file, or a webcam or capture card. There's a
  [second input](EFFECTS.md#ab-mix-source-b) as well, to mix, wipe or beat
  against the first.
- Two feedback loops, and they're worth playing with:
  [a camera aimed at its own monitor](EFFECTS.md#camera-feedback), and
  [a mixer patched back into itself](EFFECTS.md#mixer-loop) down at the signal
  level.
- Forty-odd presets to start from, nine slots to stash your own, a surprise-me
  button for when you don't know what you want, and ctrl+z for when you find out
  you didn't.
- Anything can move on its own — put an LFO, a random walk, a sample-and-hold, a
  Lorenz attractor or the level of whatever's playing onto any slider.
- Plug in a mic or a track and let it
  [shove the picture around](EFFECTS.md#audio-reactive): bass into the field
  oscillator, level into line hold, the raw waveform into the deflection coils.
- Bring your own MIDI controller. It learns one control at a time or automaps a
  whole device, won't jump when a knob is out of position, and locks rate
  controls to incoming clock.
- Record to webm, save a png, or pop the controls into a second window and give
  the picture the whole screen.
- Every look fits in a URL, so a link is a patch you can hand to someone.
- Scopes, if you want to look at the waveform you're wrecking — plus render
  scale, FPS, a map of the chain, and per-pass GPU timings.

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
