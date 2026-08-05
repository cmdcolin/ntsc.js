// Drives a worker-owned engine through its protocol and checks the picture that
// comes out — the verification for `engine.worker.ts` before anything in the
// React app depends on it.
//
//   npx vite --port 5361 --strictPort
//   node scripts/workercheck.mjs [url]
//
// Needs the **dev server**, not a production build: the worker is loaded as a
// module from source (`/src/gpu/engine.worker.ts`), which is what lets this run
// without adding a second html entry point to the repo just to be tested. Serve
// it from a `git worktree add --detach` copy if anything else might be editing
// the tree — an HMR reload mid-run tears the worker down under the assertions.
//
// Everything the app cannot do from a worker is proved here by its absence: no
// document, no <video>, no AudioContext. Frames arrive as transferred bitmaps.

import puppeteer from 'puppeteer-core'

const url = process.argv[2] ?? 'http://localhost:5361/'

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
await page.setViewport({ width: 1000, height: 760 })
const fails = []
page.on('pageerror', e => {
  fails.push(`pageerror: ${String(e).slice(0, 200)}`)
})
// React's dev build logs a line per component per render; forwarding all of it
// over BiDi is enough to stall a run, so only keep what this harness looks for.
page.on('console', m => {
  const t = m.text()
  if (/worker|error|fail/i.test(t)) console.log('[page]', t.slice(0, 200))
})
await page.goto(url, { waitUntil: 'load' })

const result = await page.evaluate(async () => {
  const log = []
  const canvas = document.createElement('canvas')
  canvas.width = 754
  canvas.height = 480
  document.body.appendChild(canvas)
  const off = canvas.transferControlToOffscreen()

  const worker = new Worker('/src/gpu/engine.worker.ts', { type: 'module' })
  const seen = []
  const waiters = new Map()
  worker.onmessage = ev => {
    seen.push(ev.data)
    const w = waiters.get(ev.data.t)
    if (w) {
      waiters.delete(ev.data.t)
      w(ev.data)
    }
  }
  const until = (t, ms = 15000) =>
    new Promise((res, rej) => {
      const hit = seen.find(m => m.t === t)
      if (hit) return res(hit)
      waiters.set(t, res)
      setTimeout(() => {
        rej(new Error(`timed out waiting for "${t}"`))
      }, ms)
    })

  worker.postMessage({ t: 'init', canvas: off, search: '?dbg=0' }, [off])
  const ready = await Promise.race([
    until('ready'),
    until('initFailed').then(m => {
      throw new Error(`initFailed: ${m.message}`)
    }),
  ])
  log.push(`ready: ${JSON.stringify(ready)}`)

  // A still on each slot, as transferred bitmaps. Two flat colours, so what
  // lands on the raster is unambiguous.
  const solid = (r, g, b) => {
    const c = new OffscreenCanvas(754, 480)
    const x = c.getContext('2d')
    x.fillStyle = `rgb(${r},${g},${b})`
    x.fillRect(0, 0, 754, 480)
    return c.transferToImageBitmap()
  }
  const bmpA = solid(220, 30, 30)
  worker.postMessage({ t: 'imageA', bmp: bmpA, aspect: 4 / 3 }, [bmpA])
  worker.postMessage({ t: 'noiseB', kind: 0 })
  worker.postMessage({ t: 'sourceBEnabled', on: false })

  // A clean look, so the red survives to the screen recognisably.
  worker.postMessage({
    t: 'applyControls',
    patch: { noiseIre: 0, fbMix: 0, crtGlow: 0, bGain: 0, timeScale: 1 },
  })

  // Step deterministically rather than waiting on wall-clock frames — an
  // occluded window throttles rAF to about 1Hz and would make this flaky.
  let stepId = 0
  const step = async n => {
    for (let i = 0; i < n; i++) {
      const id = ++stepId
      const done = new Promise(res => waiters.set('stepped', res))
      worker.postMessage({ t: 'step', id })
      await done
    }
  }
  await step(30)

  const sample = () => {
    const oc = new OffscreenCanvas(canvas.width, canvas.height)
    const g = oc.getContext('2d')
    g.drawImage(canvas, 0, 0)
    const d = g.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  // Reading a worker-owned canvas back from the page lags what the worker has
  // already presented — the same frame read twice in a row gave 0,0,0 and then
  // the real pixel. Stepping the engine is not enough; the compositor has to
  // have picked the frame up. So poll until the picture is what it should be,
  // and on a timeout hand back the last thing seen so a real failure still
  // fails rather than hanging.
  const settle = async (want, ms = 4000) => {
    const end = performance.now() + ms
    let last = sample()
    while (performance.now() < end) {
      if (want(last)) return last
      await new Promise(r => setTimeout(r, 50))
      last = sample()
    }
    return last
  }
  const dominant = i => px =>
    px[i] > 70 && px[i] > px[(i + 1) % 3] + 25 && px[i] > px[(i + 2) % 3] + 25

  const red = await settle(dominant(0))
  log.push(`centre after red still: ${red}`)

  // Swap the still and prove the change reaches the screen, which is what says
  // the protocol is actually driving the engine rather than the canvas holding
  // a first frame.
  const bmpG = solid(30, 200, 60)
  worker.postMessage({ t: 'imageA', bmp: bmpG, aspect: 4 / 3 }, [bmpG])
  await step(30)
  const green = await settle(dominant(1))
  log.push(`centre after green still: ${green}`)

  // A control the picture cannot hide: full TV static on A.
  // Static is not a colour, so settle on it simply being lit rather than black.
  worker.postMessage({ t: 'noiseA', kind: 1 })
  await step(30)
  const noise = await settle(px => px[0] + px[1] + px[2] > 90)
  log.push(`centre with TV static: ${noise}`)

  // frameNo has to answer, and has to have advanced.
  const fn = await new Promise(res => {
    waiters.set('frameNo', res)
    worker.postMessage({ t: 'frameNo', id: 1 })
  })
  log.push(`frameNo: ${fn.frame}`)

  // The transferred bitmaps must be dead on this side — that is the proof they
  // moved rather than being copied.
  const transferred = bmpA.width === 0 && bmpG.width === 0

  worker.postMessage({ t: 'destroy' })
  return {
    log,
    red,
    green,
    noise,
    frame: fn.frame,
    transferred,
    sawGpuError: seen.filter(m => m.t === 'gpuError').map(m => m.message),
    sawDeviceLost: seen.filter(m => m.t === 'deviceLost').map(m => m.message),
    sawHang: seen.some(m => m.t === 'hang'),
    gotControls: seen.some(m => m.t === 'controls'),
  }
})

for (const l of result.log) console.log(' ', l)

const dominant = (px, i) =>
  px[i] > 70 && px[i] > px[(i + 1) % 3] + 25 && px[i] > px[(i + 2) % 3] + 25
if (!dominant(result.red, 0))
  fails.push(`red still did not reach the screen: ${result.red}`)
if (!dominant(result.green, 1))
  fails.push(`green still did not replace it: ${result.green}`)
if (result.noise[0] + result.noise[1] + result.noise[2] <= 90)
  fails.push(`TV static left the raster dark: ${result.noise}`)
if (result.frame < 30) fails.push(`frameNo only reached ${result.frame}`)
if (!result.transferred) fails.push('bitmaps were copied, not transferred')
if (!result.gotControls) fails.push('no control snapshot was ever echoed back')
if (result.sawGpuError.length)
  fails.push(`gpu errors: ${result.sawGpuError.join('; ')}`)
if (result.sawDeviceLost.length)
  fails.push(`device lost: ${result.sawDeviceLost.join('; ')}`)
if (result.sawHang) fails.push('the loop reported a hang')

await browser.close()
if (fails.length) {
  console.error('FAIL (workercheck)')
  for (const f of fails) console.error('  -', f)
  process.exit(1)
}
console.log('PASS (workercheck)')
