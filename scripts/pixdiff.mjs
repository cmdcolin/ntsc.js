// Pixel A/B between two dev servers running different shader arms. The quality
// gate for any change that approximates something — fewer taps, a cheaper
// kernel, a lower-precision path — where "it looks the same to me" is not an
// answer. Reports mean and max channel error plus the tail of the distribution,
// because the failure mode of a thinned kernel is banding: a few units of error
// over a wide area, which a peak-error number alone will wave through.
//
//   node scripts/pixdiff.mjs <urlA> <urlB> [frames]
//
// Run each arm from its own `git worktree add --detach` copy with its own vite
// server (see CLAUDE.md) — that is what makes the two URLs differ by exactly one
// shader edit and nothing else.
//
// Establish the floor before trusting a result: point both URLs at the SAME
// server and confirm it prints max 0. It does, reproducibly, once the two traps
// below are handled — so a nonzero floor means the protocol has drifted, not
// that the noise is irreducible, and any A/B taken alongside it is worthless.
//
// Two traps, both of which produce a stable, convincing, wrong number:
//
// - Feedback state. With the loop live, each session accumulates a different
//   number of frames before loop.stop(), and any look with memory (phosphor,
//   phosphorBleed) never forgets the difference. `?set=phosphor:0,phosphorBleed:0`
//   isolates the pass under test; on `lightThatStays` (phosphor 0.999) the floor
//   is mean 0.7/255 with peaks of 212 and the A/B underneath it is unreadable.
// - Field parity. The engine is bistable on it, and which state a session lands
//   in depends on that same coin-flip frame count. It shows up as a floor that is
//   either exactly 0 or exactly mean ~0.6/255 with a max of 108 at one fixed
//   pixel — never anything between, which is the tell. Handled here by grabbing
//   two consecutive frames per arm and taking the better of the two alignments.

import puppeteer from 'puppeteer-core'

const [urlA, urlB, framesArg] = process.argv.slice(2)
const frames = Number(framesArg ?? 300)

if (!urlA || !urlB) {
  console.error('usage: node scripts/pixdiff.mjs <urlA> <urlB> [frames]')
  process.exit(1)
}

const grab = async url => {
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
  try {
    const page = await browser.newPage()
    page.on('pageerror', e =>
      console.log('[pageerror]', String(e).slice(0, 200)),
    )
    // Deliberately no viewport call. Under Firefox BiDi setViewport swapped the
    // realm here and window.vf came back undefined even before goto, and
    // puppeteer's defaultViewport is the same call under another name. Both arms
    // get the default window, so both get the same canvas, which is all this
    // needs — the size it compares at is reported below.
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => window.vf !== undefined, {
      timeout: 20000,
    })
    // A ?src= or ?preset= can rebuild the engine after first paint, and app.tsx
    // clears window.vf while it does — so settle, then wait for it again.
    await new Promise(r => setTimeout(r, 3500))
    await page.waitForFunction(() => window.vf !== undefined, {
      timeout: 20000,
    })
    return await page.evaluate(async frames => {
      const vf = window.vf
      vf.loop.stop()
      for (let i = 0; i < frames; i++) vf.step()
      await vf.gpu.device.queue.onSubmittedWorkDone()
      const cv = document.querySelector('canvas')
      const oc = new OffscreenCanvas(cv.width, cv.height)
      const g = oc.getContext('2d')
      const shots = []
      for (let k = 0; k < 2; k++) {
        vf.step()
        await vf.gpu.device.queue.onSubmittedWorkDone()
        g.drawImage(cv, 0, 0)
        shots.push([...g.getImageData(0, 0, cv.width, cv.height).data])
      }
      return { w: cv.width, h: cv.height, shots }
    }, frames)
  } finally {
    await browser.close()
  }
}

const a = await grab(urlA)
const b = await grab(urlB)
if (a.w !== b.w || a.h !== b.h) {
  console.error(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`)
  process.exit(1)
}

const compare = (pa, pb) => {
  let max = 0
  let sum = 0
  let n = 0
  const hist = new Array(256).fill(0)
  let worst = null
  for (let i = 0; i < pa.length; i += 4) {
    // Alpha is skipped: the canvas is opaque and it would only dilute the mean.
    for (let c = 0; c < 3; c++) {
      const e = Math.abs(pa[i + c] - pb[i + c])
      hist[e]++
      sum += e
      n++
      if (e > max) {
        max = e
        const p = i / 4
        worst = { x: p % a.w, y: Math.floor(p / a.w), c }
      }
    }
  }
  return { max, sum, n, hist, worst }
}

// Whichever field alignment matches; see the parity trap above.
const { max, sum, n, hist, worst } = [
  compare(a.shots[0], b.shots[0]),
  compare(a.shots[0], b.shots[1]),
].reduce((x, y) => (y.sum < x.sum ? y : x))

const pct = q => {
  let acc = 0
  for (let e = 0; e < 256; e++) {
    acc += hist[e]
    if (acc / n >= q) return e
  }
  return 255
}
const over = t =>
  ((hist.slice(t + 1).reduce((x, y) => x + y, 0) / n) * 100).toFixed(3)

console.log(`canvas ${a.w}x${a.h}  samples ${n}`)
console.log(
  `mean |err| ${(sum / n).toFixed(3)}/255   max ${max}  at ${JSON.stringify(worst)}`,
)
console.log(
  `p50 ${pct(0.5)}  p90 ${pct(0.9)}  p99 ${pct(0.99)}  p99.9 ${pct(0.999)}`,
)
console.log(
  `share over 1: ${over(1)}%   over 2: ${over(2)}%   over 4: ${over(4)}%   over 8: ${over(8)}%`,
)
