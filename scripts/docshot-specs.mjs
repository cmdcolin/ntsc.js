// Every image and clip docs/USER-GUIDE.md embeds, declared rather than taken by
// hand. `node scripts/docshots.mjs [name...]` renders them; see that file for
// the vocabulary (targets, actions, callouts).
//
// A spec is a URL plus the smallest set of actions that puts the app in the
// state being documented. Prefer URL params and seeded storage over clicking:
// a param is checked by the app's own parser, a click sequence is not.

import frozen from './docshot-frozen.json' with { type: 'json' }

// The panel's collapsible sections, as a shot wants them. The app persists
// these, so a shot that needs one open says so rather than clicking it.
const sections = open =>
  JSON.stringify({
    Presets: true,
    Input: true,
    'A/B Mix': false,
    Scenes: false,
    Modulation: false,
    'Sound into the picture': false,
    ...open,
  })

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
// something is off stock. One of the frozen gallery rolls, so the whole guide
// reads as one session.
const WILD = frozen['look-roll-4'] ?? CAT

// WILD with more controls on top — the two `set` strings concatenated, since a
// second `set` param would replace the first rather than extend it.
const wildWith = extra => ({
  ...WILD,
  set: [WILD.set, extra].filter(Boolean).join(','),
})

// A gallery frame from the app's own dice: `?surprise` rolls a random stack of
// presets on load, which reaches wilder places than any single preset does.
// Once a roll is worth keeping, `docshots --freeze` writes the look it landed
// on into docshot-frozen.json and that shot stops rolling — same picture every
// regen, with the params on record rather than in a lucky screenshot.
const roll = name => ({
  ...PICTURE,
  ...FRAME,
  name: `look-${name}`,
  params: frozen[`look-${name}`] ?? { ...CAT, surprise: '1' },
  warm: 150,
})

// A hand-built patch nothing in the preset table reaches: everything stacked at
// once — scrambled sync, a bent enhancer, both feedback loops, source B beating
// against itself. The guide links it live, so the link and the shot are one
// string rather than two that can disagree.
export const HERO_SET =
  'encChromaMHz:1.85,invert:1,demodMHz:1.23,chromaTail:0.47,chromaCoarse:2,' +
  'chromaGain:2.36,svideoBleed:0.78,hHold:0.45,vHold:0.56,vFreqHz:58.9,' +
  'syncBendUs:8.45,bendUs:30,bendShape:2,hvSagUs:14.8,hvRing:0.8,hDetuneHz:38,' +
  'chromaPinOnly:0.67,scramble:1,scrambleMode:2,enhClampUs:3.4,enhDroopUs:9,' +
  'enhPeakMHz:0.2,enhPeakQ:0.53,enhPeakBoost:0.02,enhSync:0.57,' +
  'enhSliceIre:-0.5,noiseIre:15.1,agc:0.7,fbMix:0.82,fbZoom:1.045,' +
  'fbRotateDeg:2.5,fbGain:1.18,fbFocus:1.3,fbVign:0.35,fbBlack:0.05,' +
  'fbKnee:0.65,crtGamma:1.1,cfbMix:0.95,cfbGain:1.2,cfbDelayUs:0.05,' +
  'cfbLines:4,cfbKey:1,cfbKeyLevel:47,cfbKeySoft:8.5,cfbFilterMHz:0.4,' +
  'cfbFilterQ:0.57,cfbFilterBoost:2.1,bGain:0.44,bLineHz:0.71,bDetuneHz:107,' +
  'bRollLps:0.17,phosphor:0.445'
const HERO = { ...CAT, srcb: 'cat', set: HERO_SET }

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
      { target: { title: 'the whole chain' }, n: 5, at: 'tl', dx: -22, dy: 16 },
    ],
  },
  {
    name: 'presets',
    params: WILD,
    crop: { section: 'Presets', pad: 10 },
  },
  {
    name: 'preset-mix',
    params: WILD,
    // Past the drag slop and on to ~60%: the fill behind the chip is the whole
    // point of the shot, and a click would apply the preset outright instead.
    actions: [{ drag: { text: 'vhs' }, by: { x: 72 } }, { steps: 40 }],
    crop: { section: 'Presets', pad: 10 },
  },
  {
    name: 'input',
    params: { ...WILD, srcb: 'sweep' },
    crop: { section: 'Input', pad: 10 },
  },
  {
    name: 'signal-path',
    params: WILD,
    height: 1150,
    seed: {
      video_feedback_open_phase: 'Tape',
      video_feedback_open_group: 'VHS Tracking',
    },
    crop: {
      union: [
        { title: 'the whole chain' },
        { selector: 'div[class*="stages_"]' },
      ],
      pad: 10,
    },
  },
  {
    name: 'slider-help',
    params: WILD,
    seed: {
      video_feedback_open_phase: 'Tape',
      video_feedback_open_group: 'VHS Tracking',
    },
    // The first ? in the panel belongs to the one group left open above.
    actions: [{ click: { selector: 'button[title="what does this do?"]' } }],
    crop: 'dialog',
  },
  {
    name: 'filter',
    params: WILD,
    height: 1150,
    actions: [
      { set: { selector: 'input[type="search"]' }, value: 'rainbow' },
      { wait: 400 },
    ],
    crop: {
      union: [
        { selector: 'input[type="search"]' },
        { selector: 'div[class*="stages_"]' },
      ],
      pad: 10,
    },
  },
  {
    name: 'palette',
    params: WILD,
    actions: [
      { press: 'Control+KeyK' },
      { set: { selector: 'input[data-autofocus]' }, value: 'ghost' },
      { wait: 400 },
    ],
    crop: 'dialog',
  },
  {
    name: 'chain',
    params: WILD,
    width: 1440,
    height: 980,
    actions: [{ click: { title: 'the whole chain' } }],
    crop: 'dialog',
  },
  {
    name: 'modulation',
    params: WILD,
    seed: {
      video_feedback_sections: sections({ Modulation: true }),
      video_feedback_mod: JSON.stringify([
        { target: 'hHold', source: 'sine', rateHz: 0.35, depth: 0.4 },
        { target: 'chromaGain', source: 'lorenz', rateHz: 0.12, depth: 0.25 },
      ]),
    },
    crop: { section: 'Modulation', pad: 10 },
  },
  {
    name: 'scenes',
    params: WILD,
    seed: {
      video_feedback_sections: sections({ Scenes: true }),
      video_feedback_scenes: JSON.stringify({
        1: { hHold: 0.4, noiseIre: 3 },
        2: { chromaGain: 2.2, svideoBleed: 0.8 },
        4: { fbMix: 0.6 },
      }),
    },
    crop: { section: 'Scenes', pad: 10 },
  },
  {
    name: 'audio',
    params: WILD,
    height: 1000,
    seed: {
      video_feedback_sections: sections({ 'Sound into the picture': true }),
    },
    crop: { section: 'Sound into the picture', pad: 10 },
  },
  {
    name: 'stage-menu',
    params: WILD,
    format: 'jpeg',
    width: 1000,
    height: 760,
    actions: [{ click: { title: 'menu (' } }],
    crop: 'stage',
  },
  {
    name: 'magnifier',
    params: wildWith('crtZoom:3.4,crtZoomX:0.44,crtZoomY:0.42'),
    format: 'jpeg',
    width: 1000,
    height: 760,
    crop: 'stage',
  },
  {
    ...PICTURE,
    name: 'scope',
    params: { ...WILD, dbg: '2' },
    maxWidth: 1200,
    width: 1000,
    height: 760,
  },
  {
    name: 'advanced',
    params: WILD,
    actions: [
      { click: { title: 'menu (' } },
      { click: { text: 'advanced settings' } },
    ],
    crop: 'dialog',
  },

  // The showcase gallery: six rolls of the app's own "surprise me", plus the
  // two hand-pushed looks that name a specific fault.
  roll('roll-1'),
  roll('roll-2'),
  roll('roll-3'),
  roll('roll-4'),
  roll('roll-5'),
  roll('roll-6'),

  // Clips: the four things a still cannot show — a feedback loop developing,
  // sync coming apart, a control moved by something other than a hand, and
  // everything at once.
  {
    name: 'clip-feedback',
    // The camera loop rather than the composite one: a zoom-and-rotate tunnel
    // builds over seconds, which is the thing a still can't say.
    params: {
      ...CAT,
      preset: 'fb bloom',
      set: 'fbMix:0.9,fbRotateDeg:4,fbGain:1.3',
    },
    width: 1320,
    height: 720,
    warm: 150,
    video: { secs: 8 },
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
    warm: 120,
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
