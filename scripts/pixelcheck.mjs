// Pixel regression: the first script that asserts a rendered pixel rather
// than trusting a screenshot was looked at. Serves the repo itself, drives
// headed Firefox Nightly (WebGPU — see CLAUDE.md for why not Chrome), steps
// deterministic frames, and checks four facts that pin the chain end to end:
//
//  - the six SMPTE bars land on their hues (encoder matrix -> channel ->
//    burst lock -> demod axes -> RGB matrix all in one assertion);
//  - the fine-tuning cliff: colour survives the ACC at -0.5 MHz and is
//    killed outright at -0.9 (the mistune model's load-bearing behaviour);
//  - source B's sync reaches the summing bus whatever the wipe is doing;
//  - the head-end's sync suppression tracks a held deck's displaced sync tip.
//
// The last two read the WAVEFORM rather than the picture, through the dbg=2
// view. Both cover bugs that were invisible from the picture and that nothing
// in `pnpm test` can reach: they are properties of what one pass hands the
// next, and the only place that is observable is a rendered frame. Both were
// real — B contributed *exactly* zero to blanking with a wipe engaged, and the
// scrambler missed the sync tip on a third of the lines under a paused deck.
//
// Deliberately not part of `pnpm test` — it needs a GPU, a display and ~40 s.
// Usage: node scripts/pixelcheck.mjs [--url http://localhost:5173]

import puppeteer from 'puppeteer-core'

import { spawn } from 'node:child_process'

const argUrl = process.argv.indexOf('--url')
const baseUrl = argUrl > 0 ? process.argv[argUrl + 1] : null
const PORT = 5197

let vite = null
let base = baseUrl
if (!base) {
  vite = spawn(
    'node',
    ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'],
    {
      stdio: 'ignore',
    },
  )
  base = `http://localhost:${PORT}`
  for (let i = 0; ; i++) {
    try {
      await fetch(base)
      break
    } catch {
      if (i > 40) throw new Error('vite never came up')
      await new Promise(r => setTimeout(r, 250))
    }
  }
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

// centres of the six 75% bars in canvas fractions (x), on the upper bars row
const BAR_X = [0.2, 0.35, 0.5, 0.65, 0.8]
// expected channel pattern per probe point, as (hot channels, cold channels):
// grey/yellow/cyan/green at 20/35/50 then magenta 65, red 80
const EXPECT = [
  { name: 'yellow', hot: [0, 1], cold: [2] },
  { name: 'cyan', hot: [1, 2], cold: [0] },
  { name: 'green', hot: [1], cold: [0, 2] },
  { name: 'magenta', hot: [0, 2], cold: [1] },
  { name: 'red', hot: [0], cold: [1, 2] },
]

async function probes(url) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800 })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 5000))
  const out = await page.evaluate(async xs => {
    for (let i = 0; i < 120; i++) {
      window.vf?.step()
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 15))
    }
    const cv = document.querySelector('canvas')
    const oc = new OffscreenCanvas(cv.width, cv.height)
    const g = oc.getContext('2d')
    g.drawImage(cv, 0, 0)
    return xs.map(x => {
      // 5x5 mean, dodging scanline texture and grain
      const d = g.getImageData(
        Math.round(x * cv.width) - 2,
        Math.round(0.3 * cv.height) - 2,
        5,
        5,
      ).data
      const m = [0, 0, 0]
      for (let i = 0; i < d.length; i += 4) {
        m[0] += d[i]
        m[1] += d[i + 1]
        m[2] += d[i + 2]
      }
      return m.map(v => v / (d.length / 4))
    })
  }, BAR_X)
  await page.close()
  return out
}

// The dbg=2 view draws a whole line's composite across the active width and
// maps IRE by (v + 40) / 140, so sync tip (-40) is 0 and blanking (0) is ~73.
// SYNC_LEN 67 of SAMPLES_PER_LINE 910 puts the horizontal sync interval in the
// leftmost 7.4% — see src/signal/constants.ts, which BAR_X above is pinned to
// the same way.
const SYNC_FRAC = 67 / 910
// Below this a sample is still at sync level rather than lifted toward
// blanking; grain and the 8-bit view leave a few counts of slack.
const TIP = 20

// Mean level over the sync interval, and how many active lines still hold a
// sample down at sync level anywhere along the line. Reading the waveform is
// the point: both facts below live in blanking, which the picture cannot show.
async function waveform(url) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800 })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 5000))
  const out = await page.evaluate(
    async (syncFrac, tip) => {
      for (let i = 0; i < 120; i++) {
        window.vf?.step()
        if (i % 10 === 0) await new Promise(r => setTimeout(r, 15))
      }
      const cv = document.querySelector('canvas')
      const oc = new OffscreenCanvas(cv.width, cv.height)
      const g = oc.getContext('2d')
      g.drawImage(cv, 0, 0)
      const d = g.getImageData(0, 0, cv.width, cv.height).data
      const x1 = Math.floor(cv.width * syncFrac)
      let sync = 0
      let syncN = 0
      let rows = 0
      let tipRows = 0
      // a band well inside the picture, dodging the letterbox at either end
      for (let y = Math.floor(cv.height * 0.3); y < cv.height * 0.7; y++) {
        let min = 255
        for (let x = 1; x < cv.width - 1; x++) {
          const v = d[(y * cv.width + x) * 4]
          if (v < min) min = v
          if (x < x1) {
            sync += v
            syncN++
          }
        }
        rows++
        if (min < tip) tipRows++
      }
      return { sync: sync / syncN, rows, tipRows }
    },
    SYNC_FRAC,
    TIP,
  )
  await page.close()
  return out
}

let failures = 0
const fail = msg => {
  failures++
  console.error('FAIL', msg)
}
// Each block reports on its own count rather than the total, so one failure
// does not silence the "ok" lines after it — a run has to say which facts held,
// not just that something somewhere broke.
const marker = () => {
  const before = failures
  return () => failures === before
}

// -- the six hues survive the clean chain -----------------------------------
{
  const p = await probes(`${base}/?set=noiseIre:0`)
  p.forEach((rgb, i) => {
    const e = EXPECT[i]
    const hotMin = Math.min(...e.hot.map(c => rgb[c]))
    const coldMax = Math.max(...e.cold.map(c => rgb[c]))
    if (hotMin < 90)
      fail(
        `${e.name}: hot channel only ${hotMin.toFixed(0)} (rgb ${rgb.map(v => v.toFixed(0))})`,
      )
    if (coldMax > hotMin * 0.45) {
      fail(
        `${e.name}: cold channel ${coldMax.toFixed(0)} vs hot ${hotMin.toFixed(0)} — hue off`,
      )
    }
  })
  console.log(
    failures === 0
      ? 'ok   bars: six hues in place'
      : 'bars: see failures above',
  )
}

// -- the mistune cliff -------------------------------------------------------
const chroma = rgb => Math.max(...rgb) - Math.min(...rgb)
{
  const alive = await probes(`${base}/?set=rfMistuneMHz:-0.5`)
  const dead = await probes(`${base}/?set=rfMistuneMHz:-0.9`)
  const aliveMin = Math.min(...alive.map(chroma))
  const deadMax = Math.max(...dead.map(chroma))
  if (aliveMin < 60)
    fail(
      `-0.5 MHz should keep colour through the ACC (min chroma ${aliveMin.toFixed(0)})`,
    )
  if (deadMax > 14)
    fail(
      `-0.9 MHz should trip the killer to greyscale (max chroma ${deadMax.toFixed(0)})`,
    )
  if (failures === 0)
    console.log(
      `ok   cliff: chroma ${aliveMin.toFixed(0)} alive at -0.5, ${deadMax.toFixed(0)} dead at -0.9`,
    )
}

// -- a wipe shapes the picture, it does not call off the sync fight ----------
{
  const clean = marker()
  // B parked on A's raster (no slip, roll or detune) so the reads differ only
  // by whether B's blanking reached the bus at all — and on a NEGATIVE fader,
  // which on the dirty path inverts B's whole waveform, sync tips included.
  // That is what makes it measurable: parked and summed the same way round,
  // B's tip lands exactly on A's and both saturate the bottom of the view, so
  // the difference only shows when B's tip pulls the other way.
  //
  // mix_b gated ALL of B on the wipe pattern, which is zero outside active
  // picture, so engaging a wipe took B's sync, burst and field pulses out of
  // the dirty sum entirely and the fight the non-genlocked path exists for
  // stopped. It measured exactly zero, not merely reduced.
  const park = 'bGain:-0.6,bLineHz:0,bDetuneHz:0,bRollLps:0,noiseIre:0,agc:0'
  const quiet = await waveform(`${base}/?dbg=2&set=bGain:0,noiseIre:0,agc:0`)
  const off = await waveform(`${base}/?dbg=2&set=${park}`)
  const on = await waveform(
    `${base}/?dbg=2&set=${park},wipeMode:1,wipeSoft:0.03`,
  )
  // how far the sync interval moves when B is summed in, wipe or no wipe
  const dOff = off.sync - quiet.sync
  const dOn = on.sync - quiet.sync
  if (dOff < 10)
    fail(`B's sync should reach the bus with no wipe (Δ ${dOff.toFixed(1)})`)
  else if (dOn < dOff * 0.8)
    fail(
      `a wipe must not take B's sync off the bus: Δ ${dOn.toFixed(1)} with, ${dOff.toFixed(1)} without`,
    )
  if (clean())
    console.log(
      `ok   wipe: B's sync on the bus either way (Δ ${dOff.toFixed(1)} / ${dOn.toFixed(1)})`,
    )
}

// -- head-end damage rides the tape, not the glass ---------------------------
{
  const clean = marker()
  // Scrambling is applied upstream of the deck, so its sync gate has to follow
  // the sync tip when a held deck displaces it. Evaluated at the output sample
  // instead, it lifted whatever had drifted under the gate and left the real
  // tip alone on a third of the lines.
  const scr = 'aScramble:1,aScrambleMode:0,bGain:0,noiseIre:0,agc:0'
  const playing = await waveform(`${base}/?dbg=2&set=${scr}`)
  const held = await waveform(`${base}/?dbg=2&set=${scr},aPause:0.9`)
  if (playing.tipRows > 0)
    fail(
      `a scrambled feed should suppress every tip while playing (${playing.tipRows}/${playing.rows} left)`,
    )
  // The mistrack stripe's snow legitimately swings below sync level, and at
  // aPause 0.9 it is ~17 source rows wide — so the floor is a band, not zero.
  const ceiling = Math.round(held.rows * 0.12)
  if (held.tipRows > ceiling)
    fail(
      `a held deck's tips escaped the scrambler: ${held.tipRows}/${held.rows} left, over ${ceiling}`,
    )
  if (clean())
    console.log(
      `ok   pause: tips suppressed held as playing (${held.tipRows}/${held.rows} left, stripe only)`,
    )
}

await browser.close()
vite?.kill()
process.exit(failures === 0 ? 0 : 1)
