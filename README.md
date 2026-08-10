# ntsc.js

WebGPU compute shader based analog video system with video mixing, effects, and
glitches galore.

### [**Try it live →**](https://cmdcolin.github.io/ntsc.js/)

Requires a WebGPU-enabled browser.

## Screenshot

[![A photo dubbed to VHS: rainbow chroma noise banding across the frame, torn lines, and the picture bending through a tracking band](img/screenshot.jpg)](https://cmdcolinphotos.s3.amazonaws.com/phosphene/demo-v2.mp4)

## Features

- Settings for every stage: wiring, camera, mixer, tape/RF, and the screen
- Input from image, video, webcam, screen share, or built-in generators; mix
  multiple sources, dirty video included
- Three feedback loops: camera-at-monitor, mixer patched into itself, and a tape
  loop with up to four playback heads
- Presets, save slots, a randomize button, undo all the way back
- Any slider can run on an LFO, random walk, sample-and-hold, Lorenz attractor,
  or live audio
- MIDI: learn one knob or automap a whole device, no jumps, clock-locked rates
- Record to webm or PNG, or pop controls into a second window and capture with
  OBS at full res
- Whole state fits in a URL, so a link carries the look
- Works on a phone: portrait stacks the picture on top, landscape goes sidebar,
  knobs sized for touch

Full list, and the hardware fault behind every effect:
[docs/EFFECTS.md](docs/EFFECTS.md).

## Run

```
pnpm install
pnpm dev
```

Running locally adds a **YouTube…** source the hosted demo doesn't have.

## Docs

### [Read the docs site →](https://cmdcolin.github.io/ntsc.js/guide/)

Start with [getting started](docs/GETTING-STARTED.md), then the
[user guide](docs/USER-GUIDE.md). Also there: the effects reference, how the
signal path works, MIDI setup, and how this compares to other analog-video tools
— same pages as markdown under [docs/](docs/).

---

Note: this project is extensively vibecoded. The initial signal-path design was
one-shotted by [Fable](https://claude.com/), which nailed the "signal level"
idea behind the glitches.
