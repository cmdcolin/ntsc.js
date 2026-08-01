// Draw the project logo: one NTSC line of 75% color bars as it looks on a
// waveform monitor — sync, burst, then the descending luma staircase with the
// chroma subcarrier riding on each pedestal.
//
// Emits the wide banner (docs/logo.svg) plus a square mark of just the bar
// staircase, small enough to read as a favicon and as the sidebar glyph
// (docs/mark.svg, mirrored to public/favicon.svg).
// Usage: node scripts/logo.mjs   (via pnpm logo)

import { writeFileSync } from 'node:fs'

const FSC = 3.579545 // color subcarrier, MHz
const LINE = 63.5556 // one line, µs
const FRONT_PORCH = 1.5
const SYNC = 4.7
const BLANKING = 10.9 // sync leading edge → start of active
const ACTIVE = LINE - BLANKING
const BURST_START = 5.3 // after sync leading edge
const BURST_CYCLES = 9
const BURST_IRE = 20 // ±, about blanking

// EIA 75% bars. Y is the luma pedestal, chroma is the subcarrier peak-to-peak
// swing about it — both in IRE, the units a waveform monitor reads.
const BARS = [
  { name: 'white', y: 100, chroma: 0, color: '#ffffff' },
  { name: 'yellow', y: 69.0, chroma: 62.1, color: '#bfbf00' },
  { name: 'cyan', y: 56.1, chroma: 87.7, color: '#00bfbf' },
  { name: 'green', y: 48.2, chroma: 81.9, color: '#00bf00' },
  { name: 'magenta', y: 36.2, chroma: 81.9, color: '#bf00bf' },
  { name: 'red', y: 28.2, chroma: 87.7, color: '#bf0000' },
  { name: 'blue', y: 15.4, chroma: 62.1, color: '#0000bf' },
  { name: 'black', y: 7.5, chroma: 0, color: '#8d97a5' },
]

const W = 720
const H = 210
const PAD_X = 18
const TOP = 22 // 100 IRE
const BOT = 178 // -40 IRE
const LEAD = 3.2 // µs of the previous line's black bar, for context

// The trace spans front porch → sync → burst → active → the next line's sync,
// so both ends read as a repeating line, the way the scope shows it.
const SPAN = LEAD + LINE + FRONT_PORCH + SYNC
const px = (W - 2 * PAD_X) / SPAN
const x = t => PAD_X + (t + LEAD) * px
const y = ire => TOP + ((100 - ire) * (BOT - TOP)) / 140
const n = v => Number(v.toFixed(2))

// Mix toward white: the true bar primaries (blue especially) go muddy against
// a near-black backdrop.
function lift(hex, amt) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `#${c
    .map(v =>
      Math.round(v + (255 - v) * amt)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

// One subcarrier cycle as two cubics — a half period each, control points at
// 4/3 amplitude so the curve peaks on the sine. Cheaper and smoother than
// sampling the sine as a polyline.
function cycles(t0, count, ire, ampIre) {
  const h = (1 / FSC / 2) * px // half period, px
  const k = n((((ampIre * 4) / 3) * (BOT - TOP)) / 140)
  const seg = s => `c${n(h / 3)} ${s * k} ${n((2 * h) / 3)} ${s * k} ${n(h)} 0`
  return (
    `M${n(x(t0))} ${n(y(ire))}` +
    Array.from({ length: count }, () => `${seg(-1)}${seg(1)}`).join('')
  )
}

const barW = ACTIVE / BARS.length
const barT = i => BLANKING + i * barW

// Sync, porches and blanking: the neutral skeleton the color rides on.
const t0 = -LEAD
const nextLine = LINE
const skeleton = [
  `M${n(x(t0))} ${n(y(7.5))}`,
  `H${n(x(0))}`,
  `V${n(y(0))}`,
  `H${n(x(FRONT_PORCH))}`,
  `V${n(y(-40))}`,
  `H${n(x(FRONT_PORCH + SYNC))}`,
  `V${n(y(0))}`,
  `H${n(x(BLANKING))}`,
  `V${n(y(BARS[0].y))}`,
  ...BARS.flatMap((_, i) => [
    `H${n(x(barT(i) + barW))}`,
    `V${n(y(i + 1 < BARS.length ? BARS[i + 1].y : 0))}`,
  ]),
  `H${n(x(nextLine + FRONT_PORCH))}`,
  `V${n(y(-40))}`,
  `H${n(x(nextLine + FRONT_PORCH + SYNC))}`,
  `V${n(y(0))}`,
  `H${n(x(SPAN - LEAD))}`,
].join('')

const burst = cycles(FRONT_PORCH + BURST_START, BURST_CYCLES, 0, BURST_IRE)

const chroma = BARS.flatMap((b, i) => {
  const stroke = lift(b.color, 0.25)
  if (b.chroma === 0) {
    return []
  }
  const hi = y(b.y + b.chroma / 2)
  const lo = y(b.y - b.chroma / 2)
  const count = Math.round(barW * FSC)
  return [
    `<rect x="${n(x(barT(i)))}" y="${n(hi)}" width="${n(barW * px)}" height="${n(lo - hi)}" fill="${b.color}" opacity="0.16"/>`,
    `<path d="${cycles(barT(i), count, b.y, b.chroma / 2)}" stroke="${stroke}" stroke-width="1.1" stroke-opacity="0.95"/>`,
    `<path d="M${n(x(barT(i)))} ${n(y(b.y))}H${n(x(barT(i) + barW))}" stroke="${stroke}" stroke-width="1.6" stroke-opacity="0.85"/>`,
  ]
})

// Faint graticule at the levels a scope is set up against.
const graticule = [100, 0, -40]
  .map(ire => `<path d="M${PAD_X} ${n(y(ire))}H${W - PAD_X}"/>`)
  .join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="ntscynthia — one NTSC line of 75% color bars on a waveform monitor: horizontal sync, color burst, and the descending luma staircase with chroma subcarrier on each bar">
  <defs>
    <filter id="glow" x="-4%" y="-8%" width="108%" height="116%">
      <feGaussianBlur stdDeviation="2.2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" rx="14" fill="#0a0b0d"/>
  <g stroke="#ffffff" stroke-opacity="0.09" stroke-width="1">${graticule}</g>
  <g fill="none" filter="url(#glow)">
    ${chroma.join('\n    ')}
    <path d="${skeleton}" stroke="#dfe5ec" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${burst}" stroke="#dfe5ec" stroke-width="1.6"/>
  </g>
</svg>
`

// The square mark: the same staircase, stripped to what survives 16 px. The
// subcarrier turns to mush at that size, so each bar is drawn as its chroma
// envelope alone, with the luma pedestal as a bright cap. Only the six chroma
// bars are kept — white and black are flat lines that vanish at icon size, and
// dropping them lets the cascade fill the square.
const CHROMA_BARS = BARS.filter(b => b.chroma > 0)
const S = 32
const SPAD = 2.5
const TOP_IRE = 100
const BOT_IRE = -16
const sy = ire =>
  SPAD + ((TOP_IRE - ire) * (S - 2 * SPAD)) / (TOP_IRE - BOT_IRE)
const sw = (S - 2 * SPAD) / CHROMA_BARS.length
const mark = CHROMA_BARS.map((b, i) => {
  const bx = n(SPAD + i * sw)
  const hi = sy(b.y + b.chroma / 2)
  const lo = sy(b.y - b.chroma / 2)
  return (
    `<rect x="${bx}" y="${n(hi)}" width="${n(sw)}" height="${n(lo - hi)}" fill="${lift(b.color, 0.12)}"/>` +
    `<rect x="${bx}" y="${n(sy(b.y) - 0.45)}" width="${n(sw)}" height="0.9" fill="#f2f5f8" opacity="0.9"/>`
  )
}).join('\n  ')

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" role="img" aria-label="ntscynthia — the 75% color bar staircase of an NTSC line">
  <rect width="${S}" height="${S}" rx="6" fill="#0a0b0d"/>
  ${mark}
</svg>
`

writeFileSync('docs/logo.svg', svg)
writeFileSync('docs/mark.svg', markSvg)
writeFileSync('public/favicon.svg', markSvg)
console.log(
  `docs/logo.svg — ${(svg.length / 1024).toFixed(1)} kB · docs/mark.svg + public/favicon.svg — ${(markSvg.length / 1024).toFixed(1)} kB`,
)
