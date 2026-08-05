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
    died = String(e).slice(0, 300)
    break
  }
  const s = samples.at(-1)
  process.stdout.write(
    `\r${Math.round((Date.now() - t0) / 1000)}s frame=${s.frame} raf=${s.raf} vid=${s.videoAcc}s ${s.vis}${s.throttled ? ' THROTTLED' : ''}${s.stalled ? ' STALLED' : ''}   `,
  )
}
console.log('')

// Losing the transport is not the app freezing, and conflating the two is how
// this harness reported a freeze that had not happened. Firefox under BiDi
// detaches the frame after a long WebGPU session — the same "Target closed /
// detached" failure every other harness here recycles browsers around, seen at
// about twelve minutes of continuous rendering. From Node the two look
// identical: `evaluate` stops answering. They are told apart below, by evidence
// from the app rather than by the shape of the error.
const transportLost =
  died !== null &&
  /Target closed|Protocol error|detached|Session closed/i.test(died)

// The app's own black-box recorder, read back from a *fresh* page on the same
// origin. This is precisely what trace.ts exists for — "when the tab wedges
// there is no console left to read" — and it is the only witness that outlives
// the session it describes. A non-app URL on purpose: re-loading the app would
// stand up a second WebGPU session in a browser that has just demonstrated it
// cannot hold one, while any same-origin document can read the same storage.
const readTrace = async () => {
  const fromLiveTab = await page
    .evaluate(() => {
      const raw = localStorage.getItem('ntsc.trace')
      return raw === null ? null : JSON.parse(raw).lines
    })
    .catch(() => null)
  if (fromLiveTab !== null) return fromLiveTab
  try {
    const fresh = await browser.newPage()
    await fresh.goto(`${url}favicon.svg`, { waitUntil: 'domcontentloaded' })
    return await fresh.evaluate(() => {
      const raw = localStorage.getItem('ntsc.trace')
      return raw === null ? null : JSON.parse(raw).lines
    })
  } catch {
    return null
  }
}
const traceLines = await readTrace()
const trace = traceLines === null ? null : traceLines.slice(-40)
// What the app itself recorded about its last moments. `stall` and `hang` are
// written with a forced synchronous flush precisely so they survive a session
// that never got to write anything else.
const traceSaysTrouble =
  traceLines !== null &&
  traceLines.some(l =>
    /\|stall\||\|hang\||\|gpuStrike\||\|fallbackGaveUp\|/.test(l),
  )

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
  // The freeze, stated directly: a visible tab whose frame counter did not move
  // between two samples five seconds apart. Everything else here is a proxy —
  // this is the thing itself, and it is what the verdict turns on rather than an
  // endpoint average, which a run that froze only at the end would hide.
  //
  // Adjacent *raw* samples, both visible — not consecutive entries of the
  // visible-only list. A hidden tab stops rAF by design (frames freeze while the
  // video decoder carries on), so a pair drawn from either side of a hidden
  // stretch has a real gap between them and reads as stuck when nothing was
  // wrong. That is a freeze detector that fires on switching tabs.
  ...(() => {
    const pairs = samples
      .slice(1)
      .map((s, i) => [samples[i], s])
      .filter(([a, b]) => a.vis === 'visible' && b.vis === 'visible')
    const fps = pairs.map(
      ([a, b]) => ((b.frame - a.frame) * 1000) / (b.t - a.t),
    )
    return {
      measuredWindows: pairs.length,
      stuckWindows: pairs.filter(([a, b]) => b.frame <= a.frame).length,
      slowestWindowFps: fps.length === 0 ? null : +Math.min(...fps).toFixed(1),
    }
  })(),
  transportLost,
  traceSaysTrouble,
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

// Only the app's own evidence decides this. A dead transport is the harness's
// problem until something the app recorded says otherwise.
const froze =
  report.everFatal ||
  report.loopStopped ||
  report.everGaveUp ||
  report.stuckWindows > 0 ||
  traceSaysTrouble
// Died in a way that is not the known browser failure: that is unexplained, and
// unexplained is not the same as fine.
const unexplained = died !== null && !transportLost
// A window that spent much of the run off screen never exercised the thing under
// test. rAF stops in a hidden tab by design, so those minutes say nothing either
// way and must not be rounded up into a clean bill of health.
const tooMuchHidden = report.onscreenFraction < 0.9

if (froze) {
  console.log('FROZE — finish the worker wiring')
} else if (unexplained) {
  console.log(`INCONCLUSIVE — the run ended unexpectedly: ${died}`)
} else if (tooMuchHidden) {
  console.log(
    `INCONCLUSIVE — the window was on screen for only ${Math.round(report.onscreenFraction * 100)}% of the run, and a hidden tab stops rAF by design; re-run with it in front`,
  )
} else if (transportLost) {
  // Everything the app reported, right up to the last sample, was healthy, and
  // its own recorder logged no stall. Report the shortfall rather than rounding
  // it up to a clean run.
  console.log(
    `NO FREEZE in ${Math.round(wall / 60)} min of ${minutes} — the browser detached the frame before time (a known Firefox/BiDi limit, not the app); re-run for a longer window`,
  )
} else {
  console.log(`NO FREEZE in ${Math.round(wall / 60)} min`)
}
await browser.close().catch(() => {})
process.exit(froze || unexplained || tooMuchHidden ? 1 : 0)
