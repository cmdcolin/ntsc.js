// What does it cost to pull a clip **one frame at a time**, on the render's
// clock rather than the wall's?
//
//   node scripts/pullstep.mjs [--frames=120] [--clip=all|single|gop3|intra]
//   node scripts/pullstep.mjs --file=public/test.mp4 [--from=5.0]
//
// This is the measurement that decides whether docs/EDITOR.md's **frame-exact
// video pull** can be built on `currentTime = n/fps` at all, and it is a
// different question from the one `scripts/loopseek.mjs` answered. That one
// measured a *random* seek — a loop's jump back to its in-point, which is a
// decode from the previous keyframe forward, and which the same file's table
// shows costing 12ms on one shipped clip and 233ms on another. This one
// measures the seek an offline render actually issues: **forward, by one frame,
// from where the decoder already is**.
//
// The two could hardly be more different if the decoder is smart, and identical
// if it is not:
//
//   - If a forward micro-seek continues the decode in place, the cost is one
//     frame's decode and the sparse arm is no worse than the dense one — the
//     keyframe spacing stops mattering entirely, because nothing ever jumps
//     back to a keyframe.
//   - If instead every seek restarts from the previous keyframe, the cost is
//     loopseek's number **per rendered frame**, and it grows through each GOP.
//     A 60s take at 60fps is 3600 of them; at the sparse arm's 200ms that is
//     twelve minutes of seeking, and the whole route is dead — WebCodecs plus a
//     demuxer, with the Firefox `importExternalTexture` constraint on top, is
//     what is left.
//
// Nothing in the design can be chosen without this number, which is why it is
// measured before anything is built on it.
//
// Three arms, and the ratio between them is the finding rather than any single
// number (see loopseek.mjs on why absolute values here are worth little):
//
//   step    the thing under test — n/fps, forward, one frame at a time.
//   jump    the control — a *random* seek of the same count, which is
//           loopseek's case reproduced here so the two are on one machine on
//           one afternoon. If `step` and `jump` come back alike, the decoder is
//           restarting; if `step` is far cheaper, it is continuing.
//   play    the floor — the same clip rolling at wall rate with no seeks at
//           all, decoded through the same `createImageBitmap`. It is what a
//           decode costs when nothing is asked of the seek path, and without it
//           "stepping is cheap" cannot be told from "this fixture is cheap".
//
// **Read `--fps=60` against a 30fps fixture as the real case.** A take renders
// at 60 and clips are 24 or 30, so every other step lands inside the frame the
// decoder is already showing — which is a distinct case from stepping 1:1, and
// the cheaper of the two if the seek is resolved against a frame boundary. Both
// are reported.
//
// **Measured, Firefox Nightly 151 / Linux, 90 frames from t=10s:**
//
//   clip    step 60fps   step 1:1   jump (random)   play (floor)   distinct
//   single      183ms      607ms          268ms            3ms       45/90
//   gop3         38ms       45ms           35ms            2ms       45/90
//   intra         9ms        7ms            6ms            3ms       24/90
//
// **The decoder restarts; it does not continue.** `step` and `jump` come back
// alike on every arm — 38 against 35 on gop3, 9 against 6 on intra — which is
// the answer to the only question this was asked. A forward seek of one frame
// costs what a seek across the whole clip costs, so the keyframe spacing goes
// on mattering for every rendered frame and `loopseek.mjs`'s table applies 3600
// times in a 60-second take rather than once a lap.
//
// The `play` floor is the other half: 2-3ms, the same `createImageBitmap` on
// the same fixture with the seek path left alone. So **the decode is nearly
// free and the seek is essentially all of the cost** — 12x it on a well-
// keyframed clip, 60-200x on a sparse one. One second of 60fps take costs 2.3s
// of pull on gop3 and 6-11s on single, and single is `public/test.mp4`'s
// structure.
//
// Two further readings worth keeping:
//
//   - **Stepping 1:1 through a sparse clip is worse than seeking randomly
//     through it** (607ms against 268ms), because each step is one frame
//     further from the single keyframe while a random jump averages the middle.
//     The cost of a stepped render on that clip is not merely high, it climbs
//     as the take goes on.
//   - **`seeked` is not a promise that the picture moved.** The intra arm at
//     60fps returned 24 distinct pictures where the two slower arms returned
//     exactly the expected 45 — so on seeks that complete in ~7ms,
//     `createImageBitmap` handed back the frame from *before* the seek about
//     half the time. Anything built on this path would need rVFC to confirm the
//     frame as well as `seeked` to confirm the seek, and would still be paying
//     the costs above.
//
// So this route is closed, and `scripts/codeccheck.mjs` is where the open one
// was measured: 0.09s per take-second, off `VideoDecoder`, flat in the keyframe
// spacing.
//
// Firefox Nightly, per CLAUDE.md.

import puppeteer from 'puppeteer-core'

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'

const flags = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = flags.find(f => f.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const FRAMES = Number(flag('frames', '120'))
const ONLY = flag('clip', 'all')
const FILE = flag('file', '')
const KEEP = flags.includes('--keep')

// 20s at 30fps, 640x480, with the frame number burnt in — same fixture shape as
// loopseek.mjs, so the two harnesses' numbers can be read against each other.
const DUR = 20
const SRC_FPS = 30

const CLIPS = {
  single: {
    label: 'one keyframe (public/test.mp4)',
    params: `keyint=${DUR * SRC_FPS * 2}:min-keyint=${DUR * SRC_FPS * 2}:scenecut=0`,
  },
  gop3: {
    label: '~3s GOP (example-popeye)',
    params: `keyint=${SRC_FPS * 3}:min-keyint=${SRC_FPS * 3}:scenecut=0`,
  },
  intra: {
    label: 'all-intra (every frame a key)',
    params: 'keyint=1:min-keyint=1:scenecut=0',
  },
}

// Where the walk starts. Deliberately deep in the clip and not on a keyframe:
// the whole question is what happens when the previous keyframe is a long way
// back, and a run started at t=0 answers it for the one position where every
// arm is cheap.
const FROM = Number(flag('from', '10.0'))

const dir = mkdtempSync(join(tmpdir(), 'pullstep-'))

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
      `testsrc=size=640x480:rate=${SRC_FPS}:duration=${DUR}`,
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
      '-movflags',
      '+faststart',
      out,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  return { out, keys: keyframeCount(out) }
}

function keyframeCount(path) {
  const csv = execFileSync('ffprobe', [
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
  return csv.split('\n').filter(l => l.includes('K')).length
}

const built = {}
if (FILE !== '') {
  built[basename(FILE)] = {
    label: `supplied file (${keyframeCount(FILE)} keyframes)`,
    path: FILE,
    keys: keyframeCount(FILE),
  }
} else {
  for (const [name, spec] of Object.entries(CLIPS)) {
    if (ONLY !== 'all' && ONLY !== name) continue
    const { out, keys } = encode(name, spec.params)
    built[name] = { ...spec, path: out, keys }
    console.log(
      `encoded ${name.padEnd(7)} ${String(keys).padStart(4)} keyframes  ${spec.label}`,
    )
  }
}
if (Object.keys(built).length === 0) {
  console.error(`no such clip arm: ${ONLY}`)
  process.exit(1)
}

// The page. What it replicates is not `VideoPump.pump()` — that is the *live*
// path, which fires a decode and collects it a frame later — but what an
// offline pull has to do instead: position the element, wait for it to be
// there, decode, and only then let the frame be rendered. Every step is
// awaited, because a render that does not wait is the wall-rate pull this is
// trying to replace.
//
// The picture is hashed as well as timed, and that half is not decoration.
// `createImageBitmap` on a `<video>` grabs whatever the element is showing, and
// "the seek fired `seeked`" is not by itself a promise that the picture moved —
// a run where every step is cheap *and* every frame is identical is the failure
// this route would otherwise ship with, and it reads as a triumph in the timing
// column alone.
const HTML = `<!doctype html><meta charset=utf-8><title>pullstep</title>
<body style="background:#111;color:#eee;font:13px monospace;margin:0">
<video id=v muted playsinline style="width:480px"></video>
<canvas id=c width=64 height=64 style="display:none"></canvas>
<div id=o style="padding:8px">ready</div>
<script>
const v = document.getElementById('v')
const c = document.getElementById('c')
const cx = c.getContext('2d', { willReadFrequently: true })
const say = m => { document.getElementById('o').textContent = m }

window.load = src => new Promise((ok, bad) => {
  v.src = src
  v.onerror = () => bad(new Error('video error ' + (v.error && v.error.code)))
  v.oncanplay = () => ok(v.duration)
})

// A cheap digest of what the decoder actually handed over. 64x64 rather than
// full size because the burnt-in frame counter survives the downscale and this
// runs once a step.
const digest = bmp => {
  cx.drawImage(bmp, 0, 0, 64, 64)
  const d = cx.getImageData(0, 0, 64, 64).data
  let h = 2166136261
  for (let i = 0; i < d.length; i += 4) {
    h ^= d[i]
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Seek and wait for it to land, with a bound. A step that never completes is a
// finding, not a reason to hang the run: the whole route dies on exactly that,
// so it has to come back as a number.
const seekTo = t => new Promise(ok => {
  const t0 = performance.now()
  let done = false
  const finish = how => {
    if (done) return
    done = true
    v.removeEventListener('seeked', onSeeked)
    clearTimeout(timer)
    ok({ ms: performance.now() - t0, how })
  }
  const onSeeked = () => finish('seeked')
  const timer = setTimeout(() => finish('timeout'), 5000)
  v.addEventListener('seeked', onSeeked)
  v.currentTime = t
})

// One arm. \`mode\` is 'step' (forward by 1/fps), 'jump' (a random position in
// the clip) or 'play' (no seeking at all — roll and take what is shown).
window.pull = ({ mode, fps, frames, from, seed }) => new Promise(async (done, bad) => {
  try {
    v.pause()
    const seeks = []
    const decodes = []
    const hashes = []
    const stalls = []
    // A generator rather than Math.random so the jump arm is the same set of
    // positions every run — otherwise the control moves under the thing it is
    // controlling for.
    let s = seed >>> 0
    const rand = () => {
      s = (s + 0x6d2b79f5) >>> 0
      let x = Math.imul(s ^ (s >>> 15), 1 | s)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }

    if (mode === 'play') {
      // The floor: the element rolls at its own rate and every rAF takes
      // whatever is on it, decoded through the same call. No seek path at all.
      v.currentTime = from
      await new Promise(ok => { const h = () => { v.removeEventListener('seeked', h); ok() }; v.addEventListener('seeked', h) })
      v.play().catch(() => {})
      let last = -1
      // Bounded, because the element running off its own end stops moving and
      // "wait for currentTime to change" then never returns — which took the
      // whole browsing context down rather than reporting a short arm. A floor
      // measured over fewer frames is still a floor; a hung run is nothing.
      const until = performance.now() + (frames / 30) * 1000 + 4000
      for (let i = 0; i < frames; i++) {
        await new Promise(ok => requestAnimationFrame(ok))
        if (performance.now() > until) { stalls.push({ i, t: v.currentTime }); break }
        if (v.currentTime === last) { i--; continue }
        last = v.currentTime
        const t0 = performance.now()
        const bmp = await createImageBitmap(v, { resizeWidth: 640, resizeHeight: 480, resizeQuality: 'low' })
        decodes.push(performance.now() - t0)
        hashes.push(digest(bmp))
        bmp.close()
      }
      v.pause()
      done({ seeks, decodes, hashes, stalls })
      return
    }

    for (let i = 0; i < frames; i++) {
      const t = mode === 'step'
        ? from + i / fps
        : rand() * (v.duration - 0.5)
      const r = await seekTo(t)
      seeks.push(r.ms)
      if (r.how === 'timeout') stalls.push({ i, t })
      const t0 = performance.now()
      const bmp = await createImageBitmap(v, { resizeWidth: 640, resizeHeight: 480, resizeQuality: 'low' })
      decodes.push(performance.now() - t0)
      hashes.push(digest(bmp))
      bmp.close()
      if (i % 20 === 0) say(mode + ' ' + i + '/' + frames + ' t=' + t.toFixed(3))
    }
    done({ seeks, decodes, hashes, stalls })
  } catch (e) {
    bad(String(e))
  }
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
  const buf = readFileSync(hit.path)
  res.writeHead(200, {
    'content-type': 'video/mp4',
    'content-length': buf.length,
  })
  res.end(buf)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const median = xs => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}
const pct = (xs, p) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}
const ms = x => (Number.isNaN(x) ? '   --' : `${x.toFixed(0).padStart(4)}ms`)

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  protocolTimeout: 600_000,
})
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 700 })
page.on('pageerror', e => console.error('pageerror', String(e).slice(0, 200)))
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await page.bringToFront()

// `step` twice, because the 60-over-30 case is the one a take actually runs and
// the 1:1 case is the one that says what a *distinct* frame costs. If they
// differ by about half, the decoder is charging per distinct frame and the
// repeats are free.
const ARMS = [
  { mode: 'step', fps: 60, label: 'step 60fps (take rate)' },
  { mode: 'step', fps: 30, label: 'step 30fps (1:1)' },
  { mode: 'jump', fps: 60, label: 'jump (random seek)' },
  { mode: 'play', fps: 60, label: 'play (no seek — floor)' },
]

console.log(
  `\n${FRAMES} frames per arm, from t=${FROM}s, ${SRC_FPS}fps sources\n`,
)
console.log(
  '  clip     arm                      seek med   seek p95   decode    total/frame   distinct',
)

const results = {}
for (const [name, spec] of Object.entries(built)) {
  await page.evaluate(
    src => window.load(src),
    `http://localhost:${port}/${basename(spec.path)}`,
  )
  results[name] = {}
  for (const arm of ARMS) {
    const r = await page.evaluate(a => window.pull(a), {
      mode: arm.mode,
      fps: arm.fps,
      frames: FRAMES,
      from: FROM,
      seed: 7,
    })
    const seekMed = median(r.seeks)
    const decMed = median(r.decodes)
    const total = (Number.isNaN(seekMed) ? 0 : seekMed) + decMed
    // How many of the pictures were different from the one before. The step
    // arms at 60 over a 30fps source should sit near half; anything near zero
    // is a decoder handing back a stale frame and a timing column that means
    // nothing.
    const distinct = r.hashes.filter(
      (h, i) => i === 0 || h !== r.hashes[i - 1],
    ).length
    results[name][arm.label] = { seekMed, decMed, total, distinct, r }
    console.log(
      `  ${name.padEnd(8)} ${arm.label.padEnd(24)} ${ms(seekMed)}     ${ms(pct(r.seeks, 0.95))}   ${ms(decMed)}     ${ms(total)}       ${String(distinct).padStart(3)}/${r.hashes.length}${r.stalls.length > 0 ? `  ${r.stalls.length} STALLED` : ''}`,
    )
  }
}

// The line the design actually turns on: what one second of rendered take costs
// in pull alone, per arm, against the same clip's random-seek control.
console.log('\n  one second of 60fps take, in pull alone:\n')
for (const [name, arms] of Object.entries(results)) {
  const step = arms['step 60fps (take rate)']
  const jump = arms['jump (random seek)']
  console.log(
    `  ${name.padEnd(8)} stepped ${((step.total * 60) / 1000).toFixed(1)}s   ` +
      `if every seek restarted ${((jump.total * 60) / 1000).toFixed(1)}s   ` +
      `ratio ${(jump.total / step.total).toFixed(1)}x`,
  )
}

await browser.close()
server.close()
if (!KEEP && FILE === '') rmSync(dir, { recursive: true, force: true })
