// Pixel regression: the first script that asserts a rendered pixel rather
// than trusting a screenshot was looked at. Serves the repo itself, drives
// headed Firefox Nightly (WebGPU — see CLAUDE.md for why not Chrome), steps
// deterministic frames, and checks two facts that pin the decode chain end
// to end:
//
//  - the six SMPTE bars land on their hues (encoder matrix -> channel ->
//    burst lock -> demod axes -> RGB matrix all in one assertion);
//  - the fine-tuning cliff: colour survives the ACC at -0.5 MHz and is
//    killed outright at -0.9 (the mistune model's load-bearing behaviour).
//
// Deliberately not part of `pnpm test` — it needs a GPU, a display and ~30 s.
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

let failures = 0
const fail = msg => {
  failures++
  console.error('FAIL', msg)
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

await browser.close()
vite?.kill()
process.exit(failures === 0 ? 0 : 1)
