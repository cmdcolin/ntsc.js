# ntsc.js


WebGPU compute shader based analog video system with video mixing, effects, and glitches galore

**[Live demo](https://cmdcolin.github.io/ntsc.js/)** ·
**[Documentation](https://cmdcolin.github.io/ntsc.js/guide/)**

This demo REQUIRES a WebGPU-enabled browser


## Screenshot

[![A photo dubbed to VHS: rainbow chroma noise banding across the frame, torn lines, and the picture bending through a tracking band](img/screenshot.jpg)](https://cmdcolinphotos.s3.amazonaws.com/phosphene/demo-v2.mp4)

<sub>▶ **In motion:**
[watch the 7-second clip](https://cmdcolinphotos.s3.amazonaws.com/phosphene/demo-v2.mp4)
(or click the image above) · or open the
[live demo](https://cmdcolin.github.io/ntsc.js/) and load your own
footage.</sub>

## Features

- 230+ settings across wiring, camera, mixer, tape/RF, and the screen: [docs/EFFECTS.md](docs/EFFECTS.md)
- Input from image, video, or built-in color bars; mix multiple sources, dirty video included
- Two feedback loops: a camera aimed at its own monitor, and a mixer patched into itself
- Presets, save slots, a randomize button, undo all the way back
- Any slider can run on an LFO, random walk, sample-and-hold, Lorenz attractor, or live audio
- Mic or track input can drive the picture directly: bass to the oscillator, level to line hold, waveform to deflection
- MIDI: learn one knob or automap a whole device, no jumps, clock-locked rates ([MIDI.md](docs/MIDI.md))
- Record to webm or PNG, or pop controls into a second window and capture with OBS at full res
- Whole state fits in a URL, so a link carries the look
- Works on a phone: portrait stacks the picture on top, landscape goes sidebar, knobs sized for touch
- Scopes for the waveform, plus render scale, FPS, a chain map, and per-pass GPU timings

## Run

```
pnpm install
pnpm dev
```

Running locally adds a **YouTube…** source the hosted demo doesn't have:
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#youtube-source-dev-server-only).

## Docs

### [Read the docs site →](https://cmdcolin.github.io/ntsc.js/guide/)

Every figure links to the live session that produced it, so you can click
through and move the sliders yourself.

Same pages as markdown, in this repo:

- [**docs/USER-GUIDE.md**](docs/USER-GUIDE.md): a tour of what's on screen and what to touch first
- [**docs/EFFECTS.md**](docs/EFFECTS.md): every effect and the hardware fault it models
- [**docs/HOW-IT-WORKS.md**](docs/HOW-IT-WORKS.md): the signal path, pass by pass, with diagrams
- [**docs/MIDI.md**](docs/MIDI.md): setting up a controller, start to finish
- [**docs/COMPARISON.md**](docs/COMPARISON.md): the other analog-video tools, and which one to use for what

Contributor notes, repo only:

- [**docs/DEVELOPMENT.md**](docs/DEVELOPMENT.md): developer setup
- [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md): pass graph, buffer layouts, adding a control end to end

## Related / prior art

ntsc-rs, ntscQT, composite-video-simulator, Blargg's NTSC filters, RetroArch
CRT shaders, and where this project fits among them:
[docs/COMPARISON.md](docs/COMPARISON.md).

---

Note: this project is extensively vibecoded. The initial signal-path design
was one-shotted by [Fable](https://claude.com/), which nailed the
"signal level" idea behind the glitches.
