# ntsc.js

### Live app!

https://cmdcolin.github.io/ntsc.js/

## Screenshot

[![A photo dubbed to VHS: rainbow chroma noise banding across the frame, torn lines, and the picture bending through a tracking band](img/screenshot.jpg)](https://cmdcolinphotos.s3.amazonaws.com/phosphene/demo-v2.mp4)

## Features

- True composite signal emulation in WebGPU compute shaders
- Three feedback loops: camera, mixer, and VHS tape
- Dirty video mix or genlocked A/B, with wipes, ring mod, and a chroma keyer
- Huge fault range, cable faults to tape dropouts to receiver misadjustment
- Sources: webcam, screen share, video synth, teletype, Commons/archive.org
- Up to four tape/dub generations, each compounding its own noise
- Any slider can run on a modulator: LFO, random walk, Lorenz, audio, S&H
- Drives from a MIDI controller via WebMIDI, with learn and auto-map
- Randomize buttons morph between settings over N seconds
- Pops controls into a second window for a second screen or projector
- Records a take, or lines up a rundown and renders it offline
- Bleeds video into the audio channel, so you can hear the picture
- The whole board mirrors to the URL, so a link is a patch
- Works on mobile (tested on Google Pixel)
- ...[much more](docs/EFFECTS.md)

## Run

```
pnpm install
pnpm dev
```

Fun bonus: If you are running this locally, it adds a **YouTube…** source that
works with yt-dlp and lets you video mix with youtube videos on the fly.

## Docs

- [Main docs website](https://cmdcolin.github.io/ntsc.js/guide/)
- [Getting started](docs/GETTING-STARTED.md)
- [User guide](docs/USER-GUIDE.md)
- [Effects](docs/EFFECTS.md)
- [How it works](docs/HOW-IT-WORKS.md)
- [MIDI](docs/MIDI.md)
- [Comparison with other tools](docs/COMPARISON.md)

---

Note: this project is extensively vibecoded. The initial signal-path design was
one-shotted by [Fable](https://claude.com/), which nailed the "signal level"
idea behind the glitches.

This app is inspired by my old 2010s era experiments alligator clipping yellow
composite video cables together in my basement and posting tumblr gifs. 
