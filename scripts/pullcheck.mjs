// Does `ui/framePull.ts` hand back the frame that is actually there, and what
// does it cost?
//
//   node scripts/pullcheck.mjs [--frames=120] [--fps=60]
//
// Three harnesses lead here and this is the one that closes the loop.
// `pullstep.mjs` measured the seek route and closed it; `codeccheck.mjs`
// measured the decoder in isolation; `demuxcheck.mjs` proved the sample table
// against ffprobe. What none of them can say is whether the thing built out of
// those parts returns **frame N of the clip when asked for time N/fps**, which
// is the entire claim, and the one failure mode that reads as success in every
// timing column: a puller that returns some frame, promptly, forever.
//
// So the fixture has the frame number burnt into the picture, and this reads it
// back off the decoded frame. Not a digest, not "did it change" — the number.
// A frame that is one off, or that repeats where the clip moved, fails here and
// nowhere else.
//
// Four arms, and the last two are what a rundown does rather than what a demo
// does:
//
//   walk     0, 1, 2 … at the take's rate. The ordinary case, and the one the
//            cost is quoted from.
//   repeat   a 60fps take over a 30fps clip, where every source frame is wanted
//            twice. It is the common case, and it is the one a cache that
//            evicts too eagerly turns into a decoder reset per frame.
//   jump     the in-points a rundown's cuts land on, in the order a rundown
//            would. Backwards is a reset by construction, so this is where the
//            fallback cost lives and it should be paid once per jump.
//   tail     the last frames of the clip, where the reorder tail has to be
//            flushed out rather than pushed out by the samples after it —
//            which is the one path with no more input behind it.
//
// **Measured, Firefox Nightly 151 / Linux, 120 frames an arm.** Every arm
// returns the frame it was asked for, on all three fixtures, including the one
// where two thirds of the frames are B-frames.
//
//   clip      walk      jump      tail
//   single    3.54ms   40.59ms   31.73ms
//   gop3      0.85ms   10.33ms    3.94ms
//   bframes   0.82ms    2.64ms    1.32ms   (means)
//
// Two things to read off that, and neither is the mean on its own.
//
//   - **The walk is the number the render pays**, and at 0.85ms it is
//     `codeccheck.mjs`'s 0.53ms decode plus the bookkeeping around it. Against
//     `pullstep.mjs`'s seek route on the same fixtures — 38ms on gop3, 183ms on
//     single — that is 45x on the good clip and 50x on the bad one, and the
//     spread between the two clips has collapsed from 5x to 4x-of-almost-
//     nothing. Which is the point: nothing seeks, so keyframe spacing stops
//     deciding.
//   - **The jump arm's mean is not its cost.** Its p95 is 3ms and its median is
//     0, so the mean is four resets in 120 pulls — a backward cut on a clip
//     with one keyframe decodes from the top, and that is the price of a cut
//     rather than of a frame. A rundown pays it once per row, where the seek
//     route paid its own version once per *frame*.
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
const TAKE_FPS = Number(flag('fps', '60'))
const KEEP = flags.includes('--keep')

const DUR = 20
const SRC_FPS = 30

// The same three GOP structures the other harnesses use, so a cost here can be
// read against a cost there. The point of this route is that the ranking
// between them should **disappear** — nothing seeks, so keyframe spacing stops
// being the thing that decides.
const CLIPS = {
  single: {
    params: `keyint=1200:min-keyint=1200:scenecut=0`,
    label: 'one keyframe',
  },
  gop3: { params: `keyint=90:min-keyint=90:scenecut=0`, label: '~3s GOP' },
  // B-frames on purpose, and the only arm that has them: decode order stops
  // being presentation order, which is the case a puller indexing by `dts`
  // scrambles and every other arm here would let through.
  bframes: {
    params: 'keyint=90:min-keyint=90:scenecut=0:bframes=3:b-adapt=0',
    label: '~3s GOP, 3 B-frames',
  },
}

const dir = mkdtempSync(join(tmpdir(), 'pullcheck-'))

// **Every frame carries its own index, in binary, in the picture.**
//
// The first cut of this compared decoded frames against ground truth rendered
// by ffmpeg and picked the nearest match, and it could not do the job: at the
// resolution the comparison ran at, `testsrc`'s neighbouring frames are nearly
// identical, so "nearest" wandered by up to six frames and every arm failed
// without saying anything about the puller. Two scaling paths — ffmpeg's and
// `createImageBitmap`'s — being compared for pixel similarity was never going
// to answer "is this frame 91 or frame 92".
//
// So the frame answers for itself. Ten white-or-black cells across the top
// encode `n`, and reading one back is thresholding ten pixels: exact, immune to
// scaling, and needing no ground truth from outside at all. `testsrc` stays
// underneath so the encoder still has real content to make GOPs out of — a
// clip of flat blocks would compress to nothing and make the keyframe arms
// meaningless.
const BITS = 10
const CELL = 48
const encode = (name, params) => {
  const out = join(dir, `${name}.mp4`)
  const bar = [
    `drawbox=x=0:y=0:w=${BITS * CELL}:h=${CELL}:color=black:t=fill`,
    ...Array.from(
      { length: BITS },
      (_, k) =>
        `drawbox=x=${k * CELL + 8}:y=8:w=${CELL - 16}:h=${CELL - 16}` +
        `:color=white:t=fill:enable='gt(bitand(n\\,${1 << k})\\,0)'`,
    ),
  ].join(',')
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
      bar,
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
  return out
}

// How many frames of each kind a fixture actually got. Reported rather than
// assumed because the `bframes` arm is the only control on presentation order —
// if x264 declined to emit any, that arm silently stops testing the one thing
// it exists for and passes for the wrong reason.
const pictTypes = path => {
  const csv = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'frame=pict_type',
    '-of',
    'csv=p=0',
    path,
  ]).toString()
  const counts = {}
  for (const line of csv.split('\n')) {
    const t = line.trim().replace(/,$/, '')
    if (t !== '') counts[t] = (counts[t] ?? 0) + 1
  }
  return counts
}

const built = {}
for (const [name, spec] of Object.entries(CLIPS)) {
  const path = encode(name, spec.params)
  const types = pictTypes(path)
  built[name] = { path, types, ...spec }
  console.log(
    `encoded ${name.padEnd(8)} ${spec.label.padEnd(22)} ` +
      `I${types.I ?? 0} P${types.P ?? 0} B${types.B ?? 0}`,
  )
}

const HTML = `<!doctype html><meta charset=utf-8><title>pullcheck</title>
<body style="background:#111;color:#eee;font:13px monospace;margin:0">
<canvas id=c width=640 height=480 style="display:none"></canvas>
<div id=o style="padding:8px">ready</div>
<script type="module">
const BITS = ${BITS}
const CELL = ${CELL}
const c = document.getElementById('c')
const cx = c.getContext('2d', { willReadFrequently: true })
const say = m => { document.getElementById('o').textContent = m }

const mod = await import('/src/ui/framePull.ts')

// Read the frame's own index back out of the bar across its top. At full size
// and with no resampling, so a cell is a cell — the whole reason the fixture
// encodes an index rather than relying on the picture being distinguishable.
//
// A VideoFrame goes through createImageBitmap because that is the route this
// browser leaves open (codeccheck.mjs) and the route the engine will take.
const readIndex = async frame => {
  const bmp = await createImageBitmap(frame)
  cx.drawImage(bmp, 0, 0)
  bmp.close()
  let n = 0
  let clean = true
  for (let k = 0; k < BITS; k++) {
    const d = cx.getImageData(k * CELL + CELL / 2, CELL / 2, 1, 1).data
    const lum = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]
    // A cell should be near black or near white. Anything in between is a
    // picture that is not one of these frames — a half-decoded reference, or a
    // blend — and is worth reporting rather than rounding into a number.
    if (lum > 60 && lum < 195) clean = false
    if (lum >= 128) n |= 1 << k
  }
  return clean ? n : -1
}

window.pull = async ({ url, times }) => {
  const t0 = performance.now()
  const pull = await mod.openPullFromUrl(url)
  const openMs = performance.now() - t0
  if (pull === null) return { opened: false }
  const got = []
  const costs = []
  for (const t of times) {
    const at = performance.now()
    const frame = await pull.frameAt(t)
    costs.push(performance.now() - at)
    if (frame === null) {
      got.push(null)
      continue
    }
    got.push(await readIndex(frame))
    frame.close()
    if (got.length % 20 === 0) say('pulled ' + got.length + '/' + times.length)
  }
  pull.close()
  return { opened: true, openMs, got, costs, duration: pull.duration }
}
</script></body>`

// The page imports `/src/ui/framePull.ts`, so it needs the app's own vite to
// transpile it rather than a static file server. One server, serving the
// fixtures beside it.
const { createServer: createVite } = await import('vite')
const vite = await createVite({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const server = createServer((req, res) => {
  const name = req.url.split('?')[0].slice(1)
  if (name === '') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(HTML)
    return
  }
  const hit = Object.values(built).find(b => basename(b.path) === name)
  if (hit !== undefined) {
    const buf = readFileSync(hit.path)
    res.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': buf.length,
    })
    res.end(buf)
    return
  }
  vite.middlewares(req, res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  protocolTimeout: 600_000,
})
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 700 })
page.on('pageerror', e => console.error('pageerror', String(e).slice(0, 300)))
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await page.bringToFront()
// The page's script is a module with a top-level `await import`, so
// `domcontentloaded` fires well before `window.pull` exists — waited for rather
// than slept through, per `until.mjs`'s argument.
await page.waitForFunction(() => typeof window.pull === 'function', {
  timeout: 20_000,
})

const fail = []
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`,
  )
  if (!ok) fail.push(name)
}
const median = xs => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}
const mean = xs =>
  xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length
// **The median of a pull is zero and says nothing.** The decoder runs ahead, so
// most frames are already in hand when they are asked for and cost nothing to
// return — which is the route working rather than a measurement. What a render
// pays is the mean, and where it stalls is the p95.
const p95 = xs => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * 0.95))]
}
const costOf = xs =>
  `${mean(xs).toFixed(2)}ms mean, ${p95(xs).toFixed(1)} p95, ${median(xs).toFixed(1)} med`

// The control on presentation order. Stated as a check so a fixture that lost
// its B-frames fails here rather than passing three arms for the wrong reason.
check(
  'the reorder control actually has B-frames in it',
  (built.bframes.types.B ?? 0) > 0,
  `B${built.bframes.types.B ?? 0}`,
)
// Which source frame a clip time lands on. `floor`, because a frame is shown
// from its own presentation time until the next one's — which is what
// `framePull`'s `shownAt` implements and what this has to agree with
// independently rather than by construction.
const wantAt = t => Math.min(Math.floor(t * SRC_FPS + 1e-6), DUR * SRC_FPS - 1)

const ARMS = {
  walk: n => Array.from({ length: n }, (_, i) => i / TAKE_FPS),
  // Deliberately from a second in, so the first pull is not the one place every
  // clip is cheap.
  jump: n =>
    Array.from(
      { length: n },
      (_, i) =>
        // Four cuts through the clip, each running on for a few frames — a
        // rundown's shape rather than a scrub.
        [2.0, 11.0, 5.5, 17.0][Math.floor(i / (n / 4)) % 4] +
        (i % (n / 4)) / TAKE_FPS,
    ),
  tail: n =>
    Array.from({ length: n }, (_, i) => DUR - (n - i) / TAKE_FPS - 0.001),
}

for (const [name, spec] of Object.entries(built)) {
  console.log(`\n${name} — ${spec.label}`)
  for (const [arm, times] of Object.entries(ARMS)) {
    const ts = times(FRAMES)
    const r = await page.evaluate(a => window.pull(a), {
      url: `http://localhost:${port}/${basename(spec.path)}`,
      times: ts,
    })
    if (r.opened !== true) {
      check(`${arm}: opened`, false, 'openPull declined the file')
      continue
    }
    let wrong = 0
    let missing = 0
    let unreadable = 0
    let worstOff = 0
    let firstBad = ''
    for (const [i, got] of r.got.entries()) {
      if (got === null) {
        missing++
        continue
      }
      if (got < 0) {
        unreadable++
        continue
      }
      const want = wantAt(ts[i])
      if (got !== want) {
        wrong++
        worstOff = Math.max(worstOff, Math.abs(got - want))
        if (firstBad === '') firstBad = ` first: wanted ${want} got ${got}`
      }
    }
    check(
      `${arm}: every frame is the one asked for`,
      wrong === 0 && missing === 0 && unreadable === 0,
      `${wrong} wrong${worstOff > 0 ? ` (worst ${worstOff} off,${firstBad})` : ''}, ` +
        `${missing} missing, ${unreadable} unreadable — ${costOf(r.costs)}`,
    )
  }
}

// The repeat arm is its own loop because what it asserts is about pairs.
console.log('\nrepeat — a 60fps take over a 30fps clip')
{
  const spec = built.gop3
  const ts = Array.from({ length: FRAMES }, (_, i) => 3.0 + i / 60)
  const r = await page.evaluate(a => window.pull(a), {
    url: `http://localhost:${port}/${basename(spec.path)}`,
    times: ts,
  })
  const ids = r.got.map(g => g ?? -1)
  // Each source frame twice, in order: 90 90 91 91 92 92 …
  const paired = ids.every((id, i) => (i % 2 === 0 ? true : id === ids[i - 1]))
  const stepped = ids.every(
    (id, i) => i < 2 || i % 2 === 1 || id === ids[i - 1] + 1,
  )
  check(
    'each source frame is handed back for both take frames',
    paired && stepped,
    `${new Set(ids).size} distinct over ${ids.length} pulls`,
  )
  check(
    'and a repeat costs nothing, because it is cached',
    mean(r.costs.filter((_, i) => i % 2 === 1)) <= mean(r.costs),
    `repeat ${costOf(r.costs.filter((_, i) => i % 2 === 1))} vs all ${costOf(r.costs)}`,
  )
}

await browser.close()
server.close()
await vite.close()
if (!KEEP) rmSync(dir, { recursive: true, force: true })
console.log(fail.length === 0 ? '\nall good\n' : `\n${fail.length} failed\n`)
process.exit(fail.length === 0 ? 0 : 1)
