// SMPTE color bars: the validation instrument. 75% bars, castellation strip,
// and a PLUGE-ish bottom row. Drawn at raster resolution.

import { ACTIVE_HEIGHT, ACTIVE_WIDTH } from '../signal/constants'

// Multiburst-style sweep: frequency gratings at known MHz plus a luma ramp.
// The bandwidth sliders should visibly erase gratings above their cutoff.
export function sweep(): OffscreenCanvas {
  const cv = new OffscreenCanvas(ACTIVE_WIDTH, ACTIVE_HEIGHT)
  const g = cv.getContext('2d')
  if (!g) throw new Error('no 2d context')
  const img = g.createImageData(ACTIVE_WIDTH, ACTIVE_HEIGHT)
  // active width = 754 samples at 14.318 MHz; grating of period p px = 14.318/(2p)... MHz
  const bands = [0.5, 1, 2, 3, 4.2, 5]
  for (let y = 0; y < ACTIVE_HEIGHT; y++) {
    for (let x = 0; x < ACTIVE_WIDTH; x++) {
      const i = (y * ACTIVE_WIDTH + x) * 4
      let v: number
      if (y < ACTIVE_HEIGHT * 0.15) {
        v = (x / ACTIVE_WIDTH) * 255 // ramp
      } else if (y < ACTIVE_HEIGHT * 0.8) {
        const band =
          bands[
            Math.min(
              Math.floor(
                (y - ACTIVE_HEIGHT * 0.15) /
                  ((ACTIVE_HEIGHT * 0.65) / bands.length),
              ),
              bands.length - 1,
            )
          ]
        // band MHz -> cycles per sample at 14.318 MHz raster
        v = 128 + 100 * Math.sin(2 * Math.PI * (band / 14.318182) * x)
      } else {
        v = x % 94 < 47 ? 20 : 235 // coarse squares for ringing
      }
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return cv
}

// The top band's seven bars, as 0..1 triples, and the single source the drawn
// pattern is built from. Exported because the vectorscope's graticule is a 75%
// bar graticule and `bars.spec.ts` checks that what this actually draws still
// lands in those boxes — otherwise the two would drift in different files and
// the instrument would quietly start lying. 0xC0 rather than exactly 0.75 is
// the conventional 8-bit value for 75% bars, and is what this has always drawn.
const B = 0xc0 / 0xff
export const SMPTE_BAR_RGB: readonly (readonly [number, number, number])[] = [
  [B, B, B],
  [B, B, 0],
  [0, B, B],
  [0, B, 0],
  [B, 0, B],
  [B, 0, 0],
  [0, 0, B],
]

const hex = (v: number) =>
  Math.round(v * 0xff)
    .toString(16)
    .padStart(2, '0')
const css = ([r, g, b]: readonly [number, number, number]) =>
  `#${hex(r)}${hex(g)}${hex(b)}`

export function smpteBars(): OffscreenCanvas {
  const cv = new OffscreenCanvas(ACTIVE_WIDTH, ACTIVE_HEIGHT)
  const g = cv.getContext('2d')
  if (!g) throw new Error('no 2d context')
  const W = ACTIVE_WIDTH
  const H = ACTIVE_HEIGHT
  const topH = Math.round(H * 0.67)
  const bw = W / 7
  SMPTE_BAR_RGB.forEach((rgb, i) => {
    g.fillStyle = css(rgb)
    g.fillRect(Math.round(i * bw), 0, Math.ceil(bw), topH)
  })
  const castH = Math.round(H * 0.08)
  const cast = [
    '#0000c0',
    '#131313',
    '#c000c0',
    '#131313',
    '#00c0c0',
    '#131313',
    '#c0c0c0',
  ]
  cast.forEach((col, i) => {
    g.fillStyle = col
    g.fillRect(Math.round(i * bw), topH, Math.ceil(bw), castH)
  })
  const by = topH + castH
  const bh = H - by
  const bottom: [string, number][] = [
    ['#00214c', 5 / 28], // -I
    ['#ffffff', 5 / 28], // 100% white
    ['#32006a', 5 / 28], // +Q
    ['#131313', 5 / 28],
    ['#090909', 8 / 84], // sub-black
    ['#131313', 8 / 84],
    ['#1d1d1d', 8 / 84], // above-black
  ]
  let x = 0
  for (const [col, frac] of bottom) {
    const w = W * frac
    g.fillStyle = col
    g.fillRect(Math.round(x), by, Math.ceil(w), bh)
    x += w
  }
  return cv
}
