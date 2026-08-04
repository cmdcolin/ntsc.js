// An input for `scripts/contact.mjs`, and the record of one round of preset
// screening — the ten candidates that were still open when it stopped, with
// what the previous round taught written next to each.
//
//   node scripts/contact.mjs scripts/candidates.example.mjs docs/contact <url>
//
// Every top-level key but `items` is a default an item may override. `ref clean`
// is the tile everything else is scored against; without it the departure
// column reads "—".
//
// What the first round taught, in order of how much it cost to learn:
//
//  - **A camera loop with `fbGain` at unity just dims away.** Every zoom regime
//    failed this way: each pass is a little darker than the last, so the
//    geometry never accumulates and the frame reads as the source, slightly
//    soft. The two that also carried `crtGamma` above 1.3 rendered nearly black.
//  - **Mixer-loop regimes were mostly too polite.** At `cfbMix` .5–.7 with a
//    sub-microsecond delay the result is the source with grain on it.
//  - **The resonant ones were the opposite.** At `cfbFilterQ` .7+ with boost
//    over 2 the picture is gone entirely and the frame flickers hard enough to
//    be unpleasant (`motion 60` against a typical 2–3). Keying the loop is what
//    puts the ringing back *on* the picture rather than over it.
//  - **Departure is not a quality score.** `mixer loop`, a shipped preset,
//    departs ~9; `infinity corridor` departs 82 because it collapsed to black.
//    Read it with `mean` and `sd`, and treat anything under ~5 as "the patch is
//    not the thing you are looking at".
//  - **Feedback-heavy stacks are source-dependent.** A loop that keeps
//    re-eating a frozen photo wanders somewhere a moving source never goes, so
//    a full-board patch judged only on `src=cat` is half-judged. The harness
//    steps frames deterministically, which a video source cannot follow — so
//    for those, look at the live link in the tile as well as the frame.
//  - **`dubGens: 2` plus dropouts plus a camera loop is not renderable** on a
//    loaded machine — seconds per frame. That is a cost a preset would hand to
//    whoever clicked it, not just to the harness.

export default {
  src: 'cat',
  srcb: 'bars',
  frames: 420,
  settle: 3500,
  late: 800,
  items: [
    { name: 'ref clean', blurb: 'the source, untouched', set: '' },
    {
      name: 'spiral core',
      blurb: 'off-centre log spiral',
      // Round 1 was washed out, and too close to `wound spiral` (shipped) to be
      // worth both. Pushed off-centre hard and wound tighter so the two are
      // different animals rather than two tunings of one.
      set: 'fbMix:0.85,fbZoom:1.035,fbRotateDeg:9,fbShiftX:0.08,fbGain:1.06,fbFocus:1,fbKnee:0.55,fbVign:0.45,fbBlack:0.045,crtBloom:0.3,noiseIre:1.5',
    },
    {
      name: 'collapse tunnel',
      blurb: 'inward fall, zoom under 1',
      set: 'fbMix:0.9,fbZoom:0.955,fbGain:1.12,fbFocus:0.6,fbKnee:0.5,fbVign:0.3,fbBlack:0.02,crtGamma:1.15,noiseIre:1.5',
    },
    {
      name: 'infinity corridor',
      blurb: 'straight outward tunnel, no rotate',
      set: 'fbMix:0.9,fbZoom:1.085,fbGain:1.1,fbFocus:0.8,fbKnee:0.55,fbVign:0.3,fbBlack:0.015,crtGamma:1.15,noiseIre:1.5',
    },
    {
      name: 'slow breath',
      blurb: 'camera loop parked on the unity knife edge',
      // Round 1 sat at gain 1.005 with a 0.5% zoom step and accumulated nothing
      // in 400 frames. The knife edge has to be just over it.
      set: 'fbMix:0.8,fbZoom:1.01,fbGain:1.05,fbFocus:0.9,fbKnee:0.5,fbVign:0.35,fbBlack:0.02,noiseIre:2',
    },
    {
      name: 'head crash',
      blurb: 'worn tape dragged through a collapsing raster',
      // Round 1 never finished: seconds per frame. One dub generation carries
      // the mush; the camera loop on top of it was what made it unrenderable.
      set: 'dubGens:1,lumaMHz:2.2,lumaPeak:1.4,noiseIre:9,colorUnderMix:1,chromaNoiseIre:9,underJitterDeg:12,tbJitterNs:500,tbWowNs:1200,headSwitchShiftUs:1.8,headSwitchNoise:0.9,dropoutRate:30,dropoutLenUs:9,vHold:0.5,bendUs:12,bendShape:1,phosphor:0.5',
    },
    {
      name: 'polarity buzz',
      blurb: 'negative loop gain, alternating edges',
      // The regime works — the frame tears into offset blocks with the polarity
      // flipping under them, which nothing else in the table does — but at
      // cfbMix .6 the alternating passes cancel most of the light out of it.
      set: 'cfbMix:0.5,cfbGain:-0.85,cfbDelayUs:0.08,cfbLines:1,noiseIre:1.5',
    },
    {
      name: 'hue carousel',
      blurb: 'mixer delay as hue rotation',
      // A 70ns delay is a 90° hue step, but only with enough of the loop bus in
      // the mix to see it.
      set: 'cfbMix:0.88,cfbDelayUs:0.14,cfbGain:1.02,cfbLines:1,cfbTrail:0.5,noiseIre:1.5',
    },
    {
      name: 'detail bars',
      blurb: 'low resonance ringing on picture detail',
      set: 'cfbMix:0.4,cfbGain:0.9,cfbFilterMHz:1.1,cfbFilterQ:0.55,cfbFilterBoost:1.5,cfbKey:0.6,cfbKeyLevel:55,cfbKeySoft:12,cfbLines:1,noiseIre:1.5',
    },
    {
      name: 'glass onion',
      blurb: 'both loops, heavily damped',
      // The fbMix+cfbMix space is genuinely unexplored, but round 1 damped it
      // so hard that neither loop showed.
      set: 'fbMix:0.75,fbZoom:1.03,fbGain:1.05,fbFocus:1.2,fbKnee:0.6,fbVign:0.45,fbBlack:0.05,cfbMix:0.55,cfbDelayUs:0.18,cfbLines:2,crtCutoff:0.05,noiseIre:1.5',
    },
    {
      name: 'halo burn',
      blurb: 'key loop breeding faceplate halos',
      // Round 1 read as overexposure rather than halos: the key was low enough
      // to feed most of the picture back, not just the highlights.
      set: 'cfbMix:0.6,cfbGain:0.85,cfbKey:0.75,cfbKeyLevel:75,cfbKeySoft:6,crtBloom:0.5,crtHalation:0.5,crtSat:1.2,noiseIre:1.5',
    },
  ],
}
