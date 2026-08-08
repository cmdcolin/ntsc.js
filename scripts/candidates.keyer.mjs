// Screening the six presets that shipped with the keyer, the synth, the strobe
// and the one-shot (e273959, carried into the table by 9e0da4c). They were
// authored from stills and had never been watched moving, which is the failure
// the contact sheet exists to catch.
//
//   node scripts/contact.mjs scripts/candidates.keyer.mjs docs/contact/keyer <url>
//
// These are shipped presets rather than candidates, so `set` here is each
// preset's patch verbatim — regenerate with:
//
//   npx tsx -e "import {PRESETS} from './src/ui/presets.ts'; …"
//
// Two of the six cannot be read off the sheet the way the other four can, and
// the reason is the harness rather than the preset:
//
//  - **`strobed tube` is sampled, not summarised.** The gate is on for 30 ms of
//    a 3.5 Hz cycle — about a tenth of the time — so whichever frame the grab
//    lands on decides whether the tile is a picture or a black field, and a
//    `dark` verdict on it means nothing. What IS readable is `motion`: a strobe
//    that reaches the guns swings the frame-to-frame delta far above a steady
//    look's, and one that never fires reads flat.
//  - **`punch in` rests by design.** Both its routings are `trig` one-shots,
//    and nothing in the harness presses fire — a one-shot with no trigger is a
//    control sitting at its rest value. `still` and `static-from-start` on that
//    tile are the preset working. The thing worth reading is that the resting
//    board is *not* already in trouble: it should look like a slightly soft
//    picture, because the gesture has to have somewhere to travel from.
//
// `ref clean` is the same cat with source B mixed in and no key, which is the
// honest reference for the three keyer tiles: it is what the mixer shows when
// the keyer is the only thing switched off, so a departure score on those
// tiles is the keyer's own contribution and not source B's.

export default {
  src: 'cat',
  srcb: 'bars',
  frames: 420,
  settle: 4000,
  late: 1000,
  items: [
    {
      name: 'ref clean',
      blurb: 'cat over bars, mixer open, keyer off',
      set: 'bGenlock:1,bGain:1,bHueDeg:150',
    },
    {
      name: 'green screen',
      blurb: "B's backing cut so A shows through it",
      set: 'bGenlock:1,bGain:1,bHueDeg:150,bKey:1,bKeyAcceptDeg:34,bKeyClip:0.06,bKeySoft:0.04,bKeySpill:0.8',
    },
    {
      name: 'key sweep',
      blurb: 'the transparent hue walked round the wheel by an LFO',
      // The routing is the preset. Screened without it this is `green screen`
      // with a different backing angle and a synth in slot B.
      set: 'bGenlock:1,bGain:1,bKey:1,bKeyAcceptDeg:34,bKeyClip:0.05,bKeySoft:0.06,bKeySpill:0.5,bKeyHueDeg:180,synthShape:0,synthAHz:15754,synthColor:1',
      mod: 'bKeyHueDeg:sine:0.09:0.5',
      // 0.09 Hz is one sweep every 11 s; 420 frames at 60 is 7 s, so the grab
      // sees most of one pass and the late checkpoint sees it come round.
    },
    {
      name: 'key into the loop',
      blurb: "the mixer's own output patched to the keyer's fill",
      set: 'bGenlock:1,bGain:1,bHueDeg:150,bKey:1,bKeyAcceptDeg:40,bKeySpill:0.4,bKeyFill:2,cfbMix:0.62,cfbGain:0.92,cfbDelayUs:0.3,cfbLines:2,phosphor:0.35',
      // A mixer loop confined to the keyed hole. `collapses` here would be the
      // finding that matters: the loop walling out inside the shape.
    },
    {
      name: 'contour lines',
      blurb: "the synth over A, A's own luma pulling its frequency",
      set: 'synthOver:0.6,synthShape:1,synthAHz:32000,synthFm:90000,synthColor:0.75,synthLevel:1.4,lumaPeak:1.1,chromaGain:1.2',
      srcb: 'none',
    },
    {
      name: 'strobed tube',
      blurb: 'guns cut for most of each cycle, over a long phosphor',
      set: 'strobeHz:3.5,strobeMs:30,phosphor:0.86,phosphorSkew:0.5,phosphorBleed:0.18,crtCutoff:0.08,crtGamma:1.7,crtHalation:0.6,abl:0.7,scanBeam:0.35',
      srcb: 'none',
    },
    {
      name: 'punch in',
      blurb: 'the resting board, before anyone hits it',
      set: 'hHold:0.5,bendPeriod:40,noiseIre:1.5,lumaMHz:3.2,phosphor:0.3',
      mod: 'hHold:trig:4:0.35,bendUs:trig:1.1:0.3',
      srcb: 'none',
    },
  ],
}
