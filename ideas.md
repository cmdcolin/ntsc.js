Remaining ideas from the list when you want them: the video-synth oscillator
source, chroma key, and the audio-reactive path.

## Capture / deinterlace (grown out of the RCA-input work)

- **Motion-adaptive deinterlace.** Current `deint` is an unconditional even-field
  bob — halves vertical resolution even on still frames. Weave where fields
  match (full res on static areas) and bob only where they differ (a per-pixel
  inter-field delta metric); keeps sharpness off motion.
- **Deint modes instead of on/off.** Turn the toggle into a mode select: off /
  bob (current) / blend (average both fields — ghosts on motion, keeps res) /
  weave. Blend is cheaper and some people prefer its look.
- **Auto-detect interlacing.** Measure a comb metric on the incoming source and
  flip `deint` on automatically only for genuinely-interlaced feeds, instead of
  hard-enabling it on every webcam/USB connect (progressive USB cams get
  needlessly softened today).
- **Remember the last capture device.** Persist the chosen `deviceId` so a
  reconnect re-selects the dongle rather than the OS default camera.
- **PAL capture.** Composite grabbers also deliver 720×576/50i; the pipeline is
  NTSC-shaped (525/60). At minimum square-pixel it correctly; ideally note the
  standard mismatch in the UI.

## Deflection (follow-ons to the sync/bend work)

- **Intra-line geometry.** `hSize`, `hLin` (S-correction failure stretching one
  side), pincushion. Blocked on decode's tiling: the workgroup stages one
  contiguous 128-sample span per row, so only *row-uniform* horizontal offsets
  are free. Non-uniform scaling within a line reads outside the halo.
- **Vertical geometry.** `vSize` / `vLin` are nearly free by contrast — they
  only change which source row a screen row picks.
- **Fractional bend.** `hoff` is `round()`ed to whole samples; at large
  amplitudes adjacent rows stair-step. Resampling the tile with `catmull` would
  smooth it, at the cost of restructuring the staging.
- **Neon phosphor colour.** Planned in detail in `docs/phosphor-plan.md`.

## Screen-domain effects not yet built

- ~~**Halation**~~ — done. `crt_face` already adds a wide warm glass-scatter
  halo (`crtHalation` × the 15-px golden-angle tap ring, tinted `WARM`), and the
  slider is live. What is *not* modeled is halation's dependence on beam
  current: real glass scatter blooms disproportionately on peak whites, so
  keying the halo radius off local luma would read more like an old tube than
  the current fixed-radius ring.
