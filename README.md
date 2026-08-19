# ntsc.js

### Live app!

https://cmdcolin.github.io/ntsc.js/

## Screenshot

[![A photo dubbed to VHS: rainbow chroma noise banding across the frame, torn lines, and the picture bending through a tracking band](img/screenshot.jpg)](https://cmdcolinphotos.s3.amazonaws.com/phosphene/demo-v2.mp4)

## The signal path

**This is the thing to click.** The map sits at the top of the sidebar, and
nearly every control in the app is behind one of its boxes — click a stage and
that stage's controls open underneath it.

![The signal path map at the top of the app sidebar: SOURCE A and SOURCE B into MIX, then TAPE, RECEIVER and SCREEN, with camera, tape loop and mixer returns arching back over the trunk, SOUND and VIEW hanging below, and MODULATION and DECK beside them](docs/img/signal-path.png)

The boxes are in the order the picture actually travels, and that is what the app
does with it: build an NTSC composite waveform, damage the waveform, hand it to a
receiver that decodes it slightly wrong. So dot crawl, rainbows, tearing and hue
drift fall out of the mechanism rather than being painted on — and two faults
compound instead of stacking, because both are acting on the same signal. The
dashed returns are the three feedback loops: **camera** is a lens pointed at the
tube, **mixer** patches the composite waveform back in electrically, and **tape
loop** sends it round a second machine a generation older each lap.

Details in [How it works](docs/HOW-IT-WORKS.md), fault by fault in
[Effects](docs/EFFECTS.md).

## Features

- True composite signal emulation in WebGPU compute shaders. This is the headline feature!
- Dirty video mix or genlocked (clean) video mixing of two sources
- Video feedback effects including hardware mixer, camera style, and vhs tape loop
- Lots of 'faults' like loose cable, bad receiver, inverted polarity, bad ground, etc.
- Audio-reactive: feed it music and bass shakes vertical hold of the image, etc.
- All settings can be modulated (e.g. with LFO, random walk, sample and hold, etc)
- Allows using MIDI controller via WebMIDI, map different knobs to settings of interest
- Easy-to-use "randomize" buttons that morph between settings over multiple seconds
- Bleeds video into the audio channel, so you can hear the picture
- ...[much more](docs/EFFECTS.md)

## Video sources

There are two 'sources' A and B and you can mix them together like a video mixer, and you get to choose what to load into each

- NTSC color bars/Video sweep test signals
- VHS static or TV static
- MP4 videos or still-frame picture from your computer/phone
- Webcam/screenshare
- Teletype style text overlay (includes 'mspaint style' feature to draw blocky text)
- Load random video from archive.org or wiki
- Basic video synth

## Other random features

- Pops controls into a second window for a second screen or projector
- Records the video live, or render it offline
- The whole board mirrors to the URL, so a link is a patch

and it works on mobile! tested on Google Pixel with Chrome



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
