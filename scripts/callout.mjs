#!/usr/bin/env node
// Composes the README's signal-path figure from two docshots: `chain`, the app
// window with the map boxed in red, and `signal-path`, the same map cropped out
// of the panel at a size you can read. One figure does the job of both — where
// the map sits, and what is on it — and the wedge between them says they are
// the same thing at two scales.
//
//   node scripts/callout.mjs        # docs/img/signal-path-callout.jpg
//
// `pnpm docshots` runs this itself after retaking either source, so the figure
// cannot outlive the shots it is made of.
import { execFileSync } from 'node:child_process'

const IMG = 'docs/img'
const WINDOW = `${IMG}/chain.jpg`
const MAP = `${IMG}/signal-path.png`
const OUT = `${IMG}/signal-path-callout.jpg`

// docshots' callout red, and the reason the box can be found again below.
// Nothing else in the dark UI uses it.
const RED = '#ff2f45'

// Gutters, in the window shot's own pixels (1800 wide). The inset sits over the
// bottom-left of the picture rather than under the whole frame: the figure then
// stays the size of the window shot, and what it covers is chair rather than
// anything the shot is making a point about.
const MARGIN = 60
const FLOOR = 96
const BORDER = 5

const magick = (...args) => execFileSync('magick', args.map(String)).toString()

const size = file =>
  magick('identify', '-format', '%w %h\n', file).trim().split(' ').map(Number)

// Where the red box landed, read back out of the pixels. docshots draws it from
// the live element, so it moves whenever the panel does — a hand-measured rect
// here would be the one part of this figure that drifts.
//
// The box is a hollow rectangle, and JPEG leaves its edges as more than one
// blob, so this unions every red run big enough to be part of it. The app's
// logo has red in it too; at a few pixels across it fails the same test.
function redBox(file) {
  const report = magick(
    file,
    '-fuzz',
    '5%',
    '-fill',
    'white',
    '-opaque',
    RED,
    '-fill',
    'black',
    '+opaque',
    'white',
    '-define',
    'connected-components:verbose=true',
    '-define',
    'connected-components:area-threshold=100',
    '-connected-components',
    '8',
    'null:',
  )
  const parts = report
    .split('\n')
    .map(line =>
      /^\s*\d+: (\d+)x(\d+)\+(\d+)\+(\d+).*srgb\(255,255,255\)/.exec(line),
    )
    .filter(m => m !== null)
    .map(m => m.slice(1).map(Number))
    .filter(([w, h]) => w >= 200 || h >= 100)
  if (parts.length === 0) throw new Error(`no red callout box in ${file}`)
  const x = Math.min(...parts.map(([, , px]) => px))
  const y = Math.min(...parts.map(([, , , py]) => py))
  return {
    x,
    y,
    w: Math.max(...parts.map(([w, , px]) => px + w)) - x,
    h: Math.max(...parts.map(([, h, , py]) => py + h)) - y,
  }
}

const [W, H] = size(WINDOW)
const [mapW, mapH] = size(MAP)
const box = redBox(WINDOW)

const iw = mapW + 2 * BORDER
const ih = mapH + 2 * BORDER
const ix = MARGIN
const iy = H - FLOOR - ih

// The wedge runs from the box's near edge to the inset's, and is drawn before
// the inset lands on top, so the lines end under its border rather than on it.
magick(
  WINDOW,
  '-stroke',
  RED,
  '-strokewidth',
  4,
  '-fill',
  'none',
  '-draw',
  `line ${box.x},${box.y} ${ix + iw},${iy}`,
  '-draw',
  `line ${box.x},${box.y + box.h} ${ix + iw},${iy + ih}`,
  '(',
  MAP,
  '-bordercolor',
  RED,
  '-border',
  BORDER,
  ')',
  '-geometry',
  `+${ix}+${iy}`,
  '-composite',
  '-quality',
  88,
  OUT,
)
console.log(`${OUT} ${W}x${H} — box ${box.w}x${box.h}+${box.x}+${box.y}`)
