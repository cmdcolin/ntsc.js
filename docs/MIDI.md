# Using a MIDI controller

There are about 130 sliders in this thing, and dragging them one at a time with
a mouse is the slowest possible way to play it. A cheap box of knobs fixes that:
you get both hands, you can move three things at once, and you stop looking at
the panel.

This page assumes you've never set one up before. If you know MIDI already, the
short version is: gear menu → **advanced settings** → **enable MIDI**, then
**auto-map** or **learn in order** in the sidebar's **MIDI** section.

## What you need

Any USB controller that sends **CC messages** — a MIDI Fighter Twister, a
nanoKONTROL, a Launch Control, the knob row on a keyboard, anything. Plug it in
before you load the page (or after; it'll be picked up either way).

You also need a browser with **Web MIDI**. Chrome and Edge have it. If yours
doesn't, the app will tell you plainly instead of failing silently — see below.

## Turning it on

MIDI is off until you ask for it, so nothing MIDI-related shows up in the
sidebar at first.

- Click the **gear** icon over the picture and choose **advanced settings**
  (`ctrl+k` → "advanced settings" works too).
- Under **MIDI control**, click **enable MIDI**.
- Your browser asks permission. Allow it.

You should now see **enabled — bind knobs from the MIDI panel in the sidebar**,
and a new **MIDI** section in the control panel.

You only have to do this once. After a successful grant the app reconnects by
itself on later visits, so reloading won't send you back to the dialog.

If instead you get:

- **Web MIDI not supported in this browser** — nothing to configure, the browser
  doesn't have the feature. Try Chrome or Edge.
- **Access denied** — you dismissed the permission prompt. Click **retry**, or
  clear the site permission in your browser settings and reload.

## Binding one knob

Start here even if you plan to map the whole device, just to see what happens.

- Find a slider you want on a knob. Each one now has a small **⚟** button next
  to it.
- Click **⚟**. It changes to **learn…** in amber, and the MIDI panel says
  _learning {control}… move a knob (Esc to cancel)_.
- Wiggle the knob you want. That's it — the button now reads **CC7** (or
  whatever number your knob sends) and the pairing appears in the MIDI panel.

Changed your mind mid-way? Press **Esc**, or click the button again.

To unbind, click the red **×** next to that control's row in the MIDI panel.
Clicking the blue **CC7** button doesn't unbind — it re-learns, so you can move
a control to a different knob without unbinding first.

One knob drives one thing. If you bind a knob that was already driving something
else, it quietly moves — whatever held it before loses it.

## The two knobs that aren't sliders

Sliders are most of what you'd want on a controller, but they are not the two
most useful things to have under your hands during a set.

**The motion amount.** Once anything is modulated, the **motion** strip above
the filter box scales every routing at once. With MIDI on it carries the same
**⚟** a slider row does, at the right-hand end of the strip — click it, move a
knob, and one hand now takes the whole board from still to swimming.

**A preset's weight.** Every preset but "clean" is a fader you can dial in
partially, and a preset patch is already a macro: one chip moves everything that
preset touches, in the proportions that make it look like itself. To put one on
a knob, use the picker at the bottom of the MIDI panel — choose the preset,
click **⚟ preset mix**, move a knob. Turning it up now layers that preset onto
whatever is live, exactly as dragging the chip sideways does.

Two things follow from what a preset weight _is_:

- Weights layer, so several knobs on several presets is a small mixing desk of
  looks. Sweeping one back to zero returns to what was underneath it.
- A weight only describes the look while nothing else has moved it. Touch a
  slider, mutate, recall a saved look, and the fills reset — the next turn of
  the knob starts a fresh mix from whatever is on screen rather than reverting
  it.

**Neither does soft takeover** (below): both take over on the first message
instead of waiting to be swept through the current value. Soft takeover only
works because the slider row can show an amber mark saying where the knob is
waiting, and neither the motion strip nor a preset chip has anywhere to draw one
— an inert knob there would just look broken. They behave like the performance
faders they are: grab it, it's yours.

## Mapping the whole device

Two buttons in the MIDI panel, and **both wipe every binding you have** before
they start. No confirmation, so don't hit them casually once you've built a
layout you like.

**auto-map** is for a MIDI Fighter Twister specifically. Pick it in the dropdown
and click the button: it assigns the first 64 — the motion amount, then hero
controls in signal-path order — to CC 0–63 on channel 1, which is what a Twister
sends from the factory. Its four banks are all mapped up front, so flicking
banks on the hardware just gives you a different set of live knobs.

The motion amount goes first deliberately: on a device whose low CCs are the
front row of knobs, that is where the one fader that scales the whole patch
belongs. Preset weights are never swept in — which preset is worth a knob is a
choice about the set you're playing, not something a layout can guess.

Hero controls are the ones the panel shows without asking: 86 of the 132, so a
64-knob sweep never spends a knob on a trim. The controls behind each group's
**fine tweaks** fold rank after all of them, and the magnifier ranks dead last —
a knob spent on where you are looking is a knob not spent on the picture.
Bindings are stored per control, so re-ranking never moves one you already have;
only the next sweep sees the new order.

**learn in order** works with anything. Click it, then sweep your knobs one at a
time, left to right — each new knob it hears takes the next thing down the same
spine, so the first knob you move gets the motion amount and the rest walk the
controls. The hint line tells you what is waiting and how many you've done. Stop
whenever you've had enough with **stop learning** or **Esc**; what you've bound
so far is kept.

One catch worth knowing: in a sweep, a knob you bump by accident gets consumed,
and there's no going back a step. Starting over means wiping everything again.

There are more controls (132) than most controllers have knobs, so some will
always be mouse-only. The panel tells you how many are left over.

## "I turn the knob and nothing happens"

That's almost always **soft takeover**, and it's deliberate. A physical knob
sitting at 3 o'clock has no idea the on-screen value is down at 10 o'clock, so
if it took effect the instant you touched it, the value would jump. Instead the
knob stays inert until you sweep it **through** the current on-screen value —
then it catches, and from that point it tracks normally.

So: turn it further, all the way across if you need to. It'll grab.

An **amber mark** on the track shows where the knob currently sits while it's
waiting. Sweep the thumb past that mark — or the mark past the thumb — and the
mark disappears, meaning the knob has it.

Knobs also let go and need re-catching whenever a value is set from somewhere
else: loading a preset, recalling a saved look, undoing, randomizing. After a
preset load expect a row of amber marks, one per knob you'd touched.

All of this is for sliders only. A knob on the motion amount or on a preset
weight takes over the moment you touch it — see above for why.

## Locking a rate to the beat

The beat comes from one of two places. If your controller or DAW sends **MIDI
clock**, that is the tempo, and the MIDI panel shows it: **clock ♩ = 128.0
BPM**. With nothing arriving it reads **no signal** and the tempo is instead the
one at the top of the **Modulation** section — type it in, or hit **tap** four
times on the beat. Clock wins whenever it is running, and the hand-set number
waits underneath for it to stop.

Three kinds of rate can follow the beat, each through the **♩** in its own **⋮**
menu. Clicking it cycles through 1/1, 1/2, 1/4, 1/8, 1/16 and back to off, and
the row wears a **♩1/4** badge while it is locked:

- **sweep** — the wipe auto-sweep.
- **line offset** — source B's line rate.
- **any modulation slot's rate** — the LFO under a ∿, whether you reach it from
  the row's own editor or from the Modulation section.

While locked, the rate is driven by the tempo and ignores its own value. The Hz
you had dialed in is kept underneath, not overwritten, so cycling the lock back
off returns to it — and so does unplugging a clock with nothing hand-set behind
it.

Asking for a lock when there is no tempo at all sets one at 120 BPM, rather than
lighting up a ♩ that changes nothing.

**sweep** tops out at 2 Hz, so past about 120 BPM the fast divisions all pin to
the ceiling and stop sounding different. A modulation rate tops out at 10 Hz,
which 1/16 reaches at 150 BPM.

The app only listens for clock ticks and stop. It never sends clock.

## What sticks around

Bindings, the hand-set tempo, and the clock locks on **sweep** and **line
offset** are saved in this browser and survive reloads. They are **not** part of
presets, saved looks, or the shareable URL — a link you send someone carries the
look, not your knob layout.

A modulation slot's lock is the exception, and deliberately: it rides along on
the link with the rest of the routing, because "this wobbles on eighth notes" is
a statement about the patch, and it should land against the tempo of whoever
opens it. There's no way to export a mapping to a file, so a different browser
or machine means mapping again.

A preset weight is bound by preset name, so if a preset is ever renamed or
dropped from the table, that one binding is discarded on the next load and its
knob goes quiet. Everything else you had bound is untouched.

## What isn't supported

Worth knowing before you buy something specifically for this:

- **CC only.** Notes, pads, pitch bend, program change and aftertouch do
  nothing.
- **Absolute knobs only.** Endless encoders in relative mode will jump around —
  set them to absolute/CC mode on the device if it has one.
- **No LED feedback.** Nothing is sent back, so a Twister's rings won't follow
  what's on screen.
- **No device picker.** Everything plugged in drives the app at once, and the
  device name isn't displayed anywhere.
- **No per-knob range, invert or curve.** A knob covers a slider's whole travel.

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
