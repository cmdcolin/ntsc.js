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

## Screen-domain effects not yet built

- **Halation** — wide, low-amplitude warm gaussian halo added on top of the CRT
  face (glass back-scatter); distinct from bloom, reads as "old tube." A single
  blurred-add in `present` / `crt_face`. (`crtHalation` param exists — confirm
  whether it's actually wired before implementing.)
