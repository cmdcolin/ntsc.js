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
//     --src=webcam   the other half of the trigger; a camera is not a clip
//     --cycle        hide and show the tab on a timer instead of holding it
//                    in front, which is how the app is actually used
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
//   rss         the browser tree's resident memory, read from /proc — Firefox
//               has no performance.memory, and "stable" and "leaking slowly"
//               are otherwise the same reading
//
// Rates are summed over adjacent visible sample pairs, never taken across
// endpoints, and the report gives the first fifth against the last as well as
// the total: this bug's whole shape is a slow slide, and a run that ends at
// half the frame rate it started at has no stuck window to show for it.
//
// It also records whether the window was on screen for each sample. An occluded
// window throttles rAF to about 1 Hz, so a run that lost the foreground measures
// nothing about rAF and has to say so rather than report a stall — hence
// `onscreenFraction` in the report, which is the first number to read.

import puppeteer from 'puppeteer-core'

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

const flags = process.argv.slice(2).filter(a => a.startsWith('--'))
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'))
const flag = name => flags.find(f => f.startsWith(`--${name}`))
const url = positional[0] ?? 'http://localhost:5382/'
const minutes = Number(positional[1] ?? 20)
const out = positional[2] ?? 'soak.json'
const SAMPLE_MS = 5000

// `--src=webcam` for the other half of the trigger this soak answers, which says
// "a video *or webcam* source". They are not the same path: a clip loops through
// `VideoPump` off an element that seeks, a camera delivers frames on its own
// cadence with no loop point and no `currentTime` to accumulate. A clean clip
// soak says nothing about the camera one.
const src = flag('src')?.split('=')[1] ?? 'clip-test'

// `--cycle` hides and shows the tab on a timer instead of asking for an
// uninterrupted run. This is how the app is actually used — the freeze reports
// came from someone who tabs away — and it is the path a steady-state soak
// deliberately excludes, since it drops hidden stretches from the measurement
// rather than testing them. rAF stops when hidden by design; what is under test
// is whether it *comes back*, and whether the hang watchdog keeps its head
// while completion callbacks are not arriving.
const cycle = flags.some(f => f.startsWith('--cycle'))
const CYCLE_HIDE_MS = 15_000
const CYCLE_PERIOD_MS = 60_000

// A clip on slot A and a look that actually costs something. Feedback, phosphor
// and extra dub generations are the passes that make a frame expensive, and an
// expensive frame is the precondition for the queue growth this is looking for —
// a soak on the landing look would exercise the cheap path and prove little.
const LOOK = 'fbMix:0.45,cfbMix:0.3,phosphor:0.6,crtGlow:0.7,dubGens:3'
const target = `${url}?src=${src}&set=${LOOK}`

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
    'media.autoplay.default': 0,
    'media.autoplay.blocking_policy': 0,
    // A fake camera, so `--src=webcam` needs no hardware and no click on a
    // permission prompt — the same pair perf.mjs uses.
    'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true,
  },
})

// Resident memory across the whole browser process tree, from /proc.
//
// The point of a soak is to separate "stable" from "leaking slowly", and
// nothing in the page can tell them apart here: `performance.memory` is
// Chrome-only, Firefox exposes no JS equivalent, and the interesting memory is
// GPU-side and in a content process anyway rather than in the JS heap. The
// harness can read it from outside, and a browser whose RSS climbs steadily
// across twenty minutes of a fixed look is the thing worth catching, whichever
// process it climbs in. Linux-only, like the rest of this script.
const browserPid = browser.process()?.pid ?? null
const treeRssMb = () => {
  if (browserPid === null) return null
  try {
    const parent = new Map()
    for (const e of readdirSync('/proc')) {
      if (!/^\d+$/.test(e)) continue
      try {
        // `comm` can contain spaces and parens, so the ppid is read from after
        // the last ')' rather than by splitting the whole line.
        const stat = readFileSync(`/proc/${e}/stat`, 'utf8')
        parent.set(+e, +stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      } catch {
        // A process that exited between readdir and read. Normal.
      }
    }
    const tree = new Set([browserPid])
    // Repeat until nothing new joins: /proc order says nothing about ancestry,
    // so one pass would miss any grandchild listed before its parent.
    for (let grew = true; grew;) {
      grew = false
      for (const [pid, ppid] of parent) {
        if (!tree.has(pid) && tree.has(ppid)) {
          tree.add(pid)
          grew = true
        }
      }
    }
    let kb = 0
    for (const pid of tree) {
      try {
        const m = /^VmRSS:\s+(\d+)/m.exec(
          readFileSync(`/proc/${pid}/status`, 'utf8'),
        )
        if (m) kb += +m[1]
      } catch {
        // Same race; a dead process contributes nothing.
      }
    }
    return Math.round(kb / 1024)
  } catch {
    return null
  }
}

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

// A soak measures nothing while the tab is hidden, and on a box with anything
// else open the window puppeteer launches comes up *behind* what is already
// there — a fully covered window reports `visibilityState: 'hidden'` here, so a
// run can accumulate zero visible minutes without anyone touching it. Measured:
// a run started this way sat at frame 61 for its whole first ten seconds.
// `browsingContext.activate` is what `bringToFront` maps to on BiDi, and it is
// the only lever this side has.
let raised = 0
const raise = async () => {
  raised += 1
  await page.bringToFront().catch(() => {})
}

console.log(`soaking ${minutes} min on ${target}`)
await page.goto(target, { waitUntil: 'load' })
await raise()
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

// The tab to switch *to* when cycling. A second tab in the same window is what
// a user does, and it is the mechanism the browser itself uses to decide
// visibility — far better evidence than setting a flag in the page would be.
// Blank on purpose: a second WebGPU context in one browser is a known way to
// kill this Firefox outright, and would confound what the cycle is testing.
const blank = cycle ? await browser.newPage() : null
if (blank !== null) {
  await blank.goto('about:blank')
  // Opening it selected it, which hid the app. Start the run on the app.
  await raise()
}
let hidden = false

const samples = []
const t0 = Date.now()
let died = null
let diedAt = null
let visibleMs = 0
// Wall clock is not the measurement — *visible* time is. rAF stops in a hidden
// tab by design, so a run that loses the foreground half way through has soaked
// for half as long as it thinks, and on a machine where anything else opens a
// window (another agent's harness, a screensaver) that is the normal case rather
// than the exception. So this accumulates the minutes the app was actually
// rendering and keeps going until it has enough of them, with a wall-clock
// ceiling so a window that never comes back cannot run forever.
const WALL_CEILING = 3
while (
  visibleMs < minutes * 60_000 &&
  Date.now() - t0 < minutes * 60_000 * WALL_CEILING
) {
  await new Promise(r => setTimeout(r, SAMPLE_MS))
  // Drive the tab switch before sampling, so a sample always describes a
  // settled state rather than one caught mid-transition.
  if (cycle) {
    const wantHidden = (Date.now() - t0) % CYCLE_PERIOD_MS < CYCLE_HIDE_MS
    if (wantHidden !== hidden) {
      await (wantHidden ? blank.bringToFront() : page.bringToFront()).catch(
        () => {},
      )
      hidden = wantHidden
    }
  }
  const rss = treeRssMb()
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
    samples.at(-1).rss = rss
  } catch (e) {
    died = String(e).slice(0, 300)
    // Where in the run it died, in both clocks. A death at a repeatable wall
    // time is a limit; one scattered across runs is not, and the difference is
    // only visible if the number is written down. It was not, once, and a
    // single "about twelve minutes" became a documented browser property.
    diedAt = {
      wallMinutes: +((Date.now() - t0) / 60_000).toFixed(1),
      visibleMinutes: +(visibleMs / 60_000).toFixed(1),
      lastSampleVisible: samples.at(-1)?.vis ?? null,
    }
    break
  }
  const s = samples.at(-1)
  const prev = samples.at(-2)
  // Only a gap with the tab visible at both ends counts toward the soak.
  if (prev !== undefined && prev.vis === 'visible' && s.vis === 'visible') {
    visibleMs += s.t - prev.t
  }
  // No re-raise here on purpose. Asking for the foreground back mid-run means
  // fighting whoever is at the keyboard for it, and measured, it does not even
  // work: `browsingContext.activate` selects the tab within its window, so a
  // window occluded by another application stays occluded and the run went on
  // reading `hidden` for every sample regardless. Visible-minutes accounting is
  // the answer to a backgrounded run — report the shortfall, do not grab.
  process.stdout.write(
    `\r${Math.round(visibleMs / 1000)}s visible of ${minutes * 60} (${Math.round((Date.now() - t0) / 1000)}s wall) frame=${s.frame} vid=${s.videoAcc}s ${s.vis}${s.throttled ? ' THROTTLED' : ''}${s.stalled ? ' STALLED' : ''}   `,
  )
}
console.log('')

// Losing the transport is not the app freezing, and conflating the two is how
// this harness reported a freeze that had not happened. A page that stops
// answering `evaluate` gives the same "Target closed / detached" error whether
// the browser dropped the BiDi frame or the browser *died*, and those are not
// the same result at all: the second is a WebGPU crash with this app's workload
// in it, which is the very failure this soak exists to find. Guessing from the
// shape of the error files both under "not our problem".
//
// So ask the process. `browser.process()` is the one this harness spawned; an
// exit code or a signal means it went down rather than merely stopped talking.
const proc = browser.process()
const procExit =
  proc === null ? null : { code: proc.exitCode, signal: proc.signalCode }

// And ask the crash reporter. Firefox writes `<profile>/minidumps/`: a `.extra`
// of key/value text naming the crash reason, the adapters and the URL that was
// open, next to the `.dmp` a Mozilla bug would need. Puppeteer deletes the whole
// temp profile on `close()`, so both have to be salvaged first or the only
// witness to a browser-side crash is gone. `MozCrashReason = Cannot remove a
// vacant resource` is a wgpu one; that is the app's own workload taking the
// browser out, not a transport limit.
const profileArg = proc?.spawnargs?.indexOf('--profile') ?? -1
const profileDir = profileArg < 0 ? null : proc.spawnargs[profileArg + 1]
const crashes = []
if (profileDir !== undefined && profileDir !== null) {
  try {
    const dumps = join(profileDir, 'minidumps')
    for (const f of readdirSync(dumps).filter(n => /\.(extra|dmp)$/.test(n))) {
      const kept = join(dirname(out), `${basename(out, '.json')}-${f}`)
      mkdirSync(dirname(kept), { recursive: true })
      copyFileSync(join(dumps, f), kept)
      crashes.push(kept)
    }
  } catch {
    // No minidumps directory is the normal case: nothing crashed.
  }
}
// SIGKILL is the one signal a process cannot send itself, so it means something
// outside took the browser out — on this box, five other Firefox Nightly
// instances launched inside one three-minute run, and any harness that reaps
// with `pkill firefox` reaps this one too. That is not a freeze and must not be
// reported as one: turning a neighbour's cleanup into "FROZE — finish the
// worker wiring" is the same false verdict as the one that started all this,
// pointed the other way. A real crash arrives as a minidump, a non-zero exit,
// or a fatal signal that is not SIGKILL.
const killedExternally = procExit?.signal === 'SIGKILL' && crashes.length === 0
const browserCrashed =
  crashes.length > 0 ||
  (procExit?.code != null && procExit.code !== 0) ||
  (procExit?.signal != null && procExit.signal !== 'SIGKILL')

const transportLost =
  died !== null &&
  !browserCrashed &&
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

// Every rate below is summed over adjacent *visible* sample pairs, never over
// endpoints. Endpoints divide frames that only advanced while visible by a span
// that includes the hidden stretches, and the answer comes out low in
// proportion to how much the tab was away — which is to say the headline number
// moved with the machine's mood rather than the app's. `stuckWindows` already
// did it this way; `fps` did not, and read ~39 on a run that held ~45.
const pairs = samples
  .slice(1)
  .map((s, i) => [samples[i], s])
  .filter(([a, b]) => a.vis === 'visible' && b.vis === 'visible')
const pairFps = ([a, b]) => ((b.frame - a.frame) * 1000) / (b.t - a.t)
const fpsOver = ps =>
  ps.length === 0
    ? null
    : +(
        (ps.reduce((n, [a, b]) => n + (b.frame - a.frame), 0) * 1000) /
        ps.reduce((n, [a, b]) => n + (b.t - a.t), 0)
      ).toFixed(1)
const fifth = Math.max(1, Math.floor(pairs.length / 5))
const report = {
  // What was asked for, and what was actually soaked. The second is the one that
  // means anything; they differ whenever the window lost the foreground.
  minutesAsked: minutes,
  visibleMinutes: +(visibleMs / 60_000).toFixed(1),
  wallMinutes: +((Date.now() - t0) / 60_000).toFixed(1),
  samples: samples.length,
  // Read this first: below ~0.9 the rAF numbers describe a backgrounded window
  // rather than the app, and the run should be repeated with the window forward.
  onscreenFraction: +(onscreen.length / Math.max(1, samples.length)).toFixed(3),
  // How often the window had to be asked for the foreground back. One is the
  // launch raise; many means something else kept taking it, and the run was
  // measuring a fight rather than the app.
  raised,
  died,
  // Only set if the run ended early, and the reason the "twelve minute limit"
  // this harness once documented could not be checked: nothing recorded when
  // the earlier death happened, so one observation could not be compared with
  // the next. A run that reaches its target leaves this null.
  diedAt,
  browserCrashed,
  killedExternally,
  procExit,
  crashes,
  framesRendered: last && first ? last.frame - first.frame : 0,
  rafDelivered: last && first ? last.raf - first.raf : 0,
  fps: fpsOver(pairs),
  // The drift, which is the shape this bug actually has: "slow and quiet",
  // a queue growing a few ms a frame, read by whoever hits it as "it freezes
  // after a while" rather than as a frame-rate problem. Extremes cannot see it
  // — a run that starts at 47 fps and ends at 20 has no stuck window and a
  // perfectly respectable worst case. First fifth against last fifth can.
  fpsFirstFifth: fpsOver(pairs.slice(0, fifth)),
  fpsLastFifth: fpsOver(pairs.slice(-fifth)),
  // rAF callbacks the backpressure gate declined to render. On a device that is
  // keeping up this is 0; see MAX_QUEUE_WAIT_MS in renderloop.ts.
  droppedToGate:
    last && first ? last.raf - first.raf - (last.frame - first.frame) : 0,
  // Null, not zero, when there is no `VideoPump` slot to read. A webcam is
  // measured to take a different route — `pump.info()` reports `videoA: null`
  // for `--src=webcam` while the canvas paints a live picture — and reporting
  // its liveness as 0.00x would read as a dead source rather than as a number
  // that does not apply here. There is no `currentTime` on a camera to
  // accumulate; the frame counter is what says it is alive.
  videoSeconds: samples.every(s => s.videoTime === null)
    ? null
    : (last?.videoAcc ?? 0),
  videoVsWall:
    samples.every(s => s.videoTime === null) || wall <= 0
      ? null
      : +((last?.videoAcc ?? 0) / wall).toFixed(2),
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
  measuredWindows: pairs.length,
  stuckWindows: pairs.filter(([a, b]) => b.frame <= a.frame).length,
  slowestWindowFps:
    pairs.length === 0 ? null : +Math.min(...pairs.map(pairFps)).toFixed(1),
  // Resident memory across the browser process tree, in MB. Firefox warms up
  // for the first minute or so, so the pair that matters is the *settled* one:
  // a fixed look on a looping clip should hold a flat plateau, and a steady
  // climb across twenty minutes is a leak whatever the frame counter says.
  rss: (() => {
    const r = samples.map(s => s.rss).filter(v => typeof v === 'number')
    if (r.length === 0) return null
    const settled = r.slice(Math.min(12, r.length - 1))
    return {
      startMb: r[0],
      endMb: r.at(-1),
      peakMb: Math.max(...r),
      // From one minute in, so browser startup does not read as a leak.
      settledGrowthMb: settled.length < 2 ? null : settled.at(-1) - settled[0],
    }
  })(),
  // Does it come back? A hidden tab stops rAF by design, so the question a
  // cycling run asks is whether the first window after the tab returns renders
  // at all — and whether the watchdog, which reads liveness off completion
  // callbacks that were not arriving, kept its head while nothing was drawn.
  ...(() => {
    let resumes = 0
    let failed = 0
    for (let i = 0; i + 2 < samples.length; i++) {
      // hidden -> visible, with the window after it visible too. Without that
      // last condition a tab that went straight back to hidden would be scored
      // for not rendering while it was away, which is not a fault.
      if (samples[i].vis === 'visible') continue
      if (samples[i + 1].vis !== 'visible') continue
      if (samples[i + 2].vis !== 'visible') continue
      resumes += 1
      if (samples[i + 2].frame <= samples[i + 1].frame) failed += 1
    }
    return { resumes, resumesThatDidNotRender: failed }
  })(),
  transportLost,
  traceSaysTrouble,
  everThrottled: samples.some(s => s.throttled === true),
  everStalled: samples.some(s => s.stalled === true),
  everGaveUp: samples.some(s => s.gaveUp === true),
  everFatal: samples.some(s => s.fatal === true),
  loopStopped: samples.some(s => s.running === false),
  // Visible samples only. This is meant as the main-thread-blocked proxy, and a
  // hidden tab clamps timers to about a second by design — measured on a run
  // that spent itself in the background, the medians read 951 ms and the
  // fraction over 50 ms read 1.0, which describes the browser's throttling
  // policy and says nothing whatever about this app's main thread.
  lateness: (() => {
    // Both ends visible, not just the sampling instant. Each `late` array is
    // accumulated across the whole five seconds *before* the sample that
    // carries it, so a window that was hidden for four of those seconds and
    // visible at the moment it was read still carries the throttled figures —
    // measured, a p95 of 958 ms in a run whose visible p95 was 8 ms.
    const l = samples
      .filter(
        (s, i) => s.vis === 'visible' && samples[i - 1]?.vis === 'visible',
      )
      .map(s => s.late)
      .filter(Boolean)
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
// problem until something the app recorded says otherwise — but a browser that
// *crashed* is app-side evidence too. The trace cannot report it (a process
// that died never flushed one) and the page cannot either, which is exactly why
// it has to be read off the crash reporter instead of inferred from silence.
const froze =
  report.everFatal ||
  report.loopStopped ||
  report.everGaveUp ||
  report.stuckWindows > 0 ||
  // A tab that comes back and does not paint is the freeze as reported, not a
  // lesser cousin of it: "needs the tab closed, not just reloaded".
  report.resumesThatDidNotRender > 0 ||
  traceSaysTrouble ||
  browserCrashed
// Died in a way that is not the known browser failure: that is unexplained, and
// unexplained is not the same as fine.
const unexplained = died !== null && !transportLost
// A window that spent much of the run off screen never exercised the thing under
// test. rAF stops in a hidden tab by design, so those minutes say nothing either
// way and must not be rounded up into a clean bill of health.
const tooMuchHidden = report.visibleMinutes < minutes * 0.9

if (browserCrashed) {
  console.log(
    `BROWSER CRASHED at ${diedAt?.wallMinutes ?? '?'} min wall — not a transport limit. ${crashes.length > 0 ? `crash report kept at ${crashes.join(', ')}` : `exit ${JSON.stringify(procExit)}, no minidump`}`,
  )
} else if (killedExternally) {
  console.log(
    `INCONCLUSIVE — something SIGKILLed the browser at ${diedAt?.wallMinutes ?? '?'} min wall. Nothing here did that and a process cannot do it to itself, so this run measured a shared machine, not the app. Re-run when nothing else is driving browsers.`,
  )
} else if (froze) {
  console.log('FROZE — finish the worker wiring')
} else if (unexplained) {
  console.log(`INCONCLUSIVE — the run ended unexpectedly: ${died}`)
} else if (tooMuchHidden) {
  console.log(
    `INCONCLUSIVE — only ${report.visibleMinutes} of the ${minutes} visible minutes asked for (${report.wallMinutes} min wall). A hidden tab stops rAF by design, so the rest measured nothing; keep the window in front, or nothing else may open one.`,
  )
} else if (transportLost) {
  // Everything the app reported, right up to the last sample, was healthy, and
  // its own recorder logged no stall. Report the shortfall rather than rounding
  // it up to a clean run.
  console.log(
    `NO FREEZE in ${report.visibleMinutes} visible min of the ${minutes} asked for — the browser stopped answering at ${diedAt?.wallMinutes} min wall with its process still alive, so the frame detached rather than the app dying. Whether that has a characteristic time is an open question; compare diedAt across runs rather than assuming one.`,
  )
} else {
  console.log(
    `NO FREEZE in ${report.visibleMinutes} visible min (${report.stuckWindows} stuck of ${report.measuredWindows} windows, ${report.fpsFirstFifth} fps first fifth vs ${report.fpsLastFifth} last, ${report.rss?.settledGrowthMb ?? '?'} MB settled RSS growth${cycle ? `, ${report.resumes} tab resumes all painting` : ''})`,
  )
}
await browser.close().catch(() => {})
process.exit(froze || unexplained || tooMuchHidden || killedExternally ? 1 : 0)
