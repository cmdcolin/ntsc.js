# Features

What the app can do, organized by area rather than by commit. For the hardware
faults themselves — every slider and the mechanism it models — see
[EFFECTS.md](EFFECTS.md). This page is the inventory around that: sources,
mixing, feedback, modulation, presets, capture, and the UI built to drive
~234 controls without it becoming a spreadsheet.

## Signal path

- A real NTSC encode/decode, not a filter over the picture: source → per-input
  feed faults → mix → three feedback loops (camera, mixer, tape) → tape/channel
  → bent enhancer → receiver → screen. See
  [HOW-IT-WORKS.md](HOW-IT-WORKS.md) for the pass-by-pass diagram and
  [EFFECTS.md](EFFECTS.md) for every fault along it.
- Runs as WebGPU compute shaders, per-frame, at whatever render scale you pick
  — resolution trades against frame rate live.

## Sources

- **Source A / Source B**, each the same rig twice: its own deck, cable and
  controls, mixed dirty (non-genlocked, beating and tearing) or genlocked into
  a clean switcher dissolve.
- Inputs: a still image, a video file, webcam (including a USB/RCA capture
  dongle), screen/window/tab share, TV-static and VHS-static noise generators,
  color bars, a two-oscillator **video synth** with no input at all, and a
  **teletype** card you type or draw onto a 40×24 dot-matrix page.
- **Clip shelf** — files and whole folders you've opened before, kept as a
  list and replayable into either deck without a fresh OS file dialog;
  reconnects by name after reload where the browser can't hold a folder handle
  open.
- **Public archives** — Wikimedia Commons and archive.org as sources in their
  own right, not just links to them:
  - **Random Commons / Random archive.org** — roll a file out of a curated
    pool; click the caption to roll again.
  - **Browse…** — search both archives at once with a ranked-thumbnail grid,
    including duration for clips before they download.
  - Rolled or browsed clips can be **★ kept** on the shelf (by reference, not
    a copy) and cached locally so a second view is instant and survives a
    reload; oldest evicted first out of a bounded cache.
- **Cue / loop** — mark a point, mark a second to loop between them, stab back
  to the cue on a keystroke; both decks loop independently, and the app
  measures and reports how expensive a given loop's jump-back is
  (`scripts/loopseek.mjs`).
- YouTube URLs as a source, via a `yt-dlp` dev-server middleware — local only,
  the hosted build has no server to run it.
- Declarative URL loading (`?iurl`, `?iurlb`, `?vurl`) and bundled sample
  clips/images for zero-setup demos.

## Mixing (source B)

- Dirty sum (free-running B beating against A) or genlock (B re-encoded onto
  A's raster).
- Wipes (horizontal, vertical, box, diamond, soft-edged, auto-sweeping),
  positionable/resizable **picture-in-picture** inset with matte border and
  luma key, and **chroma key** with hue/angle/clip/gain and spill kill.
- B-bus proc amp: hue, gain, invert; ring modulation between the two
  composites; independent line offset, subcarrier detune and frame roll.
- Direct-manipulation miniatures for placing the PiP inset and dragging the
  wipe boundary, instead of dialing in coordinates.

## Feedback loops

Three independent loops, each a stage of its own on the chain map rather than
something the signal merely passes through:

- **Camera feedback** — a simulated camera re-shooting the tube's own face:
  zoom/rotate/shift framing, defocus and vignette, black-cut and s-curve
  compression, auto-iris hunting, and a modeled CRT faceplate (beam cutoff,
  gun gamma, bloom, halation keyed off beam current) as what the camera
  actually photographs.
- **Mixer loop** — the composite waveform patched back into its own input,
  carrying color around with it: gain/delay, a timebase-pull mode where the
  picture itself displaces the delay line, ring modulation against the live
  program, soft-clipping rails, vertical offset, luma keying, strobe/trails,
  and a resonant "bent enhancer in the loop" mode that self-oscillates.
- **Tape loop** — a second deck threaded with a physical loop: up to four
  playback heads at adjustable spacing around a record head, so a lap is a
  rhythm; transport (forward/reverse/stopped/shuttle/scrub), capstan wander,
  generation loss, oxide wear, splice bump, and colour framing all modeled as
  what tape actually does to a loop rather than as a delay-line echo.

## Modulation & audio-reactivity

- Any control can run on an **LFO**, random walk, sample-and-hold, Lorenz
  attractor, or the live audio envelope — patched from the control's own row,
  with depth as a fraction of that control's range so the slider stays the
  center of the motion.
- A **Modulation** panel lists every active routing, how many slots remain,
  and jumps to the control it drives; a **motion strip** shows a global amount
  and a freeze.
- **Tempo**: type a BPM or tap it in; any rate can lock to 1/1–1/16 of it.
  MIDI clock takes over the tempo automatically when a controller sends it.
- **Audio-reactive routes into the hardware model itself**, not a generic
  "audio makes it wobble": bass into vertical hold (the field oscillator
  genuinely detunes), level into horizontal hold, bass into HV sag, the
  waveform drawn into deflection or into the color demodulator's reference
  (turning tint at the audio rate). Audio comes from a mic, a track, or a
  clip's own soundtrack.
- **Beat-synced presets and mistune cliffs** — presets designed around what a
  locked tempo makes possible (e.g. stabbing the whole look back to clean on
  the beat).

## MIDI

- Any USB class-compliant controller sending CC messages. See
  [MIDI.md](MIDI.md) for setup.
- **Learn** one knob at a time, or **auto-map**/**learn in order** to bind a
  whole device in bulk, with fine-tier control curation so the automap
  prioritizes controls worth having on hardware first.
- No jumps: a bound knob only takes over a control once it crosses the
  control's current value, rather than snapping it on touch.
- Rates can be **clock-locked** to incoming MIDI clock, and one-shots (key,
  synthesize, strobe effects) can be fired by a note at its velocity.
- Panel shows uncaught knob positions and reconnects controllers on load.

## Presets, saves and history

- **Presets** are a grouped, described picker with hover-diff and hold-to-compare
  against clean — and each one is also a fader: drag it partway to blend it
  into whatever's already on the board instead of only jumping to it.
- **This look** shows every control the current state has moved off stock, as
  real sliders, filed under the module each came from — drag to edit in
  place, or revert one control (or a whole module) without losing the rest.
- **Random look** (stacks random presets into an unseen combination) and
  **random nudge** (jogs every current control a little) share one gesture,
  with modifier keys for wilder/gentler rolls; every stage heading has its own
  die to nudge just that stage.
- **Morph** — a look can cut instantly or travel over seconds, sweeping
  through the states between two presets rather than jumping; grabbing any
  slider or starting a new roll mid-morph stops it where it stands.
- **Undo/redo** through the whole history of look changes (`ctrl+z` /
  `ctrl+shift+z`), each step taking as long to arrive as the morph setting
  says.
- **Saved profiles**, kept in Firestore behind Google sign-in, so a saved
  board follows you to another machine. The first nine are bound to number
  keys for recall (`1`–`9`) and overwrite (`shift+1`–`9`) with no naming step
  — the live-set gesture.
- **Favorites** — pin any control so it always surfaces regardless of what
  stage it's filed under.
- **Rate and tag looks** — a lightweight feedback loop for learning which
  rolled settings are worth keeping (feeds `scripts/` tooling that scores and
  fits an affinity model over labeled looks).

## Capture and export

- Save a **still** or **record a clip** (webm) straight from the browser.
- **Pop out controls** into a second window and give the picture the whole
  screen — meant to be paired with OBS pointed at the picture window, which
  captures at full resolution and follows the magnifier, unlike the built-in
  recorder.
- Adjustable recording bitrate, and a frame-stats/FPS monitor with per-pass
  GPU timings to judge what a given render scale actually costs.

## Sharing

- The **whole board mirrors continuously to the URL** — every control,
  routing, source clip and cue point — so a link is a patch, not just a
  preset name.
- **⧉ copy link** in the UI; declarative load params (`?iurl`, `?iurlb`,
  `?preset`, `?set=`) for hand-built links and docs; `?surprise` rolls a look
  from the link while keeping the view out of the shared state.

## Interface

- **Chain map** at the head of the sidebar: the whole signal path as a small
  block diagram, every box a button into that stage's controls, with the
  three feedback loops drawn as separate runs rather than boxes on the trunk.
  An expandable **diagram** view adds the parts the miniature has no room for.
- **Filter box** and **command palette** (`ctrl/⌘+k`) both search control help
  text, not just names, so an artifact is findable without knowing its knob;
  the palette also reaches presets and actions (cue verbs, "keep this file",
  "show what is moving").
- Per-control **help cards** (hover for a line, click for the full mechanism)
  and inert-control notes that say what gates them and let you jump there.
- **Collapsible sections**, a **wide bench mode**, and a mobile layout that
  stacks the picture over the panel in portrait and moves it to a sidebar in
  landscape, with touch-sized controls throughout.
- **Signal taps** and a **scope** — step the picture itself through composite
  waveform, luma, chroma energy, decoder burst state, or a proper IRE-graticule
  scope with persistence, without leaving the main view; a **vectorscope**
  reads the colour controls instead of requiring you to guess them.
- **Magnifier** built into the display itself (so it magnifies scan lines,
  mask and grain along with the picture), zooming in past 1× and pulling back
  off the simulated set below it.
- **Device-loss recovery** — a lost/crashed WebGPU device is rebuilt rather
  than ending the session, with a visible recovery UI; see
  [ADR 0004](adr/0004-never-destroy-a-presenting-device.md) for why the app
  never calls `device.destroy()` itself.

## Platform

- WebGPU compute-shader engine, optionally run in a worker with the page as a
  thin proxy.
- `?gpu=low-power` for battery use or bisecting a driver fault; render scale
  is user-adjustable independent of display resolution.
- Works fully client-side with no backend; the only server-dependent feature
  is the local-dev YouTube source.
