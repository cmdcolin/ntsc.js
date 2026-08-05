// Device-loss recovery harness: does a session survive its GPU device going
// away? Sleep/wake and driver resets fire `device.lost`, and `useEngine` answers
// by building a replacement engine and handing it back what the user chose
// rather than sending them to the fatal screen. That path has no unit test —
// it needs a real GPUDevice to lose — so this drives it in Firefox Nightly.
//
// The loss is injected through the engine's own `onDeviceLost`, which is exactly
// what the browser calls on a real one. The device is still alive when we call
// it, so the rebuild has to survive its predecessor being torn down for real.
//
//   node scripts/deviceloss.mjs <baseUrl> [mode] [outDir]
//
//   restore  (default) a configured session loses its device twice; check the
//            look, the tap, B's flag, both slots and the bay all come back
//   giveup   MAX_REBUILDS+1 losses in a row must stop rebuilding and say so
//   retry    requestAdapter fails for a moment (the sleep/wake shape) and then
//            works; and the case where it never comes back
//
// Modelled on shot.mjs — same browser, same prefs, same "a black frame is a
// failure, not a pass" rule.

import puppeteer from 'puppeteer-core'

const [base, mode = 'restore', outDir] = process.argv.slice(2)
if (!base) {
  console.error('usage: node scripts/deviceloss.mjs <baseUrl> [mode] [outDir]')
  process.exit(2)
}

const fails = []
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
// Only the lines worth reading. React's dev-mode component logging is thousands
// of messages a run, and shipping all of them back over BiDi is enough to stall
// the harness outright.
page.on('console', msg => {
  const t = msg.text()
  if (
    msg.type() === 'error' ||
    msg.type() === 'warn' ||
    /device|rebuil|retry|replaced/.test(t)
  )
    console.log('[page]', t.slice(0, 300))
})
page.on('pageerror', e => {
  console.log('[pageerror]', String(e).slice(0, 300))
  fails.push(`pageerror: ${String(e).slice(0, 160)}`)
})

const BANNER = 'the GPU device was lost'
// In-page: is the rebuild banner on the stage right now?
const bannerUp = () =>
  page.evaluate(
    b =>
      [...document.querySelectorAll('div')].some(d =>
        d.textContent?.startsWith(b),
      ),
    BANNER,
  )
const fatalUp = () =>
  page.evaluate(
    () => document.body.textContent?.includes('WebGPU device lost') ?? false,
  )

const load = async query => {
  await page.goto(`${base}/?${query}`, { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 4500))
}

// Everything worth comparing across a loss. Private fields are reachable from
// evaluate — TS `private` is compile-time only.
const probe = () =>
  page.evaluate(async () => {
    const vf = window.vf
    if (!vf) return null
    // The harness window is occluded, which throttles rAF to nothing, so drive
    // frames deterministically rather than trusting the loop to have run. Paced,
    // because a tight step loop blocks the main thread and trips the app's own
    // hang watchdog (Firefox polls wgpu from a main-thread timer).
    for (let i = 0; i < 40; i++) {
      vf.step()
      if (i % 8 === 0) await new Promise(r => setTimeout(r, 15))
    }
    const cv = document.querySelector('canvas')
    const oc = new OffscreenCanvas(cv.width, cv.height)
    const g = oc.getContext('2d')
    g.drawImage(cv, 0, 0)
    let peak = 0
    for (const [x, y] of [
      [0.3, 0.3],
      [0.5, 0.4],
      [0.7, 0.5],
      [0.5, 0.7],
    ]) {
      const d = g.getImageData(
        Math.round(x * cv.width),
        Math.round(y * cv.height),
        1,
        1,
      ).data
      peak = Math.max(peak, d[0], d[1], d[2])
    }
    const c = vf.getControls()
    return {
      id: vf.__id,
      peak,
      controls: {
        noiseIre: c.noiseIre,
        fbMix: c.fbMix,
        crtGlow: c.crtGlow,
        bGain: c.bGain,
      },
      dbg: vf.getDbgView(),
      bOn: vf.sourceBOn,
      srcNoise: vf.sources.srcNoise,
      srcNoiseB: vf.sources.srcNoiseB,
      aspect: Number(vf.sources.srcAspect.toFixed(4)),
      texA: [vf.sources.texA.width, vf.sources.texA.height],
      // A live <video> has to be attached AND still rolling: a re-attached
      // element that stopped decoding leaves one frozen frame on the slot.
      // The elements live on VideoPump, not Sources — Sources only sees the
      // bitmaps the pump decodes for it.
      videoA: vf.pump.info().videoA,
      frame: vf.frameNo(),
      audio: vf.audioState.graph === null ? 'none' : 'open',
      mod: vf.modSlots.length,
    }
  })

// Stamp the live engine so a replacement is provably a different object.
const stamp = () =>
  page.evaluate(() => {
    window.__n = (window.__n ?? 0) + 1
    window.vf.__id = window.__n
  })

// Fire the loss and watch the banner from inside the page: the rebuild can
// finish inside a single puppeteer round trip (~100 ms on the dev box), so
// sampling from out here misses it entirely.
const loseDevice = why =>
  page.evaluate(
    async (reason, b) => {
      const seen = () =>
        [...document.querySelectorAll('div')].some(d =>
          d.textContent?.startsWith(b),
        )
      const t0 = performance.now()
      window.vf.onDeviceLost(reason)
      let ever = false
      let cleared = 0
      for (let n = 0; n < 120; n++) {
        await new Promise(r => setTimeout(r, 10))
        const up = seen()
        ever ||= up
        if (ever && !up) {
          cleared = performance.now() - t0
          break
        }
      }
      return { ever, ms: Math.round(cleared) }
    },
    why,
    BANNER,
  )

if (mode === 'restore') {
  // A non-default look, a non-default source on each slot, a routing in the bay
  // and B enabled — everything the rebuild claims to put back.
  await load(
    'src=cat&srcb=sweep&set=noiseIre:14,fbMix:0.4,crtGlow:0.7,bGain:0.5&mod=noiseIre:sine:0.3:0.5',
  )
  await stamp()
  const before = await probe()
  console.log('BEFORE', JSON.stringify(before))
  if (outDir) await page.screenshot({ path: `${outDir}/loss-before.png` })
  if (before === null || before.peak <= 0)
    fails.push('no picture before the loss — nothing to compare against')

  for (let i = 1; i <= 2; i++) {
    const gap = await loseDevice('injected loss (deviceloss.mjs)')
    console.log(`loss ${i}: banner shown = ${gap.ever}, back after ${gap.ms}ms`)
    if (!gap.ever) fails.push(`loss ${i}: rebuild banner never rendered`)
    await new Promise(r => setTimeout(r, 2500))
    const after = await probe()
    console.log(`AFTER ${i}`, JSON.stringify(after))
    if (outDir) await page.screenshot({ path: `${outDir}/loss-after-${i}.png` })
    if (after === null) {
      fails.push(`loss ${i}: no engine after the rebuild`)
      break
    }
    if (await fatalUp()) fails.push(`loss ${i}: landed on the fatal screen`)
    if (after.id === before.id) fails.push(`loss ${i}: same engine object`)
    if (after.peak <= 0) fails.push(`loss ${i}: dead black frame`)
    if (after.frame < 40)
      fails.push(`loss ${i}: engine not stepping (frame ${after.frame})`)
    for (const [k, v] of Object.entries(before.controls)) {
      if (after.controls[k] !== v)
        fails.push(`loss ${i}: control ${k} ${v} -> ${after.controls[k]}`)
    }
    if (after.bOn !== before.bOn) fails.push(`loss ${i}: sourceBOn lost`)
    if (after.dbg !== before.dbg) fails.push(`loss ${i}: debug tap lost`)
    if (after.mod === 0) fails.push(`loss ${i}: bay not re-pushed`)
    if (after.srcNoise !== before.srcNoise)
      fails.push(`loss ${i}: A noise ${before.srcNoise} -> ${after.srcNoise}`)
    if (after.srcNoiseB !== before.srcNoiseB)
      fails.push(`loss ${i}: B noise ${before.srcNoiseB} -> ${after.srcNoiseB}`)
    // The still restore is what these two prove: A's texture is resized to its
    // source, so bars coming back in place of the cat would show up here.
    if (after.aspect !== before.aspect)
      fails.push(`loss ${i}: A aspect ${before.aspect} -> ${after.aspect}`)
    if (String(after.texA) !== String(before.texA))
      fails.push(`loss ${i}: A texture ${before.texA} -> ${after.texA}`)
    if (before.audio === 'open' && after.audio !== 'open')
      fails.push(`loss ${i}: audio graph closed under the rebuild`)
    await stamp()
  }

  // And the same again with a live <video> on the slot, which recovers by a
  // different route: the element is the browser's, so it only gets re-attached.
  await load('src=clip-test&srcb=none&set=noiseIre:9,tapeMix:0.5')
  const clipBefore = await probe()
  console.log('CLIP BEFORE', JSON.stringify(clipBefore))
  if (clipBefore?.videoA === null)
    fails.push('clip never reached slot A — cannot test the video path')
  await loseDevice('injected loss (deviceloss.mjs, clip)')
  await new Promise(r => setTimeout(r, 2500))
  const clipAfter = await probe()
  console.log('CLIP AFTER', JSON.stringify(clipAfter))
  if (clipAfter?.videoA === null) fails.push('clip: slot A lost its element')
  else if (clipAfter.videoA.paused) fails.push('clip: element left paused')
  else if (clipAfter.videoA.ready < 2)
    fails.push(`clip: element readyState ${clipAfter.videoA.ready}`)
  if (clipAfter && clipAfter.bOn)
    fails.push('clip: srcb=none came back enabled')
  if (clipAfter && clipAfter.peak <= 0) fails.push('clip: dead black frame')
} else if (mode === 'giveup') {
  await load('src=bars')
  // Four losses back to back. Three rebuild; the fourth is inside the window,
  // so the session has to stop rather than loop on a device that keeps dying.
  for (let i = 1; i <= 4; i++) {
    await page.evaluate(() => {
      window.vf?.onDeviceLost('injected loss (deviceloss.mjs, giveup)')
    })
    await new Promise(r => setTimeout(r, 1500))
    const fatal = await fatalUp()
    const canvas = await page.evaluate(() =>
      Boolean(document.querySelector('canvas')),
    )
    console.log(`loss ${i}: fatal=${fatal} canvas=${canvas}`)
    if (i < 4 && fatal) fails.push(`loss ${i}: gave up too early`)
    if (i < 4 && !canvas) fails.push(`loss ${i}: lost the stage early`)
    if (i === 4 && !fatal) fails.push('loss 4: kept rebuilding past the limit')
    if (i === 4 && canvas) fails.push('loss 4: fatal screen did not take over')
  }
  console.log('--- final screen ---')
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 300)))
} else if (mode === 'retry') {
  await load('src=bars&set=noiseIre:11')
  // The sleep/wake shape: the device is gone and the GPU stack is not ready to
  // hand out another one yet, so requestAdapter fails for a moment first.
  const transient = await page.evaluate(async () => {
    const real = navigator.gpu.requestAdapter.bind(navigator.gpu)
    let n = 0
    navigator.gpu.requestAdapter = opts => {
      n += 1
      return n <= 2
        ? Promise.reject(new Error(`adapter not ready yet (stub call ${n})`))
        : real(opts)
    }
    window.vf.onDeviceLost('injected loss (deviceloss.mjs, transient)')
    await new Promise(r => setTimeout(r, 4000))
    navigator.gpu.requestAdapter = real
    return { calls: n, noiseIre: window.vf?.getControls().noiseIre ?? null }
  })
  console.log('transient:', JSON.stringify(transient))
  if (transient.calls < 3)
    fails.push('transient: never retried past the failures')
  if (await fatalUp()) fails.push('transient: gave up instead of retrying')
  if (await bannerUp()) fails.push('transient: banner never cleared')
  if (transient.noiseIre !== 11) fails.push('transient: look not restored')

  // And the case where it never comes back: the session has to stop and say so,
  // not sit behind a banner forever.
  await page.evaluate(async () => {
    navigator.gpu.requestAdapter = () =>
      Promise.reject(new Error('adapter is gone for good (stub)'))
    window.vf.onDeviceLost('injected loss (deviceloss.mjs, permanent)')
    await new Promise(r => setTimeout(r, 5000))
  })
  const fatal = await fatalUp()
  console.log('permanent: fatal =', fatal)
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 300)))
  if (!fatal) fails.push('permanent: never reached the fatal screen')
  if (await bannerUp()) fails.push('permanent: left the rebuilding banner up')
} else {
  console.error(`unknown mode ${mode} (restore | giveup | retry)`)
  process.exit(2)
}

// Release the device before teardown; otherwise browser.close() SIGKILLs
// Firefox's GPU process mid-frame and drops a minidump into the throwaway
// profile (see shot.mjs).
await page.evaluate(() => window.vf?.destroy())
await browser.close()
if (fails.length > 0) {
  console.error('FAILED:\n - ' + fails.join('\n - '))
  process.exit(1)
}
console.log(`PASS (${mode})`)
