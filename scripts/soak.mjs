// Does it still freeze?
//
// The freeze this project chased is slow and quiet by construction — a queue
// growing a few ms a frame, a main thread that stalls the completion callbacks
// the loop reads liveness from — so it does not show in a six-second shot. It
// shows after a while, with a video source playing. That is exactly the trigger
// docs/handoffs/2026-08-05-freezes-and-the-worker.md sets for deciding whether
// the parked worker engine gets finished or deleted, and it was a manual "run it
// for a bit and see", which is not a thing anyone re-runs or can compare against.
//
//   npx vite build --outDir /var/tmp/soak-build
//   npx vite preview --outDir /var/tmp/soak-build --port 5382
//   node scripts/soak.mjs http://localhost:5382/ [minutes] [out.json]
//
// A **production build**, not the dev server: React's dev build logs per
// component per render, and a soak is long enough that forwarding it over BiDi
// is its own failure mode. It is also what a user actually runs.
//
// Every few seconds it samples the things that would each fail differently:
//
//   frames      vf.frame advancing — the picture is live at all
//   rAF         loop.rafTicks advancing — the browser is still delivering
//   throttle    loop.throttled — the backpressure gate acting
//   stall/frozen the loop's own verdicts, which are what the stage banner shows
//   video       *accumulated positive* currentTime deltas. Never end-minus-start:
//               a looping clip measured over roughly one loop period reads as
//               frozen, and three A/B runs were once thrown away believing that.
//   lateness    setInterval drift, the main-thread-blocked proxy the handoff
//               used (median 4 ms, p95 ~28 ms, blocks >50 ms 0.3% after 990b3d5)
//
// It also records whether the window was on screen for each sample. An occluded
// window throttles rAF to about 1 Hz, so a run that lost the foreground measures
// nothing about rAF and has to say so rather than report a stall — hence
// `onscreenFraction` in the report, which is the first number to read.

import puppeteer from 'puppeteer-core'

import { writeFileSync } from 'node:fs'

const url = process.argv[2] ?? 'http://localhost:5382/'
const minutes = Number(process.argv[3] ?? 20)
const out = process.argv[4] ?? 'soak.json'
const SAMPLE_MS = 5000

// A clip on slot A and a look that actually costs something. Feedback, phosphor
// and extra dub generations are the passes that make a frame expensive, and an
// expensive frame is the precondition for the queue growth this is looking for —
// a soak on the landing look would exercise the cheap path and prove little.
const LOOK = 'fbMix:0.45,cfbMix:0.3,phosphor:0.6,crtGlow:0.7,dubGens:3'
const target = `${url}?src=clip-test&set=${LOOK}`

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

const warnings = []
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 900 })
page.on('console', m => {
  const t = m.text()
  if (
    /dropping frames|not delivering|stopped responding|device lost|gave up|rebuil/i.test(
      t,
    )
  ) {
    warnings.push({ at: Date.now(), text: t.slice(0, 200) })
  }
})
page.on('pageerror', e => {
  warnings.push({
    at: Date.now(),
    text: `pageerror: ${String(e).slice(0, 200)}`,
  })
})

console.log(`soaking ${minutes} min on ${target}`)
await page.goto(target, { waitUntil: 'load' })
await new Promise(r => setTimeout(r, 8000))

// Timer drift as the main-thread-blocked proxy, plus video liveness, both
// sampled continuously in-page rather than at the 5 s boundaries — a block that
// lands between samples is exactly the one worth catching.
await page.evaluate(() => {
  window.__late = []
  let due = performance.now() + 50
  const tick = () => {
    const now = performance.now()
    window.__late.push(now - due)
    due = now + 50
    setTimeout(tick, 50)
  }
  setTimeout(tick, 50)
  window.__vid = { acc: 0, last: -1 }
  setInterval(() => {
    const t = window.vf?.pump?.info?.().videoA?.time
    if (typeof t === 'number') {
      if (window.__vid.last >= 0 && t > window.__vid.last) {
        window.__vid.acc += t - window.__vid.last
      }
      window.__vid.last = t
    }
  }, 250)
})

const samples = []
const t0 = Date.now()
let died = null
while (Date.now() - t0 < minutes * 60_000) {
  await new Promise(r => setTimeout(r, SAMPLE_MS))
  try {
    samples.push(
      await page.evaluate(() => {
        const l = window.vf?.loop
        return {
          t: Math.round(performance.now()),
          frame: window.vf?.frame ?? -1,
          raf: l?.rafTicks ?? -1,
          throttled: l?.throttled ?? null,
          stalled: l?.stalled ?? null,
          gaveUp: l?.gaveUp ?? null,
          running: l?.live ?? null,
          vis: document.visibilityState,
          focus: document.hasFocus(),
          videoAcc: +(window.__vid?.acc ?? 0).toFixed(2),
          videoTime: window.vf?.pump?.info?.().videoA?.time ?? null,
          fatal:
            document.body.innerText.includes('reload') &&
            /GPU|WebGPU/.test(document.body.innerText.slice(0, 400)),
          late: (() => {
            const a = (window.__late ?? []).slice()
            window.__late = []
            if (a.length === 0) return null
            a.sort((x, y) => x - y)
            return {
              n: a.length,
              med: Math.round(a[a.length >> 1]),
              p95: Math.round(a[Math.floor(a.length * 0.95)]),
              over50: +(a.filter(v => v > 50).length / a.length).toFixed(4),
              max: Math.round(a.at(-1)),
            }
          })(),
        }
      }),
    )
  } catch (e) {
    // A page that stops answering `evaluate` is itself a result — that is what
    // "needs the tab closed" looks like from out here.
    died = String(e).slice(0, 300)
    break
  }
  const s = samples.at(-1)
  process.stdout.write(
    `\r${Math.round((Date.now() - t0) / 1000)}s frame=${s.frame} raf=${s.raf} vid=${s.videoAcc}s ${s.vis}${s.throttled ? ' THROTTLED' : ''}${s.stalled ? ' STALLED' : ''}   `,
  )
}
console.log('')

const trace = await page
  .evaluate(() => {
    const raw = localStorage.getItem('ntsc.trace')
    return raw === null ? null : JSON.parse(raw).lines.slice(-40)
  })
  .catch(() => null)

const onscreen = samples.filter(s => s.vis === 'visible')
const first = onscreen[0]
const last = onscreen.at(-1)
const wall = last && first ? (last.t - first.t) / 1000 : 0
const report = {
  minutes,
  samples: samples.length,
  // Read this first: below ~0.9 the rAF numbers describe a backgrounded window
  // rather than the app, and the run should be repeated with the window forward.
  onscreenFraction: +(onscreen.length / Math.max(1, samples.length)).toFixed(3),
  died,
  framesRendered: last && first ? last.frame - first.frame : 0,
  rafDelivered: last && first ? last.raf - first.raf : 0,
  fps: last && first ? +((last.frame - first.frame) / wall).toFixed(1) : 0,
  // rAF callbacks the backpressure gate declined to render. On a device that is
  // keeping up this is 0; see MAX_QUEUE_WAIT_MS in renderloop.ts.
  droppedToGate:
    last && first ? last.raf - first.raf - (last.frame - first.frame) : 0,
  videoSeconds: last?.videoAcc ?? 0,
  videoVsWall: wall > 0 ? +((last?.videoAcc ?? 0) / wall).toFixed(2) : 0,
  everThrottled: samples.some(s => s.throttled === true),
  everStalled: samples.some(s => s.stalled === true),
  everGaveUp: samples.some(s => s.gaveUp === true),
  everFatal: samples.some(s => s.fatal === true),
  loopStopped: samples.some(s => s.running === false),
  lateness: (() => {
    const l = samples.map(s => s.late).filter(Boolean)
    if (l.length === 0) return null
    const med = l.map(x => x.med).sort((a, b) => a - b)
    const p95 = l.map(x => x.p95).sort((a, b) => a - b)
    return {
      medianOfMedians: med[med.length >> 1],
      medianOfP95: p95[p95.length >> 1],
      worstP95: p95.at(-1),
      worstSingle: Math.max(...l.map(x => x.max)),
      meanOver50: +(l.reduce((a, x) => a + x.over50, 0) / l.length).toFixed(4),
    }
  })(),
  warnings,
  trace,
}
writeFileSync(out, JSON.stringify({ report, samples }, null, 2))
console.log(JSON.stringify(report, null, 2))

const froze =
  died !== null ||
  report.everFatal ||
  report.loopStopped ||
  report.everGaveUp ||
  (report.onscreenFraction > 0.8 && report.fps < 10)
console.log(froze ? 'FROZE — finish the worker wiring' : 'NO FREEZE')
await browser.close().catch(() => {})
process.exit(froze ? 1 : 0)
