// NTSC timing on a fixed physical raster sampled at 4x the color subcarrier.
// All filter/effect parameters elsewhere are specified in real units (Hz, us,
// IRE) and converted to samples through these constants.

export const FSC = 315e6 / 88 // color subcarrier, 3.579545... MHz
export const F_H = 4500000 / 286 // line rate, 15734.27 Hz
export const SAMPLE_RATE = 4 * FSC // 14.31818 MHz
export const SAMPLES_PER_LINE = 910 // = 227.5 subcarrier cycles per line
export const LINES = 525

// Line structure, in samples from the h-sync leading edge (1 sample = 69.84 ns)
export const SYNC_LEN = 67 // 4.7 us sync tip
export const BURST_START = 78 // after 0.77 us breezeway
export const BURST_LEN = 36 // 9 subcarrier cycles
export const ACTIVE_START = 134 // ~9.4 us of total blanking
export const ACTIVE_WIDTH = 754 // 52.66 us active picture
// front porch fills the remainder to 910

// Frame structure (serrated vsync flanked by equalizing pulses on lines 0-2, 9-11)
export const VSYNC_FIRST = 3
export const VSYNC_LAST = 8
export const ACTIVE_TOP = 22
export const ACTIVE_HEIGHT = 480
export const HEAD_SWITCH_LINE = ACTIVE_TOP + ACTIVE_HEIGHT - 8 // VHS head switch near bottom of picture

// How much tape is on the loop bin, in frames. This is the one constant here
// bounded by hardware rather than by NTSC: the ring stores every sample of the
// raster as an f16, so a frame of tape costs 910 x 525 x 2 = 933 KiB and 120 of
// them is 109 MiB — inside the 128 MiB a WebGPU storage binding is guaranteed
// at default limits, with room to spare. At 60 fps that is a two-second loop.
export const TAPE_FRAMES = 120

// VHS SP linear tape speed. The loop is authored in millimetres of tape between
// the record and play heads, so the delay is length / speed — which is why
// capstan wander moves the delay time rather than only wobbling the picture.
export const TAPE_MM_PER_S = 33.35

// IRE levels
export const IRE_SYNC = -40
export const IRE_BLANK = 0
export const IRE_BLACK = 7.5
export const IRE_WHITE = 100
export const IRE_VIDEO_RANGE = IRE_WHITE - IRE_BLACK // 92.5
export const BURST_AMP_IRE = 20 // +-20 IRE (40 IRE p-p)

export const usToSamples = (us: number) => us * 1e-6 * SAMPLE_RATE

// The six 75% colour-bar targets a vectorscope graticule marks, derived from
// the encoding matrix rather than copied off a graticule face:
//
//   Y = 0.299R + 0.587G + 0.114B,  U = 0.492(B - Y),  V = 0.877(R - Y)
//
// The boxes sit at *different* radii — yellow and blue carry about a third of
// the chroma red and cyan do — which is arithmetic rather than decoration, and
// is why a real graticule's targets are not spaced around a ring. The angles
// this produces are the published NTSC ones (yellow 167.1 deg, cyan 283.5,
// green 240.7, magenta 60.7, red 103.5, blue 347.1); `bars.spec.ts` holds the
// derivation to them, so a wrong matrix cannot quietly move the graticule and
// leave the instrument lying about where colour is landing.
export const BAR_LEVEL = 0.75
const BAR_RGB = [
  [1, 0, 0], // red
  [1, 1, 0], // yellow
  [0, 1, 0], // green
  [0, 1, 1], // cyan
  [0, 0, 1], // blue
  [1, 0, 1], // magenta
] as const

export const BAR_TARGETS: readonly (readonly [number, number])[] = BAR_RGB.map(
  ([r, g, b]) => {
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    return [BAR_LEVEL * 0.492 * (b - y), BAR_LEVEL * 0.877 * (r - y)] as const
  },
)

// 100% bars reach further than 75% ones by exactly the level ratio, and that
// magnitude is what the scope's outer circle means: full scale is where an
// undamaged 100% bar lands, so anything outside it is genuinely out of range.
export const BAR_FULL_SCALE = Math.hypot(...BAR_TARGETS[0]) / BAR_LEVEL
