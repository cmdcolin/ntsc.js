import { CONTROL_KEYS, DEFAULT_CONTROLS } from '../controls'
import { randomIndex } from '../rng'
import { SLIDER_BY_KEY, VIEW_KEYS, snapToStep } from './controls'

import type { ControlKey, Controls } from '../controls'
import type { ModRouting } from './modSlots'

export interface PresetDef {
  // Identifier: camelCase, no spaces, since it lands bare in `?preset=` and in
  // MIDI-binding storage keys. `displayName` carries the words a name needed.
  name: string
  // The multi-word form a single-word `name` couldn't hold. Absent means
  // `name` is already what a chip, palette row, or MIDI label should show.
  displayName?: string
  group: string
  blurb: string
  patch: Partial<Controls>
  // How the look moves, if it moves at all. A preset without one says nothing
  // about motion rather than asserting stillness: clearing the bay on every
  // chip click would make each one destroy hand-patched routings, and most
  // presets have no opinion about whether an LFO is running.
  //
  // Avoid targeting the five filter controls (encChromaMHz, demodMHz,
  // chromaTail, lumaMHz, lumaPeak) — modulating one rebuilds the FIR bank every
  // frame, which is a real cost to hang on a preset someone clicked casually.
  mod?: readonly ModRouting[]
}

// What a chip, palette row, or MIDI label should show — never the bare
// identifier when a preset has words that didn't fit in it.
export const presetLabel = (p: PresetDef): string => p.displayName ?? p.name

// The same, from a name rather than the preset itself — for the callers that
// hold only what `?preset=` or `mix.lastPreset` carries, which is the
// identifier. Falls back to the name it was given, so a stored look naming a
// preset that has since been retired reads as itself rather than as nothing.
//
// Worth having as a function: `PRESETS.find(...)?.displayName ?? name` was
// written out at two call sites and about to be at a third (a strip row's
// suggested name), and the failure it produces is silent — a row called
// "neonTube" where the chip beside it says "neon tube".
export const presetLabelFor = (name: string): string => {
  const found = PRESETS.find(p => p.name === name)
  return found === undefined ? name : presetLabel(found)
}

// Built-in presets are absolute: defaults + patch. Ordered by group so the UI
// can render them under labeled headers.
export const PRESETS: PresetDef[] = [
  {
    name: 'clean',
    group: 'Clean',
    blurb:
      'Pristine studio signal — no artifacts. The baseline everything else departs from.',
    patch: {},
  },
  {
    name: 'vhs',
    group: 'Tape wear',
    blurb:
      'Home VHS: softened luma, color-under chroma, light head-switch wobble and specks.',
    patch: {
      lumaMHz: 2.8,
      lumaPeak: 0.8,
      noiseIre: 3,
      colorUnderMix: 1,
      underJitterDeg: 4,
      tbJitterNs: 150,
      tbWowNs: 300,
      headSwitchShiftUs: 0.8,
      headSwitchNoise: 0.4,
      dropoutRate: 6,
      demodMHz: 0.5,
    },
  },
  {
    name: 'protectedTape',
    displayName: 'protected tape',
    group: 'Tape wear',
    blurb:
      "A rental pressing with Macrovision on it, into a set whose AGC believes the lie: pulses in the vertical interval balloon the measured sync depth, so the gain crushes and recovers on the process's own slow cycle; colorstripe bands crawl down the frame wrong-hued; and a vertical hold this marginal lets the flashing bar itself ride into view.",
    patch: {
      macrovision: 0.9,
      mvStripeDeg: 110,
      agc: 1,
      vFreqHz: 59.9,
      vHold: 0.02,
      lumaMHz: 3,
      lumaPeak: 0.6,
      noiseIre: 2.5,
      colorUnderMix: 0.8,
      tbJitterNs: 120,
      headSwitchShiftUs: 0.6,
      headSwitchNoise: 0.3,
    },
  },
  {
    name: 'wornTape',
    displayName: 'worn tape',
    group: 'Tape wear',
    blurb:
      'Third-gen dub: mushy detail, heavy grain, frequent dropouts and bad tracking.',
    patch: {
      dubGens: 2,
      lumaMHz: 2.2,
      lumaPeak: 1.4,
      noiseIre: 7,
      colorUnderMix: 1,
      chromaNoiseIre: 9,
      underJitterDeg: 10,
      tbJitterNs: 400,
      tbWowNs: 900,
      headSwitchShiftUs: 1.6,
      headSwitchNoise: 0.8,
      dropoutRate: 25,
      dropoutLenUs: 9,
      ghostDelayUs: 3,
      ghostGain: 0.15,
      demodMHz: 0.45,
    },
  },
  {
    name: 'stickyShed',
    displayName: 'sticky shed',
    group: 'Tape wear',
    blurb:
      'A tape whose binder has gone hygroscopic, played unbaked: it grabs the drum, tension builds, breaks free, re-sticks — the relaxation oscillator behind squealing tapes. Bands of shear lean line by line, snap back, and hang where a strong patch holds, and because it is real timebase error the color-under phase rainbows at every slip boundary. Shedding oxide takes the RF down with it: heavy grain and a rash of dropouts where the coating let go.',
    patch: {
      tbStickNs: 1800,
      tbJitterNs: 100,
      lumaMHz: 2.5,
      lumaPeak: 1,
      noiseIre: 5,
      colorUnderMix: 1,
      chromaNoiseIre: 6,
      underJitterDeg: 6,
      headSwitchShiftUs: 1,
      headSwitchNoise: 0.5,
      dropoutRate: 18,
      dropoutLenUs: 7,
      demodMHz: 0.45,
    },
  },
  {
    name: 'pictureSearch',
    displayName: 'picture search',
    group: 'Tape wear',
    blurb:
      'Cue at 5x: the head crosses four tracks per sweep, noise bars sweeping the frame while the strips between them tear and rainbow.',
    patch: {
      shuttleX: 5,
      lumaMHz: 2.8,
      lumaPeak: 0.8,
      noiseIre: 3,
      colorUnderMix: 1,
      underJitterDeg: 4,
      tbJitterNs: 200,
      headSwitchShiftUs: 0.8,
      headSwitchNoise: 0.4,
      hHold: 0.3,
      demodMHz: 0.5,
    },
  },
  {
    name: 'stuckTape',
    displayName: 'stuck tape',
    group: 'Tape wear',
    blurb:
      'Deck jammed on pause: the head grinds one track boundary into a drifting noise bar, time crawls at a third of real speed, and phosphor trails smear what little still moves.',
    patch: {
      shuttleX: 0,
      timeScale: 0.35,
      phosphor: 0.9,
      lumaMHz: 2.6,
      lumaPeak: 1,
      noiseIre: 4,
      colorUnderMix: 1,
      underJitterDeg: 6,
      tbJitterNs: 300,
      tbWowNs: 500,
      headSwitchShiftUs: 1,
      headSwitchNoise: 0.5,
      hHold: 0.3,
    },
  },
  {
    name: 'trackingBand',
    displayName: 'tracking band',
    group: 'Tape wear',
    blurb:
      'The head riding half off its track: a band of hash where the signal is weakest, the picture bending through it, and colour dropping out across it because the 629 kHz carrier starves before the luma does. The thing the tracking knob on the front of the deck was for.',
    patch: {
      trackAmt: 0.55,
      trackPos: 0.62,
      headClog: 0.2,
      colorUnderMix: 1,
      chromaNoiseIre: 18,
      lumaMHz: 2.8,
      noiseIre: 3,
      tbJitterNs: 250,
      hHold: 0.25,
    },
    // A real deck's band never sits still — the tape stretches, the servo
    // hunts, and the band walks slowly up and down the frame. Slow enough to
    // read as drift rather than as something flapping.
    mod: [{ target: 'trackPos', source: 'smooth', rateHz: 0.08, depth: 0.25 }],
  },
  {
    name: 'fmFold',
    displayName: 'fm fold',
    group: 'Tape wear',
    blurb:
      'The white clip set too hot: every hard dark-to-bright edge overshoots past the FM response cliff and the discriminator folds back, trailing a black comet that boils frame to frame. Colour is recorded separately, so it rides straight through the fold — saturated hue smeared over black.',
    patch: {
      fmOverdev: 0.72,
      fmStreakUs: 0.45,
      lumaPeak: 2.4,
      lumaMHz: 3.2,
      colorUnderMix: 1,
      chromaGain: 1.3,
      noiseIre: 2.5,
    },
  },
  {
    name: 'colourLate',
    displayName: 'colour late',
    group: 'Tape wear',
    blurb:
      'Chroma group delay mistrimmed against luma: every coloured area sits bodily sideways off the edge it belongs to, bleeding out of one side of things and falling short of the other. The burst travels the same wrong path, so hue stays correct — displaced colour, not rotated, which is what tells it from a timebase fault.',
    patch: {
      ycDelayNs: 1120,
      colorUnderMix: 1,
      chromaGain: 1.4,
      lumaMHz: 3,
      noiseIre: 2,
    },
  },
  {
    name: 'tiredAmplifier',
    displayName: 'tired amplifier',
    group: 'Tape wear',
    blurb:
      'Both of the video amp’s brightness-dependent errors at once: saturation drains out of the highlights while the shadows keep theirs, and hue swings with the luma underneath it — so a face turns one way in the light and the other in the shadow. Measured on every VTR spec sheet ever printed as DG% and DP°.',
    patch: {
      diffGain: 0.8,
      diffPhaseDeg: 34,
      lumaPeak: 1.6,
      chromaGain: 1.2,
      agc: 0.3,
      noiseIre: 2,
    },
  },
  {
    name: 'broadcast',
    group: 'RF / Broadcast',
    blurb:
      'Clean over-the-air feed: a whisper of noise and a soft multipath ghost.',
    patch: { noiseIre: 1.2, ghostDelayUs: 1.8, ghostGain: 0.1, demodMHz: 0.8 },
  },
  {
    name: 'mistunedRf',
    displayName: 'mistuned rf',
    group: 'RF / Broadcast',
    blurb:
      'Tuner off-station: the sound carrier climbs out of its trap and the detector multiplies it against the picture — buzz weave, a coarse 920 kHz beat, rainbow crawl on fine detail — over snow, a hard ghost and a struggling AGC.',
    patch: {
      rfMistuneMHz: 0.55,
      noiseIre: 6,
      ghostDelayUs: 2.4,
      ghostGain: 0.18,
      agc: 0.4,
      tbJitterNs: 80,
    },
  },
  {
    name: 'adjacentChannel',
    displayName: 'adjacent channel',
    group: 'RF / Broadcast',
    blurb:
      'The next channel up the cable through a worn-out trap: not their picture — their carriers. Their sound lays a fine 1.5 MHz weave, their blanking crosses as slanted dark bars with the broad windshield-wiper band sweeping at its own drifting rate, and where their content beats into our chroma band the decoder invents confetti colour no camera ever shot.',
    patch: {
      rfAdjacent: 0.7,
      rfMistuneMHz: 0.2,
      noiseIre: 2,
      agc: 0.5,
      demodMHz: 0.8,
    },
  },
  {
    name: 'fringeReception',
    displayName: 'fringe reception',
    group: 'RF / Broadcast',
    blurb:
      'A station at the edge of its range, through the envelope detector that makes weak signal mean something: whites boil into snow first, blacks hold longest, sync dies last — a picture fighting through rather than sinking into grey fuzz, while a far-off reflection ghosts it and the AGC leans on what depth it can still find.',
    patch: {
      rfSnow: 0.5,
      agc: 0.7,
      ghostDelayUs: 3.5,
      ghostGain: 0.14,
      rfMistuneMHz: 0.1,
      hHold: 0.3,
    },
  },
  {
    name: 'ignitionStorm',
    displayName: 'ignition storm',
    group: 'RF / Broadcast',
    blurb:
      'Arc interference over a dim signal: storm-clustered hits from ticks to torn slabs, plus millisecond strikes — and every big one lands on sync and the beam load, so the raster tears, the supply rings, and the AGC claws its way back while the phosphor holds each flash. The rig reacting is most of the look.',
    patch: {
      impulseRate: 4,
      impulseIre: 120,
      strikeRate: 1.5,
      aGain: 0.3,
      agc: 0.6,
      hvSagUs: 8,
      hvRing: 0.8,
      crtCutoff: 0.1,
      phosphor: 0.88,
    },
  },
  {
    name: 'deadChannel',
    displayName: 'dead channel',
    group: 'RF / Broadcast',
    blurb:
      'No signal: full snow, hum bars, rolling picture and collapsing sync.',
    patch: {
      noiseIre: 32,
      killThresh: 8,
      agc: 0.7,
      hHold: 0.6,
      tbJitterNs: 600,
      tbWowNs: 1200,
      dropoutRate: 40,
      dropoutLenUs: 14,
      ghostDelayUs: 6,
      ghostGain: 0.3,
      humAmp: 8,
    },
  },
  {
    name: 'dimmerHash',
    displayName: 'dimmer hash',
    group: 'RF / Broadcast',
    blurb:
      'A triac dimmer on the same mains, firing twice a cycle at its set angle: the interference stops falling anywhere and bunches into two bands of hash that roll up the picture locked to the hum bar — same mains, so they travel together. Quieter than an arc storm and far more unsettling, because it is periodic.',
    patch: {
      impulseRate: 9,
      impulseHz: 420,
      impulseMains: 0.85,
      impulseIre: 90,
      humAmp: 14,
      humMod: 0.35,
      agc: 0.45,
      noiseIre: 3,
      phosphor: 0.8,
    },
  },
  {
    name: 'cbBreakthrough',
    displayName: 'cb breakthrough',
    group: 'RF / Broadcast',
    blurb:
      'An illegal linear two streets over pushing into the front end: a slow herringbone crawling over a weak picture, with the sound carrier leaking past its trap on top. The 1970s in one look.',
    patch: {
      ingress: 0.6,
      soundIre: 7,
      rfSnow: 0.3,
      rfAdjacent: 0.25,
      noiseIre: 6,
      agc: 0.5,
      lumaMHz: 3.4,
    },
    // A neighbour keying a microphone is not a steady tone — it comes and goes
    // in bursts, which is what makes it read as somebody talking.
    mod: [{ target: 'ingress', source: 'hold', rateHz: 0.6, depth: 0.4 }],
  },
  {
    name: 'scrambledChannel',
    displayName: 'scrambled channel',
    group: 'RF / Broadcast',
    blurb:
      'Premium channel with no decoder box: sync suppressed at the head-end, so every line lands at its own offset and the AGC winds up chasing a tip that is not there.',
    patch: {
      scramble: 0.55,
      hDetuneHz: 18,
      agc: 0.3,
      hHold: 0.45,
      noiseIre: 2,
    },
  },
  {
    name: 'ssavi',
    group: 'RF / Broadcast',
    blurb:
      "Zenith's system, undecoded: suppression plus video inversion, a shearing negative with the colour still in it.",
    patch: {
      scramble: 0.85,
      scrambleMode: 2,
      hDetuneHz: 20,
      agc: 0.4,
      hHold: 0.5,
      noiseIre: 2.5,
    },
  },
  {
    name: 'verticalHoldGone',
    displayName: 'vertical hold gone',
    group: 'Sync / Deflection',
    blurb:
      'Vertical oscillator detuned past its pull-in range: the picture scrolls forever, VBI bar and all, hooking sideways at every seam.',
    patch: {
      vFreqHz: 54,
      vHold: 0.35,
      syncBendUs: 7,
      hHold: 0.2,
      noiseIre: 2.5,
    },
    // A free-running vertical oscillator hunts: the roll speeds up and slows
    // as the divider drifts, which is the difference between a set that has
    // lost hold and a picture being scrolled at a constant rate.
    mod: [{ target: 'vFreqHz', source: 'smooth', rateHz: 0.08, depth: 0.015 }],
  },
  {
    name: 'bentScan',
    displayName: 'bent scan',
    group: 'Sync / Deflection',
    blurb:
      'Deflection bowed hard across the glass — the blanking interval itself curves through the picture.',
    patch: { bendUs: 24, bendShape: 2, syncBendUs: 4, noiseIre: 2 },
  },
  {
    name: 'supplyChaos',
    displayName: 'supply chaos',
    group: 'Sync / Deflection',
    blurb:
      'Beam current bending its own scan through a ringing HV supply: geometry driven by picture content, never repeating.',
    patch: {
      hvSagUs: 16,
      hvRing: 0.85,
      bGain: 0.55,
      bLineHz: 0.9,
      bDetuneHz: 130,
      bRollLps: 0.2,
      bRing: 0.3,
      noiseIre: 2,
    },
  },
  {
    name: 'fullCollapse',
    displayName: 'full collapse',
    group: 'Sync / Deflection',
    blurb:
      'Every deflection fault at once, feeding the mixer loop — bend, roll and beam load chasing each other frame to frame.',
    patch: {
      hvSagUs: 20,
      hvRing: 0.9,
      bendUs: 12,
      bendShape: 2,
      vFreqHz: 58.5,
      vHold: 0.4,
      syncBendUs: 6,
      hHold: 0.18,
      bGain: 0.6,
      bLineHz: 0.9,
      bDetuneHz: 130,
      bRollLps: 0.2,
      cfbMix: 0.45,
      cfbLines: 3,
      phosphor: 0.85,
      noiseIre: 3,
    },
  },
  {
    name: 'bassSmack',
    displayName: 'bass smack',
    group: 'Sync / Deflection',
    blurb:
      'Every kick slams the HV supply and knocks vertical hold loose, then it snaps back. Enable the microphone under Audio.',
    patch: {
      audioRoll: 5,
      audioTear: 130,
      audioLoad: 2.2,
      // a little standing sag for character, most of it on the onset so the
      // tube sits nearly still between hits and the kick actually lands
      hvSagUs: 7,
      audioSagUs: 24,
      hvRing: 0.8,
      vHold: 0.45,
      hHold: 0.3,
      phosphor: 0.8,
      noiseIre: 2,
    },
  },
  {
    name: 'mixerLoop',
    displayName: 'mixer loop',
    group: 'Feedback loops',
    blurb: 'Composite fed back into itself — each line echoes into the next.',
    patch: { cfbMix: 0.65, cfbDelayUs: 0.12, cfbLines: 3, noiseIre: 1.5 },
    // The loop delay is also a hue rotation, so drifting it by a fraction of a
    // microsecond walks the colour of every generation around the wheel while
    // the geometry stays put.
    mod: [{ target: 'cfbDelayUs', source: 'sine', rateHz: 0.12, depth: 0.01 }],
  },
  {
    name: 'loopBin',
    displayName: 'loop bin',
    group: 'Feedback loops',
    blurb:
      'A loop of tape past three heads: the picture comes back on a beat, a generation older each lap.',
    patch: {
      tapeMix: 0.6,
      tapeLoopMm: 30,
      tapeHeads: 3,
      tapeHfLoss: 0.4,
      tapeNoiseIre: 2,
      tapeSplice: 0.7,
      tapeWear: 0.015,
      tapeWowPct: 0.25,
      colorUnderMix: 0.5,
      phosphor: 0.75,
    },
    // The loop length is the delay, so walking it walks the echo spacing — and
    // because nothing time-base corrects the return, each new length hands back
    // a picture at a different height. Slow, because a transport has mass.
    mod: [
      { target: 'tapeLoopMm', source: 'smooth', rateHz: 0.05, depth: 0.06 },
    ],
  },
  {
    name: 'strobeTrails',
    displayName: 'strobe trails',
    group: 'Feedback loops',
    blurb: 'Held frames blended forward, smearing motion into long trails.',
    patch: {
      cfbMix: 0.6,
      cfbTrail: 0.9,
      cfbHold: 3,
      cfbDelayUs: 0.1,
      noiseIre: 2,
    },
  },
  {
    name: 'keyLoop',
    displayName: 'key loop',
    group: 'Feedback loops',
    blurb:
      'Luma-keyed feedback — only bright areas re-enter the loop and tunnel.',
    patch: {
      cfbMix: 0.8,
      cfbKey: 0.85,
      cfbKeyLevel: 45,
      cfbKeySoft: 8,
      cfbDelayUs: 0.25,
      cfbLines: 2,
      noiseIre: 1.5,
    },
  },
  {
    name: 'fbBloom',
    displayName: 'fb bloom',
    group: 'Feedback loops',
    blurb:
      'Camera-style zoom + rotate feedback blooming outward into a tunnel.',
    patch: {
      fbMix: 0.82,
      fbZoom: 1.045,
      fbRotateDeg: 2.5,
      fbGain: 1.18,
      fbFocus: 1.3,
      fbBlack: 0.05,
      fbKnee: 0.65,
      fbVign: 0.35,
      noiseIre: 1.5,
    },
    // Nobody holds a camera that still. A degree of sway on the mount is also
    // what keeps the loop from settling into one fixed pattern and sitting
    // there — the tunnel keeps finding new structure to breed.
    mod: [{ target: 'fbRotateDeg', source: 'sine', rateHz: 0.05, depth: 0.02 }],
  },
  {
    name: 'woundSpiral',
    displayName: 'wound spiral',
    group: 'Feedback loops',
    blurb:
      'The camera turned a few degrees on its mount and the exposure pushed past unity — each pass lands rotated and brighter than the last, so the subject smears into a spiral instead of a tunnel.',
    patch: {
      fbMix: 0.78,
      fbZoom: 1.015,
      fbRotateDeg: 3.2,
      fbShiftX: 0.03,
      fbGain: 1.1,
      fbFocus: 1.4,
      fbKnee: 0.6,
      fbVign: 0.45,
      fbBlack: 0.04,
      noiseIre: 2,
    },
  },
  {
    name: 'shadowLadder',
    displayName: 'shadow ladder',
    group: 'Feedback loops',
    blurb:
      'Loop key inverted so only the dark areas re-enter, stepped four lines every trip — the shadows climb the frame in rungs while the highlights stay put.',
    patch: {
      cfbMix: 0.75,
      cfbKey: -0.7,
      cfbLines: 4,
      cfbDelayUs: 0.2,
      noiseIre: 1.5,
    },
  },
  {
    name: 'ladderClimb',
    displayName: 'ladder climb',
    group: 'Feedback loops',
    blurb:
      'Frame store walking six lines up per pass with its peak-hold left on: trails stack into a bleached ladder and tear the picture off its own edges.',
    patch: {
      cfbMix: 0.7,
      cfbGain: 0.95,
      cfbLines: -6,
      cfbTrail: 0.85,
      cfbDelayUs: 0.06,
      noiseIre: 1.5,
    },
  },
  {
    name: 'subcarrierSiren',
    displayName: 'subcarrier siren',
    group: 'Feedback loops',
    blurb:
      'Resonance in the loop parked on the colour subcarrier and driven past unity: the filter stops responding to the picture and starts generating its own, in bands of pure hue.',
    patch: {
      cfbMix: 0.55,
      cfbFilterMHz: 3.6,
      cfbFilterQ: 0.85,
      cfbFilterBoost: 2.6,
      noiseIre: 1.5,
    },
    // What makes it a siren rather than a drone: an oscillator this close to
    // unity walks its own centre frequency as the loop warms, and the bands
    // sweep with it. Cheap to modulate — the loop resonance is designed per
    // frame in the shader, not baked into the FIR bank.
    mod: [
      { target: 'cfbFilterMHz', source: 'sine', rateHz: 0.04, depth: 0.03 },
    ],
  },
  {
    name: 'huntingServos',
    displayName: 'hunting servos',
    group: 'Feedback loops',
    blurb:
      "Two gain servos left underdamped — the beam limiter and the camera's auto-iris — each metering a loop it is inside. Neither can settle while the other moves, and their unequal rhythms beat: bloom, clamp, collapse, reopen, on no beat the content wrote.",
    patch: {
      abl: 0.8,
      fbIris: 0.9,
      fbMix: 0.5,
      fbZoom: 1.04,
      agc: 0.6,
      hvSagUs: 7,
      hvRing: 0.85,
      crtBloom: 0.3,
    },
  },
  {
    name: 'meltdown',
    group: 'Feedback loops',
    blurb:
      "The loop's delay trimmer bent onto its own video bus, so every lap the picture rewrites its own timing and hue — with a ring mod folding the products back in and every servo in the rack hunting. The image dissolves into flowing terrain that never repeats, because the displacement field is the picture one generation late.",
    patch: {
      cfbMix: 0.7,
      cfbGain: 1.06,
      cfbLines: 2,
      cfbDelayUs: 0.35,
      cfbServoUs: -4.5,
      cfbRing: 0.5,
      abl: 0.75,
      fbIris: 0.85,
      fbMix: 0.45,
      fbZoom: 1.03,
      hvSagUs: 9,
      hvRing: 0.9,
      accLagLines: 18,
      agc: 0.6,
      chromaGain: 1.8,
      crtSat: 1.3,
    },
  },
  {
    name: 'cleanDissolve',
    displayName: 'clean dissolve',
    group: 'A/B mixing',
    blurb:
      'Source B genlocked to the house reference and dissolved half over A — a clean switcher mix, no beat or roll.',
    patch: {
      bGenlock: 1,
      bGain: 0.5,
    },
  },
  {
    name: 'dirtyMix',
    displayName: 'dirty mix',
    group: 'A/B mixing',
    blurb:
      'Source B bleeds in off-frequency and off-line, tearing the horizontal sync.',
    patch: {
      bGain: 0.55,
      bLineHz: 0.6,
      bDetuneHz: 120,
      bRollLps: 0.2,
      hHold: 0.22,
      noiseIre: 2,
    },
  },
  {
    name: 'pauseFight',
    displayName: 'pause fight',
    group: 'A/B mixing',
    blurb:
      'The old rig: a VCR on pause into the dirty mixer. The held frame shreds through the live picture in torn bands — the paused deck free-runs with its servo defeated, the mistrack stripe walks, hue flickers between the drum’s two reads, and when the stripe crosses B’s vertical interval the sync fight rolls.',
    patch: {
      bGain: 0.5,
      bPause: 0.8,
      bLineHz: 0.2,
      bDetuneHz: 25,
    },
  },
  {
    name: 'pirateFeed',
    displayName: 'pirate feed',
    group: 'A/B mixing',
    blurb:
      'A scrambled premium channel on input A — sync suppressed at the head-end — with a pirate box summing a whisper of clean B in as substitute sync. The receiver almost saves the picture around the borrowed pulses, which is exactly how the real boxes worked; pull B gain to zero to watch it collapse into shear.',
    patch: {
      aScramble: 1,
      bGain: 0.22,
      bLineHz: 0.05,
      bDetuneHz: 15,
      bRollLps: 0,
    },
  },
  {
    name: 'negativeDrifter',
    displayName: 'negative drifter',
    group: 'A/B mixing',
    blurb:
      "SSAVI scrambling on input B alone: its sync goes toothless before the mix, so A holds the raster steady while B's picture leaks through as a negative — a ghost image in complementary luma drifting and beating through the program.",
    patch: {
      bScramble: 1,
      bScrambleMode: 2,
      bGain: 0.6,
      bDetuneHz: 60,
      bRollLps: 0.15,
    },
  },
  {
    name: 'houseDeckHeld',
    displayName: 'house deck held',
    group: 'A/B mixing',
    blurb:
      "The pause button on the deck feeding input A — the house reference itself. Every line of the program scatters around the defeated servo's wander, a mistrack stripe creeps through the picture, and the clean B summed underneath starts winning sync fights it used to lose.",
    patch: {
      aPause: 0.75,
      bGain: 0.35,
      bLineHz: 0.1,
      bDetuneHz: 30,
    },
  },
  {
    name: 'differenceKey',
    displayName: 'difference key',
    group: 'A/B mixing',
    blurb:
      'Source A inverted on its own bus fader and summed against B: where the two pictures agree they cancel to flat grey, where they differ the mix lights up, with a slow chroma beat riding through.',
    patch: {
      aGain: -1,
      bGain: 1,
      bLineHz: 0,
      bDetuneHz: 30,
      bRollLps: 0,
      noiseIre: 1.5,
    },
  },
  {
    name: 'dirtyDissolve',
    displayName: 'dirty dissolve',
    group: 'A/B mixing',
    blurb:
      'A manual crossfade on the summing bus — A pulled halfway down under B — but B is still off-frequency and off-line, so the dissolve beats and rolls instead of sitting clean like the genlocked one.',
    patch: {
      aGain: 0.5,
      bGain: 0.6,
      bLineHz: 0.3,
      bDetuneHz: 60,
      bRollLps: 0.12,
      hHold: 0.28,
      noiseIre: 1.8,
    },
  },
  {
    name: 'greenScreen',
    displayName: 'green screen',
    group: 'A/B mixing',
    blurb:
      "A chroma keyer across the mixer, slicing B's green out so A shows through it. B's hue is trimmed round so the two inputs disagree even when they are the same picture — the keyed band comes back in A's own colour while everything else stays rotated. Put different things in the two slots for the real thing, and note the edge: the keyer is on the bus, so it slices the chroma the encoder made, and that filter has no vertical term — the matte is soft across and razor sharp down, the way every composite key was.",
    patch: {
      bGenlock: 1,
      bGain: 1,
      bHueDeg: 150,
      bKey: 1,
      bKeyAcceptDeg: 34,
      bKeyClip: 0.06,
      bKeySoft: 0.04,
      bKeySpill: 0.8,
    },
  },
  {
    name: 'keySweep',
    displayName: 'key sweep',
    group: 'A/B mixing',
    blurb:
      "The keyer's backing colour walked round the wheel by an LFO, so the transparent hue travels and the picture dissolves into A one colour at a time. Best with the video synth in slot B: its colorizer turns level into hue, so B is a moving ramp *through* the wheel and the key cuts a band out of it — the acceptance angle becomes the width of the hole and the key hue becomes where it sits, with nothing anywhere drawing a stripe.",
    patch: {
      bGenlock: 1,
      bGain: 1,
      bKey: 1,
      bKeyAcceptDeg: 34,
      bKeyClip: 0.05,
      bKeySoft: 0.06,
      bKeySpill: 0.5,
      // Parked mid-wheel so the sweep below has room either side of it. The
      // control clamps at 0 and 360, and a sweep that runs into a clamp parks
      // the hole off the end of the picture for most of its cycle — which
      // reads as the preset doing nothing, not as a key at the end of its
      // travel.
      bKeyHueDeg: 180,
      synthShape: 0,
      synthAHz: 15754,
      synthColor: 1,
    },
    // Half depth over a 0..360 control: 90° to 270°, so the transparent hue
    // walks through green at 241 and out the other side without ever hitting
    // the rail.
    mod: [{ target: 'bKeyHueDeg', source: 'sine', rateHz: 0.09, depth: 0.5 }],
  },
  {
    name: 'keyIntoTheLoop',
    displayName: 'key into the loop',
    group: 'A/B mixing',
    blurb:
      "The mixer's own output patched into the keyer's fill input, so the feedback only regenerates inside the shape the key cut. What grows is the silhouette of whatever was the backing colour — the loop is bounded by a matte the picture is making for itself, and every lap it comes back a little further round the hue the delay spins it.",
    patch: {
      bGenlock: 1,
      bGain: 1,
      bHueDeg: 150,
      bKey: 1,
      bKeyAcceptDeg: 40,
      bKeySpill: 0.4,
      bKeyFill: 2,
      cfbMix: 0.62,
      cfbGain: 0.92,
      cfbDelayUs: 0.3,
      cfbLines: 2,
      phosphor: 0.35,
    },
  },
  {
    name: 'wipeFight',
    displayName: 'wipe fight',
    group: 'A/B mixing',
    blurb:
      'Two sources battling across a slowly sweeping wipe, sync fighting to hold.',
    patch: {
      bGain: 0.6,
      bLineHz: 1.2,
      bDetuneHz: 150,
      bRollLps: 0.15,
      wipeMode: 1,
      wipeSoft: 0.03,
      wipeRate: 0.25,
      hHold: 0.25,
      noiseIre: 2,
    },
  },
  {
    name: 'negative',
    group: 'Cross-wired',
    blurb:
      'Reversed polarity on the composite line — luma and every hue flip to their complement.',
    patch: { invert: 1 },
  },
  {
    name: 'sVideoMiswire',
    displayName: 's-video miswire',
    group: 'Cross-wired',
    blurb:
      'S-video pins jammed into a composite jack, the chroma pin making the best contact: color glows hot through a darkened, barely-locking picture, the subcarrier herringbones through brightness, detail decodes as rainbow blocks, and the frame rolls when the shallow sync loses its grip.',
    patch: {
      svideoBleed: 1,
      chromaGain: 2.6,
      demodMHz: 1.4,
      encChromaMHz: 2,
      chromaTail: 0.6,
      chromaCoarse: 2,
      chromaPinOnly: 0.5,
      hHold: 0.15,
      noiseIre: 2,
    },
  },
  {
    name: 'reversePolarity',
    displayName: 'reverse polarity',
    group: 'Bad cables',
    blurb:
      'Signal and ground fully swapped: sync inverts too, so the picture tears and rolls as colors flip.',
    patch: { polarityFlip: 1 },
  },
  {
    name: 'noTerminator',
    displayName: 'no terminator',
    group: 'Bad cables',
    blurb:
      'Unterminated line running hot — blown highlights and edges ringing from the reflected wave.',
    patch: { termination: 0.7, agc: 0.3 },
  },
  {
    name: 'daisyChained',
    displayName: 'daisy-chained',
    group: 'Bad cables',
    blurb:
      'Two monitors on one line double-terminate it: dim, washed out, sync barely holding.',
    // AGC now reaches the sync separator (it slices post-IF-gain), so a
    // strong AGC would quietly rescue this fault; a weak one keeps the look
    // the blurb promises while still breathing the way a real set's would.
    patch: { termination: -1.0, agc: 0.2, hHold: 0.5, noiseIre: 2 },
  },
  {
    name: 'chromaOnly',
    displayName: 'chroma only',
    group: 'Bad cables',
    blurb:
      'Only the chroma pin reaches the input — burst-locked color glowing on black, no luma to hold sync. The s-video miswire preset is this same patch at partial contact.',
    patch: { chromaPinOnly: 1, chromaGain: 1.4 },
  },
  {
    name: 'looseConnector',
    displayName: 'loose connector',
    group: 'Bad cables',
    blurb:
      'Intermittent contact: bands of the picture cut to snow and flicker as the plug wiggles.',
    patch: { connectorGlitch: 0.45, noiseIre: 2 },
  },
  {
    name: 'bentEnhancer',
    displayName: 'bent enhancer',
    group: 'Circuit bent',
    blurb:
      'Output bridged back to input through a resonant network, keyed by its own brightness: the band rings past unity and a woven oscillation eats into the picture wherever the loop finds light.',
    patch: {
      cfbMix: 0.55,
      cfbGain: 1.0,
      cfbDelayUs: 0.25,
      cfbLines: 1,
      cfbFilterMHz: 1.3,
      cfbFilterQ: 0.75,
      cfbFilterBoost: 2.0,
      cfbKey: 0.8,
      cfbKeyLevel: 52,
      cfbKeySoft: 10,
      noiseIre: 1.5,
    },
  },
  {
    name: 'contourLines',
    displayName: 'contour lines',
    group: 'Circuit bent',
    blurb:
      "The video synth patched over slot A with the picture's own brightness driving its oscillator. Frequency, not phase — so the wave genuinely runs faster through bright picture and slower through dark, equal-brightness regions fall into step, and the image draws itself as contour lines nobody traced. The colorizer turns those bands into hue, and the encoder downstream has a picture full of edges it was never designed to carry.",
    patch: {
      synthOver: 0.6,
      synthShape: 1,
      synthAHz: 32000,
      synthFm: 90000,
      synthColor: 0.75,
      synthLevel: 1.4,
      lumaPeak: 1.1,
      chromaGain: 1.2,
    },
  },
  {
    name: 'punchIn',
    displayName: 'punch in',
    group: 'Circuit bent',
    blurb:
      'A look that sits still until you hit it. The board rests just short of trouble, with two one-shot envelopes patched to the horizontal hold and the deflection bend — press ⚡ fire in the Modulation section (or the ⚡ on either slot) and the picture is knocked out of lock and recovers on its own, fast one and slow one together. The gesture the bay had no source for: everything else in there says what a knob is doing, this says what you just did.',
    patch: {
      hHold: 0.5,
      bendPeriod: 40,
      noiseIre: 1.5,
      lumaMHz: 3.2,
      phosphor: 0.3,
    },
    // Two rates on purpose: the fast one is the hit and the slow one is the
    // settle, and firing them together reads as one event with a tail rather
    // than two envelopes ending at different times.
    mod: [
      { target: 'hHold', source: 'trig', rateHz: 4, depth: 0.35 },
      { target: 'bendUs', source: 'trig', rateHz: 1.1, depth: 0.3 },
    ],
  },
  {
    name: 'rainbowStorm',
    displayName: 'rainbow storm',
    group: 'Circuit bent',
    blurb:
      'The 3.58 MHz crystal pulled far off-frequency: hue shears across every line and barber-poles down the frame faster than the burst loop can chase it.',
    patch: {
      scDetuneKHz: 7,
      burstLock: 0.55,
      chromaGain: 1.2,
      hHold: 0.25,
      noiseIre: 2,
    },
    // A crystal pulled off frequency does not sit still — it wanders with
    // temperature, which is why the barber pole in a real one never holds a
    // steady pitch. Smooth noise rather than a sine for the same reason.
    mod: [
      { target: 'scDetuneKHz', source: 'smooth', rateHz: 0.05, depth: 0.02 },
    ],
  },
  {
    name: 'neonTube',
    displayName: 'neon tube',
    group: 'Phosphor / CRT',
    blurb:
      'A camcorder pointed at a CRT at night: beam cutoff crushes the background to true black, gamma blooms the cores white-hot, and saturated colour stays electric at the clipping point.',
    patch: {
      crtCutoff: 0.12,
      crtGamma: 2.4,
      crtSat: 1.4,
      crtBloom: 0.6,
      crtHalation: 0.5,
      crtGlow: 0.3,
      chromaGain: 1.5,
    },
  },
  {
    name: 'strobedTube',
    displayName: 'strobed tube',
    group: 'Phosphor / CRT',
    blurb:
      'The blanking gate held on: the guns cut for most of each cycle and let through in short flashes, over a long-persistence phosphor. It does not cut to black — the gate is upstream of the phosphor, so the light already on the glass goes on giving itself back through the dark, cooling toward green as red and blue die first. The beam limiter sees the beam current collapse and opens up, so the first field after each dark stretch surges before the servo catches it. Lock the rate to the beat with ♩.',
    patch: {
      strobeHz: 3.5,
      strobeMs: 30,
      phosphor: 0.86,
      phosphorSkew: 0.5,
      phosphorBleed: 0.18,
      crtCutoff: 0.08,
      crtGamma: 1.7,
      crtHalation: 0.6,
      abl: 0.7,
      scanBeam: 0.35,
    },
  },
  {
    name: 'roundTube',
    displayName: 'round tube',
    group: 'Phosphor / CRT',
    blurb:
      'Early-60s colorimetry: the deep 1953 phosphors on an Illuminant-C white — green and red pull in, whites cool, bright lines fatten between visible scanlines, and a soft-focus gun bleeds every sample into its neighbours.',
    patch: {
      phosphorMode: 2,
      crtCutoff: 0.06,
      crtGamma: 2.2,
      crtSpot: 1.3,
      crtGrain: 0.16,
      crtBloom: 0.3,
      crtHalation: 0.3,
      crtGlow: 0.15,
      scanBeam: 0.45,
      scanBloom: 0.7,
      phosphor: 0.7,
      phosphorBleed: 0.2,
    },
  },
  {
    name: 'greenTerminal',
    displayName: 'green terminal',
    group: 'Phosphor / CRT',
    blurb:
      'Long-persistence mono green tube (P1 family): everything lands on one phosphor, and motion hangs as a seconds-long tail that sums like light, not paint — and keeps scattering sideways in the layer while it hangs, so old light goes soft and cloudy while the fresh edge stays sharp.',
    patch: {
      phosphorMode: 3,
      phosphor: 0.99,
      phosphorBleed: 0.35,
      crtCutoff: 0.08,
      crtGamma: 2.2,
      crtSpot: 1.2,
      crtGrain: 0.22,
      crtBloom: 0.5,
      scanBeam: 0.5,
      scanBloom: 0.5,
    },
  },
  {
    name: 'radarTube',
    displayName: 'radar tube',
    group: 'Phosphor / CRT',
    blurb:
      'A P7 cascade — the two-layer phosphor radar and scope tubes were coated with. The beam lands on a fast blue layer and dumps most of its light there at once, but what it excites underneath is a slow yellow-green that keeps emitting long after the blue has gone. So the tail is not one colour fading: the fresh edge is white, a few tenths of a second back it is amber, and what is still glowing seconds later is green. Nothing here tints anything — the three channels are just given the decay rates the two layers have, and the colour walk falls out of them dying at different speeds.',
    patch: {
      // Green holds ~2.5s; the skew puts red at a quarter of that and blue at a
      // seventh, which is the cascade. Bleed is high because the long layer is
      // what scatters — the old light in a scope tube goes cloudy while the
      // trace itself stays sharp.
      phosphor: 0.9925,
      phosphorSkew: 3,
      phosphorBleed: 0.3,
      // A scope tube is a dim tube read in a dark room: crushed black for the
      // tail to register against, and a real haze on the glass.
      crtCutoff: 0.1,
      crtGamma: 2.2,
      crtGlow: 0.35,
      crtGrain: 0.18,
      crtSpot: 1.3,
      // The trace is enormously brighter than anything around it, which is the
      // case keyed halation exists for: the live edge throws light well into the
      // faceplate while the decayed tail keeps a tight halo.
      crtBloom: 0.5,
      crtHalation: 0.4,
      crtHaloKey: 2,
      scanBeam: 0.2,
      scanBloom: 0.6,
    },
    // A tube like this says nothing on a still picture — the whole look is what
    // motion leaves behind it, so the preset brings its own sweep.
    mod: [{ target: 'bendUs', source: 'smooth', rateHz: 0.12, depth: 0.1 }],
  },
  {
    name: 'noseAgainstTheGlass',
    displayName: 'nose against the glass',
    group: 'Phosphor / CRT',
    blurb:
      'The magnifier, wound up: close enough to see what the picture is made of — grille triads, the gaps between scan lines, the granular deposit, and the beam spot bleeding one sample into the next. Drag the magnifier x/y sliders in Screen to move around the glass.',
    patch: {
      crtZoom: 5,
      // parked on a colour-bar boundary, where the beam spot's ramp from one
      // bar into the next is the thing to look at
      crtZoomX: 0.285,
      crtZoomY: 0.3,
      crtSpot: 1.4,
      crtGrain: 0.3,
      maskAmt: 0.55,
      maskPitch: 3,
      scanBeam: 0.6,
      scanBloom: 0.45,
      crtCutoff: 0.05,
      crtGamma: 2.1,
      crtGlow: 0.12,
    },
  },
  {
    name: 'bentDetailer',
    displayName: 'bent detailer',
    group: 'Circuit bent',
    blurb:
      "Jumper across the enhancer's peaking coil: the stage is regenerative, so the sync pulse at the head of every line sets it ringing and the bars build across the picture into the amplifier's rails.",
    patch: {
      enhPeakMHz: 2.5,
      enhPeakQ: 0.86,
      enhPeakBoost: 0.36,
      enhDroopUs: 120,
      noiseIre: 1.5,
      crtCutoff: 0.05,
      crtGamma: 2.1,
    },
  },
  {
    name: 'howlroundLoom',
    displayName: 'howlround loom',
    group: 'Circuit bent',
    blurb:
      "The enhancer's peaking coil regenerative and minting its own sync, fed into a loop whose delay its video is pulling and whose ring mod re-multiplies every product: the howl, the servo warp and the raster lock weave a full-field electric tapestry with no picture left in it.",
    patch: {
      enhPeakMHz: 1.9,
      enhPeakQ: 0.95,
      enhPeakBoost: 3,
      enhSync: 0.8,
      enhSliceIre: 35,
      cfbMix: 0.6,
      cfbGain: 1.05,
      cfbServoUs: 3,
      cfbRing: 0.45,
      cfbLines: 1,
      abl: 0.7,
      fbIris: 0.8,
      fbMix: 0.35,
      fbZoom: 1.04,
      agc: 0.8,
      accLagLines: 14,
      chromaGain: 2,
      matrixClip: 0.7,
      crtSat: 1.4,
    },
  },
  {
    name: 'falseSync',
    displayName: 'false sync',
    group: 'Circuit bent',
    blurb:
      "The stabilizer's sync slicer bent up into picture territory: every dark area mints pulses of its own mid-line, and the set tears wherever the image goes dark.",
    patch: {
      enhSync: 1,
      enhSliceIre: 14,
      enhClampUs: 6,
      hHold: 0.6,
      noiseIre: 2,
    },
  },
  {
    name: 'blackRestore',
    displayName: 'black restore',
    group: 'Phosphor / CRT',
    blurb:
      'Just the beam transfer — cutoff and gun gamma with no bloom. Lifts the decoded pedestal off the floor for a clean tube with a genuinely black background.',
    patch: {
      crtCutoff: 0.08,
      crtGamma: 2.2,
    },
  },
  {
    name: 'magnetised',
    group: 'Phosphor / CRT',
    blurb:
      'A speaker left against the cabinet, or a set moved without degaussing: a patch of mask stays magnetised and bends all three beams together. A triad is three dots 120° apart, so the same nudge over-excites the one it moves toward and starves the one opposite — the stain turns hue across itself instead of tinting flat, and it is fixed on the glass, so a rolling picture travels through it.',
    patch: {
      crtPurity: 1.1,
      crtPurityX: 0.31,
      crtPurityY: 0.63,
      crtPuritySize: 0.34,
      maskAmt: 0.45,
      maskPitch: 3,
      crtCutoff: 0.08,
      crtGamma: 2.2,
      crtSpot: 1.1,
      scanBeam: 0.4,
      scanBloom: 0.5,
    },
  },
  {
    name: 'misconverged',
    group: 'Phosphor / CRT',
    blurb:
      'Three guns firing through one mask from three positions, registered only in the middle: sharp at the centre and fringing red and blue harder toward every corner. With the scan-velocity trick wired in on top, edges also get the asymmetric relief consumer sets used to fake sharpness — a white overshoot one side, a black notch the other.',
    patch: {
      crtConverge: 2.6,
      crtSvm: 1.2,
      crtSvmWidth: 3,
      maskAmt: 0.5,
      maskPitch: 3.5,
      crtSpot: 1.4,
      scanBeam: 0.45,
      scanBloom: 0.55,
      crtCutoff: 0.08,
      crtGamma: 2.2,
    },
  },
  // Stacks rather than single mechanisms: several stages misbehaving at once,
  // interfering with each other. The rest of the table is deliberately one
  // fault per preset — it is what makes a chip teachable — but the looks people
  // actually keep are usually three of them at the same time, and nothing here
  // reached that on its own.
  {
    name: 'transmissionFault',
    displayName: 'transmission fault',
    group: 'Full board',
    blurb:
      'Sync suppressed at the head-end while the colour crystal sits off frequency and the tube is left long: every line lands at its own offset, in the wrong hue, over the ghost of the last one.',
    patch: {
      scramble: 0.35,
      agc: 0.5,
      hHold: 0.3,
      hDetuneHz: 30,
      syncBendUs: 5,
      scDetuneKHz: 5,
      burstLock: 0.6,
      chromaGain: 1.6,
      encChromaMHz: 1.7,
      demodMHz: 1.1,
      noiseIre: 8,
      phosphor: 0.75,
      crtBloom: 0.4,
      crtGamma: 1.4,
    },
  },
  {
    name: 'nightMonitor',
    displayName: 'night monitor',
    group: 'Full board',
    blurb:
      'A monitor run hot in a dark room with a camera on it: the loop breeds halos out of the highlights, the faceplate scatters them, and the phosphor holds what is left.',
    patch: {
      fbMix: 0.55,
      fbZoom: 1.01,
      fbGain: 1.06,
      fbFocus: 2,
      fbKnee: 0.7,
      fbVign: 0.6,
      crtBloom: 1,
      crtHalation: 0.9,
      crtGlow: 0.25,
      crtCutoff: 0.06,
      crtGamma: 1.5,
      crtSat: 1.3,
      phosphor: 0.9,
      noiseIre: 2,
    },
    // A loop sitting a hair over unity is a knife edge, and a tube warming up
    // does not hold a bias steady. Drifting the exposure across that edge is
    // what makes the halos breathe instead of settling.
    mod: [{ target: 'fbGain', source: 'smooth', rateHz: 0.03, depth: 0.01 }],
  },
  {
    name: 'deepEnd',
    displayName: 'deep end',
    group: 'Full board',
    blurb:
      'Every stage at once — scrambled sync, a bent enhancer, both feedback loops and the phosphor left long. Nothing here is drawn: each fault is one circuit misbehaving, and they interfere with each other for free.',
    patch: {
      chromaGain: 2.4,
      svideoBleed: 0.8,
      chromaTail: 0.4,
      encChromaMHz: 1.85,
      demodMHz: 1.23,
      vHold: 0.4,
      vFreqHz: 59.6,
      syncBendUs: 6,
      bendUs: 22,
      bendShape: 2,
      hvSagUs: 12,
      hvRing: 0.8,
      hDetuneHz: 24,
      scramble: 0.4,
      agc: 0.5,
      noiseIre: 7,
      enhPeakMHz: 0.35,
      enhPeakQ: 0.7,
      enhPeakBoost: 0.06,
      fbMix: 0.5,
      fbZoom: 1.03,
      fbRotateDeg: 2,
      fbGain: 0.96,
      fbFocus: 1.1,
      fbVign: 0.4,
      fbBlack: 0.02,
      fbKnee: 0.6,
      cfbMix: 0.35,
      cfbGain: 0.8,
      cfbDelayUs: 0.25,
      cfbLines: 3,
      cfbKey: 0.7,
      cfbKeySoft: 10,
      phosphor: 0.9,
    },
  },
  // Past the redline: every patch below sets at least one control beyond the
  // range it was tuned to, so none of these were reachable before the travel
  // was widened — which is the argument for writing them down rather than
  // leaving the extra range to be found by dragging a slider into its stop.
  //
  // Still the house rule: model the mechanism, let the look emerge. What is
  // different out here is only that the mechanisms are being driven past
  // anything the hardware would have survived, so what they interfere into is
  // no longer a broken television. They are aimed at disagreeing across the
  // frame rather than pumping all of it together — eight heads at uneven
  // spacing, arcs that cluster, a loop ringing against its own rails.
  {
    name: 'pastTheYoke',
    displayName: 'past the yoke',
    group: 'Past the redline',
    blurb:
      'The scan magnified far past anything the tube would frame, then rippled: a narrow band of raster standing in for a picture, bending against its own beam current.',
    patch: {
      vSize: 3.4,
      bendUs: 70,
      bendShape: 3,
      bendPeriod: 9,
      hvSagUs: 60,
      hvRing: 0.9,
      abl: 0.5,
      hDetuneHz: 900,
      phosphor: 0.85,
      noiseIre: 3,
    },
  },
  {
    name: 'arcStorm',
    displayName: 'arc storm',
    group: 'Past the redline',
    blurb:
      'Eighteen arcs a frame at three times peak white, over a tape that has shed most of its oxide. The hits arrive clustered and the stick-slip shear moves under them, so nothing lands twice in the same place.',
    patch: {
      impulseRate: 18,
      impulseIre: 320,
      strikeRate: 11,
      dropoutRate: 220,
      dropoutLenUs: 40,
      // Enough snow to read as a failing front end, not so much that it buries
      // the arcs and the shear — those are the mechanisms this is about, and
      // past about 40 IRE the uniform noise is all that is left.
      noiseIre: 32,
      tbStickNs: 8000,
      tbJitterNs: 2200,
      phosphor: 0.88,
    },
  },
  {
    name: 'eightHeadLap',
    displayName: 'eight-head lap',
    group: 'Past the redline',
    blurb:
      'Eight heads crowded toward the record end of a six-millimetre loop, running five times play speed. A lap returns eight times at uneven spacing, so the echoes interfere across the frame instead of ticking.',
    patch: {
      tapeMix: 0.85,
      // Unity, not above it. Eight taps summing into a loop that only clips
      // (the play path rails at 140 IRE) means any spare gain is spent whiting
      // the whole frame out inside a second — the taps stop being separable,
      // which is the one thing this patch is for. The wear and the HF loss are
      // what keep it moving instead.
      tapeGain: 1,
      tapeHeads: 8,
      tapeHeadSpread: 2.4,
      tapeLoopMm: 6,
      tapeWear: 0.35,
      tapeSplice: 0.8,
      tapeHfLoss: 0.5,
      colorUnderMix: 0.6,
      phosphor: 0.78,
    },
  },
  {
    name: 'railSlam',
    displayName: 'rail slam',
    group: 'Past the redline',
    blurb:
      'The composite bus fed back at more than unity, ninety lines up, through a resonance that howls. The loop clips to a square and stays there — it cannot run away, so what it does instead is ring.',
    patch: {
      // Just over unity, not far over. The loop clips instead of diverging, so
      // gain this side of the rail rings and gain well past it just pins every
      // sample to +110 and hands back a flat white frame — the saturation is
      // the sound, but only while something still gets through unsaturated.
      cfbMix: 0.93,
      cfbGain: 1.1,
      cfbTrail: 0.96,
      cfbLines: 90,
      cfbDelayUs: 22,
      cfbFilterMHz: 2.4,
      cfbFilterQ: 0.85,
      cfbFilterBoost: 5,
      cfbRing: 0.5,
      noiseIre: 2,
    },
  },
  {
    name: 'lightThatStays',
    displayName: 'light that stays',
    group: 'Past the redline',
    blurb:
      'A phosphor that gives almost nothing back, scattering sideways as it goes, under a gun with its gamma turned inside out. Everything the beam has touched is still on the glass, spreading.',
    patch: {
      phosphor: 0.999,
      phosphorBleed: 0.9,
      phosphorSkew: 5,
      // Gamma this far under 1 lifts the floor as hard as it lifts the mids,
      // and a tube whose black is white has nothing for the glow to sit on. The
      // cutoff puts the floor back: the gun stays off below the knee, so the
      // lifted part is only what the beam actually lit.
      crtGamma: 0.4,
      crtCutoff: 0.15,
      crtSat: 4.5,
      crtBloom: 3,
      crtHalation: 2.5,
      crtSpot: 6,
    },
    // A phosphor that holds this long has nothing to show on a still frame —
    // the trail IS the motion, so with a static source the whole patch reads as
    // a slightly soft picture. Lorenz rather than an LFO because a periodic
    // sweep would lay its trail back down on itself every cycle and average
    // out; the chaotic one never quite repeats, so the light accumulates
    // somewhere new each pass and the smear stays spatial.
    mod: [{ target: 'bendUs', source: 'lorenz', rateHz: 0.08, depth: 0.04 }],
  },
]

export function presetControls(patch: Partial<Controls>): Controls {
  return { ...DEFAULT_CONTROLS, ...patch }
}

export function controlsEqual(a: Controls, b: Controls): boolean {
  return CONTROL_KEYS.every(k => a[k] === b[k])
}

// Each authored patch resolved against the defaults, once, at module load. The
// patches are static, so the resolution is too — and everything that compares
// against a preset (`matchPreset` on every panel render, the blender on every
// pointer step of a weight drag) was rebuilding all 66 full 213-key objects to
// do it. That was half a millisecond per write, spent re-deriving a constant.
const PRESET_FULL: ReadonlyMap<PresetDef, Controls> = new Map(
  PRESETS.map(p => [p, presetControls(p.patch)]),
)

// A preset's full control-set. Falls back to resolving on the spot for a def
// that isn't one of PRESETS' own — nothing hands one in today, and the map
// lookup should not be the reason that stops working.
export function fullControls(p: PresetDef): Controls {
  return PRESET_FULL.get(p) ?? presetControls(p.patch)
}

// The preset whose full control-set exactly matches `values`, if any.
export function matchPreset(values: Controls): PresetDef | undefined {
  return PRESETS.find(p => controlsEqual(fullControls(p), values))
}

// How much of each preset is dialed in, by preset name. Absent or 0 is off.
export type PresetWeights = ReadonlyMap<string, number>

// Which controls a preset moves off stock. Derived once per preset from the
// same PRESET_FULL the blender reads, because the roll now has to know what a
// candidate would tread on before it picks it.
const PRESET_KEYS: ReadonlyMap<string, ReadonlySet<ControlKey>> = new Map(
  PRESETS.map(p => {
    const full = fullControls(p)
    return [
      p.name,
      new Set(CONTROL_KEYS.filter(k => full[k] !== DEFAULT_CONTROLS[k])),
    ]
  }),
)

// Fisher-Yates. `toSorted(() => rand() - 0.5)` is the idiom this used to use and
// it is not a shuffle: a comparator that ignores its arguments biases toward the
// input order by an amount that depends on the sort implementation, and what is
// being ordered here is which preset family gets to lead the roll. Measured over
// 40000 draws on this engine, against a fair 9.1% each: Tape wear led 18.1% of
// rolls and Phosphor / CRT 5.5%, a 3.3x spread across families, purely from
// where they sit in this file. Somebody rolling and rolling and getting tape
// again was reading the sort comparator, not the presets. (`vote/candidates.ts`
// spells the same shuffle out for the same reason; when its TODO to take a
// seeded `rand` through here lands, the two can share one.)
function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// How much overlap a follower may have with the controls already claimed. Not
// zero: a couple of shared controls is two faults meeting, which is the point.
// Past that they are arguing about the same knob rather than stacking.
const MAX_TREAD = 2

// A fresh recipe: one full preset plus one or two partial ones from other
// groups, so a roll crosses families instead of deepening one. Shared by the
// "random look" button and by `?surprise` on a link, which is how the docs
// harness fills a gallery without clicking anything.
//
// Followers are chosen against what is already claimed rather than at random
// within their group, because `blendPresets` *sums* departures from stock: when
// two presets both move a control, the roll lands somewhere neither author put
// it. Over 4000 simulated rolls that was 1.6 controls fought over and 1.0
// pushed past every contributing preset, per roll — the arithmetic, not a look
// anybody designed, and the readiest explanation for a roll coming out mush.
// Picking the least-treading candidate in each group and skipping a group whose
// best still collides takes that to 0.4 fought over and 0.3 overshot, and costs
// about 1.5 of the ~10.8 controls a roll's followers used to add.
//
// Summing stays as it is. It is what dragging two chips by hand means, and the
// roll has no business redefining that for the mixer — this fixes the roll by
// not handing the blender an argument in the first place.
export function randomPresetMix(
  sourceBOn: boolean,
  rand: () => number = Math.random,
): PresetWeights {
  const pool = PRESETS.filter(
    p => p.group !== 'Clean' && (sourceBOn || p.group !== 'A/B mixing'),
  )
  const groups = shuffled([...new Set(pool.map(p => p.group))], rand)
  // Two most of the time. Three whole authored looks at once — which is what a
  // 50/50 split was rolling — is a lot of picture to ask one frame to hold, and
  // the third is the one most likely to be the fault that tipped it over.
  const wanted = rand() < 0.3 ? 3 : 2
  const lead = pool.filter(p => p.group === groups[0])
  const first = lead[randomIndex(lead.length, rand)]
  const weights = new Map<string, number>([[first.name, 1]])
  const claimed = new Set(PRESET_KEYS.get(first.name))
  for (const g of groups.slice(1)) {
    if (weights.size >= wanted) break
    // 'Full board' presets are complete looks in themselves — as a lead that is
    // the point of them, on top of one it is a second whole board.
    const opts = pool.filter(p => p.group === g && p.group !== 'Full board')
    if (opts.length === 0) continue
    const best = opts
      .map(p => ({
        p,
        tread: [...(PRESET_KEYS.get(p.name) ?? [])].filter(k => claimed.has(k))
          .length,
      }))
      .toSorted((a, b) => a.tread - b.tread)[0]
    if (best.tread > MAX_TREAD) continue
    // Lower than the 0.3-0.8 this used to roll. A follower at 0.8 is not a
    // seasoning on the lead, it is a second look at nearly full strength, and
    // two of those over a lead is where "fun but not the best settings" came
    // from. Still enough to read: these are departures from stock, so a quarter
    // of a fault is a quarter of something that was designed to be visible.
    weights.set(best.p.name, 0.25 + rand() * 0.25)
    for (const k of PRESET_KEYS.get(best.p.name) ?? []) claimed.add(k)
  }
  return weights
}

// Controls holding a mode rather than a quantity: halfway between phosphor 0
// and 3 is not phosphor 1.5, it is a tube nobody asked for. The heaviest
// preset that moves one of these off its default picks the mode outright.
// Derived from which controls declare `choices`, so the blender and the panel's
// toggle groups can't drift from one hand-kept list.
// Exported for the morph, which needs the same list for the same reason and
// must not keep a second one: a mode cannot be halfway between two values
// whether you get there by mixing or by travelling.
export const ENUM_KEYS: ReadonlySet<ControlKey> = new Set<ControlKey>(
  [...SLIDER_BY_KEY.values()].filter(s => s.choices).map(s => s.key),
)

// Snap a summed value back onto its slider's range and grid, so a mix lands on
// values the UI can actually show and `matchPreset` can compare exactly.
function quantize(key: ControlKey, v: number): number {
  const s = SLIDER_BY_KEY.get(key)
  return s === undefined ? v : snapToStep(s, v)
}

// What a recipe says about motion: the heaviest preset that carries routings
// wins outright, its depths scaled by how much of it is in.
//
// Routings do not sum the way control departures do — they are patch cables,
// and half of one cable plus half of another is not a quieter version of both,
// it is a different bay. So this follows the ENUM_KEYS rule instead: the
// heaviest mover picks, everyone else abstains. `null` is "the recipe has no
// opinion", which the caller reads as leave the bay alone.
export function blendMod(weights: PresetWeights): ModRouting[] | null {
  const winner = weights
    .entries()
    .filter(([, w]) => w > 0)
    .toArray()
    .toSorted(([, a], [, b]) => b - a)
    .flatMap(([name, w]) => {
      const def = PRESETS.find(p => p.name === name)
      return def?.mod === undefined ? [] : [{ w, mod: def.mod }]
    })
    .at(0)
  return winner === undefined
    ? null
    : winner.mod.map(m => ({ ...m, depth: m.depth * winner.w }))
}

// Presets mix by summing their departures from default onto `baseline`, so
// dialing in two faults accumulates both instead of the later one winning.
// Weight 1 on a single preset over the default baseline reproduces
// `presetControls(patch)` exactly, which is what keeps `matchPreset` honest.
export function blendPresets(
  baseline: Controls,
  weights: PresetWeights,
): Controls {
  const active = weights
    .entries()
    .filter(([, w]) => w > 0)
    .toArray()
    .toSorted(([, a], [, b]) => b - a)
    .flatMap(([name, w]) => {
      const def = PRESETS.find(p => p.name === name)
      return def === undefined ? [] : [{ w, full: fullControls(def) }]
    })
  const out = { ...baseline }
  for (const k of CONTROL_KEYS) {
    const moved = active.filter(a => a.full[k] !== DEFAULT_CONTROLS[k])
    if (moved.length > 0) {
      // `active` is heaviest-first, so the leading mover wins the enum keys.
      out[k] = ENUM_KEYS.has(k)
        ? moved[0].full[k]
        : quantize(
            k,
            moved.reduce(
              (acc, a) => acc + a.w * (a.full[k] - DEFAULT_CONTROLS[k]),
              baseline[k],
            ),
          )
    }
  }
  return out
}

// The board a roll means: the recipe over stock, with the view controls taken
// back from `view` instead of from the recipe.
//
// One function because there are two roll paths — the button in `useMix` and
// `?surprise` on boot in `useEngine` — and they are one verb that has to reach
// one place. Each used to carry its own copy of this rule and one of them was
// missing it, which is not a thing anybody notices by reading: it shows up as
// a link occasionally opening the app on a picture the size of a stamp, weeks
// later, with nothing to connect it to.
//
// What `view` should be differs, and that is the argument rather than a second
// branch in here. The button keeps where the magnifier already is, because a
// roll has no business moving your eye mid-session; the boot path has no
// "already" to keep and passes stock.
export function rollControls(weights: PresetWeights, view: Controls): Controls {
  const out = blendPresets(DEFAULT_CONTROLS, weights)
  for (const key of VIEW_KEYS) out[key] = view[key]
  return out
}
