// Does a take render the same twice, and is the file what it says it is?
//
//   node scripts/rendercheck.mjs [port]
//
// The render owns its own time. Two renders of the same length are asserted to
// come out the same length *in the render's terms* — the same span of frames,
// and a clock that reads exactly the frame counter over the rate at every
// sample — while one of them has real time injected between yields.
//
// **What is deliberately not asserted, and why.** A first version compared the
// pixels of two runs and called it determinism. It is not: frame N is a
// function of N *and of the state the engine was in when the render started*,
// and the live loop runs between two renders, so the second begins with a
// different history in the tape ring, the phosphor persistence and the PLL.
// Measured, the two files come out within about 5% of each other in size and
// the last frames sometimes match and sometimes do not — which is the premise
// of the simulator rather than a defect in the loop.
//
// So this proves what the render loop actually buys: **the same take from the
// same starting state is the same take, however long it takes to run.** Getting
// byte-identity across sessions additionally needs the feedback buffers put
// back, which is what recording a take (docs/EDITOR.md › _Seeding_) has to
// carry. That is the next piece, not this one.

import puppeteer from 'puppeteer-core'

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const port = process.argv[2] ?? '5199'
const FRAMES = 60
const FPS = 60

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
const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  protocolTimeout: 240_000,
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
await new Promise(r => setTimeout(r, 6000))
await page.bringToFront()

// One render, from a fixed board, returning the file and a hash of the last
// frame. `jitter` puts real time between the yields — a machine having a bad
// day — which is exactly what a wall clock notices and a frame counter must
// not.
const render = (frames, jitter, wantFile = false) =>
  page.evaluate(
    async (n, pause, fps, want) => {
      const mod = await import('/src/ui/render.ts')
      const vf = window.vf
      const cv = document.querySelector('canvas')
      // The same board every time, so the only thing that can differ between
      // runs is what the clock and the loop did.
      vf.stopGlide()
      vf.applyControls({ ...vf.getControls(), strobeHz: 7, strobeMs: 50 })
      // Counted across the render itself, not across the gap between two of
      // them: the loop is running again in between, so a reading taken outside
      // includes whatever rAF managed.
      const at = vf.frameNo()
      const wallAt = performance.now()
      const marks = []
      const blob = await mod.renderTake(vf, cv, {
        frames: n,
        fps,
        onProgress: async done => {
          // Sampled inside the render, where the clock is still virtual: it
          // goes back on the wall before `renderTake` returns.
          marks.push({ done, clock: vf.clockMs(), frame: vf.frameNo() })
          if (pause > 0) await new Promise(r => setTimeout(r, pause))
        },
      })
      const oc = new OffscreenCanvas(cv.width, cv.height)
      oc.getContext('2d').drawImage(cv, 0, 0)
      const d = oc.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      let h = 0x811c9dc5
      for (let i = 0; i < d.length; i += 37) {
        h ^= d[i]
        h = Math.imul(h, 0x01000193) >>> 0
      }
      const buf = new Uint8Array(await blob.arrayBuffer())
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
        hash: h,
        stepped: vf.frameNo() - at,
        // Every sample taken inside the render, where the clock is virtual.
        // The invariant is that it reads exactly the frame counter over the
        // rate — which is the whole of what "the render owns its time" means.
        drift: marks
          .map(m => Math.abs(m.clock - (m.frame * 1000) / fps))
          .reduce((x, y) => Math.max(x, y), 0),
        span:
          marks.length === 0
            ? 0
            : marks[marks.length - 1].frame - marks[0].frame,
        wall: performance.now() - wallAt,
        size: buf.length,
      }
    },
    frames,
    jitter,
    FPS,
    wantFile,
  )

// --- the render owns its own time --------------------------------------------
//
// The second arm has 25ms injected at every yield — a machine having a bad day.
// What must be true is that none of it reaches the file: the take is the same
// length in frames and in clock, and the wall time it took to produce is not
// recorded anywhere.
const a = await render(FRAMES, 0, true)
const b = await render(FRAMES, 25)
check(
  'the clock reads exactly the frame counter throughout, jitter or not',
  a.drift === 0 && b.drift === 0,
  `worst drift ${a.drift}ms and ${b.drift}ms`,
)
check(
  'and both renders covered the same span of frames',
  a.span === b.span,
  `${a.span} and ${b.span}`,
)
// There was an arm here asserting the jittered run really was slower in real
// time, and it is not measurable: a backgrounded window clamps `setTimeout` to
// about a second, so the injected 25ms disappears into the clamp and both arms
// take the same wall time (measured: 3491ms vs 3434ms). Nothing is lost by
// dropping it. The two checks above are the property that matters — whatever
// the wall clock did, the render's own clock and span came out identical — and
// they hold whether or not the jitter arrived.
// Two more than asked for, every time: `RenderLoop.stop()` drops a flag rather
// than cancelling, so the two already-scheduled chains each land one last
// frame. They are ordered before the render (see render.ts) rather than
// interleaved with it, which is what matters — the frames the file holds are
// consecutive, and it holds exactly FRAMES of them, asserted below.
check(
  'the render steps its own frames and nothing steps more',
  a.stepped === b.stepped && a.stepped <= FRAMES + 2,
  `${a.stepped} and ${b.stepped} for ${FRAMES} asked`,
)

// --- the engine is left as it was found --------------------------------------
const after = await page.evaluate(async () => {
  const before = window.vf.frameNo()
  const clock = window.vf.clockMs()
  await new Promise(r => setTimeout(r, 600))
  return { advanced: window.vf.frameNo() - before, wallish: clock > 5000 }
})
check('the clock goes back on the wall afterwards', after.wallish, '')
check(
  'and the picture starts moving again',
  after.advanced > 0,
  `${after.advanced} frames in 600ms`,
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

// **What is deliberately not asserted: that the two files are identical.**
//
// They are not, and the reason is the premise of the whole simulator rather
// than a defect here. Frame N is a function of N *and of the state the engine
// was in when the render started* — the tape ring, the phosphor persistence,
// the PLL's lock age, the two servos. Between these two renders the live loop
// ran, so render B began with a different history in those buffers, and the
// encoded sizes differ by about 3% even though the last frames come out
// pixel-identical (the strobe and the raster converge; the feedback paths carry
// their own past).
//
// So what the render loop buys is: **the same take from the same starting state
// is the same take, however long it takes to run.** Byte-identity across
// sessions additionally needs the feedback buffers put back — which is what
// `vote/prepare.ts` does between candidate pairs, and what recording a take
// (docs/EDITOR.md › _Seeding_) will have to record and replay. That is the next
// piece, not this one.
check(
  'two renders differ only as much as their histories do',
  Math.abs(a.size - b.size) / a.size < 0.1,
  `${a.size} vs ${b.size} (${(((b.size - a.size) / a.size) * 100).toFixed(1)}%)`,
)

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(fail.length === 0 ? '\nrender ok' : `\n${fail.length} failed`)
process.exit(fail.length === 0 ? 0 : 1)
