# User guide

The rest of the app, once [Getting started](GETTING-STARTED.md) has you rolling
presets.

## Presets and looks

Click a preset and the board jumps to it. Drag it sideways and it goes in part
of the way, stacking onto what's already there.

- **This look** lists everything you're off stock on, as real sliders. Drag one
  and you're editing the preset; **↺** puts one piece back.
- **clean** resets, and holding `c` previews the clean signal.
- **random look** stacks a few presets into something new. **random nudge**
  keeps your look and jogs everything a little — `shift` for wilder, `alt` for
  gentler. Most of the good accidents come from here.
- **morph** sets how long a new look takes to arrive, from a frame to 8s. Rolls
  chain, so hitting random look every few seconds wanders continuously.
- **undo** (`ctrl+z`) steps back through all of it.

## Sources

Each source is picked at the head of its own stage: **A** on SOURCE A, **B** on
SOURCE B, sound on SOUND.

- **A** takes bars, sweep, snow, the bundled photo, a file, or a webcam — which
  is also how an RCA capture dongle gets real gear in here.
- **Clips…** is a shelf of files you've opened before, folders included.
  **Public archives** rolls one out of Wikimedia Commons or archive.org, and
  **Browse…** searches both with a thumbnail grid.
- **Video synth** is two oscillators and a colorizer with no input. Frequency is
  the whole knob: on a multiple of line rate you get standing bars, a few hertz
  off they lean and creep, at 3.58 MHz it lands on the subcarrier and comes back
  as flat colour.
- **Teletype…** prints what you type onto a dot-matrix card, and **draw** paints
  on the same page. The dither shades are worth a try — a dither is exactly what
  dot crawl and chroma bleed feed on.
- **B** is a second source, deliberately not genlocked, so it beats and tears
  against A. Its controls are in **Mix**.
- **♪** is audio in, and does nothing until you turn up a knob in **Sound**.

Anything with a timeline gets a **cue** button: press to mark, press again to
loop, a third time to drop it. **⇤** stabs back to the cue without waiting for
the lap, which is a stutter you play by hand. `i` and `o` do the same from the
keyboard, `shift` puts them on B.

## Working down the chain

![The app window, the chain map at the head of the sidebar boxed in red](img/chain.jpg)

The map at the top of the sidebar is the whole signal path, and every box on it
is a button. Amber marks a stage you've moved something in. The three wires
arcing over the trunk are the feedback loops — camera, mixer and tape — and each
is its own button.

**DECK** and **MODULATION** sit apart, below the chain, because they patch into
the controls rather than the signal. MODULATION is the hand you set running and
leave. DECK is the hand that's on it now: transitions, both tape transports, the
tracking knob, the hold that stops the frame dead — gathered by the gesture that
moves them rather than by where the fault happens, so a take is one surface
instead of four stages.

Inside a stage: **• 10** counts what you've moved, amber means off stock, **↺**
reverts, **⋮** is the wiring (pin, start an LFO, learn a MIDI knob), and
**"inert — needs …"** means another control gates this one.

![The app window with a slider's help card open, boxed in red](img/slider-help.jpg)

**?** on any slider explains the fault it models rather than what you'll see.
The look is emergent, so knowing the cause is what tells you how two controls
will combine.

The loops are the exception to working left to right: they take the picture off
the end and put it back at the front, so they compound whatever else is going
on. Here's a camera aimed a hair off-axis from its monitor, over a tape that's
dropping out underneath:

<video
  controls muted loop playsinline
  poster="img/clip-feedback-poster.jpg"
  src="https://cmdcolinphotos.s3.amazonaws.com/phosphene/clip-feedback.mp4"></video>

## Finding a control

The filter box narrows the panel and `ctrl+k` opens a palette over presets,
controls and actions at once. Both search the help text, so you can hunt down an
artifact without knowing which knob makes it.

## Making it move

**∿ on any control row** sets that control wobbling — LFO, random walk, noise,
sample-and-hold, a Lorenz attractor, the audio level or its hits, or a one-shot
envelope you strike by hand or from a MIDI note. Depth is a fraction of that
control's own range and the slider stays put, since it's the centre the motion
happens around. That's why a preset or a link still holds the look.

Once anything is moving, a **motion** strip appears with one amount over every
routing and a freeze. At the top of **MODULATION** is the tempo: type a BPM or
tap it in, then lock any rate to it. MIDI clock takes over whenever something is
sending it — see [MIDI.md](MIDI.md).

**stabs** flip the whole board back to clean for a few tens of milliseconds at a
time, so the look gets poked into a clean picture rather than running flat out.
Phosphor, the loops and the tape bin keep running through the flip, so a stab
leaves a trail behind it.

**Sound** hangs off Receiver, because that's where audio is patched in. Bass
lurches the frame, level tears line hold. Pick something under **♪** first or
the box opens onto nothing.

## Keeping what you find

**saved** is your library, kept on your account, so it needs a sign-in.
`ctrl/⌘+S` saves, and the first nine sit on the number keys — `1–9` recalls,
`shift+1–9` overwrites.

A recall brings back the controls and the motion and leaves your input alone.
**⧉** copies a link carrying both, source clip included. `s` saves a still, `r`
records a clip.

## Looking closer

Drag a box on the picture to zoom, double-click to reset. The magnifier is part
of the display, so it magnifies the lit tube face along with the picture: scan
lines, mask and all.

To watch the signal instead, **signal tap** in the View group steps through the
composite waveform, luma, chroma energy, burst state, the scope, and back.
Whichever tap is live is named on the ☰ button, so a screen full of waveform
never looks like a fault.

**scope** is the one to reach for first. It lays a single line out left to
right, sync tip and burst included, against an IRE graticule. Sync depth, setup,
the AGC pumping and a burst that has stopped being 40 IRE are all readable there
rather than inferred. Turning a knob and watching the waveform change shape is
the fastest way to understand it.

## Getting it out

The ☰ menu has stills, recording, fullscreen, and **pop out controls**, which
moves the panel to a second window and gives the picture the whole screen. For
anything you care about, point OBS at the picture window.

## Keyboard

| Key                     | Does                                                |
| ----------------------- | --------------------------------------------------- |
| `ctrl/⌘+k`              | command palette                                     |
| `c` (hold)              | preview the clean signal                            |
| `r` / `s`               | record a clip / save a still                        |
| `f`                     | fullscreen                                          |
| `i`                     | cue a clip · press again to loop from there         |
| `o`                     | stab back to the cue · `+shift` for source B        |
| `1`–`9` / `shift+1`–`9` | recall / overwrite one of your first nine saves     |
| `ctrl/⌘+z`              | step back a look · `+shift` steps forward again     |
| `esc`                   | close a dialog, cancel a MIDI arm, clear the filter |

---

[Effects & features](EFFECTS.md) — everything it can break ·
[How it works](HOW-IT-WORKS.md) — the code ·
[MIDI](MIDI.md) — setting up a controller
