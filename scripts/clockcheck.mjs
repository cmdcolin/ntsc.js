// Is frame N actually a function of N?
//
//   node scripts/clockcheck.mjs [port]
//
// Five places in the signal path measure a *rate* rather than taking a
// per-frame step — the two glide reads, the stab gate, the strobe gate and the
// PLL's auto-lock — and off the wall clock they land on different frames
// depending on how fast the machine was that day. `startTake` points all five
// at the frame counter instead. This measures that it took.
//
// The clock is one of three things `startTake` holds still (the dice and the
// signal state are the other two, and `scripts/rendercheck.mjs` is where the
// whole switch is measured against a file). Here it is the clock alone that is
// under test, which is why every arm below starts its glide *after* the switch:
// a morph in flight when a take begins is stopped by it, deliberately, since
// its origin was stamped on a clock that no longer exists.
//
// **What it deliberately does not claim.** A first version hashed the canvas
// after two runs and asserted the pixels matched. That test cannot pass while
// the app's own rAF loop is running: the loop advances the frame counter during
// any real time between steps, so two runs step different totals and what is
// being measured is the window manager. Determinism needs the virtual clock
// *and* ownership of the loop, and only the first of those exists — which is
// exactly the gap docs/EDITOR.md now records against build-order step 1.
//
// So what is measured is the inversion itself, in a synchronous burst where rAF
// cannot interleave: sixty stepped frames of no real time finish a one-second
// morph on the virtual clock and barely start it on the wall clock. The
// wall-clock arm is a control rather than a formality — if it finished too,
// the other arm would be measuring nothing.

import puppeteer from 'puppeteer-core'

// Boot waited for rather than slept through — see until.mjs.
import { appUp } from './until.mjs'

import process from 'node:process'

const port = process.argv[2] ?? '5199'
const fail = []
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`,
  )
  if (!ok) fail.push(name)
}

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 900 })
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
await page.goto(`http://localhost:${port}/?set=strobeHz:8,strobeMs:40`, {
  waitUntil: 'domcontentloaded',
})
await appUp(page, 6000)
await page.bringToFront()

// One second of morph, then exactly that many frames stepped in a *synchronous*
// burst — no awaits, so the app's own rAF loop cannot interleave and the frame
// count is entirely this harness's. That is what makes the two arms comparable
// at all: with a free-running render loop, two runs separated by real time step
// different totals and the measurement is of the window manager.
//
// The morph is the cleanest reader to watch. It is one of the five, it has a
// progress readout, and "did a one-second glide finish?" is a question with an
// unambiguous answer.
const glideAfter = (virtual, frames) =>
  page.evaluate(
    (useVirtual, n) => {
      const vf = window.vf
      if (useVirtual) vf.startTake({ fps: 60, seed: 1 })
      else vf.endTake()
      const to = { ...vf.getControls(), vSize: 0.4 }
      vf.applyControls({ ...vf.getControls(), vSize: 1 })
      vf.startGlide({
        to,
        seconds: 1,
        switchKeys: new Set(),
        holdKeys: new Set(),
      })
      for (let i = 0; i < n; i++) vf.step()
      // null once the walk is over; a fraction while it is still travelling.
      return { progress: vf.getGlide(), vSize: vf.getControls().vSize }
    },
    virtual,
    frames,
  )

// --- the clock itself --------------------------------------------------------
const before = await page.evaluate(() => {
  window.vf.startTake({ fps: 60, seed: 1 })
  return { a: window.vf.clockMs(), frame: window.vf.frameNo() }
})
await new Promise(r => setTimeout(r, 700))
const after = await page.evaluate(() => ({
  a: window.vf.clockMs(),
  frame: window.vf.frameNo(),
}))
check(
  'the virtual clock does not move when only real time does',
  before.frame === after.frame ? before.a === after.a : true,
  `${before.a} -> ${after.a} over ${after.frame - before.frame} frames`,
)
const stepped = await page.evaluate(() => {
  const at = window.vf.clockMs()
  for (let i = 0; i < 60; i++) window.vf.step()
  return window.vf.clockMs() - at
})
check(
  'and one second of it is exactly sixty frames',
  Math.abs(stepped - 1000) < 0.001,
  `${stepped}ms`,
)

const wall = await page.evaluate(() => {
  window.vf.endTake()
  const a = window.vf.clockMs()
  return { a, big: a > 1000 }
})
check('turning it off goes back to the wall clock', wall.big, `${wall.a}ms`)

// --- what the switch actually inverts ----------------------------------------
//
// Sixty frames stepped in no real time at all. On the virtual clock that is a
// second and the morph is over; on the wall clock almost no time has passed and
// it has barely started. Same frames, same board, opposite answers — which is
// the inversion, stated as a measurement.
// 61 and not 60: the glide is applied at the top of a frame, before the counter
// moves, so N steps elapse N-1 frames of clock. That is an ordering rather than
// a rounding — 60 steps lands on 0.983, which is 59/60 exactly.
const virtual = await glideAfter(true, 61)
check(
  'a one-second morph is over after sixty frames of virtual clock',
  virtual.progress === null,
  `progress ${virtual.progress}, vSize ${virtual.vSize?.toFixed(3)}`,
)
check(
  'and it arrives where it was going',
  Math.abs((virtual.vSize ?? 0) - 0.4) < 0.001,
  String(virtual.vSize),
)

// The control, and the point of the harness rather than a formality: if the
// wall clock finished too, the arm above would be measuring nothing.
const walled = await glideAfter(false, 60)
check(
  'the wall clock, as the control, has barely moved over the same frames',
  walled.progress !== null && walled.progress < 0.2,
  `progress ${walled.progress}, vSize ${walled.vSize?.toFixed(3)}`,
)

// Half the frames, half the walk: the reader is following the counter linearly
// rather than merely being finished or not.
const half = await glideAfter(true, 30)
check(
  'and thirty frames get half way, so it tracks the counter and not a flag',
  half.progress !== null && Math.abs(half.progress - 0.5) < 0.05,
  `progress ${half.progress}`,
)
await page.evaluate(() => {
  window.vf.stopGlide()
  window.vf.endTake()
})

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(fail.length === 0 ? '\nclock ok' : `\n${fail.length} failed`)
process.exit(fail.length === 0 ? 0 : 1)
