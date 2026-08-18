# ntsc.js


### Live app!

https://cmdcolin.github.io/ntsc.js/

## Screenshot


[![A photo dubbed to VHS: rainbow chroma noise banding across the frame, torn lines, and the picture bending through a tracking band](img/screenshot.jpg)](https://cmdcolinphotos.s3.amazonaws.com/phosphene/demo-v2.mp4)

## Features

- True composite signal emulation using WebGPU compute shaders. Requires WebGPU!
- Multiple types of feedback loops including mixer-patched-into-itself feedback, point-camera-at-monitor feedback, and vhs tape loop
- Allows dirty or genlocked video mixing of two sources, with wipes and a chroma keyer.
- Insane number of effects, and slider can run on a modulator (LFO, random walk, etc).
- Allows connection to MIDI controller with WebMIDI to twist different knobs (chrome only, firefox nightly too)
- Randomizer buttons that morph between settings over N seconds
- Record to webm or screenshot stills
- Popout the controls into a second window and cast the other screen in a projector or OBS screen recorder
- The whole board fits in a URL, so a link is a patch
- Let's the video static bleed into the audio, just like the olden days
- Insanely, it works on a phone. Tested on Android Pixel

## Run

```
pnpm install
pnpm dev
```

Fun bonus: If you are running this locally, it adds a **YouTube…** source that works with yt-dlp and lets you video mix with youtube videos on the fly. 

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
