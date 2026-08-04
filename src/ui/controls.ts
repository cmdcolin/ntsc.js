import type { ControlKey } from '../controls'

export interface SliderDef {
  key: ControlKey
  label: string
  min: number
  max: number
  step: number
  unit: string
  // Plain-language mechanism behind the control, shown by the slider's ? icon.
  // Say what breaks in the hardware, not what the picture looks like — the look
  // is emergent, and knowing the cause is what makes the knobs combine.
  help: string
  // A discrete mode rather than a quantity: one label per integer value, index
  // == value. Presence renders a toggle-button group instead of a slider and is
  // the single source of truth for which controls blend by mode (ENUM_KEYS in
  // presets), so min/max/step still bound the same integer for MIDI and mod.
  choices?: string[]
  // How the travel maps onto the value. Omitted is linear; 'magnifier' is the
  // two-sided view-fraction scale in lens.ts, which puts the fine control where
  // the useful magnifications are and keeps a detent at 1x.
  curve?: 'magnifier'
  // A trim rather than a look-maker: adjusts the character of an effect some
  // other control turns on. The group tucks these behind a "fine tweaks"
  // disclosure so the rows that make the picture stay in reach. Absent = shown.
  fine?: true
}

// The signal-path stages, in the order the panel's spine is browsed. A group
// placed on one of these renders in that stage.
export const PHASE_ORDER = [
  'Source',
  'Feedback',
  'Tape',
  'Receiver',
  'Screen',
] as const
export type Phase = (typeof PHASE_ORDER)[number]

// Where a group lives in the panel — its single source of placement truth, so
// nothing can silently fail to render:
//   a Phase — in that stage of the browsable signal-path spine;
//   'ab'    — in the A/B Mix section, shown only when source B is on;
//   'audio' — inside the Audio section, next to its enable button.
export type Placement = Phase | 'ab' | 'audio'

export interface Group {
  name: string
  place: Placement
  sliders: SliderDef[]
}

export const GROUPS: Group[] = [
  {
    name: 'Signal (source A)',
    place: 'Source',
    sliders: [
      {
        key: 'invert',
        label: 'invert (polarity swap)',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'Negates the composite waveform coming out of the encoder, as if the video pair were fed in backwards. At 1 the picture is a full negative; halfway lands on the solarized midpoint where bright and dark both fold toward grey. Hue inverts with it, since the colour subcarrier rides on the same wire.',
      },
      {
        key: 'deint',
        label: 'deinterlace',
        min: 0,
        max: 1,
        step: 1,
        unit: '',
        help: 'Rebuilds each frame from a single field instead of both, the way a bob deinterlacer does. Use it when an interlaced source (a captured video or webcam) shows comb teeth on horizontal motion. Costs half the vertical detail, which is exactly the trade a real deinterlacer makes.',
      },
    ],
  },
  {
    name: 'Cable / Wiring',
    place: 'Source',
    sliders: [
      {
        key: 'polarityFlip',
        label: 'hard polarity (flips sync)',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'A signal/ground swap at the connector: the whole composite waveform is negated, sync pulses included. Unlike the picture-only invert above, the receiver now has to find sync in what used to be peak white, so the picture tears and rolls while it hunts.',
      },
      {
        key: 'termination',
        label: 'termination (-1 daisy, +1 open)',
        min: -1,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'Composite video expects a single 75 Ω load. Negative is double-terminated — a monitor daisy-chained with its loop-through still on — halving the signal, so the picture goes dim and the colour killer starts to bite. Positive is unterminated, so the line reflects: signal runs hot and rings, with overshoot on every edge.',
      },
      {
        key: 'chromaPinOnly',
        label: 'chroma-pin only',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'S-video miswired into a composite input: only the chroma pin arrives. There is no luma and no sync, so the receiver free-runs on a bare subcarrier — floating colour over a black raster that has nothing to lock to.',
      },
      {
        key: 'connectorGlitch',
        label: 'loose connector',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'Intermittent contact in the plug. Contact drops out for random spans of the waveform and the input floats to snow, so bands of noise cut in and out — and take sync with them when they land on a sync tip.',
      },
    ],
  },
  {
    name: 'Cable Scrambling',
    place: 'Source',
    sliders: [
      {
        key: 'scramble',
        label: 'sync suppression',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'How hard the head-end suppresses sync on a premium channel. The scrambler lifts the carrier during each sync pulse, so a set without a decoder box has a shallow tip — or none at all — to find the start of a line in. Under about half depth the tip still clears the slicer and the set merely mismeasures it, so the AGC over-compensates and the picture washes out bright. Past that the tip is gone and the line oscillator is left free-running, so what the picture does next is whatever the h-osc detune below says its own rate is — a set sitting exactly on 15.734 kHz coasts through the gap almost cleanly. Vertical stays roughly framed either way: the broad vertical pulses are wider than the line-rate gate, so the frame shears instead of tumbling.',
      },
      {
        key: 'scrambleMode',
        label: 'system',
        min: 0,
        max: 2,
        step: 1,
        unit: '',
        choices: ['gated', 'alternate', 'ssavi'],
        help: "Which scrambling system. Gated suppresses every line, so the oscillator free-runs the whole way down and the raster shears continuously. Alternate suppresses every other line, so the flywheel is hauled back half the time and the drift between corrections comes out as a ragged line-pair zigzag on every vertical edge — it tolerates far more h-osc detune before it stops being a picture. SSAVI is Zenith's: suppression plus inversion of the active video, so what does leak through is a negative. Burst sits in the back porch and is untouched, so hue survives the inversion.",
      },
    ],
  },
  // The two loops are named for the physics that closes them, because that is
  // the only thing that tells them apart once both are running: light around
  // the outside of the set, or the composite bus patched back into itself. The
  // optical one carries a picture that has already been decoded and lit, so it
  // can only do what a lens can; the electrical one carries the subcarrier
  // round with it, so it does things optics cannot.
  {
    name: 'Camera loop (optical)',
    place: 'Feedback',
    sliders: [
      {
        key: 'fbMix',
        label: 'mix',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'How much of the camera-pointed-at-the-monitor image is fed back into the input. This is the classic video feedback loop: raise it until loop gain passes unity and the picture starts breeding structure on its own. Everything below shapes what the loop does on each trip around.',
      },
      {
        key: 'fbZoom',
        label: 'zoom',
        min: 0.7,
        max: 1.6,
        step: 0.005,
        unit: 'x',
        help: 'How much bigger or smaller the camera frames the screen each time around. Above 1 detail flows outward and tunnels form; below 1 it collapses inward. The distance from 1 sets how fast the loop marches, and tiny offsets are usually the most interesting.',
      },
      {
        key: 'fbRotateDeg',
        label: 'rotate',
        min: -30,
        max: 30,
        step: 0.1,
        unit: 'deg',
        help: 'Camera tilt on the loop. Each pass rotates the image again, so structures spiral instead of expanding straight out. Combines with zoom into the classic logarithmic-spiral feedback.',
      },
      {
        key: 'fbShiftX',
        label: 'shift x',
        min: -0.3,
        max: 0.3,
        step: 0.001,
        unit: '',
        fine: true,
        help: 'Camera aim off-centre horizontally. Moves where the feedback fixed point sits, which is what decides where the tunnel mouth or spiral core lands on screen.',
      },
      {
        key: 'fbShiftY',
        label: 'shift y',
        min: -0.3,
        max: 0.3,
        step: 0.001,
        unit: '',
        fine: true,
        help: 'Camera aim off-centre vertically. Same as shift x on the other axis — together they steer the centre of the loop.',
      },
      {
        key: 'fbGain',
        label: 'gain',
        min: 0.5,
        max: 1.5,
        step: 0.005,
        unit: 'x',
        fine: true,
        help: 'Camera exposure on the loop. Below 1 each pass is dimmer than the last and structures fade out; above 1 they build until they clip. Unity is the knife edge where patterns persist indefinitely.',
      },
      {
        key: 'fbFocus',
        label: 'defocus',
        min: 0,
        max: 3,
        step: 0.05,
        unit: 'px',
        fine: true,
        help: 'Lens blur radius on the camera. A little defocus is what keeps a feedback loop from going straight to pixel noise: it smooths each generation, so the loop favours large soft structures over single-pixel speckle.',
      },
      {
        key: 'fbVign',
        label: 'vignette',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'Lens falloff toward the corners. Loop gain becomes position-dependent — high in the middle, low at the edges — so feedback lives in the centre of frame and dies before it reaches the border.',
      },
      {
        key: 'fbBlack',
        label: 'black cut',
        min: 0,
        max: 0.2,
        step: 0.005,
        unit: '',
        fine: true,
        help: 'The camera sensor black level. Anything dimmer than this reads as pure black, so trails do not linger forever at low level — they thin and snap off once they fall under the cut.',
      },
      {
        key: 'fbKnee',
        label: 'cam s-curve',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'Sensor highlight compression. Bright areas roll off into a shoulder instead of clipping flat, which stabilizes a runaway loop into thick glowing bands rather than a white-out.',
      },
    ],
  },
  // The gun and the glass, split out of the camera group because none of it is
  // a camera: it is the tube's own transfer curve and faceplate. It sits here
  // rather than under Screen because it is the camera loop's subject — the
  // light the lens is pointed at — so it is what decides which structures
  // survive a trip around and which die, and tuning a loop means reaching for
  // these in the same breath as the lens. The mixer loop taps ahead of the
  // tube and never sees them.
  {
    name: 'Tube face (what the camera shoots)',
    place: 'Feedback',
    sliders: [
      {
        key: 'crtCutoff',
        label: 'beam cutoff',
        min: 0,
        max: 0.6,
        step: 0.01,
        unit: '',
        help: 'The gun bias point: drive below this emits no light at all. It gives the tube a true black background and, in a feedback loop, sets the floor everything has to stay above to survive another pass.',
      },
      {
        key: 'crtGamma',
        label: 'beam gamma',
        min: 1,
        max: 3,
        step: 0.05,
        unit: '',
        help: 'The gun transfer curve — light out versus drive in. High gamma deepens shadows and stretches highlights, which is much of what gives a CRT its contrast; in a feedback loop it sharpens the boundary between what survives and what dies.',
      },
      {
        key: 'crtSat',
        label: 'beam saturation',
        min: 0,
        max: 2,
        step: 0.01,
        unit: '',
        help: 'Colour saturation of the emitted light, applied after the beam transfer. Feedback multiplies it every pass, so a small boost here compounds into wildly saturated bands.',
      },
      {
        key: 'crtBloom',
        label: 'screen bloom',
        min: 0,
        max: 1.5,
        step: 0.01,
        unit: '',
        help: 'Light spreading out of bright phosphor cores. A tight halo that fattens highlights, and in a loop it is how a bright point grows into a blob over successive passes.',
      },
      {
        key: 'crtHalation',
        label: 'halation (warm halo)',
        min: 0,
        max: 1.5,
        step: 0.01,
        unit: '',
        help: 'Light scattering inside the thick glass faceplate and bouncing back — a wide, warm, low-level halo around highlights. Broader and softer than bloom, and the reason bright CRT images look like they are glowing through the screen rather than off it.',
      },
      {
        key: 'crtGlow',
        label: 'phosphor glow',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'Faceplate haze: the dull ambient sheen a powered tube has even in black areas. Lifts the black floor slightly, which in a feedback loop gives the whole frame a small standing gain.',
      },
    ],
  },
  {
    name: 'Mixer loop (electrical)',
    place: 'Feedback',
    sliders: [
      {
        key: 'cfbMix',
        label: 'loop mix',
        min: 0,
        max: 0.95,
        step: 0.01,
        unit: '',
        help: "Feedback through a video mixer instead of a camera: the previous frame's composite waveform is patched back into the input, electrically. This is the crossfader position toward that loop bus. The subcarrier goes around the loop too, so colour does things optics cannot.",
      },
      {
        key: 'cfbGain',
        label: 'loop gain',
        min: -1.2,
        max: 1.2,
        step: 0.01,
        unit: 'x',
        help: 'Proc-amp trim on the loop return. Past ±1 the round trip exceeds unity and the loop builds until it clips. Negative inverts each pass, so the picture alternates polarity frame to frame and edges buzz.',
      },
      {
        key: 'cfbDelayUs',
        label: 'loop delay',
        min: 0,
        max: 8,
        step: 0.001,
        unit: 'us',
        help: 'Delay on the loop return, in microseconds. Because the colour subcarrier rides the same waveform, delay is also a hue rotation — one sample (70 ns) is a 90° spin. Sub-microsecond moves smear the picture sideways and repaint it in a different colour at the same time.',
      },
      {
        key: 'cfbLines',
        label: 'v offset',
        min: -20,
        max: 20,
        step: 1,
        unit: 'lines',
        help: 'Vertical offset applied each trip around the loop. Every generation slides a few lines up or down, so trails walk vertically and stack into ladders instead of sitting still.',
      },
      {
        key: 'cfbKey',
        label: 'luma key',
        min: -1,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'Keys the loop return against brightness, so only part of the picture feeds back. Positive keeps the bright areas, negative inverts the polarity and keeps the dark ones. This is what makes feedback follow the subject instead of flooding the frame.',
      },
      {
        key: 'cfbKeyLevel',
        label: 'key level',
        min: 0,
        max: 100,
        step: 0.5,
        unit: 'IRE',
        fine: true,
        help: 'The brightness the loop key slices at, in IRE (0 is blanking, 100 is peak white). Sets where the boundary between fed-back and not falls.',
      },
      {
        key: 'cfbKeySoft',
        label: 'key soft',
        min: 1,
        max: 30,
        step: 0.5,
        unit: 'IRE',
        fine: true,
        help: 'How wide the key transition is, in IRE. Narrow gives a hard-edged cut-out; wide gives a gradual blend that follows the picture gradient.',
      },
      {
        key: 'cfbHold',
        label: 'strobe hold',
        min: 0,
        max: 60,
        step: 1,
        unit: 'frames',
        fine: true,
        help: "Freezes the loop's frame store for this many frames before it grabs again — a frame synchronizer stuttering. At small values motion strobes; at large ones the picture holds still while the live signal keeps mixing over it.",
      },
      {
        key: 'cfbTrail',
        label: 'trails',
        min: 0,
        max: 0.98,
        step: 0.01,
        unit: '',
        help: "Peak-hold decay in the loop's frame store: bright areas are retained and fade rather than being replaced. This is the smeary luminance trail of a frame synchronizer left in the loop, distinct from the tube's own phosphor persistence.",
      },
      {
        key: 'cfbFilterMHz',
        label: 'loop resonance freq (0 off)',
        min: 0,
        max: 5,
        step: 0.05,
        unit: 'MHz',
        fine: true,
        help: 'Puts a resonant filter in the loop, centred here — a bent video enhancer patched into the feedback. Around 3.58 MHz it rings on the colour subcarrier itself; lower down it rings on picture detail and turns edges into repeating bars.',
      },
      {
        key: 'cfbFilterQ',
        label: 'loop resonance Q (broad→ringing)',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'How selective that resonance is. Broad gives the loop a gentle tonal tilt; narrow makes it ring for a long time after every edge, laying a fixed-frequency pattern across the line.',
      },
      {
        key: 'cfbFilterBoost',
        label: 'loop resonance boost',
        min: 0,
        max: 4,
        step: 0.05,
        unit: 'x',
        fine: true,
        help: 'In-band gain added by the resonance. Push it far enough that the round trip exceeds unity at that frequency and the loop self-oscillates: the filter starts generating its own pattern out of nothing.',
      },
    ],
  },
  {
    name: 'Tape loop (loop bin)',
    place: 'Feedback',
    sliders: [
      {
        key: 'tapeMix',
        label: 'loop mix',
        min: 0,
        max: 0.95,
        step: 0.01,
        unit: '',
        help: 'A second machine threaded with a loop of tape: the mixer feeds a record head, and a play head further round the loop returns what was laid down a second or two ago. This is the crossfader toward that return. Because the return gets recorded again, whatever keeps circulating goes round the medium once per lap and ages a generation each time.',
      },
      {
        key: 'tapeLoopMm',
        label: 'loop length',
        min: 0.6,
        max: 66,
        step: 0.1,
        unit: 'mm',
        help: 'Millimetres of tape between the record head and the play head. Tape runs at 33.35 mm/s, so this is the delay: 0.6 mm is a single frame, 33 mm a second, 66 mm the whole bin. Length is the physical setting rather than a time, which is why speed wander below moves the delay itself.',
      },
      {
        key: 'tapeGain',
        label: 'playback gain',
        min: -1.2,
        max: 1.2,
        step: 0.01,
        unit: 'x',
        help: 'Proc-amp trim on the playback. Past ±1 each lap comes back louder than it went out and the loop builds until it clips. Negative inverts every pass, so repeats alternate polarity down the tail.',
      },
      {
        key: 'tapeHfLoss',
        label: 'generation loss',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'How much of the top of the band the head and tape lose on each pass. The colour subcarrier sits at the very top, so it goes several times faster than the picture under it — repeats fade to grey well before they go soft, and a long tail ends up monochrome. This is the knob that makes the echo sound like tape instead of a delay line.',
      },
      {
        key: 'tapeNoiseIre',
        label: 'tape noise',
        min: 0,
        max: 8,
        step: 0.1,
        unit: 'IRE',
        fine: true,
        help: "The medium's own noise floor. It belongs to the oxide, not to the moment, so the same grain is on the same stretch of tape every lap and gets re-recorded rather than averaging away like snow — it builds into standing streaks, and slides bodily through the picture when the speed wanders.",
      },
      {
        key: 'tapeRecord',
        label: 'record head',
        min: 0,
        max: 1,
        step: 1,
        unit: '',
        choices: ['hold', 'record'],
        help: 'Lift the record head and the tape keeps circulating with whatever is already on it — the loop repeats indefinitely and stops taking in the live picture. Playing over a held loop is what makes this a looper rather than an echo. It does not fade: playback loss is what the head does on the way past, not damage to the oxide, so a held loop comes back identical every lap, down to the same grain in the same places. Drop the head again and it starts recording over what it has.',
      },
      {
        key: 'tapeTransport',
        label: 'transport',
        min: 0,
        max: 3,
        step: 1,
        unit: '',
        choices: ['reverse', 'stopped', 'forward', 'scrub'],
        help: 'Which way a held loop runs past the heads, and whether the drum is still turning. Reverse plays the frames back in the order they were laid down, each one whole — the scanner still sweeps the same way, so motion runs backwards while the picture stays a picture. Stopped parks the tape while the drum re-reads one sweep: a still frame you can play live over. Scrub stalls the drum and keeps pulling backwards, so the head recovers the tape in the order it drags past rather than in sweep order — the waveform itself comes back reversed, and the set gets sync tips at the wrong end of every line, a burst that reads phase-flipped, and a raster arriving end-first. Nothing about that is drawn; it is what a receiver does with a signal running the wrong way. Only means anything with the record head up.',
      },
      {
        key: 'tapeShuttle',
        label: 'shuttle (1 = play)',
        min: 0,
        max: 8,
        step: 0.05,
        unit: 'x',
        help: 'How fast a held loop runs, as a multiple of play — the transport switch above gives the direction, this gives the speed. Off play speed the head no longer follows a single recorded track: each sweep crosses several, the RF nulls at every crossing, and that many noise bars sweep the picture. It is the same mechanism the deck shuttle uses, but running over your own captured loop instead of the incoming signal — cue and review through two seconds you recorded, with the picture skipping frames as it goes. Note this is why a paused loop has a bar across it and a reversed one has two: at a standstill the head still crosses one track per sweep, and backwards it crosses two.',
      },
      {
        key: 'tapeHeads',
        label: 'playback heads',
        min: 1,
        max: 4,
        step: 1,
        unit: '',
        help: "How many playback heads are in the tape path. Each one is at its own distance from the record head, so a single lap hands the picture back once per head — the heads are a rhythm and the loop is the bar line. A piece of tape is written once and read by all of them on the way past, so a lap's taps are the same generation: the pattern repeats intact and goes a generation darker each time round, rather than fading across the taps.",
      },
      {
        key: 'tapeHeadSpread',
        label: 'head spacing',
        min: 0.35,
        max: 3,
        step: 0.05,
        unit: '',
        fine: true,
        help: 'Where the heads sit along the path. At 1 they are at even subdivisions of the loop — a straight pattern. Below 1 they crowd toward the far head, so the taps rush and then hold; above 1 they crowd toward the record head, so the taps come quickly and leave a long gap before the lap turns over.',
      },
      {
        key: 'tapeSplice',
        label: 'splice',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'A loop is a loop because someone joined the ends, and the joint runs the path once per lap, drawing level with each head in turn — the head lifts for the three lines it takes to cross. Since a loop is rarely a whole number of frames long, the bump walks down the picture lap by lap: a metronome you can see, ticking out the tap pattern.',
      },
      {
        key: 'tapeWowPct',
        label: 'capstan wander',
        min: 0,
        max: 2,
        step: 0.01,
        unit: '%',
        help: 'Speed error in the transport. The loop is a fixed length of tape, so a capstan running slow is a longer delay — the echo breathes in and out of time instead of merely wobbling. A percent goes a long way: nothing time-base corrects the return, so a delay that grows by half a frame hands back a picture displaced half a screen, and the repeats slide vertically. This is why mixing a delayed feed needed a frame synchronizer. With colour framing off it drags hue round too.',
      },
      {
        key: 'tapeColourFrame',
        label: 'colour framing',
        min: 0,
        max: 1,
        step: 1,
        unit: '',
        choices: ['hue spins', 'framed'],
        help: 'The subcarrier rides the same tape, so a delay is also a hue rotation — 90° per sample, and a frame of delay lands on 180°. Framed rounds the delay onto a whole subcarrier cycle, costing 140 ns of picture shift, which is exactly what an edit controller insisting on colour framing is doing. Off, every change of delay repaints the repeats a different colour.',
      },
      {
        key: 'tapeWear',
        label: 'oxide wear',
        min: 0,
        max: 0.2,
        step: 0.005,
        unit: '',
        fine: true,
        help: 'Fraction of the loop with the oxide worn off it. The bad patches are fixed to the tape, so the same lines drop to noise every lap — which is what tells a loop apart from a deck playing a long recording, where a dropout never comes back.',
      },
    ],
  },
  {
    name: 'A/B Mixer (source B)',
    place: 'ab',
    sliders: [
      {
        key: 'bGenlock',
        label: 'genlock',
        min: 0,
        max: 1,
        step: 1,
        unit: '',
        choices: ['dirty sum', 'clean dissolve'],
        help: "Whether source B is genlocked to the house reference. Off (0): B free-runs and is summed into the composite — a wiring fault, so its detune, roll and skew below drive fighting sync and chroma beats. On (1): B is re-encoded on A's carrier and raster and the combine becomes a clean crossfade — a production switcher dissolve, with B gain as the fader and the wipe as a clean B-replaces-A wipe. The detune/roll/skew and ring mod do nothing on this path.",
      },
      {
        key: 'aGain',
        label: 'A gain',
        min: -1.2,
        max: 1.2,
        step: 0.01,
        unit: 'x',
        fine: true,
        help: "A's own level on the summing bus (dirty path only). 1 is full program; pull it down to fade A out under B for a manual crossfade, or take it negative to invert A into a difference key that cancels against B. Does nothing on the genlocked clean-dissolve path, where A is implied by (1 − B gain).",
      },
      {
        key: 'bGain',
        label: 'B gain',
        min: 0,
        max: 1.2,
        step: 0.01,
        unit: 'x',
        help: "How much of source B reaches the composite line. With genlock off this is the level B is summed in at — a wiring fault, not a clean dissolve. With genlock on it is the crossfade fader: 0 full A, 1 full B. Everything below detunes B's timebase relative to A (dirty path only).",
      },
      {
        key: 'bRing',
        label: 'ring mod',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'Multiplies the two composite signals instead of adding them. The product of two subcarriers lands at sum and difference frequencies, so the picture comes back in colours neither source contained.',
      },
      {
        key: 'bLineHz',
        label: 'line offset',
        min: -8,
        max: 8,
        step: 0.01,
        unit: 'Hz',
        help: "How far B's line rate sits from A's. B slides sideways continuously, skewing a little more on each successive line, because the two horizontal oscillators are not locked. At zero it stops but stays where it drifted to.",
      },
      {
        key: 'bDetuneHz',
        label: 'sc detune',
        min: -400,
        max: 400,
        step: 0.5,
        unit: 'Hz',
        help: "How far B's colour subcarrier sits from A's 3.579545 MHz. The decoder locks to A's burst, so B's colour beats against it and its hue cycles continuously — the rainbow crawl of a non-genlocked source.",
      },
      {
        key: 'bRollLps',
        label: 'frame roll',
        min: -3,
        max: 3,
        step: 0.01,
        unit: 'l/f',
        help: "B's vertical drift in lines per frame, from its field rate not matching A's. B creeps up or down through the frame independently of the picture A is painting.",
      },
      {
        key: 'bHueDeg',
        label: 'B hue',
        min: -180,
        max: 180,
        step: 1,
        unit: 'deg',
        fine: true,
        help: "Proc-amp hue trim on B before it is mixed — a static phase offset on its subcarrier. Unlike sc detune this does not drift; it just parks B's colours somewhere else.",
      },
      {
        key: 'bVidGain',
        label: 'B video gain',
        min: 0,
        max: 2,
        step: 0.01,
        unit: 'x',
        fine: true,
        help: 'Proc-amp video gain on B: contrast of the B picture before mixing, without changing how much of B is patched in.',
      },
      {
        key: 'bInv',
        label: 'B invert',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: "Inverts B's picture. Mixed against A this reads as a difference key — where the two agree they cancel toward flat grey, where they differ the mix lights up.",
      },
    ],
  },
  {
    name: 'Wipe (A/B)',
    place: 'ab',
    sliders: [
      {
        key: 'wipeMode',
        label: 'pattern',
        min: 0,
        max: 4,
        step: 1,
        unit: '',
        choices: ['off', 'h', 'v', 'box', 'diamond'],
        help: 'Selects the switcher wipe pattern that decides which parts of the frame show B instead of A: 0 off, 1 horizontal, 2 vertical, 3 box, 4 diamond.',
      },
      {
        key: 'wipePos',
        label: 'position',
        min: 0,
        max: 1,
        step: 0.001,
        unit: '',
        help: 'The wipe lever: where the A/B boundary sits, 0 full A to 1 full B.',
      },
      {
        key: 'wipeSoft',
        label: 'softness',
        min: 0,
        max: 0.5,
        step: 0.005,
        unit: '',
        help: 'Width of the blended border along the wipe edge — a hard switcher cut at 0, a soft dissolving edge as it opens up.',
      },
      {
        key: 'wipeRate',
        label: 'sweep',
        min: 0,
        max: 2,
        step: 0.01,
        unit: 'Hz',
        help: 'Drives the wipe lever back and forth automatically at this rate, so the boundary sweeps on its own. Can be locked to MIDI clock with the ♩ icon.',
      },
    ],
  },
  {
    name: 'PiP inset (source B)',
    place: 'ab',
    sliders: [
      {
        key: 'pipMix',
        label: 'inset key',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'Squeezes source B into a positionable window over the program, like a switcher DVE. Unlike the dirty mix, the inset is re-encoded genlocked to the house raster — so it dot-crawls like real video but does not beat or roll.',
      },
      {
        key: 'pipX',
        label: 'center x',
        min: 0,
        max: 1,
        step: 0.005,
        unit: '',
        help: 'Horizontal centre of the inset window across the active picture.',
      },
      {
        key: 'pipY',
        label: 'center y',
        min: 0,
        max: 1,
        step: 0.005,
        unit: '',
        help: 'Vertical centre of the inset window down the active picture.',
      },
      {
        key: 'pipW',
        label: 'width',
        min: 0.1,
        max: 1,
        step: 0.005,
        unit: '',
        help: 'Width of the inset window, as a fraction of the active picture.',
      },
      {
        key: 'pipH',
        label: 'height',
        min: 0.1,
        max: 1,
        step: 0.005,
        unit: '',
        help: 'Height of the inset window, as a fraction of the active picture.',
      },
      {
        key: 'pipBorder',
        label: 'border',
        min: 0,
        max: 0.03,
        step: 0.001,
        unit: '',
        fine: true,
        help: 'Thickness of the matte border drawn around the inset — the hard frame line a switcher puts around a squeezed source.',
      },
      {
        key: 'pipSoft',
        label: 'edge soft',
        min: 0,
        max: 0.05,
        step: 0.001,
        unit: '',
        fine: true,
        help: 'Softness of the inset window edge, so the box blends into the program instead of cutting hard.',
      },
      {
        key: 'pipKey',
        label: 'luma key (- inverts)',
        min: -1,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'Keys the inset against its own brightness so it is not a solid box: positive keeps the bright parts of B, negative keeps the dark ones. This is how you drop a subject in without the rectangle.',
      },
      {
        key: 'pipKeyLevel',
        label: 'key level',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'The brightness the inset key slices at, 0 black to 1 white.',
      },
      {
        key: 'pipKeySoft',
        label: 'key soft',
        min: 0.01,
        max: 0.4,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'Width of the inset key transition. Narrow cuts a hard matte; wide feathers the subject into the program.',
      },
    ],
  },
  {
    name: 'Tape / Channel',
    place: 'Tape',
    sliders: [
      {
        key: 'lumaMHz',
        label: 'luma bandwidth',
        min: 1.2,
        max: 6,
        step: 0.05,
        unit: 'MHz',
        help: 'How much brightness detail the recording or channel passes. Broadcast is about 4.2 MHz; VHS manages roughly 3 MHz, EP mode less. Lowering it softens fine horizontal detail exactly the way a worn tape does — vertical edges smear while the picture stays sharp top to bottom.',
      },
      {
        key: 'lumaPeak',
        label: 'peaking',
        min: 0,
        max: 3,
        step: 0.05,
        unit: '',
        help: 'The sharpness boost VCRs and TVs apply to fake back the detail the bandwidth limit took away. It overshoots on every edge, laying a bright ringing outline against a dark one — the crispening artifact of consumer video.',
      },
      {
        key: 'noiseIre',
        label: 'noise',
        min: 0,
        max: 40,
        step: 0.1,
        unit: 'IRE',
        help: 'Additive noise on the waveform, in IRE: tape grain and RF snow. Because it lands on the whole signal, enough of it will also disturb sync and confuse the colour burst — noise degrades everything downstream, not just the picture.',
      },
      {
        key: 'ghostDelayUs',
        label: 'ghost delay',
        min: 0,
        max: 12,
        step: 0.05,
        unit: 'us',
        help: 'Multipath: a reflected copy of the broadcast arriving this many microseconds late. It shows as a displaced echo to the right of everything — the further away the reflecting building, the further out the ghost.',
      },
      {
        key: 'ghostGain',
        label: 'ghost gain',
        min: -0.6,
        max: 0.6,
        step: 0.01,
        unit: '',
        help: 'Strength of that reflection. Negative means it arrives phase-inverted, so the echo is a dark outline instead of a bright one.',
      },
      {
        key: 'humAmp',
        label: 'hum',
        min: 0,
        max: 30,
        step: 0.1,
        unit: 'IRE',
        fine: true,
        help: 'Mains hum riding on the video from a ground loop — 60 Hz on the signal, in IRE. Because it is not quite locked to the field rate it appears as a soft bright bar drifting slowly up the picture.',
      },
      {
        key: 'humMod',
        label: 'hum modulation',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: "The same mains ripple, but in the supply of an amplifier the signal passes through — a failing line amp — so it moves that stage's gain instead of adding to its output. The picture pumps and its colour saturates and fades in bands rather than just brightening, and because sync is scaled along with everything else the depth breathes: the receiver's AGC and horizontal hold end up chasing the hum. Mostly 120 Hz, from the rectified supply.",
      },
      {
        key: 'soundIre',
        label: 'sound carrier',
        min: 0,
        max: 10,
        step: 0.1,
        unit: 'IRE',
        fine: true,
        help: 'The 4.5 MHz intercarrier sound leaking past the trap that is supposed to remove it. Lays a fine herringbone of interference over the picture — sound buzz you can see.',
      },
      {
        key: 'dropoutRate',
        label: 'dropouts',
        min: 0,
        max: 60,
        step: 1,
        unit: '/frame',
        help: 'How many dropout events happen per frame. Shed oxide or a clogged head means the head reads nothing for a moment, leaving white streaks and, on a bad one, a scarred line the decoder cannot reconstruct.',
      },
      {
        key: 'dropoutLenUs',
        label: 'dropout len',
        min: 1,
        max: 25,
        step: 0.5,
        unit: 'us',
        fine: true,
        help: 'How long each dropout lasts, in microseconds. A line is 63.5 µs, so 25 µs is a streak across a third of the picture width.',
      },
      {
        key: 'dubGens',
        label: 'dub generations',
        min: 1,
        max: 4,
        step: 1,
        unit: 'x',
        fine: true,
        help: 'Runs the whole tape/channel stage this many times over — a copy of a copy of a copy. Each generation adds its own independent noise, dropouts and timebase wander on top of the last, which is why third-generation dubs fall apart much faster than one pass at triple the damage.',
      },
    ],
  },
  {
    name: 'VHS Chroma',
    place: 'Tape',
    sliders: [
      {
        key: 'colorUnderMix',
        label: 'color-under',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: "VHS cannot record 3.58 MHz colour, so it heterodynes chroma down to 629 kHz, records it under the luma, and converts it back on playback. Raising this routes colour through that path: it collapses colour bandwidth to a fraction of luma's, which is why VHS colour smears sideways for many pixels while edges stay sharp.",
      },
      {
        key: 'chromaNoiseIre',
        label: 'chroma noise',
        min: 0,
        max: 30,
        step: 0.1,
        unit: 'IRE',
        help: 'Noise on the colour-under carrier itself, before it is converted back up. The 629 kHz chroma carrier gets a fraction of the headroom the luma FM does, so its signal-to-noise is far worse — which is why VHS colour is blotchy while its luma is merely grainy. This noise has to come back through the narrow chroma bandpass, so it arrives as slow smears of wrong hue rather than the fine speckle the noise slider gives. Needs colour-under raised to do anything.',
      },
      {
        key: 'underJitterDeg',
        label: 'phase jitter',
        min: 0,
        max: 25,
        step: 0.1,
        unit: 'deg/line',
        help: 'Per-line phase error in that down/up conversion. The colour-under path has to reinsert phase exactly; when it does not, hue wanders line to line and the picture picks up a coloured venetian-blind texture. Needs colour-under raised to do anything.',
      },
    ],
  },
  {
    name: 'VHS Tracking',
    place: 'Tape',
    sliders: [
      {
        key: 'trackAmt',
        label: 'tracking error',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'The head is not following the recorded track. It reads partly off-track, so a band of noise appears where the signal is weakest and the picture tears and bends through it — the thing the tracking knob on a VCR was for.',
      },
      {
        key: 'trackPos',
        label: 'band position',
        min: 0,
        max: 1,
        step: 0.005,
        unit: '',
        help: 'Where that mistracked band sits vertically, 0 top to 1 bottom. On a real deck it drifts as the tape stretches; here you park it.',
      },
      {
        key: 'shuttleX',
        label: 'shuttle (1 = play)',
        min: -8,
        max: 8,
        step: 0.05,
        unit: 'x',
        help: 'Tape speed as a multiple of play — cue past 1, pause at 0, review negative. Off play speed the spinning head no longer follows a single recorded track: each sweep crosses several, the RF nulls at every crossing, and that many noise bars sweep the frame. Each strip between bars is a different track with its own timing and color-under phase, so the picture tears and rainbows at the boundaries. At 1 the head tracks and the picture is clean.',
      },
    ],
  },
  {
    name: 'Timebase',
    place: 'Tape',
    sliders: [
      {
        key: 'tbJitterNs',
        label: 'flutter',
        min: 0,
        max: 800,
        step: 5,
        unit: 'ns',
        help: 'Fast timebase error from capstan flutter, in nanoseconds. Each line starts a slightly different moment late, so edges get a ragged, shimmering wobble. This is signal-domain error — the burst moves with the picture, so hue wobbles too.',
      },
      {
        key: 'tbWowNs',
        label: 'wow',
        min: 0,
        max: 2000,
        step: 10,
        unit: 'ns',
        help: 'Slow timebase error from tape or capstan wow. Where flutter shakes line to line, wow drifts over many lines, so whole regions of the picture lean and breathe sideways together.',
      },
      {
        key: 'headSwitchShiftUs',
        label: 'head switch',
        min: -3,
        max: 3,
        step: 0.05,
        unit: 'us',
        help: 'A helical-scan VCR swaps between two heads a few lines before the bottom of the picture, and the two do not agree on timing. That mismatch, in microseconds, is the torn hook at the very bottom of the frame that every VHS tape has.',
      },
      {
        key: 'headSwitchNoise',
        label: 'switch noise',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'How much noise hash fills the few lines during the head switch, before the servo settles on the new head. Usually hidden under the bottom of the overscan; raise it and the frayed band shows.',
      },
    ],
  },
  {
    name: 'Enhancer (bent)',
    place: 'Tape',
    sliders: [
      {
        key: 'enhClampUs',
        label: 'clamp gate',
        min: -8,
        max: 50,
        step: 0.1,
        unit: 'us',
        fine: true,
        help: "How far the box's DC-restoration gate has slid off the back porch, in microseconds. A clamp pins one sample per line to blanking and the rest of the line rides on that; correct, it lands on the porch and does nothing. Drag it into active video and black level is set by whatever the picture happens to be at that instant, so the level bounces line to line with the image. Negative puts the gate on the burst or the sync tip, and the whole line lifts by the depth of sync.",
      },
      {
        key: 'enhDroopUs',
        label: 'clamp droop',
        min: 0,
        max: 400,
        step: 1,
        unit: 'us',
        fine: true,
        help: 'Time constant of the coupling capacitor between the gates, in microseconds. Short enough and the level sags back toward blanking within the line: bright content drags a dark streak behind it all the way to the right edge, and a lit area leaves the rest of its line depressed. This is the low-frequency smear of a box with an undersized cap, not a blur — vertical edges stay sharp.',
      },
      {
        key: 'enhPeakMHz',
        label: 'detail freq (0 off)',
        min: 0,
        max: 5,
        step: 0.05,
        unit: 'MHz',
        help: "Centre of the peaking stage the detail knob drives, with the bend's own feedback wrapped around it. A composite box has no Y/C split, so this is one knob doing two jobs: down around 1-2 MHz it rings on picture detail and lays bars behind every edge, and up at 3.58 it is boosting the subcarrier itself, so saturation climbs with detail and dot crawl comes apart.",
      },
      {
        key: 'enhPeakQ',
        label: 'detail regen (0.75+ howls)',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: "How much of the peaking stage's output the bend feeds back into it. Low rings for a few samples — ordinary edge overshoot. Approaching 0.75 the ring lasts most of a line. Past it the stage is regenerative: excited by the sync pulse at the head of every line it climbs until it hits the amplifier's rails, so the bars build left to right across the picture and the image only knocks them about.",
      },
      {
        key: 'enhPeakBoost',
        label: 'detail boost',
        min: 0,
        max: 4,
        step: 0.02,
        unit: 'x',
        fine: true,
        help: 'How much of the peaking stage is mixed back into the video. With the regen low this is a sharpness control; with it past unity this is how loud the howl is, and past about 1 the bars are full-scale and swamp the picture they came from.',
      },
      {
        key: 'enhSync',
        label: 'sync regen',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'The stabilizer half of the box: a sync separator slices the signal and stamps a clean 4.7 us pulse at every crossing it finds. At the standard slice the stamp lands on the real sync tip and nothing changes. This is how much of the regenerated pulse train reaches the output.',
      },
      {
        key: 'enhSliceIre',
        label: 'sync slice',
        min: -40,
        max: 60,
        step: 0.5,
        unit: 'IRE',
        fine: true,
        help: 'The level the separator calls sync, in IRE. Blanking is 0 and the real tip is -40, so anything under about -10 only ever finds real pulses. Bend it up into picture territory and dark content starts minting pulses of its own, mid-line and mid-field: the set is handed a line rate the image is writing, and it tears wherever the picture goes dark. The separator slices its own lowpassed copy, so burst and fine detail cannot trip it — only sustained dark areas can.',
      },
    ],
  },
  {
    name: 'Sync',
    place: 'Receiver',
    sliders: [
      {
        key: 'hHold',
        label: 'horizontal hold',
        min: 0.02,
        max: 0.8,
        step: 0.01,
        unit: '',
        help: "How hard the receiver's horizontal PLL pulls toward each sync pulse it finds. Low is a loose flywheel that ignores noise but drifts and skews; high snaps to every edge including the false ones, so damage in the waveform is translated straight into a bent picture. Sync-domain: the burst gate moves with it, so a large enough error throws colour off too.",
      },
      {
        key: 'vHold',
        label: 'vertical hold',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: "How much authority the incoming vertical sync has over the receiver's own field oscillator. At 1 the picture locks solid; as it falls the oscillator wins and the frame starts to roll — the old vertical hold knob, from the picture's side.",
      },
      {
        key: 'vFreqHz',
        label: 'vertical osc (60 = locked)',
        min: 50,
        max: 70,
        step: 0.05,
        unit: 'Hz',
        help: "The free-running frequency of the receiver's vertical oscillator. At 60 Hz it agrees with the signal and sits still; detune it and the frame rolls at a speed set by the difference, up or down. Only bites once vertical hold is loose enough to let the oscillator win.",
      },
      {
        key: 'syncBendUs',
        label: 'retrace flag',
        min: 0,
        max: 12,
        step: 0.05,
        unit: 'us',
        help: 'A kick to the horizontal PLL at the vertical seam, where the equalizing pulses upset it. The first few lines of the frame start late and settle back over the next dozen, giving the hooked, flagging top edge of a picture whose sync separator cannot cope.',
      },
      {
        key: 'hDetuneHz',
        label: 'horizontal osc detune',
        min: -500,
        max: 500,
        step: 1,
        unit: 'Hz',
        help: "Free-run drift of the receiver's horizontal oscillator away from 15.734 kHz. The PLL has to keep dragging it back, so the picture leans into a diagonal skew — and past the pull-in range it gives up and shears into diagonal bars.",
      },
    ],
  },
  {
    name: 'Audio',
    place: 'audio',
    sliders: [
      {
        key: 'audioRoll',
        label: 'bass → vertical hold',
        min: 0,
        max: 8,
        step: 0.05,
        unit: 'Hz',
        help: 'Bass energy detunes the vertical oscillator, so kick drums shove the frame vertically and it settles back. The picture lurches on the beat because the field rate is genuinely moving, not because anything is being animated.',
      },
      {
        key: 'audioTear',
        label: 'level → horizontal hold',
        min: -400,
        max: 400,
        step: 1,
        unit: 'Hz',
        help: 'Overall audio level pulls the horizontal oscillator off frequency, so loud passages skew and tear the picture sideways and it re-locks in the gaps. Negative leans the tear the other way.',
      },
      {
        key: 'audioSagUs',
        label: 'bass → HV sag',
        min: 0,
        max: 40,
        step: 0.5,
        unit: 'us',
        fine: true,
        help: 'Bass loads the high-voltage supply as if the beam were drawing current, so the scan collapses momentarily on each hit — the picture smacks inward and springs back. Needs supply ring (in Deflection) above zero to have a tank to disturb.',
      },
      {
        key: 'audioBendUs',
        label: 'waveform into deflection',
        min: -20,
        max: 20,
        step: 0.1,
        unit: 'us',
        help: 'The audio waveform itself is patched into the horizontal deflection, one sample per scan line — literally drawing the oscilloscope trace of the sound into the geometry of the picture. Deflection-domain, so hue stays put while the glass bends.',
      },
      {
        key: 'audioLoad',
        label: 'audio into HV tank',
        min: 0,
        max: 3,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'Drives the audio into the high-voltage tank alongside the beam current, so the supply rings and wobbles with the music rather than just sagging. Needs bass → HV sag above zero.',
      },
      {
        key: 'audioIre',
        label: 'audio into video in',
        min: 0,
        max: 60,
        step: 0.5,
        unit: 'IRE',
        help: 'The audio is patched straight into the video input, in IRE. Loud passages therefore land on the sync tips and the burst as well as the picture, so you get brightness bands, shifting colour and sync that tears — the classic wrong-cable-into-the-video-input result.',
      },
      {
        key: 'audioGain',
        label: 'input trim',
        min: 0,
        max: 4,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'Input trim on the waveform routings — into deflection and into video in — which is how hard the raw sound drives the geometry and the composite line. The envelope routings (the two hold oscillators and HV sag) normalize against a decaying peak instead, so they ride any input level on their own and this trim does not move them, or the meter above.',
      },
    ],
  },
  {
    name: 'Deflection',
    place: 'Receiver',
    sliders: [
      {
        key: 'bendUs',
        label: 'bend amount',
        min: -30,
        max: 30,
        step: 0.1,
        unit: 'us',
        help: "How far the tube's own scan is displaced sideways, in microseconds of line time. This is deflection-domain damage: the beam is bent after the picture has been decoded, so geometry warps but hue stays exactly where it was, and a rolling picture slides through a bend that stays put on the glass.",
      },
      {
        key: 'bendShape',
        label: 'shape',
        min: 0,
        max: 3,
        step: 1,
        unit: '',
        choices: ['flag', 'skew', 'bow', 'ripple'],
        help: 'How that displacement is distributed down the frame: 0 flag (a hook at the top that decays away), 1 skew (a straight lean), 2 bow (a barrel-like curve), 3 ripple (a repeating wave down the screen).',
      },
      {
        key: 'bendPeriod',
        label: 'decay / ripple period',
        min: 4,
        max: 480,
        step: 1,
        unit: 'lines',
        help: 'How many scan lines the shape takes: the decay length for the flag hook, or the wavelength for the ripple. Short gives a tight buzz near the top; long stretches the shape across the whole frame.',
      },
      {
        key: 'hvSagUs',
        label: 'HV sag',
        min: -25,
        max: 25,
        step: 0.1,
        unit: 'us',
        help: 'A bright picture draws beam current, which loads the high-voltage supply and lets the scan widen — so bright content stretches the geometry around it. It is why a white box on a tired tube bulges the image outward, and because it follows the content it moves with the picture.',
      },
      {
        key: 'hvRing',
        label: 'supply ring (0 droop, 1 chaos)',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'How well damped that supply is. At 0 it droops smoothly and recovers; toward 1 the tank rings and overshoots, so a bright edge sets off a decaying wobble down the lines below it and hard content makes the geometry chaotic.',
      },
    ],
  },
  {
    name: 'Decoder',
    place: 'Receiver',
    sliders: [
      {
        key: 'combMode',
        label: 'Y/C comb',
        min: 0,
        max: 2,
        step: 1,
        unit: '',
        choices: ['trap', '2-line', '3-line'],
        help: 'How the TV separates brightness from colour, which share one wire. 0 is a notch trap — cheap, and it mistakes fine detail for colour (rainbow fringing on stripes) and colour for detail (dot crawl on edges). 1 and 2 are 2- and 3-line combs, which use the line-to-line subcarrier alternation to separate them properly and largely kill both artifacts.',
      },
      {
        key: 'svideoBleed',
        label: 'S-video bleed',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'Chroma crossing into the luma path, as if the Y and C wires were shorted. It defeats the separation, so the subcarrier itself appears in the picture as a dense moving dot pattern over anything coloured.',
      },
      {
        key: 'demodMHz',
        label: 'chroma bandwidth',
        min: 0.15,
        max: 1.5,
        step: 0.01,
        unit: 'MHz',
        help: "The colour demodulator's low-pass, which decides how fast colour is allowed to change across a line. Real sets are around 0.5 MHz, which is why colour bleeds past its edges while brightness stays crisp — the eye barely notices, and broadcasters exploited it.",
      },
      {
        key: 'chromaTail',
        label: 'chroma trail',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'Asymmetric colour smear, trailing to the right only. A symmetric filter blurs both ways; a lagging chroma path drags colour behind the edge, which is the direction real sets and tapes actually smear.',
      },
      {
        key: 'chromaCoarse',
        label: 'chroma upsample error',
        min: 1,
        max: 8,
        step: 1,
        unit: 'px',
        fine: true,
        help: 'How coarsely the demodulated colour is sampled before being stretched back up. Coarse sampling lands on the subcarrier lattice at intervals, so moving detail rainbows in blocks — the cross-colour a cheap decoder makes of a striped shirt.',
      },
      {
        key: 'chromaGain',
        label: 'chroma gain',
        min: 0,
        max: 3,
        step: 0.01,
        unit: 'x',
        help: 'The colour control on the set: how much the demodulated chroma is amplified. Past 1 saturation blooms and clips against the edge of the gamut.',
      },
      {
        key: 'burstLock',
        label: 'burst lock',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'How much the decoder trusts the colour burst it measured. At 1 it follows the burst, so phase errors in the incoming signal are corrected out; at 0 it ignores it and runs on its own crystal, so any subcarrier error shows up directly as wrong, drifting hue.',
      },
      {
        key: 'scDetuneKHz',
        label: 'subcarrier detune',
        min: -20,
        max: 20,
        step: 0.05,
        unit: 'kHz',
        help: "The decoder's reference crystal pulled off 3.579545 MHz — the classic circuit-bend. The demodulation axis rotates continuously against the incoming colour, so hue sweeps the whole wheel at a rate set by how far off you are. Turn burst lock down to let it run.",
      },
      {
        key: 'killThresh',
        label: 'color killer',
        min: 0,
        max: 15,
        step: 0.1,
        unit: 'IRE',
        fine: true,
        help: 'The burst amplitude below which the set decides the broadcast is monochrome and shuts colour off entirely, in IRE. Raise it and anything that weakens the burst — noise, a dim signal, dropouts — makes colour cut in and out in patches.',
      },
      {
        key: 'agc',
        label: 'agc',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'How aggressively the receiver normalizes signal level off the sync tip. At 1 it corrects for weak or hot signals and holds contrast steady; at 0 the gain is fixed, so anything that changes signal amplitude changes picture brightness directly.',
      },
      {
        key: 'encChromaMHz',
        label: 'encoder chroma bw',
        min: 0.3,
        max: 2,
        step: 0.01,
        unit: 'MHz',
        fine: true,
        help: "Colour bandwidth at the encode end, before the signal is ever transmitted — the camera's own limit, as opposed to the decoder's. Wide enough and the chroma sidebands spill into the luma band and generate their own cross-colour.",
      },
    ],
  },
  {
    name: 'Display',
    place: 'Screen',
    sliders: [
      {
        key: 'scanBeam',
        label: 'beam profile',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'The electron beam is a spot of finite height, so it does not quite fill the gap between scan lines. Raise this for a tighter spot and visible dark gaps — scanlines — and lower it for a fat spot that fills in like a well-used consumer set.',
      },
      {
        key: 'scanBloom',
        label: 'beam bloom',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: "The spot grows with beam current, so bright lines are fatter than dark ones. Scanlines therefore show in the shadows and close up entirely in the highlights — which is why a real CRT's scanline structure appears and disappears with the picture.",
      },
      {
        key: 'crtSpot',
        label: 'beam spot',
        min: 0,
        max: 3,
        step: 0.05,
        unit: 'px',
        help: 'How wide a spot the gun writes on the phosphor. The beam is a smooth blob, not a square, so light from one sample lands partly on its neighbours and every edge arrives as a ramp — unlike screen bloom this applies to dim picture too, which is what stops the image resolving into hard pixels. At 0 the samples are point-sharp.',
      },
      {
        key: 'crtGrain',
        label: 'phosphor grain',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'The coating is a granular deposit of crystallites, so its emission is mottled rather than perfectly even. Fixed on the glass, so it does not crawl with the picture, and strongest in the mid tones — black grains have nothing to vary and fully driven ones have no headroom left.',
      },
      {
        key: 'crtSharp',
        label: 'reconstruction (bilinear→cubic)',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'How the sampled line is reconstructed into continuous light across the screen. Toward 0 is plain linear interpolation, which loses high frequencies; toward 1 is a cubic that stays flat past the subcarrier, so fine patterns hold instead of pumping as they move.',
      },
      {
        key: 'phosphorMode',
        label: 'phosphors',
        min: 0,
        max: 3,
        step: 1,
        unit: '',
        choices: ['sRGB', 'P22', '1953', 'green'],
        help: 'Which phosphors the tube is coated with, i.e. what its primaries actually are: 0 sRGB (no conversion), 1 P22/SMPTE-C (a normal colour TV), 2 the wide 1953 NTSC primaries nobody ever built, 3 a long-persistence monochrome green monitor.',
      },
      {
        key: 'phosphor',
        label: 'phosphor persistence',
        min: 0,
        max: 0.995,
        step: 0.005,
        unit: '',
        help: 'How long the phosphor keeps glowing after the beam has passed. This is afterglow in the glass, not electronic feedback — motion leaves comet trails that decay on their own, and at high values the screen never fully clears.',
      },
      {
        key: 'phosphorSkew',
        label: 'trail tint',
        min: 0,
        max: 2,
        step: 0.05,
        unit: '',
        fine: true,
        help: 'The three phosphors do not decay at the same rate — red and blue die faster than green. Raise this and trails tint green as they fade, which is the giveaway that you are looking at real persistence rather than a blend of frames.',
      },
      {
        key: 'phosphorDecayMix',
        label: 'trail sum (peak-hold→additive)',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        fine: true,
        help: 'How old and new light combine. At 0 the brighter of the two wins (peak-hold), giving hard strobing trails; at 1 they add like real light, so overlapping trails accumulate and burn toward white.',
      },
      {
        key: 'phosphorBleed',
        label: 'trail scatter',
        min: 0,
        max: 0.5,
        step: 0.01,
        unit: '',
        help: 'Held light does not leave through the grain that emitted it — it scatters sideways through the layer and the glass, into phosphor that is still glowing itself. The spread therefore compounds along a trail: the fresh edge stays sharp while old light gets progressively wider and softer, instead of the tail being a stack of hard copies.',
      },
      {
        key: 'maskAmt',
        label: 'aperture grille',
        min: 0,
        max: 1,
        step: 0.01,
        unit: '',
        help: 'Strength of the shadow mask / aperture grille — the vertical stripes of R, G and B phosphor the beam actually lands on. Raise it and the picture is visibly built out of coloured stripes, as it is on the real glass up close.',
      },
      {
        key: 'maskPitch',
        label: 'grille pitch',
        min: 1.5,
        max: 12,
        step: 0.5,
        unit: 'px',
        fine: true,
        help: 'Spacing of those phosphor triads in screen pixels. Fine pitch is a high-end monitor seen from a distance; coarse is a cheap tube with your nose against it. Pitches near a small whole number of pixels alias into moiré, exactly as photographing a CRT does.',
      },
      {
        key: 'crtZoom',
        label: 'magnifier',
        min: 0.25,
        max: 12,
        step: 0.01,
        // Creeping in slightly is the common move; going all the way to the
        // grille is the rare one, so it gets the last sliver of travel.
        curve: 'magnifier',
        unit: '×',
        help: 'Where your eye is, up against the glass. Everything that lives on the screen rather than in the image magnifies with it — scanline structure, the beam spot bleeding between samples, phosphor grain, the grille triads — so this is the way to see what the picture is actually built out of.',
      },
      {
        key: 'crtZoomX',
        label: 'magnifier x',
        min: 0,
        max: 1,
        step: 0.005,
        unit: '',
        help: 'Which part of the glass is under the magnifier, across. Ignored at 1× since the whole screen is already in view.',
      },
      {
        key: 'crtZoomY',
        label: 'magnifier y',
        min: 0,
        max: 1,
        step: 0.005,
        unit: '',
        help: 'Which part of the glass is under the magnifier, down.',
      },
      {
        key: 'timeScale',
        label: 'slow motion (1 = realtime)',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'x',
        help: 'Steps the whole simulation at a fraction of display rate, like slowed footage of the rig: noise, rolls, sweeps, feedback loops and phosphor all crawl together, and 0 freezes the frame. Modulation stays live, so an LFO or audio envelope here warps time itself. Pair with the speed control in the vaporwave section to slow the source footage to match.',
      },
    ],
  },
]

// A control that is physically inert until another control opens its path —
// e.g. phase jitter rides the color-under conversion, so with color-under at 0
// there is nothing for it to jitter. Encoding the gate as data (it used to live
// only in the help prose) lets the panel flag the dead knob and offer the
// prerequisite in one click, instead of letting exploration die on a slider
// that does nothing.
export interface SliderNeed {
  key: ControlKey
  ok: (v: number) => boolean
  fix: number
  hint: string
}

const above0 = (v: number) => v > 0
const below1 = (v: number) => v < 1
const nonzero = (v: number) => v !== 0

const fb: SliderNeed = {
  key: 'fbMix',
  ok: above0,
  fix: 0.5,
  hint: 'mix above 0',
}
const cfb: SliderNeed = {
  key: 'cfbMix',
  ok: above0,
  fix: 0.5,
  hint: 'loop mix above 0',
}
const cfbKeyed: SliderNeed = {
  key: 'cfbKey',
  ok: nonzero,
  fix: 0.6,
  hint: 'luma key nonzero',
}
const tape: SliderNeed = {
  key: 'tapeMix',
  ok: above0,
  fix: 0.5,
  hint: 'loop mix above 0',
}
const dirtyPath: SliderNeed = {
  key: 'bGenlock',
  ok: below1,
  fix: 0,
  hint: 'genlock on "dirty sum"',
}
const wiping: SliderNeed = {
  key: 'wipeMode',
  ok: above0,
  fix: 1,
  hint: 'a wipe pattern selected',
}
const pip: SliderNeed = {
  key: 'pipMix',
  ok: above0,
  fix: 0.7,
  hint: 'inset key above 0',
}
const enhPeaking: SliderNeed = {
  key: 'enhPeakMHz',
  ok: above0,
  fix: 1.5,
  hint: 'detail freq above 0',
}
const pipKeyed: SliderNeed = {
  key: 'pipKey',
  ok: nonzero,
  fix: 0.6,
  hint: 'luma key nonzero',
}

export const NEEDS: Partial<Record<ControlKey, SliderNeed>> = {
  fbZoom: fb,
  fbRotateDeg: fb,
  fbShiftX: fb,
  fbShiftY: fb,
  fbGain: fb,
  fbFocus: fb,
  fbVign: fb,
  fbBlack: fb,
  fbKnee: fb,
  cfbGain: cfb,
  cfbDelayUs: cfb,
  cfbLines: cfb,
  cfbKey: cfb,
  cfbHold: cfb,
  cfbTrail: cfb,
  cfbFilterMHz: cfb,
  cfbKeyLevel: cfbKeyed,
  cfbKeySoft: cfbKeyed,
  cfbFilterQ: {
    key: 'cfbFilterMHz',
    ok: above0,
    fix: 3.58,
    hint: 'resonance freq above 0',
  },
  cfbFilterBoost: {
    key: 'cfbFilterMHz',
    ok: above0,
    fix: 3.58,
    hint: 'resonance freq above 0',
  },
  tapeLoopMm: tape,
  tapeRecord: tape,
  tapeTransport: {
    key: 'tapeRecord',
    ok: (v: number) => v < 0.5,
    fix: 0,
    hint: 'the record head lifted',
  },
  tapeShuttle: {
    key: 'tapeRecord',
    ok: (v: number) => v < 0.5,
    fix: 0,
    hint: 'the record head lifted',
  },
  tapeHeads: tape,
  tapeHeadSpread: {
    key: 'tapeHeads',
    ok: (v: number) => v > 1,
    fix: 3,
    hint: 'more than one head',
  },
  tapeGain: tape,
  tapeHfLoss: tape,
  tapeNoiseIre: tape,
  tapeWear: tape,
  tapeSplice: tape,
  tapeWowPct: tape,
  tapeColourFrame: tape,
  enhPeakQ: enhPeaking,
  enhPeakBoost: enhPeaking,
  enhSliceIre: {
    key: 'enhSync',
    ok: above0,
    fix: 1,
    hint: 'sync regen above 0',
  },
  aGain: dirtyPath,
  bRing: dirtyPath,
  bLineHz: dirtyPath,
  bDetuneHz: dirtyPath,
  bRollLps: dirtyPath,
  wipePos: wiping,
  wipeSoft: wiping,
  wipeRate: wiping,
  pipX: pip,
  pipY: pip,
  pipW: pip,
  pipH: pip,
  pipBorder: pip,
  pipSoft: pip,
  pipKey: pip,
  pipKeyLevel: pipKeyed,
  pipKeySoft: pipKeyed,
  dropoutLenUs: {
    key: 'dropoutRate',
    ok: above0,
    fix: 10,
    hint: 'dropouts above 0',
  },
  underJitterDeg: {
    key: 'colorUnderMix',
    ok: above0,
    fix: 0.8,
    hint: 'color-under above 0',
  },
  trackPos: {
    key: 'trackAmt',
    ok: above0,
    fix: 0.4,
    hint: 'tracking error above 0',
  },
  vFreqHz: {
    key: 'vHold',
    ok: below1,
    fix: 0.5,
    hint: 'vertical hold below 1',
  },
  scDetuneKHz: {
    key: 'burstLock',
    ok: below1,
    fix: 0,
    hint: 'burst lock below 1',
  },
  audioSagUs: {
    key: 'hvRing',
    ok: above0,
    fix: 0.5,
    hint: 'supply ring above 0 (in Deflection)',
  },
  audioLoad: {
    key: 'audioSagUs',
    ok: above0,
    fix: 10,
    hint: 'bass → HV sag above 0',
  },
}

// One line per stage for the spine's hover text — the role of the stage in the
// signal path, so the map explains itself without opening anything.
const PHASE_BLURBS: Record<Phase, string> = {
  Source:
    'the picture becomes a composite waveform — encoder faults and bad cables live here',
  Feedback:
    'two loops around the chain — one optical (a camera on the tube), one electrical (the mixer bus patched into itself)',
  Tape: 'damage to the recorded waveform — VHS color-under, dropouts, timebase wander',
  Receiver:
    'a TV hunting for sync and decoding color from whatever arrives — hold, deflection, the decoder',
  Screen: 'the tube itself — beam profile, phosphor persistence, shadow mask',
}

// The signal-path phases, in order — the spine the panel is browsed along.
// The browsable spine, derived straight from each group's `place` so a group's
// stage lives in one spot (the group) and can't drift from a parallel list. ab
// and audio groups carry no phase and surface contextually instead.
export const PHASES = PHASE_ORDER.map(name => ({
  name,
  blurb: PHASE_BLURBS[name],
  groups: GROUPS.filter(g => g.place === name),
}))

// Every control, in signal-path order. The one flattening of GROUPS.
export const ALL_SLIDERS = GROUPS.flatMap(g => g.sliders)

// Span/step lookup for the code that maps external values onto controls —
// MIDI CC scaling, modulation depth, mutation — none of which have the group
// walk in hand.
export const SLIDER_BY_KEY = new Map<ControlKey, SliderDef>(
  ALL_SLIDERS.map(s => [s.key, s]),
)

// Every control has exactly one slider (controls.test.ts holds that), so the
// lookup is total: callers get a SliderDef, not a maybe they have to paper over
// with the control key as a stand-in label.
export function sliderFor(key: ControlKey): SliderDef {
  const def = SLIDER_BY_KEY.get(key)
  if (def === undefined) throw new Error(`no slider defined for ${key}`)
  return def
}

// A value landed on a control's own step grid and inside its range. One
// definition, because the four call sites that need it (MIDI CC scaling, the
// mutator, preset blending, the magnifier's curved travel) had grown two
// conventions: half anchored the grid at `min`, half at zero. They agree only
// because every slider's bounds happen to be multiples of its step — a control
// that broke that would have quietly produced values the UI cannot show.
export function snapToStep(
  def: Pick<SliderDef, 'min' | 'max' | 'step'>,
  value: number,
): number {
  const stepped =
    def.step > 0
      ? def.min + Math.round((value - def.min) / def.step) * def.step
      : value
  // Trim the float dust the multiply leaves: matchPreset compares controls with
  // ===, so a 0.30000000000000004 reads as a look someone edited.
  return Number(Math.min(def.max, Math.max(def.min, stepped)).toFixed(6))
}

// Controls that move where you are looking rather than what the signal does.
// Still bindable, but they rank last: a knob spent on the magnifier is a knob not
// spent on the picture.
export const VIEW_KEYS = new Set<ControlKey>([
  'crtZoom',
  'crtZoomX',
  'crtZoomY',
])

// The groups that surface contextually rather than on the signal-path spine.
export const AB_GROUPS = GROUPS.filter(g => g.place === 'ab')
export const AUDIO_GROUPS = GROUPS.filter(g => g.place === 'audio')

const automapSliders = [
  ...GROUPS.filter(g => g.place !== 'ab' && g.place !== 'audio'),
  ...AB_GROUPS,
  ...AUDIO_GROUPS,
].flatMap(g => g.sliders)

// Controls in auto-map priority order. A controller has far fewer knobs than
// there are controls, so the ranking decides what a 64-knob device actually
// reaches: every look-maker first, then the fine trims, then the view. Within
// each band the signal-path spine leads and the contextual A/B and audio groups
// follow, so the low banks land on what is always on screen. Bindings are stored
// by key, so re-ranking only changes what a fresh sweep assigns.
export const AUTOMAP_KEYS: ControlKey[] = [
  ...automapSliders.filter(s => s.fine !== true && !VIEW_KEYS.has(s.key)),
  ...automapSliders.filter(s => s.fine === true && !VIEW_KEYS.has(s.key)),
  ...automapSliders.filter(s => VIEW_KEYS.has(s.key)),
].map(s => s.key)
