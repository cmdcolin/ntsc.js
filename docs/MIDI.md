# Using a MIDI controller

There are more sliders in this thing than you want to drag one at a time. A
cheap box of knobs gets you both hands and stops you looking at the panel.

Short version: **advanced settings** → **enable MIDI**, then **auto-map** or
**learn in order** in the sidebar's **MIDI** section.

## What you need

Any USB controller that sends **CC messages** — a MIDI Fighter Twister, a
nanoKONTROL, a Launch Control, the knob row on a keyboard. Plug it in before or
after loading the page.

You also need a browser with **Web MIDI** — Chrome or Edge.

## Turning it on

1. Open the **☰** menu → **advanced settings** (or `ctrl+k` → "advanced
   settings").
2. Under **MIDI control**, click **enable MIDI** and allow the browser prompt.

A **MIDI** section appears in the control panel. You only do this once — the app
reconnects on later visits.

If you get **Web MIDI not supported**, try Chrome or Edge. If you get **access
denied**, click **retry** or clear the site permission and reload.

## Binding one knob

Each slider now has a **⚟** button. Click it, wiggle the knob, done — the button
reads **CC7** and the pairing shows in the MIDI panel. `Esc` cancels.

- **×** in the MIDI panel unbinds. Clicking **CC7** re-learns instead, so you
  can move a control to another knob without unbinding first.
- One knob drives one thing. Bind a knob that was already driving something and
  it quietly moves.

## Two knobs that aren't sliders

- **The motion amount** — the strip above the filter box scales every modulation
  routing at once, and carries the same **⚟**. One hand takes the board from
  still to swimming.
- **A preset's weight** — every preset is a fader, so a preset on a knob is a
  macro that moves everything that preset touches. Use the picker at the bottom
  of the MIDI panel: choose the preset, click **⚟ preset mix**, move a knob.
  Weights layer, so several presets on several knobs is a small desk of looks.

Neither does soft takeover — they grab on the first message, because neither has
a track to draw a waiting mark on. A weight also resets once anything else moves
the board: the next turn starts a fresh mix from what is on screen.

## Mapping the whole device

Both buttons **wipe every binding** first, with no confirmation.

- **auto-map** is for a MIDI Fighter Twister: it assigns the first 64 controls —
  motion amount first, then look-makers in signal-path order — to CC 0–63 on
  channel 1, across all four banks.
- **learn in order** works with anything: sweep your knobs one at a time and
  each takes the next control down the same list. **stop learning** or `Esc`
  keeps what you have bound.

Fine tweaks rank after the look-makers, and the magnifier ranks last. Bindings
are stored per control, so re-ranking never moves one you already have. In a
sweep, a knob bumped by accident is consumed and there is no going back a step.

There are more controls than most controllers have knobs, so some stay
mouse-only. The panel says how many are left over.

## "I turn the knob and nothing happens"

That is **soft takeover**. A physical knob at 3 o'clock doesn't know the value
is at 10 o'clock, so it stays inert until you sweep it **through** the current
value — then it catches and tracks normally. An **amber mark** on the track
shows where the knob is waiting.

Knobs let go and need re-catching whenever a value is set from elsewhere:
loading a preset, recalling a save, undoing, randomising. Expect a row of amber
marks after a preset load.

## Locking a rate to the beat

The tempo comes from **MIDI clock** if anything is sending it (the panel shows
**clock ♩ = 128.0 BPM**), otherwise from the top of the **MODULATION** box on
the signal-path map — type it or **tap** four times. Clock wins while it runs;
the hand-set number waits underneath.

Three things can follow the beat, each through the **♩** in its own **⋮** menu,
cycling 1/1 → 1/16 → off:

- **sweep** — the wipe auto-sweep. Tops out at 2 Hz, so past ~120 BPM the fast
  divisions all pin.
- **line offset** — source B's line rate.
- **any modulation slot's rate**. Tops out at 10 Hz, which 1/16 reaches at 150
  BPM.

While locked the rate ignores its own value, and the Hz you dialled in comes
back when you unlock. Asking for a lock with no tempo at all sets one at 120
BPM. The app only listens for clock; it never sends it.

## What sticks around

Bindings, the hand-set tempo and the clock locks on **sweep** and **line
offset** are saved in this browser. They are **not** in presets, saved looks or
the URL — a link carries the look, not your knob layout, and there is no way to
export a mapping.

A modulation slot's lock is the exception: it rides along on the link, because
"this wobbles on eighth notes" is part of the patch.

A preset weight is bound by name, so a renamed or dropped preset discards that
one binding on the next load.

## What isn't supported

- **CC only** — notes, pads, pitch bend, program change and aftertouch do
  nothing.
- **Absolute knobs only** — endless encoders in relative mode will jump around.
- **No LED feedback** — nothing is sent back to the device.
- **No device picker** — everything plugged in drives the app at once.
- **No per-knob range, invert or curve.**

## When it seems broken

| What you see                        | What's going on                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| No MIDI section in the sidebar      | Not enabled yet, or there's text in the panel's filter box — clear it         |
| Knob does nothing, amber mark shown | Soft takeover: sweep the knob across the on-screen value to catch it          |
| Everything went dead after a preset | Same thing; a preset load drops every knob's catch                            |
| Two controls move together          | Both bound to the same CC — unbind one with **×** and re-learn it             |
| Value jumps in steps                | Coarse-stepped slider; 128 knob positions land on fewer distinct values       |
| Bindings vanished                   | **auto-map** or **learn in order** clears them all before it starts           |
| Tempo says "no signal"              | Nothing is sending clock; ticks are what it counts, start/continue is ignored |
