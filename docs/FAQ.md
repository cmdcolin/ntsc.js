# FAQ

The questions that keep arriving, all versions of the same one: why is this a
whole app instead of something that plugs into what you already run. The longer
arguments live in [COMPARISON.md](COMPARISON.md) and [EDITOR.md](EDITOR.md);
this page is the short answer plus what to do instead.

## Why isn't this a plugin for After Effects, Premiere or Resolve?

Investigated and declined — the full findings are in
[EDITOR.md](EDITOR.md#what-this-is-not-an-nle-plugin). Three of them, in the
order of how fast each one kills it.

**There is no "the shaders" to port.** The WGSL is about a third of the
simulator. Against it sit `src/core/signal/`'s per-frame CPU state — the line, mix,
tape, RF, synth and audio state, and a FIR bank rebuilt whenever one of the
filter controls moves — plus `src/core/gpu/`'s pass graph, uniform packing and
buffers that hold state rather than scratch. Lifting the shaders alone lifts
nothing that runs.

**No plugin API speaks WebGPU.** OFX 1.5's GPU rendering suite is CUDA, OpenCL
and Metal, and Adobe's SDK is the same family. wgpu/naga does mean the WGSL
survives a _native_ port unchanged, which is the one genuinely portable asset
here — but inside a CUDA or Metal host it makes you a wgpu island paying a
full-frame upload and readback every frame, in both directions.

**The host's frame model fights the feedback loops.** The tape ring, the
phosphor persistence, the PLL's lock age, the AGC and the two servos all make
frame N a function of every frame before it. Under a timeline that means
scrubbing is wrong, playing from the middle is wrong, and a viewer means nothing
until it has rendered from the top. Those loops are what
[COMPARISON.md](COMPARISON.md) names as the thing distinguishing this project
from its neighbours, and they are exactly the parts that cannot survive being a
plugin.

The slot is also taken, by a tool built for it.
[ntsc-rs](https://github.com/ntsc-rs/ntsc-rs) shares the premise, runs
multithreaded SIMD Rust on the CPU, is not locked to the NTSC raster, and
already ships After Effects, Premiere and OpenFX builds. For this look on a clip
in an edit, reach for that one.

## Then how do I get a result into an edit?

Render a file, which the app does today. Open the **strip** tray along the
bottom and press **⎙ render**: the take walks on a virtual clock rather than
wall time, and what lands is a constant-framerate H.264 MP4 that Resolve and
Premiere conform straight off the header — no plugin, and no WebM that Resolve
declines to import at all.

The take can be a performance. **●** records every move a hand makes against the
frame it happened on — sliders, presets, a controller knob, a morph — and **⎙**
replays that into the render, so a run made at whatever rate the tab managed
comes back as a file at a rate that never drifts.

## Can I patch it into Max/MSP, Jitter, TouchDesigner or VJ software?

Most of this works now, with no code on either side:

- **Control in** — MIDI CC and MIDI clock over a virtual port (IAC bus,
  loopMIDI). Every slider learns a CC; see [MIDI.md](MIDI.md).
- **Audio in** — a loopback device (BlackHole, or your OS's equivalent) picked
  as the microphone under **Audio**, which reaches the audio-driven bend, load
  and level controls. A patch's output then bends the signal directly.
- **Video in** — a Jitter or TouchDesigner render arrives as a webcam source
  through a Syphon → virtual-camera bridge.
- **Video out** — point an OBS browser source at the page.

What is missing is the part that would make it feel like a module rather than a
coincidence, and the first piece is **OSC through a small local WebSocket
bridge** — browsers cannot speak UDP, so it needs a node process in the middle.
Worth it because controls are already a flat named record behind one write path:
a patch could address `/hHold`, `/scDetuneKHz` or `/bendUs` by name, with float
precision and none of the 128-control CC ceiling. The same channel run backwards
would let a patch's UI track the app. _Patching into other apps_ in
[IDEAS.md](IDEAS.md) carries the shape of both, along with NDI or WebRTC output
for anyone who needs the picture back in Jitter without the OBS round trip.

Going the other way — hosting the app _inside_ a patch — is the one arrangement
to rule out. Max's `jweb` embeds a web view but is unlikely to expose WebGPU.
This wants to be a separate app you route into.
