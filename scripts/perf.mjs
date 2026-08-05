// GPU frame-cost harness: best-of wall-clock over batched vf.step() runs —
// the methodology that replaced the ?prof timestamp profiler (a9bf95f), which
// mis-attributed queue backlog to whichever pass ran first.
//
//   node scripts/perf.mjs <url> <label> [batches] [framesPerBatch]
//   node scripts/perf.mjs <url> <label> --ablate [framesPerBatch]
//
// --vp=WxH sets the viewport BEFORE navigation — the one safe moment; after
// load it swaps the BiDi realm and window.vf vanishes (see below). The canvas
// the run actually measured is reported, since layout and dpr decide it.
//
// --ablate attributes cost per pass: it disables one pass at a time by
// overriding its `when` gate, interleaving full and ablated batches in one
// session, and reports each pass's delta. The deltas are not perfectly
// additive (passes overlap on the GPU) but they rank the hot spots honestly.
//
// Traps, learned the hard way:
// - Never call page.setViewport AFTER navigation under Firefox BiDi — it
//   swaps the realm and every later evaluate sees window.vf undefined.
//   Before goto (as scripts/shot.mjs does) it is safe.
// - One browser per config; a page driven through many WebGPU sessions
//   detaches its frame partway through a run.
// - Serve from a `git worktree add --detach` copy when anyone (or any agent)
//   might touch the tree: an HMR reload mid-run tears the engine down and the
//   remaining batches measure a dead page.
// - For A/B, alternate base and patched runs back to back; session-to-session
//   GPU clock drift is several percent.

import puppeteer from 'puppeteer-core'

const args = process.argv.slice(2)
const ablate = args.includes('--ablate')
const vpArg = args.find(a => a.startsWith('--vp='))
const [url, label, a3, a4] = args.filter(a => !a.startsWith('--'))
const batches = ablate ? 3 : Number(a3 ?? 6)
const frames = Number((ablate ? a3 : a4) ?? 120)
const vp = vpArg ? vpArg.slice(5).split('x').map(Number) : null

if (!url || !label) {
  console.error(
    'usage: node scripts/perf.mjs <url> <label> [--ablate] [batches] [framesPerBatch]',
  )
  process.exit(1)
}

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
  page.on('pageerror', err =>
    console.log('[pageerror]', String(err).slice(0, 300)),
  )
  if (vp) await page.setViewport({ width: vp[0], height: vp[1] })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.vf !== undefined, { timeout: 20000 })
  await new Promise(r => setTimeout(r, 2500)) // sources settle

  if (!ablate) {
    const res = await page.evaluate(
      async (batches, frames) => {
        const vf = window.vf
        vf.loop.stop()
        const done = () => vf.gpu.device.queue.onSubmittedWorkDone()
        for (let i = 0; i < 40; i++) vf.step() // pipelines compiled, caches hot
        await done()
        const times = []
        for (let b = 0; b < batches; b++) {
          const t0 = performance.now()
          for (let i = 0; i < frames; i++) vf.step()
          await done()
          times.push((performance.now() - t0) / frames)
        }
        const cv = document.querySelector('canvas')
        return { times, cw: cv?.width ?? 0, ch: cv?.height ?? 0 }
      },
      batches,
      frames,
    )
    const best = Math.min(...res.times)
    const med = [...res.times].sort((x, y) => x - y)[
      Math.floor(res.times.length / 2)
    ]
    console.log(
      `${label}\tbest ${best.toFixed(3)} ms/frame\tmedian ${med.toFixed(3)}\tcanvas ${res.cw}x${res.ch}\tall [${res.times.map(t => t.toFixed(2)).join(', ')}]`,
    )
  } else {
    const res = await page.evaluate(
      async (batches, frames) => {
        const vf = window.vf
        vf.loop.stop()
        const done = () => vf.gpu.device.queue.onSubmittedWorkDone()
        const meas = async () => {
          const t0 = performance.now()
          for (let i = 0; i < frames; i++) vf.step()
          await done()
          return (performance.now() - t0) / frames
        }
        for (let i = 0; i < 40; i++) vf.step()
        await done()
        const groups = [vf.prePasses, vf.loopPasses, vf.postPasses]
        const active = []
        for (const g of groups)
          for (const p of g)
            if (p.when === undefined || p.when()) active.push(p)
        const full = []
        const abl = new Map(active.map(p => [p.label, []]))
        for (let round = 0; round < batches; round++) {
          full.push(await meas())
          for (const p of active) {
            const orig = Object.prototype.hasOwnProperty.call(p, 'when')
              ? p.when
              : undefined
            p.when = () => false
            abl.get(p.label).push(await meas())
            if (orig === undefined) delete p.when
            else p.when = orig
          }
        }
        const fullBest = Math.min(...full)
        return {
          fullBest,
          full,
          rows: active.map(p => {
            const b = Math.min(...abl.get(p.label))
            return { label: p.label, delta: fullBest - b, without: b }
          }),
        }
      },
      batches,
      frames,
    )
    console.log(
      `== ${label}  full best ${res.fullBest.toFixed(3)} ms/frame  (all full: ${res.full.map(t => t.toFixed(2)).join(', ')})`,
    )
    for (const r of res.rows.sort((x, y) => y.delta - x.delta))
      console.log(
        `  ${r.label.padEnd(16)} ~${r.delta.toFixed(3)} ms  (without: ${r.without.toFixed(3)})`,
      )
  }
  await page.evaluate(() => window.vf?.destroy())
} finally {
  await browser.close()
}
