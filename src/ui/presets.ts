import { CONTROL_KEYS, DEFAULT_CONTROLS } from '../controls'
import { SLIDER_BY_KEY, snapToStep } from './controls'

import type { ControlKey, Controls } from '../controls'
import type { ModRouting } from './modSlots'

export interface PresetDef {
  name: string
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
    name: 'protected tape',
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
    name: 'worn tape',
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
    name: 'picture search',
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
    name: 'stuck tape',
    group: 'Tape wear',
    blurb:
      'Deck jammed on pause: the head grinds one track boundary into a drifting noise bar, time crawls at a third of real speed, and phosphor trails smear what little still moves.',
    patch: {
      shuttleX: 0,
      timeScale: 0.35,
      phosphor: 0.6,
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
    name: 'broadcast',
    group: 'RF / Broadcast',
    blurb:
      'Clean over-the-air feed: a whisper of noise and a soft multipath ghost.',
    patch: { noiseIre: 1.2, ghostDelayUs: 1.8, ghostGain: 0.1, demodMHz: 0.8 },
  },
  {
    name: 'mistuned rf',
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
    name: 'adjacent channel',
    group: 'RF / Broadcast',
    blurb:
      "The next channel up the cable through a worn-out trap: not their picture — their carriers. Their sound lays a fine 1.5 MHz weave, their blanking crosses as slanted dark bars with the broad windshield-wiper band sweeping at its own drifting rate, and where their content beats into our chroma band the decoder invents confetti colour no camera ever shot.",
    patch: {
      rfAdjacent: 0.7,
      rfMistuneMHz: 0.2,
      noiseIre: 2,
      agc: 0.5,
      demodMHz: 0.8,
    },
  },
  {
    name: 'fringe reception',
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
    name: 'ignition storm',
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
      phosphor: 0.8,
      phosphorDecayMix: 0.15,
    },
  },
  {
    name: 'dead channel',
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
    name: 'scrambled channel',
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
    name: 'vertical hold gone',
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
    name: 'bent scan',
    group: 'Sync / Deflection',
    blurb:
      'Deflection bowed hard across the glass — the blanking interval itself curves through the picture.',
    patch: { bendUs: 24, bendShape: 2, syncBendUs: 4, noiseIre: 2 },
  },
  {
    name: 'supply chaos',
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
    name: 'full collapse',
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
      phosphor: 0.6,
      noiseIre: 3,
    },
  },
  {
    name: 'bass smack',
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
      phosphor: 0.5,
      noiseIre: 2,
    },
  },
  {
    name: 'mixer loop',
    group: 'Feedback loops',
    blurb: 'Composite fed back into itself — each line echoes into the next.',
    patch: { cfbMix: 0.65, cfbDelayUs: 0.12, cfbLines: 3, noiseIre: 1.5 },
    // The loop delay is also a hue rotation, so drifting it by a fraction of a
    // microsecond walks the colour of every generation around the wheel while
    // the geometry stays put.
    mod: [{ target: 'cfbDelayUs', source: 'sine', rateHz: 0.12, depth: 0.01 }],
  },
  {
    name: 'loop bin',
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
      phosphor: 0.35,
    },
    // The loop length is the delay, so walking it walks the echo spacing — and
    // because nothing time-base corrects the return, each new length hands back
    // a picture at a different height. Slow, because a transport has mass.
    mod: [
      { target: 'tapeLoopMm', source: 'smooth', rateHz: 0.05, depth: 0.06 },
    ],
  },
  {
    name: 'strobe trails',
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
    name: 'key loop',
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
    name: 'fb bloom',
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
    name: 'wound spiral',
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
    name: 'shadow ladder',
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
    name: 'ladder climb',
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
    name: 'subcarrier siren',
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
    name: 'hunting servos',
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
    name: 'clean dissolve',
    group: 'A/B mixing',
    blurb:
      'Source B genlocked to the house reference and dissolved half over A — a clean switcher mix, no beat or roll.',
    patch: {
      bGenlock: 1,
      bGain: 0.5,
    },
  },
  {
    name: 'dirty mix',
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
    name: 'pause fight',
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
    name: 'pirate feed',
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
    name: 'negative drifter',
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
    name: 'house deck held',
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
    name: 'difference key',
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
    name: 'dirty dissolve',
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
    name: 'wipe fight',
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
    name: 's-video miswire',
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
    name: 'reverse polarity',
    group: 'Bad cables',
    blurb:
      'Signal and ground fully swapped: sync inverts too, so the picture tears and rolls as colors flip.',
    patch: { polarityFlip: 1 },
  },
  {
    name: 'no terminator',
    group: 'Bad cables',
    blurb:
      'Unterminated line running hot — blown highlights and edges ringing from the reflected wave.',
    patch: { termination: 0.7, agc: 0.3 },
  },
  {
    name: 'daisy-chained',
    group: 'Bad cables',
    blurb:
      'Two monitors on one line double-terminate it: dim, washed out, sync barely holding.',
    // AGC now reaches the sync separator (it slices post-IF-gain), so a
    // strong AGC would quietly rescue this fault; a weak one keeps the look
    // the blurb promises while still breathing the way a real set's would.
    patch: { termination: -1.0, agc: 0.2, hHold: 0.5, noiseIre: 2 },
  },
  {
    name: 'chroma only',
    group: 'Bad cables',
    blurb:
      'Only the chroma pin reaches the input — burst-locked color glowing on black, no luma to hold sync. The s-video miswire preset is this same patch at partial contact.',
    patch: { chromaPinOnly: 1, chromaGain: 1.4 },
  },
  {
    name: 'loose connector',
    group: 'Bad cables',
    blurb:
      'Intermittent contact: bands of the picture cut to snow and flicker as the plug wiggles.',
    patch: { connectorGlitch: 0.45, noiseIre: 2 },
  },
  {
    name: 'bent enhancer',
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
    name: 'rainbow storm',
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
    name: 'neon tube',
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
    name: 'round tube',
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
      phosphor: 0.4,
      phosphorBleed: 0.2,
    },
  },
  {
    name: 'green terminal',
    group: 'Phosphor / CRT',
    blurb:
      'Long-persistence mono green tube (P1 family): everything lands on one phosphor, and motion hangs as a seconds-long tail that sums like light, not paint — and keeps scattering sideways in the layer while it hangs, so old light goes soft and cloudy while the fresh edge stays sharp.',
    patch: {
      phosphorMode: 3,
      phosphor: 0.99,
      phosphorDecayMix: 0.35,
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
    name: 'across the room',
    group: 'Phosphor / CRT',
    blurb:
      'The magnifier wound the other way, further back than the slider ever goes: the tube stops being the whole world and turns into an object — a little set with its face bulging out at you, glowing into a dark room.',
    patch: {
      crtZoom: 0.42,
      crtCutoff: 0.07,
      crtGamma: 2.2,
      crtBloom: 0.45,
      crtHalation: 0.35,
      crtGlow: 0.2,
      crtSpot: 1,
      crtGrain: 0.14,
      phosphor: 0.3,
      phosphorBleed: 0.2,
    },
  },
  {
    name: 'nose against the glass',
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
    name: 'bent detailer',
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
    name: 'howlround loom',
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
    name: 'false sync',
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
    name: 'black restore',
    group: 'Phosphor / CRT',
    blurb:
      'Just the beam transfer — cutoff and gun gamma with no bloom. Lifts the decoded pedestal off the floor for a clean tube with a genuinely black background.',
    patch: {
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
    name: 'transmission fault',
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
      phosphor: 0.35,
      crtBloom: 0.4,
      crtGamma: 1.4,
    },
  },
  {
    name: 'night monitor',
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
      phosphor: 0.6,
      noiseIre: 2,
    },
    // A loop sitting a hair over unity is a knife edge, and a tube warming up
    // does not hold a bias steady. Drifting the exposure across that edge is
    // what makes the halos breathe instead of settling.
    mod: [{ target: 'fbGain', source: 'smooth', rateHz: 0.03, depth: 0.01 }],
  },
  {
    name: 'deep end',
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
      phosphor: 0.45,
    },
  },
]

export function presetControls(patch: Partial<Controls>): Controls {
  return { ...DEFAULT_CONTROLS, ...patch }
}

export function controlsEqual(a: Controls, b: Controls): boolean {
  return CONTROL_KEYS.every(k => a[k] === b[k])
}

// The preset whose full control-set exactly matches `values`, if any.
export function matchPreset(values: Controls): PresetDef | undefined {
  return PRESETS.find(p => controlsEqual(presetControls(p.patch), values))
}

// How much of each preset is dialed in, by preset name. Absent or 0 is off.
export type PresetWeights = ReadonlyMap<string, number>

// A fresh recipe: one full preset plus one or two partial ones from other
// groups, so a roll crosses families instead of deepening one. Shared by the
// "surprise me" button and by `?surprise` on a link, which is how the docs
// harness fills a gallery without clicking anything.
export function randomPresetMix(sourceBOn: boolean): PresetWeights {
  const pool = PRESETS.filter(
    p => p.group !== 'Clean' && (sourceBOn || p.group !== 'A/B mixing'),
  )
  const groups = [...new Set(pool.map(p => p.group))].toSorted(
    () => Math.random() - 0.5,
  )
  const weights = new Map<string, number>()
  groups.slice(0, 2 + Math.floor(Math.random() * 2)).forEach((g, i) => {
    const opts = pool.filter(p => p.group === g)
    const p = opts[Math.floor(Math.random() * opts.length)]
    weights.set(p.name, i === 0 ? 1 : 0.3 + Math.random() * 0.5)
  })
  return weights
}

// Controls holding a mode rather than a quantity: halfway between phosphor 0
// and 3 is not phosphor 1.5, it is a tube nobody asked for. The heaviest
// preset that moves one of these off its default picks the mode outright.
// Derived from which controls declare `choices`, so the blender and the panel's
// toggle groups can't drift from one hand-kept list.
const ENUM_KEYS = new Set<ControlKey>(
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
      return def === undefined ? [] : [{ w, full: presetControls(def.patch) }]
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
