// Does a take render the same twice, and is the file what it says it is?
//
//   node scripts/rendercheck.mjs [port]
//
// The render owns its own time, its own dice and its own starting state, so two
// renders of one take are **the same file, byte for byte** — asserted below on
// a SHA-256 of each — while one of them has real time injected between its
// yields and the live loop runs between the two.
//
// That assertion is younger than the harness. The version before `startTake`
// could only claim that a take was the same take *from the same starting
// state*, and measured the gap: frame N was a function of N and of the tape
// ring, the phosphor persistence and the PLL's lock age at frame zero, so the
// second render began with a different history and the two files came out about
// 3% apart in size. `startTake` is what closed it — every buffer back to what
// the device handed over, every CPU modulator rebuilt, and the dice seeded — so
// the thing this file used to explain it could not check is now the headline
// check (docs/EDITOR.md › _Take state_).
//
// **The clip exclusion is gone**, and it was the older of two. This file used
// to say a take over a `<video>` could not be reproducible because the pump
// pulled at wall rate, and so rendered the default bars. Frame-exact pull is
// what removed it: the last arm below loads `public/test.mp4` through the app's
// own `?vurl` path and renders it twice, and the two files match byte for byte.
//
// That arm asks the pump whether the deck actually had a decoder on it, which
// is not paranoia: two renders of a *frozen* deck are also identical, so
// "identical" on its own cannot tell a working pull from a fallback that never
// moved. It is also last on purpose — everything before it renders bars, so a
// failure there is the render and a failure only there is the video path.
//
// One exclusion stands: a take is reproducible *within a browser build*. The
// H.264 encoder is Firefox's, and nothing here asserts across versions of it.
//
// It grew arms as the halves of a take arrived, and they follow the same shape
// as the headline: render it twice for the same file, and render it *without*
// for the control that says the thing under test is what made the file what it
// is. The rundown's walk is one (_One walk, two clocks_); the automation tape
// is another (_Live input has no offline meaning_), plus one arm on the
// recorder itself, which is the only piece here that has to work against a
// frame counter the window manager is moving.

import puppeteer from 'puppeteer-core'

// Boot waited for rather than slept through — see until.mjs.
import { appUp } from './until.mjs'

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const port = process.argv[2] ?? '5199'
const origin = `http://localhost:${port}`
const FRAMES = 60
const FPS = 60
// `YIELD_EVERY` in ui/render.ts, which is where the render's progress callback
// fires. Mirrored rather than imported because this file runs in node and that
// one is a browser module; what it buys is the first mark's frame number, which
// is what says a take counted from zero.
const YIELD_EVERY = 12

const fail = []
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`,
  )
  if (!ok) fail.push(name)
}

// **A backgrounded window makes this slow, not wrong — but slow enough to look
// broken.** `renderTake` yields with `setTimeout(0)` every twelve frames so the
// tab stays answerable, and a browser clamps that to about a second once the
// window is not in front. A 120-frame render then takes ten seconds instead of
// two, and puppeteer's default 30s protocol timeout fires as a bare
// `ProtocolError` naming nothing at all. Hence the generous timeout: the run
// survives being tabbed away from, it just takes longer.
//
// 480s and not the 240s this started at, because 240 was not enough: a run that
// takes two minutes in the foreground blew the timeout when a neighbour's
// browser took the screen mid-run, and it reports as a `ProtocolError` naming
// no cause rather than as a slow run. On a shared box that is a harness that
// fails for reasons that have nothing to do with the app.
const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  protocolTimeout: 480_000,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 900 })
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
await page.goto(
  `http://localhost:${port}/?preset=vhs&set=strobeHz:7,strobeMs:50`,
  {
    waitUntil: 'domcontentloaded',
  },
)
await appUp(page, 6000)
await page.bringToFront()

// One render, from a fixed board, returning a digest of the file it produced.
// `jitter` puts real time between the yields — a machine having a bad day —
// which is exactly what a wall clock notices and a frame counter must not.
const render = (frames, jitter, wantFile = false) =>
  page.evaluate(
    async (n, pause, fps, want) => {
      const mod = await import('/src/ui/render.ts')
      const vf = window.vf
      const cv = document.querySelector('canvas')
      // The same board every time, so the only thing that can differ between
      // runs is what the clock, the loop and the dice did.
      vf.applyControls({ ...vf.getControls(), strobeHz: 7, strobeMs: 50 })
      // Read outside the render, and put back by it: `endTake` hands the
      // counter back, so a take is an aside on the app's clock rather than a
      // rewind of it, and the strip's walk still measures its holds correctly
      // afterwards.
      const at = vf.frameNo()
      const marks = []
      const blob = await mod.renderTake(vf, cv, {
        frames: n,
        fps,
        seed: 12345,
        onProgress: async done => {
          // Sampled inside the render, where the clock is still virtual: it
          // goes back on the wall before `renderTake` returns.
          marks.push({ done, clock: vf.clockMs(), frame: vf.frameNo() })
          if (pause > 0) await new Promise(r => setTimeout(r, pause))
        },
      })
      // Read the instant the render returns, before the digest and the base64
      // below — the loop is running again by then, so anything measured after
      // them is partly how long a hash took.
      const drifted = vf.frameNo() - at
      const buf = new Uint8Array(await blob.arrayBuffer())
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', buf)),
      ]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      // Chunked, and only when asked for. A byte-at-a-time string build over a
      // six-megabyte take is slow enough to blow puppeteer's protocol timeout —
      // which it did, twice, as an unexplained ProtocolError rather than as
      // anything naming the cause.
      let s = ''
      if (want) {
        for (let i = 0; i < buf.length; i += 0x8000) {
          s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        }
      }
      return {
        b64: want ? btoa(s) : '',
        digest,
        // Where the counter is left, against where the take found it. "Near"
        // rather than "equal": the loop is running again the instant the
        // render's `finally` returns, so a frame or two lands before this is
        // read. What would fail is a take that left it 600 frames on.
        drifted,
        // Every sample taken inside the render, where the clock is virtual.
        // The invariant is that it reads exactly the frame counter over the
        // rate — which is the whole of what "the render owns its time" means.
        drift: marks
          .map(m => Math.abs(m.clock - (m.frame * 1000) / fps))
          .reduce((x, y) => Math.max(x, y), 0),
        // The take's own first and last frame numbers. `first` is the one that
        // says the counter started at zero: the render yields every twelfth
        // frame, so a take that began mid-session would report its first mark
        // at whatever the session was on.
        first: marks[0]?.frame ?? -1,
        last: marks[marks.length - 1]?.frame ?? -1,
        size: buf.length,
      }
    },
    frames,
    jitter,
    FPS,
    wantFile,
  )

// A rundown rendered offline: the strip's own walk stepped once per rendered
// frame (`ui/stripRun.offlineWalk`) through the render's `onFrame`. Answers a
// digest, so two of them can be compared, and takes `walkOn` so the same take
// can be rendered with the rundown and without it.
//
// The sink writes controls and nothing else, deliberately. Source loading is
// asynchronous and the render does not wait for it — see docs/EDITOR.md ›
// _Landed: the offline walk_ — so a row that names a clip is not yet a
// reproducible row, and putting one here would be testing the network. What is
// under test is the driver: that the boundaries land on the frames the rundown
// says, and that a rundown is a take you can ask for twice.
const renderStrip = walkOn =>
  page.evaluate(
    async (on, fps, frames) => {
      const mod = await import('/src/ui/render.ts')
      const { offlineWalk } = await import('/src/ui/stripRun.ts')
      const vf = window.vf
      const cv = document.querySelector('canvas')
      // Every key the rows below touch, explicitly at stock. `session` is a
      // *patch*, so without this the second render would start from wherever
      // the first one's last row left the board and the digests could not be
      // compared — which is a property of the test, not of the walk.
      vf.stopGlide()
      vf.applyControls({
        ...vf.getControls(),
        vSize: 1,
        hvSagUs: 0,
        trackAmt: 0,
      })
      // 120bpm at 60fps makes a quarter-bar hold 30 frames, so a 60-frame take
      // holds two whole rows and cuts once in the middle of itself.
      const hold = { bars: 0.25, drift: 0 }
      const rows = [
        { id: 'r1', name: '', session: 'set=vSize:0.6', hold },
        { id: 'r2', name: '', session: 'set=hvSagUs:40', hold },
        { id: 'r3', name: '', session: 'set=trackAmt:0.8', hold },
      ].map(r => ({ ...r, fill: { kind: 'clip' }, arrive: { seconds: 0 } }))
      const fired = []
      const sink = {
        session: p => {
          fired.push(vf.frameNo())
          vf.applyControls(p.controls)
        },
        roll: () => {},
        jitter: () => {},
        // The rows below name no transition and no clip, so neither of these
        // fires. They are here because a sink is an interface: a walk that
        // started asking for one and found nothing would be a `TypeError` three
        // arms into the run rather than a check that failed.
        //
        // `fault` runs its cut rather than swallowing it, which is what the app
        // does when the shelf has no such entry (`useEngine.faultTo`) — a
        // stand-in that dropped the step would make a rundown that grew a
        // transition look like a rundown that stopped doing anything.
        fault: (_name, onCut) => onCut(),
        preroll: () => {},
      }
      const step = offlineWalk({ rows, seed: 7, loop: true }, sink, {
        bpm: 120,
        fps,
      })
      const blob = await mod.renderTake(vf, cv, {
        frames,
        fps,
        seed: 7,
        onFrame: on ? step : undefined,
      })
      const buf = new Uint8Array(await blob.arrayBuffer())
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', buf)),
      ]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('')
      return { digest, size: buf.length, fired }
    },
    walkOn,
    FPS,
    FRAMES,
  )

// A recorded take rendered offline: an automation tape replayed through the
// render's `onFrame` (`ui/automation.playTape`), against the same sink the app
// hands it (`ui/useAutomation.engineAutoSink`).
//
// Imported rather than re-stated, and that is the whole reason the sink is an
// exported function: a harness that builds its own writes measures the engine
// correctly and the app's wiring not at all, which is how a transition's stale
// cut once survived a browser check that was passing.
//
// The tape is written out by hand rather than performed, deliberately. What the
// recorder does with a live counter is the arm below; what this one is about is
// whether a stamped write reaches the file, and a literal tape is the only way
// to ask that without the answer depending on when a `setTimeout` fired.
const renderAuto = tapeOn =>
  page.evaluate(
    async (on, fps, frames) => {
      const mod = await import('/src/ui/render.ts')
      const { playTape } = await import('/src/ui/automation.ts')
      const { engineAutoSink } = await import('/src/ui/useAutomation.ts')
      const vf = window.vf
      const cv = document.querySelector('canvas')
      // Every key the tape touches, explicitly at stock, for the reason the
      // rundown arm gives: a second render starting from where the first one
      // left the board could not be compared with the first.
      vf.stopGlide()
      vf.applyControls({ ...vf.getControls(), vSize: 1, trackAmt: 0 })
      const tape = {
        events: [
          { kind: 'set', at: 10, key: 'trackAmt', value: 0.8 },
          { kind: 'set', at: 30, key: 'vSize', value: 0.7 },
          { kind: 'set', at: 45, key: 'trackAmt', value: 0.2 },
        ],
        frames,
      }
      const play = playTape(
        tape,
        engineAutoSink(() => vf),
      )
      const blob = await mod.renderTake(vf, cv, {
        frames,
        fps,
        seed: 9,
        onFrame: on ? play : undefined,
      })
      const buf = new Uint8Array(await blob.arrayBuffer())
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', buf)),
      ]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('')
      // Read after the render, so it says the last event actually landed rather
      // than that the first one did.
      return { digest, size: buf.length, ended: vf.getControls().trackAmt }
    },
    tapeOn,
    FPS,
    FRAMES,
  )

// --- two renders of one take are one file -------------------------------------
//
// The headline, and everything else here is the reason it can be asserted. The
// second arm has 25ms injected at every yield — a machine having a bad day —
// and the live loop runs between the two, dirtying the tape ring, the phosphor
// and the PLL that the second take then starts from. None of it reaches the
// file.
const a = await render(FRAMES, 0, true)
const b = await render(FRAMES, 25)
check(
  'two renders of one take are the same file, byte for byte',
  a.digest === b.digest && a.size === b.size,
  `${a.digest.slice(0, 16)} (${a.size}B) vs ${b.digest.slice(0, 16)} (${b.size}B)`,
)
check(
  'the clock reads exactly the frame counter throughout, jitter or not',
  a.drift === 0 && b.drift === 0,
  `worst drift ${a.drift}ms and ${b.drift}ms`,
)
// There was an arm here asserting the jittered run really was slower in real
// time, and it is not measurable: a backgrounded window clamps `setTimeout` to
// about a second, so the injected 25ms disappears into the clamp and both arms
// take the same wall time (measured: 3491ms vs 3434ms). Nothing is lost by
// dropping it — whatever the wall clock did, the file came out identical, which
// is the same property stated harder.
check(
  'a take counts its own frames from zero and covers exactly the span asked',
  a.first === YIELD_EVERY &&
    b.first === YIELD_EVERY &&
    a.last === FRAMES &&
    b.last === FRAMES,
  `${a.first}..${a.last} and ${b.first}..${b.last} for ${FRAMES} asked`,
)

// --- the render waits for a row that is not ready yet -------------------------
//
// The other half of the awaiting sink (docs/EDITOR.md › _Frame-exact video
// pull_): `offlineWalk` hands back a promise on the frames a row fires on, and
// `renderTake` awaits it before it steps. What that buys is a row landing on
// the frame the rundown named rather than on whichever frame its fetch happened
// to finish by.
//
// Asserted on the *render*, which is the part this file owns. The barrier
// behind it — `useEngine.settleSources`, fed by `beginLoad` and the slot's
// three arrival verbs — is not reachable from here: the strip's sink lives in
// the React tree and only `window.vf` crosses into the page. So this proves the
// waiting, and the thing waited on is covered by `stripRun.test.ts` and by
// being one matched pair through one funnel each.
// **Against a measured floor, never against zero.** A render of this length
// takes about two seconds on its own, so "it took longer than 240ms" passes
// whether or not anything was awaited. The same take with no wait in it is the
// control, and the delta is the reading.
const waitArm = (delayMs, marks) =>
  page.evaluate(
    async (n, fps, delay, on) => {
      const mod = await import('/src/ui/render.ts')
      const vf = window.vf
      const cv = document.querySelector('canvas')
      const at = []
      const t0 = performance.now()
      await mod.renderTake(vf, cv, {
        frames: n,
        fps,
        seed: 9,
        onFrame: i => {
          if (!on.includes(i)) return undefined
          at.push(i)
          // `undefined` on the control arm rather than a resolved promise: what
          // is under test is that a promise is awaited, and a zero-delay
          // promise still costs a microtask hop the control should not pay.
          return delay === 0
            ? undefined
            : new Promise(r => setTimeout(r, delay))
        },
      })
      return { ms: performance.now() - t0, at }
    },
    FRAMES,
    FPS,
    delayMs,
    marks,
  )

const MARKS = [10, 20, 30, 40]
// **400ms and not 120, because the floor moves.** A render of this length takes
// about two seconds and varies by ~250ms run to run on a shared box, so four
// 120ms waits (480ms of signal) sit inside the noise — measured at 670ms added
// on one run and 425ms on the next, against a threshold of 240. Four 400ms
// waits put 1600ms of signal against the same noise, which is a reading rather
// than a coin toss. It costs the harness 1.6s.
const DELAY = 400
const noWait = await waitArm(0, MARKS)
const withWait = await waitArm(DELAY, MARKS)
const added = withWait.ms - noWait.ms
check(
  'a render waits for a row whose source has not landed',
  // Four waits of 120ms is 480ms of extra wall time. Half of it is enough to
  // separate "awaited" from "sailed past", and the slack is what a render's own
  // run-to-run spread on a shared box needs.
  added >= (MARKS.length * DELAY) / 2 && withWait.at.length === MARKS.length,
  `${added.toFixed(0)}ms added by ${MARKS.length} waits of ${DELAY}ms ` +
    `(${noWait.ms.toFixed(0)}ms floor)`,
)

// --- a rundown is a take you can ask for twice --------------------------------
//
// _One walk, two clocks_, measured: the same `advance` and the same `runStep`
// the tray runs on, stepped by the render instead of by rAF.
const s1 = await renderStrip(true)
const s2 = await renderStrip(true)
const bare = await renderStrip(false)
check(
  'the walk cuts on the frames the rundown says',
  JSON.stringify(s1.fired) === JSON.stringify([0, 30]),
  `fired on ${s1.fired.join(', ')} of ${FRAMES}, for a 30-frame hold`,
)
check(
  'two renders of one rundown are the same file',
  s1.digest === s2.digest,
  `${s1.digest.slice(0, 16)} vs ${s2.digest.slice(0, 16)}`,
)
// The control arm, and the check above is worth nothing without it: a walk that
// never fired would render two identical files too.
check(
  'and the rundown is what made it that file',
  s1.digest !== bare.digest,
  `${s1.size}B walked vs ${bare.size}B not`,
)

// --- a recorded take is a take you can ask for twice --------------------------
//
// docs/EDITOR.md › _Live input has no offline meaning_, measured: what a hand
// did while the take rolled, replayed onto the frames it did it on.
const t1 = await renderAuto(true)
const t2 = await renderAuto(true)
const untaped = await renderAuto(false)
check(
  'two renders of one automation tape are the same file',
  t1.digest === t2.digest,
  `${t1.digest.slice(0, 16)} vs ${t2.digest.slice(0, 16)}`,
)
// The control arm, and the check above is worth nothing without it: a tape that
// never reached the engine would render two identical files too.
check(
  'and the tape is what made it that file',
  t1.digest !== untaped.digest,
  `${t1.size}B replayed vs ${untaped.size}B not`,
)
// The last event rather than the first, because the failure a digest cannot
// distinguish is a replay that lands one write and then stops — a cursor that
// forgot to advance, or a walk rebuilt per frame.
check(
  'every event on the tape lands, not only the first',
  Math.abs(t1.ended - 0.2) < 1e-6,
  `trackAmt ended at ${t1.ended}, for a tape ending on 0.2`,
)

// The recorder against a real frame counter. Not an exact stamp — the live loop
// is running and the window manager has a say in how fast — but an exact
// *bound*: the write happened between two readings of the counter, so its stamp
// has to sit between the same two, and a recorder measuring from the wrong
// origin fails that however slow the machine is.
const recorded = await page.evaluate(async () => {
  const { makeAutomationRunner } = await import('/src/ui/useAutomation.ts')
  const vf = window.vf
  const runner = makeAutomationRunner()
  runner.setFrameNo(() => vf.frameNo())
  const origin = vf.frameNo()
  runner.start()
  await new Promise(r => setTimeout(r, 250))
  const before = vf.frameNo() - origin
  runner.tap.set('vSize', 0.42)
  const after = vf.frameNo() - origin
  await new Promise(r => setTimeout(r, 250))
  runner.stop()
  // And nothing after the seal: a tape that went on recording would make every
  // take a recording of whatever happened next.
  runner.tap.set('vSize', 0.99)
  const tape = runner.getTape()
  return { events: tape.events, frames: tape.frames, before, after }
})
check(
  'the recorder stamps a write against the frame it started on',
  recorded.events.length === 1 &&
    recorded.events[0].at >= recorded.before &&
    recorded.events[0].at <= recorded.after,
  `stamped ${recorded.events[0]?.at} for a write between frames ${recorded.before} and ${recorded.after}`,
)
check(
  'and seals a length that covers the whole take',
  recorded.frames > recorded.after,
  `${recorded.frames} frames sealed, last write at ${recorded.after}`,
)

// --- the engine is left as it was found --------------------------------------
//
// Including the frame counter, which the take rewound to zero: `frameNo()` is
// also the app's clock — the strip measures its holds against it — so a render
// hands it back rather than leaving the walk hundreds of frames in the future.
// Two of the frames below are the live loop's own strays (`RenderLoop.stop()`
// drops a flag rather than cancelling, so both scheduled chains land one more),
// and the rest is whatever the resumed loop managed before this was read.
check(
  'the frame counter is handed back where the take found it',
  a.drifted < 10 && b.drifted < 10,
  `${a.drifted} and ${b.drifted} frames on, for ${FRAMES}-frame takes`,
)
// **Whether the loop was put back, not whether frames are flowing**, which is
// the same rule the cancel check below already follows and for the same reason:
// an occluded window throttles rAF to nearly nothing, so counting frames over
// 600ms measures the window manager. It did — this arm was `advanced > 0` and
// reported 29 frames with the window in front and 0 behind another one, which
// is a harness that fails when somebody clicks somewhere else. `loop.running`
// is the fact the check is about, and it is reachable because `window.vf` is
// the concrete `Engine` (see gpu/engineapi.ts on why it stays that way).
const after = await page.evaluate(async () => {
  const before = window.vf.frameNo()
  const clock = window.vf.clockMs()
  await new Promise(r => setTimeout(r, 600))
  return {
    running: window.vf.loop.running,
    advanced: window.vf.frameNo() - before,
    wallish: clock > 5000,
  }
})
check('the clock goes back on the wall afterwards', after.wallish, '')
check(
  'and the render loop is running again',
  after.running,
  `${after.advanced} frames in 600ms, which is the window manager's to say`,
)

// --- cancelling ---------------------------------------------------------------
const cancelled = await page.evaluate(async fps => {
  const mod = await import('/src/ui/render.ts')
  const vf = window.vf
  const cv = document.querySelector('canvas')
  let threw = ''
  try {
    await mod.renderTake(vf, cv, {
      frames: 100000,
      fps,
      seed: 1,
      cancelled: () => true,
    })
  } catch (e) {
    threw = e.name
  }
  // Whether the *clock* came back, not whether frames are flowing: an occluded
  // window throttles rAF to nearly nothing (the trap every harness here
  // records), so counting frames would be measuring the window manager. The
  // clock reading wall time proves the `finally` ran, and the loop is put back
  // on the same line.
  return { threw, wallish: vf.clockMs() > 5000 }
}, FPS)
check(
  'a cancelled render says so',
  cancelled.threw === 'RenderCancelled',
  cancelled.threw,
)
check('and puts the engine back on the way out', cancelled.wallish)

// --- the file ------------------------------------------------------------------
const file = join(mkdtempSync(join(tmpdir(), 'rendercheck-')), 'take.mp4')
writeFileSync(file, Buffer.from(a.b64, 'base64'))
const probe = entries =>
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    entries,
    '-of',
    'default=nw=1',
    file,
  ]).toString()
const info = Object.fromEntries(
  probe('stream=r_frame_rate,avg_frame_rate,nb_frames')
    .trim()
    .split('\n')
    .map(l => l.split('=')),
)
check(
  'the rendered file is constant-framerate at the rate asked for',
  info.r_frame_rate === info.avg_frame_rate && info.r_frame_rate === `${FPS}/1`,
  `${info.r_frame_rate} vs ${info.avg_frame_rate}`,
)
check(
  'and holds every frame that was rendered',
  Number(info.nb_frames) === FRAMES,
  info.nb_frames,
)
const decoded = spawnSync('ffmpeg', [
  '-v',
  'warning',
  '-i',
  file,
  '-f',
  'null',
  '-',
])
  .stderr.toString()
  .trim()
check(
  'and decodes without a warning',
  decoded === '',
  decoded.split('\n')[0] ?? '',
)

// --- a take with a clip in it ------------------------------------------------
//
// **The thing this harness used to say it could not check.** Its header carried
// the exclusion for months: "a take over a `<video>` is not reproducible — the
// pump pulls at wall rate — so this renders the default bars". Frame-exact pull
// is what removes it, and the check is the same one as above with a clip on the
// deck: two renders, real time injected into the second, the live loop running
// in between, and the same file out.
//
// It is deliberately the *last* arm. Everything before it renders bars, so a
// failure there is the render and a failure only here is the video path — which
// is the difference between "the take is broken" and "the pull is".
const clip = `${origin}/test.mp4`
const renderClip = jitter =>
  page.evaluate(
    async (src, n, pause, fps) => {
      const mod = await import('/src/ui/render.ts')
      const vf = window.vf
      const cv = document.querySelector('canvas')
      // **Sampled inside the render, because identical is not the same as
      // right.** Two renders come out byte-identical if the pull is working
      // *and* if the deck is showing one frozen frame both times — and a
      // fallback to the wall-rate element is the thing this arm is meant to
      // tell apart from a working pull. So the arm asks the pump directly
      // whether the deck had a decoder on it while the take ran.
      const pulled = []
      const blob = await mod.renderTake(vf, cv, {
        frames: n,
        fps,
        seed: 4242,
        onProgress: async () => {
          pulled.push(
            vf.pump?.a?.pull !== null && vf.pump?.a?.pull !== undefined,
          )
          if (pause > 0) await new Promise(r => setTimeout(r, pause))
        },
      })
      const buf = new Uint8Array(await blob.arrayBuffer())
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', buf)),
      ]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      return {
        digest,
        size: buf.length,
        src,
        pulling: pulled.length > 0 && pulled.every(Boolean),
      }
    },
    clip,
    FRAMES,
    jitter,
    FPS,
  )

// Loaded through the app's own `?vurl` path rather than by reaching into the
// slot, so what is under test is the wiring a user gets and not a shortcut this
// file invented.
await page.goto(`${origin}/?preset=vhs&vurl=${encodeURIComponent(clip)}`, {
  waitUntil: 'domcontentloaded',
})
await appUp(page, 6000)
await page.bringToFront()
// The element has to be *loaded* before a take starts — not for the pull, which
// never touches it, but because a deck with nothing on it is a deck this arm
// would pass on for the wrong reason.
//
// Read off the pump rather than the DOM: the slot's elements are created with
// `document.createElement` and never appended, so `querySelector('video')` finds
// nothing however well the clip loaded. That cost this file a twenty-second
// timeout naming no cause, which is the shape of every mistake about this app's
// video path — there is no element on the page to look at.
await page.waitForFunction(
  () => (window.vf?.pump?.info?.().videoA?.ready ?? 0) >= 2,
  { timeout: 20_000 },
)
check('the clip arm has a clip on the deck', true)

const clipA = await renderClip(0)
// Between the two, exactly as above: the live loop runs and moves the tape
// ring, the phosphor and the element's own playhead on. The element's position
// is the one that matters here — under a wall-rate pump it is what made two
// renders differ, and under a frame-exact one it must not be readable at all.
await new Promise(r => setTimeout(r, 1200))
const clipB = await renderClip(25)

check(
  'the deck pulled its frames from a decoder, not from the element',
  clipA.pulling && clipB.pulling,
  `${clipA.pulling} then ${clipB.pulling}`,
)
check(
  'two renders of a take with a clip in it are the same file',
  clipA.digest === clipB.digest && clipA.size > 0,
  `${clipA.digest.slice(0, 16)} vs ${clipB.digest.slice(0, 16)} (${clipA.size}B)`,
)
// Against the bars arm's digest, so "the same twice" cannot be satisfied by a
// clip that never reached the picture at all — two renders of a blank deck are
// also identical.
check(
  'and the clip is actually in it',
  clipA.digest !== a.digest,
  `${clipA.size}B with a clip vs ${a.size}B without`,
)

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(fail.length === 0 ? '\nrender ok' : `\n${fail.length} failed`)
process.exit(fail.length === 0 ? 0 : 1)
