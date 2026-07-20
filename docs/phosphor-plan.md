# Phosphor / neon colour plan

Goal: the electric, saturated look of a camcorder pointed at a CRT at night —
true-black background, cores that go white-hot, colour that stays vivid at the
clipping point instead of flattening, and trails that shift hue as they die.

The pipeline already has the *light* behaviour (bloom, halation, glow in
`crt_face`) and persistence (in `decode`). What is missing is the tube's
**colour transfer**: today the decoder matrixes YIQ straight to sRGB and hard
clamps. Everything below follows from fixing that.

## Why it currently can't get there

Three specific things, each verified in the source:

1. **`decode.wgsl` ends in `clamp(rgb, 0, 1)`.** A hard clamp on an
   out-of-gamut colour changes its hue — clipping only the channel that
   overflows rotates the colour toward the remaining primaries. Saturated
   content therefore goes *duller and wrong* at exactly the brightness where a
   real tube goes *more electric*.
2. **There is no display-side black cut.** `fbBlack` exists but lives in
   `compose.wgsl`, which is the feedback *camera* path only. Nothing lifts or
   crushes black on the way to the screen, so the background sits at a decoded
   pedestal rather than the true zero the reference images have.
3. **Persistence decay is hard-coded.** `decode` uses
   `vec3f(pow(g, 1.7), g, pow(g, 2.4))`. That ratio *is* the green-tailed trail,
   but it can't be adjusted, and `phosphor` is capped at 0.98, well short of the
   long-persistence look.

## Phase 1 — beam transfer and gamut (the substance)

Add to `crt_face`, at the top, before bloom/halation. That pass is explicitly
the emissive stage, and putting the transfer there means the feedback camera
photographs phosphor light rather than decoder voltages — which is the correct
loop ordering and costs nothing extra.

- **`crtCutoff`** — beam cutoff. Drive below the knee emits nothing. This is
  what makes backgrounds true black, and it is the single biggest contributor to
  the reference look.
- **`crtGamma`** — luminance ≈ drive^γ, γ≈2.4 for a real gun. Expands highlights
  and deepens shadows, so cores bloom and the rest recedes.
- **`crtSat`** — saturation applied around luma, *after* the transfer.
- **Gamut clip by desaturation.** Replace the hard clamp: when a colour exceeds
  the cube, pull it toward its own luma until it fits, preserving hue. Do this
  in `decode` (where the clamp is) and let `crt_face` work in headroom.

Order matters: transfer → saturate → gamut-fit → bloom/halation. Saturating
after the gamma is what gives vivid mids without posterizing.

## Phase 2 — phosphor identity

- **P22 primaries.** A 3×3 from sRGB primaries to P22's actual chromaticities.
  P22 green is markedly more yellow-green and its blue more violet than sRGB, so
  this alone shifts the whole image toward the CRT palette. Ship it as a
  `phosphorMode` select (sRGB / P22 / long-persistence green) rather than a
  slider — these are discrete tube types, not a continuum.
- **Expose the persistence skew.** Turn the hard-coded exponents into
  `phosphorSkew` (R/B decay relative to G) and raise the `phosphor` ceiling
  toward 0.995. Blue-white streak with a green tail is exactly this ratio held
  longer.
- **Consider decay vs peak-hold.** Persistence currently uses `max()`, which
  holds a hard edge. Real phosphor decays exponentially and *adds*. A mix
  control between peak-hold and additive decay would give softer, more
  photographic trails; peak-hold should stay available since it is what makes
  the current strobe presets read.

## Phase 3 — polish

- **Halation keyed to beam current.** Glass scatter blooms disproportionately on
  peak whites; keying the halo radius (not just its amplitude) off local luma
  would read more like real glass than today's fixed-radius ring.
- **Per-channel bloom radius.** Different phosphors have different grain, so the
  blue core spreads slightly less than the red. Small, but it kills the
  "gaussian filter" tell.

## Sequencing and risk

Phase 1 alone probably gets 80% of the reference look and is contained to two
shaders plus params. Phase 2 changes the colour of *every existing preset*,
which is why it should be a mode select defaulting to current behaviour rather
than an always-on matrix — otherwise every gallery image and clip in `docs/` and
`clips/` silently changes and would need regenerating.

Cheap to verify: the existing `?preset=` URL plus `scripts/shot.mjs` can capture
before/after for the whole preset list, and the `dbgView` hooks in `decode`
(modes 3/4/5 dump luma, chroma, and burst state) already isolate the stages if a
colour shift needs debugging.
