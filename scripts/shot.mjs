// Verification harness: drive headed Firefox Nightly (WebGPU) against the dev
// server, wait real time for GPU frames, dump page console, save a screenshot.
// Usage: node scripts/shot.mjs <url> <out.png> [waitMs]

import puppeteer from 'puppeteer-core'

const [url, out, waitMsArg] = process.argv.slice(2)
const waitMs = Number(waitMsArg ?? 6000)

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
    'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true,
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 900 })
let failure = ''
page.on('console', (msg) => console.log('[page]', msg.text().slice(0, 500)))
page.on('pageerror', (err) => {
  console.log('[pageerror]', String(err).slice(0, 500))
  failure ||= `pageerror: ${String(err).slice(0, 200)}`
})
await page.goto(url, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, waitMs))
// occluded windows throttle rAF; step frames deterministically instead
await page.evaluate(async () => {
  for (let i = 0; i < 120; i++) {
    window.vf?.step()
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 15))
  }
})
const probe = await page.evaluate(() => {
  const cv = document.querySelector('canvas')
  if (!cv) return { text: 'no canvas', peak: -1 }
  const oc = new OffscreenCanvas(cv.width, cv.height)
  const g = oc.getContext('2d')
  g.drawImage(cv, 0, 0)
  const pts = [[0.2, 0.3], [0.35, 0.3], [0.5, 0.3], [0.65, 0.3], [0.8, 0.3], [0.5, 0.85], [0.5, 0.5]]
  let peak = 0
  const text = pts.map(([x, y]) => {
    const d = g.getImageData(Math.round(x * cv.width), Math.round(y * cv.height), 1, 1).data
    peak = Math.max(peak, d[0], d[1], d[2])
    return `${(x * 100).toFixed(0)},${(y * 100).toFixed(0)}: ${d[0]},${d[1]},${d[2]}`
  }).join(' | ')
  return { text, peak }
})
console.log('probe', probe.text)
// A dead-black frame across every sample point means the GPU process crashed
// mid-run or never produced output — a saved black PNG must not read as success.
if (probe.peak <= 0) failure ||= `dead frame (canvas peak channel ${probe.peak}, no output rendered)`
await page.screenshot({ path: out })
// Stop the render loop and release the device before teardown; otherwise
// browser.close() SIGKILLs Firefox's GPU process mid-frame, which drops a
// minidump (with a missing .extra sidecar) into the throwaway profile.
await page.evaluate(() => window.vf?.destroy())
await browser.close()
if (failure) {
  console.error('FAILED:', failure)
  process.exit(1)
}
console.log('saved', out)
