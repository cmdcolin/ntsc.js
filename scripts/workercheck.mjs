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

const fails = []

// One browser per phase, and never more than one WebGPU session per browser:
// a page driven through several detaches its frame partway and every later
// evaluate dies with "Target closed", which reads exactly like the code under
// test hanging.
const runOnce = async fn => {
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: '/usr/bin/firefox-nightly',
    headless: false,
    extraPrefsFirefox: {
      'dom.webgpu.enabled': true,
      'gfx.webgpu.ignore-blocklist': true,
      'media.autoplay.default': 0,
      'media.autoplay.blocking_policy': 0,
    },
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1000, height: 760 })
    page.on('pageerror', e => {
      fails.push(`pageerror: ${String(e).slice(0, 200)}`)
    })
    // React's dev build logs a line per component per render; forwarding all of
    // it over BiDi is enough to stall a run, so only keep what this looks for.
    page.on('console', m => {
      const t = m.text()
      if (/worker|error|fail/i.test(t)) console.log('[page]', t.slice(0, 200))
    })
    await page.goto(url, { waitUntil: 'load' })
    return await page.evaluate(fn)
  } finally {
    await browser.close().catch(() => {})
  }
}

// A Firefox driven through a WebGPU session sometimes detaches its frame on the
// way out, and every later call dies with "Target closed" — the same
// browser-is-spent failure the other harnesses here recycle around. Retry once
// on a fresh one; a second death is reported rather than swallowed, because
// that is no longer the browser being tired.
const inFreshBrowser = async fn => {
  try {
    return await runOnce(fn)
  } catch (e) {
    if (!/Target closed|Protocol error|detached/i.test(String(e))) throw e
    console.log('  (browser died; retrying once on a fresh one)')
    return await runOnce(fn)
  }
}

const result = await inFreshBrowser(async () => {
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

// Second phase: the same engine driven through WorkerEngine, the class React
// will actually hold. This is where the paths raw postMessage cannot reach get
// covered — a <video> decoded on this side and transferred over, a control
// write that has to be readable synchronously, and a rebuild in place.
const client = await inFreshBrowser(async () => {
  const log = []
  const { WorkerEngine } = await import('/src/gpu/workerclient.ts')
  const canvas = document.createElement('canvas')
  canvas.width = 754
  canvas.height = 480
  document.body.appendChild(canvas)
  const eng = await WorkerEngine.create(canvas)

  // The React contract: a write is readable before the next render. If this is
  // ever async the sliders snap back under the user's finger.
  eng.setControl('noiseIre', 7)
  const syncRead = eng.getControls().noiseIre
  let notified = 0
  eng.subscribeControls(() => {
    notified++
  })
  eng.applyControls({ noiseIre: 0, fbMix: 0, crtGlow: 0, bGain: 0 })
  const afterPatch = eng.getControls().noiseIre

  const sample = () => {
    const oc = new OffscreenCanvas(canvas.width, canvas.height)
    const g = oc.getContext('2d')
    g.drawImage(canvas, 0, 0)
    const d = g.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  const settle = async (want, ms = 9000) => {
    const end = performance.now() + ms
    let last = sample()
    while (performance.now() < end) {
      if (want(last)) return last
      await new Promise(r => setTimeout(r, 60))
      last = sample()
    }
    return last
  }

  const c = new OffscreenCanvas(754, 480)
  const cx = c.getContext('2d')
  cx.fillStyle = 'rgb(220,30,30)'
  cx.fillRect(0, 0, 754, 480)
  eng.setImageSource(c.transferToImageBitmap(), 4 / 3)
  eng.setSourceBEnabled(false)
  for (let i = 0; i < 20; i++) await eng.step()
  const still = await settle(px => px[0] > 70 && px[0] > px[1] + 25)
  log.push(`still through the client: ${still}`)

  // A real clip, decoded here and transferred over. The pump runs on this
  // thread's rAF, which an occluded window throttles hard, so give it room.
  const v = document.createElement('video')
  v.src = '/demo-v2.mp4'
  v.muted = true
  v.loop = true
  v.playsInline = true
  await v.play().catch(() => {})
  eng.setVideoSource(v)
  // Wait for the clip to be genuinely rolling before judging the picture.
  // Without this the check passes on the single frame the pump decodes from a
  // paused element, which proves a bitmap crossed but not that a *playing*
  // source streams — and it read as the latter.
  const playBy = performance.now() + 8000
  while (v.currentTime < 0.3 && performance.now() < playBy) {
    await new Promise(r => setTimeout(r, 100))
  }
  const played = v.currentTime
  const moved = await settle(px => !(px[0] > 70 && px[0] > px[1] + 25), 12000)
  log.push(`after a clip replaced the still: ${moved} (video t=${played.toFixed(2)})`)

  // A lost device, answered inside the worker on the canvas it already holds.
  const rebuilt = await eng.rebuild()
  log.push(`rebuild: ${JSON.stringify(rebuilt)}`)
  eng.setImageSource((() => {
    const c2 = new OffscreenCanvas(754, 480)
    const x2 = c2.getContext('2d')
    x2.fillStyle = 'rgb(30,60,220)'
    x2.fillRect(0, 0, 754, 480)
    return c2.transferToImageBitmap()
  })(), 4 / 3)
  eng.setVideoSource(null)
  eng.applyControls({ noiseIre: 0, fbMix: 0, crtGlow: 0, bGain: 0 })
  for (let i = 0; i < 20; i++) await eng.step()
  const afterRebuild = await settle(px => px[2] > 70 && px[2] > px[0] + 25)
  log.push(`picture after rebuild: ${afterRebuild}`)

  const frame = await eng.syncFrame()
  eng.destroy()
  return { log, syncRead, afterPatch, notified, still, moved, played, rebuilt, afterRebuild, frame }
})

for (const l of result.log) console.log(' ', l)
for (const l of client.log) console.log(' ', l)

if (client.syncRead !== 7)
  fails.push(`setControl was not readable synchronously (got ${client.syncRead})`)
if (client.afterPatch !== 0)
  fails.push(`applyControls did not reach the snapshot (got ${client.afterPatch})`)
if (client.notified < 1) fails.push('no control listener was ever notified')
if (!(client.still[0] > 70 && client.still[0] > client.still[1] + 25))
  fails.push(`client still did not reach the screen: ${client.still}`)
if (client.played < 0.3)
  fails.push(`the clip never rolled (t=${client.played}); the video path was not exercised`)
if (client.moved[0] > 70 && client.moved[0] > client.moved[1] + 25)
  fails.push(`the clip never replaced the still: ${client.moved}`)
if (!client.rebuilt.ok) fails.push(`rebuild failed: ${client.rebuilt.message}`)
if (!(client.afterRebuild[2] > 70 && client.afterRebuild[2] > client.afterRebuild[0] + 25))
  fails.push(`no picture after the rebuild: ${client.afterRebuild}`)
if (client.frame < 1) fails.push(`frameNo after rebuild was ${client.frame}`)

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

if (fails.length) {
  console.error('FAIL (workercheck)')
  for (const f of fails) console.error('  -', f)
  process.exit(1)
}
console.log('PASS (workercheck)')
