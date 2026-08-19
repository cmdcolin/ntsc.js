# ntsc.js

### Live app!

https://cmdcolin.github.io/ntsc.js/

## Screenshot

[![A photo dubbed to VHS: rainbow chroma noise banding across the frame, torn lines, and the picture bending through a tracking band](img/screenshot.jpg)](https://cmdcolinphotos.s3.amazonaws.com/phosphene/demo-v2.mp4)

## The signal path

**This is the thing to click.** The map sits at the top of the sidebar, and
nearly every control in the app is behind one of its boxes — click a stage and
that stage's controls open underneath it.

![The app window with the signal path map boxed in red at the head of the sidebar and enlarged over the picture: SOURCE A and SOURCE B into MIX, then TAPE, RECEIVER and SCREEN, with camera, tape loop and mixer returns arching back over the trunk, SOUND and VIEW hanging below, and MODULATION and DECK on a row of their own with no wire reaching them](docs/img/signal-path-callout.jpg)

The boxes are in the order the picture actually travels, and that is what the
app does with it: build an NTSC composite waveform, damage the waveform, hand it
to a receiver that decodes it slightly wrong. So dot crawl, rainbows, tearing
and hue drift fall out of the mechanism rather than being painted on — and two
faults compound instead of stacking, because both are acting on the same signal.
The dashed returns are the three feedback loops: **camera** is a lens pointed at
the tube, **mixer** patches the composite waveform back in electrically, and
**tape loop** sends it round a second machine a generation older each lap.

Details in [How it works](docs/HOW-IT-WORKS.md), fault by fault in
[Features](docs/FEATURES.md).

## Features

- True composite signal emulation in WebGPU compute shaders. This is the
  headline feature!
- Dirty video mix or genlocked (clean) video mixing of two sources
- Video feedback effects including hardware mixer, camera style, and vhs tape
  loop
- Lots of 'faults' like loose cable, bad receiver, inverted polarity, bad
  ground, etc.
- Audio-reactive: feed it music and bass shakes vertical hold of the image, etc.
- All settings can be modulated (e.g. with LFO, random walk, sample and hold,
  etc)
- Allows using MIDI controller via WebMIDI, map different knobs to settings of
  interest
- Easy-to-use "randomize" buttons that morph between settings over multiple
  seconds
- Bleeds video into the audio channel, so you can hear the picture
- ...[much more](docs/FEATURES.md)

## Video sources

There are two 'sources' A and B and you can mix them together like a video
mixer, and you get to choose what to load into each

- NTSC color bars/Video sweep test signals
- VHS static or TV static
- MP4 videos or still-frame picture from your computer/phone
- Webcam/screenshare
- Teletype style text overlay (includes 'mspaint style' feature to draw blocky
  text)
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

## FAQ

Short versions; the arguments behind them are in [the full FAQ](docs/FAQ.md).

### Why isn't this an After Effects / Premiere / Resolve plugin?

No plugin API speaks WebGPU — OFX and Adobe's SDK are CUDA, OpenCL and Metal —
and the feedback loops make frame N a function of every frame before it, so
scrubbing a timeline is wrong by construction. For this look on a clip in an
edit, [ntsc-rs](https://github.com/ntsc-rs/ntsc-rs) shares the premise and
already ships those plugins.

### How do I get a result into an edit then?

Open the **strip** tray along the bottom and press **⎙ render**. It writes a
constant-framerate H.264 MP4 that Resolve and Premiere conform straight off the
header. **●** records a live performance first, and ⎙ replays it into the
render.

### Can I patch it into Max/MSP, Jitter or TouchDesigner?

Most of it works now with no code: MIDI CC and clock over a virtual port, audio
in through a loopback device picked as the microphone, a Jitter render in as a
webcam through Syphon, and the picture back out through an OBS browser source.
OSC is the piece that is missing.

## Docs

- [Main docs website](https://cmdcolin.github.io/ntsc.js/guide/)
- [Getting started](docs/GETTING-STARTED.md)
- [User guide](docs/USER-GUIDE.md)
- [Features](docs/FEATURES.md)
- [Effects](docs/EFFECTS.md) — every control, generated
- [How it works](docs/HOW-IT-WORKS.md)
- [MIDI](docs/MIDI.md)
- [Comparison with other tools](docs/COMPARISON.md)
- [FAQ](docs/FAQ.md)

---

Note: this project is extensively vibecoded. The initial signal-path design was
one-shotted by [Fable](https://claude.com/), which nailed the "signal level"
idea behind the glitches.

This app is inspired by my old 2010s era experiments alligator clipping yellow
composite video cables together in my basement and posting tumblr gifs.

## Cool demos

- Camera feedback + static
  https://cmdcolin.github.io/ntsc.js/?set=chromaGain%3A1.3%2ChvSagUs%3A2.1%2ChvRing%3A0.61%2Cabl%3A0.24%2ClumaMHz%3A3.2%2ClumaPeak%3A2.4%2CnoiseIre%3A2.5%2Cagc%3A0.18%2CcolorUnderMix%3A1%2CfmOverdev%3A0.72%2CfmStreakUs%3A0.45%2CfbMix%3A0.9%2CfbGain%3A1.059%2CfbFocus%3A0%2CfbVign%3A0.73%2CfbBlack%3A0%2CfbKnee%3A0.42%2CcrtBloom%3A0.23%2CcrtZoomX%3A0.7143%2CcrtZoomY%3A0.314&mod=vFreqHz%3Asmooth%3A0.08%3A0.0049%2CfbGain%3Asmooth%3A0.24%3A0.06&src=vhs+static
