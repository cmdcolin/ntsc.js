# Ideas / backlog

Things worth doing that aren't done, and things that look worth doing but aren't
— so a future pass doesn't re-litigate them. Line numbers drift; grep the
described feature.

## Modulation: kill the remaining naked periodic waves

The premise (see ARCHITECTURE.md) is that a fault should be _mechanistic_. A
single periodic wave traced straight down the raster violates that — it reads as
a filter effect, not a fault (the warning `signal/audiostate.ts` opens with).
The shared home for bounded-aperiodic drift is now **`signal/noise.ts`**
(`valueNoise`, `Lorenz`, `Wow`); reuse it rather than rolling a new sine.

### Deferred — mains-frequency roll drift (hum), `channel.wgsl`

The 60 Hz hum fundamental is a clean sine and **should stay one** — it's mains,
it really is that periodic. The boring part is the fixed roll rate (the
`f32(P.frame) * 0.0037` term): real mains frequency wanders with grid load, so
the beat against field rate should breathe instead of ticking at a constant
rate.

Approach: replace the constant with a slowly-drifting phase accumulated CPU-side
(same pattern as `Engine.advanceScPhase`), driven by an OU/`valueNoise` slow
term from `signal/noise.ts`. Optionally add a 120 Hz full-wave harmonic.

Deferred because it's the only one of the modulation ideas that needs a new
uniform + phase plumbing (a `PARAM_DEFS` field, `DEFAULT_CONTROLS`,
`uniformValues`) for the least-visible win. Everything else in the batch was
self-contained.

### Landed

Replaced with `signal/noise.ts` sources (commit "Replace periodic modulators
with bounded-aperiodic sources"):

- **Tape wow** (`signal/linestate.ts`) — was a single 0.6 Hz sine; now `Wow`, a
  quasi-periodic sum of incommensurate eccentricities.
- **Modulation LFOs** (`signal/modstate.ts`) — added `smooth` (value noise),
  `hold` (sample & hold), `lorenz` (strange attractor) sources.
- **Intercarrier buzz** (`channel.wgsl`) — the 4.5 MHz sound carrier's FM is now
  driven from `audio[row]` (it physically _is_ the audio leaking past the trap),
  so it's content-driven and silence leaves a clean stationary weave.

## Not worth touching

These read like naked periodic waves but are physically correct — don't
"aperiodic-ise" them:

- **Hum fundamental** (`channel.wgsl`) — mains is a clean sine; only its _roll
  rate_ is worth drifting (above).
- **Wipe ping-pong** (`signal/mixstate.ts`) — a switcher sweep is _deliberately_
  periodic; that's what the hardware does.
- **Source-B detune / roll** (`signal/mixstate.ts`) — a mistuned crystal really
  does sit at a fixed wrong frequency. The constant is the point.
- **Decode bend ripple** (`decode.wgsl`) — spatial, not animated; nothing to
  make aperiodic in time.
