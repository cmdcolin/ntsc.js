// Every image and clip the guide pages embed, declared rather than taken by
// hand. `node scripts/docshots.mjs [name...]` renders them; see that file for
// the vocabulary (targets, actions, callouts).
//
// A spec is a URL plus the smallest set of actions that puts the app in the
// state being documented. Prefer URL params and seeded storage over clicking:
// a param is checked by the app's own parser, a click sequence is not.

import frozen from './docshot-frozen.json' with { type: 'json' }

// The bundled photo, which every shot uses so they read as one session.
const CAT = { src: 'cat' }

// A picture-only frame: the canvas alone, with the overlay chrome dropped.
const PICTURE = { actions: [{ bare: true }], crop: 'canvas', format: 'jpeg' }

// A full frame of picture: 960 of canvas beside the 360px panel, so it is
// exactly 4:3 and fills without letterbox bars.
const FRAME = { maxWidth: 960, width: 1320, height: 720 }

// Clips record the canvas backing store, which is the CSS size times the device
// pixel ratio — so this is a 1440x1080 clip out of a window that still fits on
// the screen driving it. 2x (1920x1440) is where the heavy patches stop holding
// 30fps on this GPU, and a choppy clip of a moving picture is worse than a
// slightly smaller sharp one.
const CLIP = { ...FRAME, dpr: 1.5 }

// The look every UI shot sits on. Not the landing state: those shots are of the
// panel, but their "open this in the app" link should still land somewhere
// worth being, and the off-stock lamps and counts only mean something once
// something is off stock. Fixed here rather than borrowed from a gallery roll,
// so re-rolling the gallery doesn't quietly restyle every UI figure — and kept
// off the polarity controls, because a UI shot wants the picture beside it
// legible as a picture.
const WILD = {
  ...CAT,
  set:
    'demodMHz:0.5,lumaMHz:2.8,lumaPeak:0.8,noiseIre:4,agc:0.19,' +
    'ghostDelayUs:1.15,ghostGain:0.08,colorUnderMix:1,underJitterDeg:4,' +
    'dropoutRate:6,headSwitchNoise:0.4,headSwitchShiftUs:0.8,tbJitterNs:190,' +
    'tbWowNs:300,hvSagUs:2.7,hvRing:0.61,phosphor:0.19',
}

// WILD with more controls on top — the two `set` strings concatenated, since a
// second `set` param would replace the first rather than extend it.
const wildWith = extra => ({
  ...WILD,
  set: [WILD.set, extra].filter(Boolean).join(','),
})

// The whole app in frame, with a red box round the thing being described. A
// tight crop of one panel section reads as a screenshot of some other program:
// it drops where the section sits, what it is doing to the picture, and how far
// down the panel you have to go to find it. The box is drawn from the live
// element (see `annotate` in docshots.mjs), so it cannot drift off its target.
//
// Height is per shot: a section that opens tall wants a taller window rather
// than a panel scrolled halfway down.
const WINDOW = { format: 'jpeg', width: 1320, height: 900 }
const boxed = (target, spec) => ({
  ...WINDOW,
  params: WILD,
  ...spec,
  annotations: [{ target, box: true }, ...(spec?.annotations ?? [])],
})

// A gallery frame: one named mechanism pushed past where its preset leaves it,
// so each tile in the guide's gallery is a different fault rather than a
// different roll of the same dice. `?surprise` (the app's own dice) mostly
// lands on stacks that read as generic mush at thumbnail size.
//
// These used to stop where the cat was still legible under the damage. They no
// longer do: a tile that reads as a photo with an effect on it undersells the
// thing, and the point of a signal simulator is the state where the picture has
// stopped being a picture and the structure on screen is the chain's own. The
// bar a tile clears is now that it has structure — hue that goes somewhere,
// geometry that came from somewhere — rather than that the subject survives.
// Full white, full black and undifferentiated hash all still fail it, and all
// three are one control away from every patch below.
//
// `docshots --freeze` still pins whatever a shot's address bar said, so a look
// pushed further by hand in the app can be captured back into
// docshot-frozen.json and takes precedence from then on.
const look = (name, params, extra) => ({
  ...PICTURE,
  ...FRAME,
  name: `look-${name}`,
  params: frozen[`look-${name}`] ?? { ...CAT, ...params },
  warm: 150,
  ...extra,
})

// A hand-built patch nothing in the preset table reaches: everything stacked at
// once — suppressed sync, a bent enhancer, both feedback loops, source B
// beating against itself, the phosphor left long. The guide links it live, so
// the link and the shot are one string rather than two that can disagree.
//
// Two things this patch is deliberately kept off, both of which take the frame
// to a wall rather than to a picture:
//
// - Anything that inverts. `invert`, SSAVI scrambling and `chromaPinOnly` all
//   turn the raster inside out or black it out entirely; a negative reads as a
//   filter over the photo rather than as damage done to a signal.
// - The enhancer's sync side (`enhSync`, `enhSliceIre` up in picture territory).
//   It hands the separator pulses minted from dark content, the AGC chases them,
//   and everything else here — two loops at just under unity — then compounds
//   whatever level is left. Even a touch of it takes the frame to black. The
//   resonant peak is what stays, which is the bend worth showing anyway.
export const HERO_SET =
  'chromaGain:2.4,svideoBleed:0.8,chromaTail:0.4,encChromaMHz:1.85,' +
  'demodMHz:1.23,hHold:0.35,vHold:0.4,vFreqHz:59.6,syncBendUs:6,bendUs:22,' +
  'bendShape:2,hvSagUs:12,hvRing:0.8,hDetuneHz:24,scramble:0.4,agc:0.5,' +
  'noiseIre:7,enhPeakMHz:0.35,enhPeakQ:0.7,enhPeakBoost:0.06,fbMix:0.5,' +
  'fbZoom:1.03,fbRotateDeg:2,fbGain:0.96,fbFocus:1.1,fbVign:0.4,fbBlack:0.02,' +
  'fbKnee:0.6,cfbMix:0.35,cfbGain:0.8,cfbDelayUs:0.25,cfbLines:3,cfbKey:0.7,' +
  'cfbKeyLevel:45,cfbKeySoft:10,bGain:0.35,bLineHz:0.71,bDetuneHz:107,' +
  'bRollLps:0.17,phosphor:0.45'
const HERO = { ...CAT, srcb: 'cat', set: HERO_SET }

// The chain map at the head of the sidebar — the figure itself in one shot, a
// callout target in others.
const MAP = { selector: 'svg[aria-label="signal chain"]' }

export const SPECS = [
  {
    name: 'overview',
    params: WILD,
    format: 'jpeg',
    width: 1360,
    height: 860,
    // Numbered to a legend in the guide: five labels would crowd a 360px panel,
    // and the numbers survive the prose being rewritten around them.
    annotations: [
      { target: 'canvas', n: 1, at: 'tl', dx: 40, dy: 40 },
      { target: { title: 'menu (' }, n: 2, at: 'tl', dx: -22, dy: 16 },
      { target: { section: 'Presets' }, n: 3, at: 'tl', dx: -22, dy: 14 },
      { target: { section: 'Input' }, n: 4, at: 'tl', dx: -22, dy: 14 },
      { target: MAP, n: 5, at: 'tl', dx: -22, dy: 16 },
    ],
  },
  boxed('dialog', {
    name: 'slider-help',
    seed: {
      video_feedback_open_phase: 'Tape',
      video_feedback_open_group: 'VHS Tracking',
    },
    // The first ? in the panel belongs to the one group left open above.
    actions: [{ click: { selector: 'button[title="what does this do?"]' } }],
  }),
  // The map is a 304x34 row in a 360px panel, so the box is most of what tells
  // you where to look for it.
  boxed(MAP, { name: 'chain' }),
  // Ten boxed-UI shots stood here: presets, preset-mix, input, signal-path,
  // filter, palette, motion, audio, menu, magnifier, scope, advanced. They went
  // together, and for one reason rather than twelve — a full 1320x900 window
  // with a red box on a 300px strip of it is a poor figure. The strip is small
  // enough to be unreadable at the guide's measure, the other 90% of the frame
  // is the same app window every time, and stacked twelve deep they took the
  // user guide to 15,000 pixels of screenshots the prose was already saying.
  //
  // Three survive, and the test each passes is that the picture carries
  // something the sentence cannot: `overview` names the five regions at once,
  // `chain` shows a map you would not guess the shape of, and `slider-help` is
  // the doc's own argument for why there is no per-control reference here.
  // Anything re-added should clear the same bar, and a tight crop of the panel
  // region is the shape to reach for rather than another boxed window.

  // The showcase gallery: three mechanisms, one per tile, each starting from
  // the preset that names it and pushed well past where that preset stops.
  // Each is a different kind of destruction rather than three strengths of one
  // — a receiver decoding a signal whose polarity is upside down, a keyer with
  // no camera anywhere in it, and a feedback loop breeding its own structure —
  // and the three read apart at thumbnail size, which is the only size the
  // gallery is ever seen at.
  //
  // Six tiles stood here: rainbow, scramble, tape, tunnel, ladder, tube. Half
  // were a legible photo with an effect on it, and half (the two camera loops
  // and the driven tube) photographed as haze, noise and a contrasty snapshot.
  // The presets they named are all still one click away in the app; a gallery
  // is not the place to enumerate them.
  // The mixer loop past unity, with the loop bus ring-modulated against the
  // live program and a big offset per generation. What survives is structure
  // the loop is breeding rather than the picture that seeded it: the delay is
  // also a hue rotation, so each generation lands a step further round the
  // wheel and the stack is coloured rather than grey.
  look(
    'loop',
    {
      preset: 'mixer loop',
      set: 'cfbMix:0.8,cfbGain:1.01,cfbLines:-9,cfbDelayUs:1.4,cfbServoUs:1.6,cfbRing:0.45,cfbTrail:0.6,chromaGain:2.6,crtSat:1.6,crtGamma:1.3,phosphor:0.45,noiseIre:2',
    },
    { warm: 100 },
  ),
  // Polarity reversed on the composite line, which takes sync with it — so
  // this is not a negative filter over a photo: the set is hunting for a sync
  // tip up in peak white, and what it finds shears the raster while every hue
  // reads complementary. Scrambling and a loose PLL on top, so the lines land
  // where the separator guesses.
  look('negative', {
    preset: 'negative',
    set: 'invert:1,scramble:0.45,agc:0.3,hHold:0.5,hDetuneHz:34,bendUs:16,bendShape:2,chromaGain:2.4,svideoBleed:0.7,noiseIre:5,phosphor:0.55,crtGamma:2.4,crtBloom:0.7',
  }),
  // No camera anywhere in this one: the video synth into the chroma keyer,
  // which is what key sweep is built for. The colorizer turns level into hue,
  // so the synth is a ramp *through* the wheel and the key cuts a band out of
  // it — the acceptance angle is the width of the hole and the key hue is
  // where it sits. Nothing here is drawing a stripe, and the oscillator is
  // parked just off a line-rate multiple so the bars lean and beat instead of
  // standing still.
  look('key', {
    src: 'synth',
    srcb: 'bars',
    preset: 'key sweep',
    set: 'synthAHz:15797,synthBHz:47,synthShape:3,synthMix:2,synthColor:1,synthLevel:1.7,bKeyHueDeg:196,bKeyAcceptDeg:52,bKeySoft:0.06,bKeySpill:0.4,chromaGain:3,chromaCoarse:3,scDetuneKHz:0.4,burstLock:0.3,demodMHz:0.9,svideoBleed:0.8,crtSat:1.6,crtGamma:1.9,phosphor:0.35',
  }),

  // Clips: the four things a still cannot show — a feedback loop developing,
  // sync coming apart, a control moved by something other than a hand, and
  // everything at once.
  {
    name: 'clip-feedback',
    // A camera barely off-axis from the monitor it is pointed at: a hair over
    // 1x zoom, a degree of tilt, and the tunnel builds itself over several
    // seconds. Winding zoom and rotation right up instead gives a spinning
    // kaleidoscope, which is a different (and much less analog) thing — so the
    // loop is pushed by gain and mix rather than by geometry.
    //
    // The tape underneath it is running badly too: dropouts, head-switch noise
    // and time-base wobble all go around the loop, so each pass smears the last
    // one's damage instead of the picture cleanly tunnelling. Only a little of
    // each, though — the loop compounds them, and a mixer loop stacked on top
    // of this one takes ten seconds to reach a flat wall of noise.
    params: {
      ...CAT,
      set:
        'fbMix:0.88,fbZoom:1.014,fbRotateDeg:0.6,fbGain:1.08,fbFocus:1.2,' +
        'fbVign:0.28,fbBlack:0.03,fbKnee:0.55,colorUnderMix:0.5,' +
        'underJitterDeg:3,dropoutRate:8,dropoutLenUs:5,headSwitchNoise:0.35,' +
        'headSwitchShiftUs:0.9,tbJitterNs:150,tbWowNs:300,noiseIre:2.5,' +
        'phosphor:0.4',
    },
    ...CLIP,
    warm: 60,
    video: { secs: 10, crf: 28 },
  },
  {
    name: 'clip-sync',
    // Line hold and the tape's grip on time, not vertical hold: a frame that
    // rolls end over end is unreadable on a clip, where shearing and tearing
    // against a picture that stays put is the thing worth watching.
    params: {
      ...CAT,
      preset: 'worn tape',
      set: 'hHold:0.62,tbJitterNs:700,tbWowNs:1400,trackAmt:0.6,trackPos:0.6,headSwitchShiftUs:2,noiseIre:6',
    },
    ...CLIP,
    // Noise over the whole frame, like the hero clip: worth the lower quality.
    video: { secs: 7, crf: 31 },
  },
  {
    name: 'clip-hero',
    params: HERO,
    ...CLIP,
    // Short: both loops sit just under unity, so every extra frame before the
    // shutter is another generation of wash across the frame.
    warm: 45,
    // Dense per-pixel noise: at the default quality this one alone outweighs
    // every other clip put together.
    video: { secs: 9, crf: 30 },
  },
  {
    name: 'clip-modulation',
    // Deep enough to be unmistakable: the hold oscillators are swept far enough
    // to break lock and come back, rather than nudged.
    params: wildWith('chromaGain:1.8'),
    ...CLIP,
    seed: {
      video_feedback_mod: JSON.stringify([
        { target: 'hHold', source: 'sine', rateHz: 0.5, depth: 0.9 },
        { target: 'vHold', source: 'triangle', rateHz: 0.22, depth: 0.7 },
        { target: 'chromaGain', source: 'lorenz', rateHz: 0.4, depth: 0.8 },
        { target: 'bendUs', source: 'hold', rateHz: 1.6, depth: 0.6 },
      ]),
    },
    video: { secs: 8, crf: 31 },
  },
]
