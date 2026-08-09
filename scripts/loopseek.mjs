// What does it cost to loop a short section of a clip by seeking the <video>
// element back to an in-point?
//
// This is the one measurement that decides whether a tap-in/tap-out loop can be
// built on `currentTime = start` at all. A loop wrap is a seek, and a seek to a
// non-keyframe position is a decode from the previous keyframe forward — so the
// cost is not a property of the loop, it is a property of **how the clip was
// encoded**, which the app does not control and cannot see.
//
//   node scripts/loopseek.mjs [--laps=12] [--clip=all|single|gop3|intra] [--keep]
//   node scripts/loopseek.mjs --file=public/test.mp4        # a real file instead
//
// The three GOP structures are not hypothetical — they are what this repo
// already ships and loads:
//
//   single  one keyframe, at t=0 — `public/test.mp4`'s structure. Every wrap past
//           the start decodes from frame 0. (Use --file for the real thing: its
//           content is far more expensive to decode than this stand-in.)
//   gop3    a keyframe every ~3s, irregularly placed — example-popeye.mp4 (22.6s,
//           7 keyframes at 0, 5.0, 8.1, 10.0, 15.0, 17.9, 20.0). Not "the bundled
//           cartoons": they differ by more than an order of magnitude, and
//           haunted-house is at 5.3s spacing. Measure each one.
//   intra   every frame a keyframe. The best case, and the shape a clip would
//           have to be re-encoded into if seeking turns out to be the answer.
//
// The metric is the **wrap gap**: wall-clock ms between the last frame the
// compositor presented before the seek was issued and the first one it presented
// carrying a media time back inside the region. Compared against the same clip's
// unwrapped control run. A wrap gap near that baseline is a loop nobody can see
// the seam of; several times it is a hitch on every lap.
//
// **Read it off requestVideoFrameCallback, never off currentTime.** The first
// version of this harness measured the pump's own deliveries and reported every
// arm as free, including ones that visibly hitch. The reason is that currentTime
// reports the seek TARGET the instant a seek is issued: a frame decoded while the
// seek was still in flight got labelled with the time it was seeking to, so the
// stale picture counted as the wrap completing and a 250ms seek measured as 41ms.
// rVFC's mediaTime comes from the frame itself and cannot lie about this.
//
// Measured, Firefox Nightly 151 / Linux, `--laps=10`, stable across three runs
// (medians; the p95/worst columns pick up occasional multi-hundred-ms
// presentation stalls that the seeked column shows are not the seek's doing):
//
//   clip    in-point  frames back  wrap gap  seeked   verdict
//   single      1.0s           30      21ms    17ms   free — the one key is right there
//   single     16.4s          492     188ms   176ms   HITCH — 3.7x the 50ms baseline
//   gop3        1.0s           30      21ms    18ms   free
//   gop3       16.4s           42      42ms    23ms   free
//   intra       any             0      21ms     4ms   free, and faster than the cadence
//
// So: **seeking is a sound basis for a loop, and the cost is set by how many
// frames sit between the in-point and the previous keyframe.** Across those three
// synthetic arms it came to roughly a 17ms floor plus ~0.33ms a frame — 30 frames
// back is 21ms, 42 is 23ms, 492 is 176ms — and all-intra skips even the floor at
// 3-4ms, because there is nothing to decode forward from.
//
// **Do not carry that per-frame constant to real footage.** It is a property of
// the content, not of the browser, and `testsrc` is about as cheap a thing to
// decode as exists. Measured with `--file=` on what this repo actually ships, the
// same "frames back" buys an order of magnitude more:
//
//   file                    in-point   seeked, across runs
//   example-minnie-moocher   any         12-15ms
//   example-popeye           any         15-64ms
//   public/demo-v2.mp4       5.1s        62-90ms
//   public/test.mp4          0.9s        73-96ms
//   public/test.mp4          5.1s       122-165ms  (one run: 513ms)
//   example-haunted-house    3.18s      128-171ms
//   example-haunted-house   17.99s      194-233ms
//
// **Read the ordering, not the numbers.** Those are ranges because the absolute
// values move by about 2x with whatever else is running on the machine, and the
// outlier in brackets is real: one early run had test.mp4 at 513ms where every
// later run put it near 150ms. A single reading of this is worth very little, and
// a per-frame constant fitted to one is worth less — which is how the synthetic
// 0.33ms figure above came to be quoted as if it were general.
//
// What *is* stable across every run is the ranking, and it is the ranking the
// keyframe spacing predicts. So: denser keyframes are cheaper; measure the file you
// care about; and do not build a threshold on top of this without checking it on a
// quiet machine, because the gap between the fine tier (~90ms) and the slow tier
// (~150ms) is about the size of the run-to-run noise.
//
// Two consequences for anything built on this:
//
//   - **This is not a rare pathology.** Two of the four clips on this repo's own
//     shelf are in the slow tier: test.mp4 (one IDR in 180 frames) and
//     haunted-house (four keyframes in 21s), the latter anywhere in the file. The
//     cartoons are stream-copied excerpts and were never encoded for seeking.
//   - JS cannot see where the keyframes are, but it can time the wrap's own seek
//     with the `seeked` event, which tracks the visible gap within about 10%. The
//     app does exactly that and shows the number on the cue row — a number and not
//     a warning, for the calibration reason above (see ui/cue.ts).
//     `fastSeek()` is the other lever and is not a free win: it lands on a
//     keyframe, which on a 5s-GOP clip can be seconds outside a short loop.
//
// Firefox Nightly, per CLAUDE.md — Chrome's Linux backend is not the target and
// its seek path is not the one users will be on.
//
// One aside worth keeping: `await v.play()` after setting currentTime on a
// freshly-loaded element can hang without ever settling, which is why the run
// below fires play() unawaited behind a timer watchdog. videoSlot.ts's `roll()`
// chains `slot.attach` off that same promise, so a slot that never rolls is a
// shape that can happen — unrelated to looping, but it is the same promise.

import puppeteer from 'puppeteer-core'

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const flags = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = flags.find(f => f.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const LAPS = Number(flag('laps', '12'))
const ONLY = flag('clip', 'all')
const KEEP = flags.includes('--keep')

// 20s at 30fps, 640x480. A burnt-in frame number so a human watching the run
// can see the loop actually looping, and so a wrap that silently fails to move
// the picture is visible rather than only a number.
const DUR = 20
const FPS = 30

// GOP structures to generate. `x264-params` rather than -g alone: keyint AND
// min-keyint AND no-scenecut together are what actually pin the spacing —
// scenecut alone will insert extra IDRs on the moving counter and quietly turn
// the `single` arm into something with keyframes in it.
const CLIPS = {
  single: {
    label: 'one keyframe (public/test.mp4)',
    params: `keyint=${DUR * FPS * 2}:min-keyint=${DUR * FPS * 2}:scenecut=0`,
  },
  gop3: {
    label: '~3s GOP (example-popeye)',
    params: `keyint=${FPS * 3}:min-keyint=${FPS * 3}:scenecut=0`,
  },
  intra: {
    label: 'all-intra (every frame a key)',
    params: 'keyint=1:min-keyint=1:scenecut=0',
  },
}

// Where a loop is marked, and how long it is. Two in-points because the whole
// question is distance-to-previous-keyframe: one near the top of the clip where
// even the single-keyframe encode is cheap, one deep in where it is not. The
// deep one is deliberately NOT on a keyframe boundary in the gop3 arm (nearest
// key below 16.4 is 15.0), because a loop marked by hand never will be.
const RUNS = [
  { inPoint: 1.0, length: 0.3 },
  { inPoint: 1.0, length: 1.0 },
  { inPoint: 16.4, length: 0.3 },
  { inPoint: 16.4, length: 1.0 },
]

// A real file instead of the generated matrix — for answering "does THIS clip
// loop cleanly", which is the question anyone with footage actually has. The
// in-points are derived from its own duration rather than fixed, so a 6s clip and
// a 22s one are both probed near the top and near the end.
const FILE = flag('file', '')

const dir = mkdtempSync(join(tmpdir(), 'loopseek-'))

// One clip per GOP structure, same content in each so the arms differ only in
// how they are encoded.
const encode = (name, params) => {
  const out = join(dir, `${name}.mp4`)
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=640x480:rate=${FPS}:duration=${DUR}`,
      '-vf',
      `drawtext=text='%{n}':fontsize=96:fontcolor=white:x=20:y=20`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-x264-params',
      params,
      // faststart so the moov atom is up front and the element is not waiting on
      // a range request mid-seek — that would be measuring the server, not the
      // decoder.
      '-movflags',
      '+faststart',
      out,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  return { out, keys: keyframeCount(out) }
}

// Report what a file actually has rather than what was asked for: x264 can and
// does place extra IDRs, and an arm that silently has 40 keyframes in it would
// read as "seeking is free" for the wrong reason.
function keyframeCount(path) {
  const flagsCsv = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'packet=flags',
    '-of',
    'csv=p=0',
    path,
  ]).toString()
  return flagsCsv.split('\n').filter(l => l.includes('K')).length
}

const built = {}
if (FILE !== '') {
  const keys = keyframeCount(FILE)
  built[basename(FILE)] = {
    label: `supplied file (${keys} keyframes)`,
    path: FILE,
    keys,
  }
  console.log(`probing ${FILE} — ${keys} keyframes`)
}
for (const [name, spec] of Object.entries(FILE === '' ? CLIPS : {})) {
  if (ONLY !== 'all' && ONLY !== name) continue
  const { out, keys } = encode(name, spec.params)
  built[name] = { ...spec, path: out, keys }
  console.log(
    `encoded ${name.padEnd(7)} ${String(keys).padStart(4)} keyframes  ${spec.label}`,
  )
}
if (Object.keys(built).length === 0) {
  console.error(`no such clip arm: ${ONLY}`)
  process.exit(1)
}

// The page. Replicates VideoPump's delivery test exactly — once per rAF, deliver
// only when currentTime has moved, decode through createImageBitmap at the same
// resize settings — and adds the region clamp a loop would need. The clamp runs
// before the delivery test, which is the order the real thing would use.
const HTML = `<!doctype html><meta charset=utf-8><title>loopseek</title>
<body style="background:#111;color:#eee;font:13px monospace;margin:0">
<video id=v muted playsinline style="width:480px"></video>
<div id=o style="padding:8px">ready</div>
<script>
const v = document.getElementById('v')
const say = m => { document.getElementById('o').textContent = m }

window.load = src => new Promise((ok, bad) => {
  v.src = src
  v.onerror = () => bad(new Error('video error ' + (v.error && v.error.code)))
  v.oncanplay = () => ok(v.duration)
})

// One run: play the region, wrap at the out-point, and record what the picture
// actually did. Returns raw events so every statistic is computed on the node
// side and nothing is averaged away in here.
//
// clamp:false is the control: same clip, same decode path, same duration, no
// seeks at all. Without it a "wrap costs one frame interval" result cannot be
// told apart from "this harness cannot resolve one frame interval".
//
// Three instruments, because the obvious one is a liar. currentTime reports
// the seek TARGET the instant a seek is issued, so any frame decoded while the
// seek is still in flight gets labelled with the time it was seeking TO — and a
// seek that had not landed yet reads as costing nothing. So:
//
//   shown  requestVideoFrameCallback: the media time of each frame the
//          compositor actually presented. Ground truth, and the only source of
//          it — this is what the eye saw.
//   seeks  seek issued -> seeked fired. The decoder's own answer for what the
//          seek cost, independent of any render loop.
//   frames the VideoPump replica (rAF + currentTime dedup + createImageBitmap),
//          kept because it is the load the real app puts on the decoder, but no
//          longer the thing the verdict is read off.
window.run = ({ inPoint, length, laps, clamp = true }) => new Promise(async (done, bad) => {
  const end = inPoint + length
  const frames = []
  const shown = []
  const seeks = []
  // Wall clock at which each wrap seek was issued, and the media time it left.
  const wraps = []
  // rAF arrival times, so the tick rate is reported rather than assumed.
  const ticks = []
  let lastTime = -1
  let inFlight = false
  let stop = false

  // Presented-frame ground truth, re-armed after every callback.
  const onShown = (now, meta) => {
    shown.push({ t: now, mediaTime: meta.mediaTime, presented: meta.presentedFrames })
    if (!stop) v.requestVideoFrameCallback(onShown)
  }
  v.requestVideoFrameCallback(onShown)

  // A wrap's seek, timed against the decoder's own completion event. One-shot
  // per wrap so a seeked from an earlier lap cannot close a later one.
  const timeSeek = () => {
    const t0 = performance.now()
    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked)
      seeks.push(performance.now() - t0)
    }
    v.addEventListener('seeked', onSeeked)
  }
  // The control arm has no out-point to end on, so it runs for the wall-clock
  // time the clamped arm of the same shape would have taken.
  const deadline = performance.now() + laps * length * 1000

  // A run that cannot finish has to come back as a reading rather than as a hung
  // BiDi call: the state at the moment it gave up is the whole diagnosis, and a
  // protocol timeout throws it away. On a timer rather than inside the rAF loop
  // because the loop is one of the things that can fail to start — an unresolved
  // play() promise below never reaches the first tick, and a watchdog living in
  // that tick would sit there with it.
  const giveUp = setTimeout(() => {
    if (stop) return
    stop = true
    v.pause()
    done({
      frames,
      shown,
      seeks,
      wraps,
      ticks,
      stalled: {
        reason: ticks.length === 0 ? 'no rAF tick ever ran' : 'loop stalled',
        currentTime: v.currentTime,
        end,
        paused: v.paused,
        seeking: v.seeking,
        readyState: v.readyState,
        wraps: wraps.length,
        presented: shown.length,
        ticks: ticks.length,
      },
    })
  }, 30000)
  const finish = payload => {
    clearTimeout(giveUp)
    stop = true
    v.pause()
    done(payload)
  }

  v.currentTime = inPoint
  // Not awaited: a play() promise that never settles is one of the failure modes
  // under test, and awaiting it would hang the run before the watchdog above
  // could report that that is what happened.
  v.play().catch(() => {})

  const tick = () => {
    if (stop) return
    ticks.push(performance.now())
    // --- the clamp under test ---
    if (clamp && v.currentTime >= end) {
      wraps.push({ t: performance.now(), mt: v.currentTime })
      timeSeek()
      v.currentTime = inPoint
      if (wraps.length > laps) {
        finish({ frames, shown, seeks, wraps, ticks })
        return
      }
    }
    if (!clamp && performance.now() > deadline) {
      finish({ frames, shown, seeks, wraps, ticks })
      return
    }
    // --- VideoPump.due(), verbatim ---
    if (!inFlight && v.readyState >= 2 && v.videoWidth > 0 && v.currentTime !== lastTime) {
      lastTime = v.currentTime
      const mt = v.currentTime
      const t0 = performance.now()
      inFlight = true
      createImageBitmap(v, { resizeWidth: 640, resizeHeight: 480, resizeQuality: 'low' }).then(
        bmp => {
          bmp.close()
          inFlight = false
          frames.push({ t: performance.now(), mt, cost: performance.now() - t0 })
        },
        () => { inFlight = false; lastTime = -1 },
      )
    }
    say('lap ' + wraps.length + '/' + laps + '  t=' + v.currentTime.toFixed(3) + '  frames=' + frames.length)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
</script></body>`

const server = createServer((req, res) => {
  const name = req.url.slice(1)
  if (name === '') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(HTML)
    return
  }
  const hit = Object.values(built).find(b => b.path.endsWith(name))
  if (hit === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  // Whole file, no ranges: a 200 for the entire clip means the element has
  // everything buffered and a seek is never waiting on the network.
  const buf = readFileSync(hit.path)
  res.writeHead(200, {
    'content-type': 'video/mp4',
    'content-length': buf.length,
  })
  res.end(buf)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const pct = (xs, p) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}

const gapsBetween = xs => xs.slice(1).map((x, i) => x - xs[i])

// The wrap gap for each lap, and the steady-state interval to judge it against —
// both read off PRESENTED frames (rVFC), never off currentTime.
//
// A presented frame is "after the wrap" when the media time it actually carried
// is back inside the region's first half. That test only means anything because
// mediaTime comes from the frame itself: the same test applied to currentTime
// passes on the pre-seek picture, because currentTime already reads the seek
// target by then — which is how a seek that had not landed could report as free.
const analyse = ({ frames, shown, seeks, wraps, ticks }, inPoint, length) => {
  const gaps = []
  for (const w of wraps) {
    const before = shown.filter(f => f.t <= w.t).pop()
    const after = shown.find(
      f => f.t > w.t && f.mediaTime < inPoint + length * 0.5,
    )
    if (before !== undefined && after !== undefined)
      gaps.push(after.t - before.t)
  }
  // Steady interval: consecutive presentations that did not straddle a wrap, so
  // the seam is excluded from the baseline it is being compared to.
  const steady = []
  for (let i = 1; i < shown.length; i++) {
    const a = shown[i - 1]
    const b = shown[i]
    if (b.mediaTime > a.mediaTime && wraps.every(w => w.t < a.t || w.t > b.t))
      steady.push(b.t - a.t)
  }
  // `tick` is the rAF grid the clamp is sampled on — the clamp cannot fire finer
  // than this, so it is the floor on any wrap gap. `decode` is what
  // createImageBitmap costs; if it approached the presentation interval then the
  // pump replica would be the thing pacing the run rather than the clip.
  return {
    laps: gaps.length,
    median: pct(gaps, 0.5),
    p95: pct(gaps, 0.95),
    worst: gaps.length === 0 ? NaN : Math.max(...gaps),
    steady: pct(steady, 0.5),
    // The decoder's own account of the seek, alongside the picture's.
    seeked: pct(seeks, 0.5),
    seekedWorst: seeks.length === 0 ? NaN : Math.max(...seeks),
    tick: pct(gapsBetween(ticks), 0.5),
    decode: pct(
      frames.map(f => f.cost),
      0.5,
    ),
    presented: shown.length,
  }
}

const ms = x => (Number.isNaN(x) ? '  --' : x.toFixed(0).padStart(4))
const rows = []

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
    // Drive the refresh driver off a software timer at a fixed rate instead of
    // vsync. Two reasons, and the first one cost a whole run: an occluded or
    // unfocused window has its rAF throttled to nothing, which arrives as a run
    // where the clamp never fires and the watchdog reports "no rAF tick ever
    // ran" (shot.mjs carries the same warning). The second is resolution — vsync
    // here delivers a 21ms grid, which cannot cleanly resolve a 33ms clip
    // cadence, and 60 can.
    'layout.frame_rate': 60,
  },
  // Comfortably past the in-page watchdog, so a stall is reported by the page as
  // data rather than thrown by the transport as a timeout.
  protocolTimeout: 60000,
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 560, height: 620 })
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.goto(`http://127.0.0.1:${port}/`, {
    waitUntil: 'domcontentloaded',
  })
  await page.bringToFront()

  for (const [name, spec] of Object.entries(built)) {
    const file = spec.path.split('/').pop()
    const dur = await page.evaluate(f => window.load('/' + f), file)
    console.log(
      `\n${name} — ${spec.label}, ${spec.keys} keyframes, ${dur.toFixed(1)}s`,
    )
    // Near the top and near the end, as fractions, so the deep probe is actually
    // deep in whatever was handed over.
    const runs =
      FILE === ''
        ? RUNS
        : [0.15, 0.85].flatMap(f =>
            [0.3, 1.0]
              .map(length => ({ inPoint: +(dur * f).toFixed(2), length }))
              .filter(r => r.inPoint + r.length < dur),
          )
    // wrap gap (median/p95/worst) is the picture's account; seeked is the
    // decoder's; steady/rAF/decode are the instrument.
    console.log(
      '  in-point  length    laps  median   p95  worst  seekd  skWst  steady   rAF  decode',
    )
    // The control first, so the baseline it establishes is on screen above the
    // arms that are compared against it.
    for (const r of [{ ...runs[0], clamp: false, control: true }, ...runs]) {
      // Raised to the front before every run, not just once at startup: the
      // window can lose visibility partway through a multi-arm run, and rAF for
      // an occluded window stops, which arrives as an arm with no data in it.
      // Cheaper to re-assert than to discover from a NaN row.
      await page.bringToFront()
      const once = () =>
        page.evaluate(
          (inPoint, length, laps, clamp) =>
            window.run({ inPoint, length, laps, clamp }),
          r.inPoint,
          r.length,
          LAPS,
          r.clamp !== false,
        )
      let raw = await once()
      if (raw.stalled !== undefined) {
        // One retry, because the common cause is environmental rather than
        // anything about this arm. A second stall is reported and kept.
        console.log(`  stalled, retrying: ${JSON.stringify(raw.stalled)}`)
        await page.bringToFront()
        raw = await once()
      }
      if (raw.stalled !== undefined) {
        console.log(`  STALLED ${JSON.stringify(raw.stalled)}`)
      }
      const a = analyse(raw, r.inPoint, r.length)
      if (r.control === true) {
        console.log(
          `  ${'no wrap'.padStart(8)} ${'—'.padStart(7)} ${'—'.padStart(7)} ` +
            `${'  --'}ms ${'  --'}ms ${'  --'}ms ${'  --'}ms ${'  --'}ms ` +
            `${ms(a.steady)}ms ${ms(a.tick)}ms ${ms(a.decode)}ms`,
        )
        rows.push({ clip: name, control: true, ...a })
        continue
      }
      rows.push({ clip: name, ...r, ...a })
      console.log(
        `  ${r.inPoint.toFixed(1).padStart(7)}s ${r.length.toFixed(1).padStart(6)}s ` +
          `${String(a.laps).padStart(7)} ${ms(a.median)}ms ${ms(a.p95)}ms ${ms(a.worst)}ms ` +
          `${ms(a.seeked)}ms ${ms(a.seekedWorst)}ms ` +
          `${ms(a.steady)}ms ${ms(a.tick)}ms ${ms(a.decode)}ms`,
      )
    }
  }
} finally {
  await browser.close().catch(() => {})
  server.close()
  if (!KEEP) rmSync(dir, { recursive: true, force: true })
  else console.log(`\nclips kept in ${dir}`)
}

// The verdict, in the terms the decision actually turns on: a wrap that costs
// about one frame interval is a loop with no visible seam, and anything past
// ~3x is a hitch the eye lands on every lap.
console.log('\n--- verdict ---')
// Judged against that clip's OWN control run rather than the arm's internal
// steady interval: an arm whose every lap hitched would have raised its own
// baseline and then reported itself as free.
for (const row of rows.filter(r => r.control !== true)) {
  const base = rows.find(r => r.control === true && r.clip === row.clip)?.steady
  const ratio = row.median / base
  const call = Number.isNaN(ratio)
    ? 'NO DATA — no frame came back inside the region'
    : ratio < 1.6
      ? 'free'
      : ratio < 3
        ? 'visible seam'
        : 'hitch every lap'
  console.log(
    `  ${row.clip.padEnd(7)} in ${row.inPoint}s len ${row.length}s: ` +
      `${row.median.toFixed(0)}ms vs ${base.toFixed(0)}ms unwrapped (${ratio.toFixed(1)}x) — ${call}` +
      `, seek itself ${row.seeked.toFixed(0)}ms (worst ${row.seekedWorst.toFixed(0)}ms)`,
  )
}

// Whether the run is allowed to claim anything at all. If the decode costs about
// as much as a frame interval then the deliveries were paced by
// createImageBitmap, not by the clip, and a seek cost smaller than that is
// simply below the noise floor — which is a result about the harness, not about
// seeking, and has to be said out loud rather than read as "free".
const controls = rows.filter(r => r.control === true)
const blunt = controls.filter(c => c.decode > c.steady * 0.7)
if (blunt.length > 0) {
  console.log(
    `\n  !! instrument too coarse on: ${blunt.map(c => c.clip).join(', ')}`,
  )
  console.log(
    `     createImageBitmap costs ~${blunt[0].decode.toFixed(0)}ms against a ${blunt[0].steady.toFixed(0)}ms delivery interval,`,
  )
  console.log(
    '     so anything cheaper than a decode cannot be seen. Shrink resizeWidth/Height',
  )
  console.log('     or drop to a rVFC counter before trusting a "free" above.')
} else {
  console.log(
    `\n  instrument: rAF ${controls[0].tick.toFixed(0)}ms, decode ${controls[0].decode.toFixed(0)}ms,` +
      ` unwrapped delivery ${controls[0].steady.toFixed(0)}ms — a seek costing more than`,
  )
  console.log('  ~one delivery interval would show.')
}
console.log(
  '\nThe axis that matters is distance from the in-point back to the previous keyframe,',
)
console.log(
  'not the loop length: a seek pays for the frames it has to decode to arrive.',
)
