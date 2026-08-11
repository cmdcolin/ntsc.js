// What does a loop's wrap cost the *sound*?
//
//   node scripts/wrapsound.mjs [port] [--clip=all|intra|dense|sparse] [--keep]
//
// Needs a dev server already running on that port (docs/DEVELOPMENT.md — put it
// on a worktree copy if other agents are editing, since an src/ write mid-run is
// an HMR reload that resets the engine underneath the measurement). Needs ffmpeg
// and ffprobe, the way scripts/loopseek.mjs does, and for the same reason: the
// clip has to be encoded on purpose.
//
// **Why this exists.** `docs/IDEAS.md` › _Clip cues_ says the loop's wrap drops
// the clip's audio for a fifth to half a second, and gets there by inference:
// `loopHealth().medianMs` is 199-524ms between issuing the wrap's seek and its
// `seeked`, and an element that is seeking is not playing. That is sound
// reasoning about a seek and still not the same thing as having listened. It
// says so itself — "measure before building" — because the fix (a second read
// head, docs/EDITOR.md › _Performance_) costs a policy decision about the one
// preroll slot per deck, and that is not a price worth paying for an inference.
//
// So this listens, on the app's own audio path.
//
// **The instrument is an AudioWorklet tapping the app's analyser**, not the
// analyser's own reading, and the difference is what makes the run trustworthy
// here. `AudioState.level` is recomputed once per *rendered* frame, so reading
// it means measuring sound through the rendering step — and an occluded window
// throttles rAF to about 1 Hz (docs/DEVELOPMENT.md), which would have reported a
// covered window as a permanent dropout. A worklet runs on the audio thread at
// 128-sample quanta whatever the compositor is doing: 2.67ms granularity, and
// nothing about it depends on the window being in front.
//
// It taps `graph.analyser` because that is where everything routed arrives —
// same node the app reads, so this is the app's sound and not a second copy of
// it — through a zero gain to the destination, so the tap adds nothing audible.
//
// Two more things about the method, stated rather than left to be inferred:
//
//   - **The source is a continuous 440Hz tone**, generated with the picture. On
//     music a quiet bar and a dropout are the same reading; on a tone, floor
//     means silence and nothing else. That is why the arms are encoded here
//     rather than pointed at `public/` — and `public/test.mp4`, the sparse clip
//     the existing readings come from, has no audio track at all.
//   - **The control arm is the same clip with no loop marked.** Without it, "the
//     sound sits at floor" cannot be told from an analyser that was never fed,
//     an autoplay block, or a tone that is not there.
//
// The GOP arms are loopseek's, because the question underneath is the same one:
// a seek's cost is set by how far back the previous keyframe is, so if the
// silence *is* the seek then silence must order the same way. `intra` is the
// control from the other end — a wrap that costs nothing to decode should cost
// nothing to hear.
//
// **The engine is stepped from Node rather than left on rAF**, for the reason
// above: the region clamp lives in `VideoPump.pump()`, which runs once per
// rendered frame, so a throttled window would wrap the loop once a second and
// this would be measuring the window manager. Pausing the loop and stepping it
// from the poll below makes the frame rate a known quantity — `render.ts` makes
// the same move for the same reason.

import puppeteer from 'puppeteer-core'

import { appUp, until } from './until.mjs'

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const flags = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = flags.find(f => f.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const PORT = flags.find(f => /^\d+$/.test(f)) ?? '5173'
const ONLY = flag('clip', 'all')
const KEEP = flags.includes('--keep')

const DUR = 20
const FPS = 30
// Deep into the clip and not on a keyframe boundary in any arm, which is where a
// hand marks a loop — loopseek's own deep in-point, so the seek numbers here can
// be read beside the ones its header records.
const IN = 16.4
const LENGTH = 1.0
const OUT = IN + LENGTH
// Ten laps of a 1.4s cycle, near enough.
const WATCH_MS = 14000
// The poll, which is also the step: fast enough that the region clamp is checked
// at about a rendered frame's cadence, and slow enough to leave the audio thread
// alone.
const POLL_MS = 16

const CLIPS = {
  intra: {
    label: 'every frame a keyframe',
    params: 'keyint=1:min-keyint=1:scenecut=0',
  },
  dense: {
    label: '~0.5s GOP (public/demo-v2.mp4)',
    params: `keyint=${FPS / 2}:min-keyint=${FPS / 2}:scenecut=0`,
  },
  sparse: {
    label: 'one keyframe (public/test.mp4)',
    params: `keyint=${DUR * FPS * 2}:min-keyint=${DUR * FPS * 2}:scenecut=0`,
  },
}

const dir = mkdtempSync(join(tmpdir(), 'wrapsound-'))

// Picture and tone in one file. The tone is what is being listened to; the
// burnt-in frame number is so a human watching the run can see the loop looping,
// which is the same reason loopseek draws one.
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
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=48000:duration=${DUR}`,
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
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      // faststart so the moov atom is up front and the element is never waiting
      // on the file mid-seek — that would be measuring the server.
      '-movflags',
      '+faststart',
      out,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  return { out, keys: keyframeCount(out) }
}

// What the file actually has, not what was asked for: x264 places extra IDRs on
// its own, and a `sparse` arm with forty keyframes in it would read as "silence
// is not the seek" for the wrong reason.
const keyframeCount = path =>
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'packet=flags',
    '-of',
    'csv=p=0',
    path,
  ])
    .toString()
    .split('\n')
    .filter(l => l.includes('K')).length

const built = {}
for (const [name, spec] of Object.entries(CLIPS)) {
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

// The fixtures, served to the app rather than to a page of our own — this arm
// measures the shipped path, so the clip arrives through `?vurl` like any other.
//
// **CORS matters here and nowhere else in these harnesses.** `configureVideo`
// sets `crossOrigin='anonymous'`, and `createMediaElementSource` on a
// cross-origin element without the header hands the analyser silence — which
// this run would have reported as a permanent dropout.
const server = createServer((req, res) => {
  const hit = Object.values(built).find(b => b.path.endsWith(req.url.slice(1)))
  if (hit === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  const buf = readFileSync(hit.path)
  res.writeHead(200, {
    'content-type': 'video/mp4',
    'content-length': buf.length,
    'access-control-allow-origin': '*',
  })
  res.end(buf)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const fixtures = `http://127.0.0.1:${server.address().port}`

const launch = () =>
  puppeteer.launch({
    browser: 'firefox',
    executablePath: '/usr/bin/firefox-nightly',
    headless: false,
    extraPrefsFirefox: {
      'dom.webgpu.enabled': true,
      'gfx.webgpu.ignore-blocklist': true,
      // No gesture is available to start an AudioContext from, and a suspended
      // one analyses digital silence — which is the reading this whole run is
      // about, arriving for the wrong reason. traycheck sets the same pair.
      'media.autoplay.default': 0,
      'media.autoplay.blocking_policy': 0,
    },
    protocolTimeout: 90000,
  })

// The listener. `currentTime` in here is the AudioContext's clock at the head of
// the render quantum, which is the same clock the poll below stamps its readings
// with — so a silence and a seek can be laid against each other without
// aligning two clocks.
//
// A quantum counts as quiet if every sample in it is under the threshold. The
// tone is full-scale, so 0.01 is three decades down and there is nothing in
// between for it to catch.
const WORKLET = `
class Silence extends AudioWorkletProcessor {
  constructor() {
    super()
    this.quiet = true
    this.since = 0
    this.loud = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    let loud = false
    if (ch !== undefined) {
      for (let i = 0; i < ch.length; i++) {
        if (Math.abs(ch[i]) > 0.01) { loud = true; break }
      }
    }
    if (loud) this.loud += 1
    if (loud === this.quiet) {
      // A transition. A run is posted when it *closes*, so one still open at the
      // end of the arm is never reported — it has no end to measure to.
      if (loud) this.port.postMessage([this.since, currentTime - this.since])
      else this.since = currentTime
      this.quiet = !loud
    }
    return true
  }
}
registerProcessor('silence', Silence)
`

const INSTALL = async code => {
  const g = window.vf.audioState.graph
  const url = URL.createObjectURL(
    new Blob([code], { type: 'application/javascript' }),
  )
  await g.ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const node = new AudioWorkletNode(g.ctx, 'silence')
  // Through a zero gain to the destination: a node no path reaches from the
  // destination is not guaranteed to be pulled, and a node reaching it at unity
  // would be a second copy of the clip's sound in the room.
  const zero = g.ctx.createGain()
  zero.gain.value = 0
  g.analyser.connect(node)
  node.connect(zero).connect(g.ctx.destination)
  window.__wrap = { runs: [] }
  node.port.onmessage = e => window.__wrap.runs.push(e.data)
  return true
}

// Put the audio picker on 'video' — the clip's own sound track, through the same
// analyser a mic or a music file would use. Through the panel rather than by
// calling routeMedia, so what is measured includes the wiring.
//
// React listens on its own value setter, so the native one has to be called
// through the prototype or the change never reaches state — panelcheck's
// `setRange` makes the same move for sliders.
const PICK_VIDEO_AUDIO = () => {
  const tag = document.querySelector(
    'span[title="audio in, driving sync and deflection"]',
  )
  const sel = tag?.parentElement?.querySelector('select')
  if (sel == null) {
    // The panel mounts one stage at a time, so a folded Sound stage has no
    // <select> to find. Open it and let the caller ask again.
    const box = [
      ...document.querySelectorAll(
        'svg[aria-label="signal chain"] g[role=button]',
      ),
    ].find(g => (g.getAttribute('aria-label') ?? '').startsWith('Sound'))
    box?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return false
  }
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value').set.call(
    sel,
    'video',
  )
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

// One step and one reading, on the AudioContext's clock.
const STEP = () => {
  const as = window.vf.audioState
  const el = as.routed[0]
  window.vf.step()
  return el == null
    ? null
    : [as.graph.ctx.currentTime, el.currentTime, el.seeking ? 1 : 0]
}

const arm = async (label, clip, cue, head = true) => {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 800 })
    const src = encodeURIComponent(`${fixtures}/${clip}.mp4`)
    const q = (cue ? `&cuea=${IN},${OUT}` : '') + (head ? '' : '&loophead=0')
    await page.goto(`http://127.0.0.1:${PORT}/?vurl=${src}${q}`, {
      waitUntil: 'domcontentloaded',
    })
    await page.bringToFront()
    await appUp(page)
    // Answered rather than slept through: a run that starts listening before the
    // graph is routed reads its own lead-in as a dropout.
    const picked = await until(
      () => page.evaluate(PICK_VIDEO_AUDIO).catch(() => false),
      ok => ok === true,
      { budget: 10000 },
    )
    if (!picked) return { label, runs: [], polls: [], health: null }
    const installed = await page
      .evaluate(INSTALL, WORKLET)
      .catch(e => String(e))
    if (installed !== true)
      return { label, runs: [], polls: [], bad: installed }
    // The tone arriving is the precondition, not a duration: the clip has to be
    // fetched, decoded and rolling, and the graph has to have adopted it. A
    // closed silence run means the worklet has heard the tone start.
    await until(
      () => page.evaluate(() => window.__wrap.runs.length).catch(() => 0),
      n => n >= 1,
      { budget: 20000 },
    )
    // A loop marked deep in the clip is seventeen seconds of playback away from
    // its first wrap, which is longer than this run. `o` is the app's own
    // retrigger — the jump to the in-point that a hand makes — and it lands
    // inside the region, so the loop it was marked with survives it.
    if (cue) {
      await page.keyboard.press('o')
      await until(
        () =>
          page
            .evaluate(() => window.vf.audioState.routed[0]?.currentTime ?? 0)
            .catch(() => 0),
        t => t >= IN && t <= OUT,
        { budget: 10000 },
      )
    }
    // The engine's own loop off, so the region clamp runs at the rate below and
    // not at whatever the compositor is giving this window.
    await page.evaluate(() => window.vf.pauseLoop())
    const polls = []
    const done = Date.now() + WATCH_MS
    while (Date.now() < done) {
      const r = await page.evaluate(STEP).catch(() => null)
      if (r !== null) polls.push(r)
      await new Promise(r2 => setTimeout(r2, POLL_MS))
    }
    const runs = await page.evaluate(() => window.__wrap.runs)
    // What the app itself concluded about the seek, over the same laps. The
    // whole point is the two numbers side by side.
    const health = await page
      .evaluate(() => window.vf?.loopHealth?.().a ?? null)
      .catch(() => null)
    await page.evaluate(() => window.vf.resumeLoop())
    return { label, runs, polls, health }
  } finally {
    await browser.close().catch(() => {})
    await new Promise(r => setTimeout(r, 700))
  }
}

const pct = (xs, p) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}

// Silences, wraps, and which of them belong together.
//
// The window judged over starts at the first poll and ends at the last, so the
// lead-in — before the clip was rolling and the graph routed — is outside it. A
// silence is a wrap's if the playhead jumped backwards within a poll interval of
// it either way: `currentTime` reads the seek *target* the instant the seek is
// issued, so the jump can land just before the silence or just inside it.
const analyse = ({ runs, polls }) => {
  if (polls.length < 2) return { runs: [], wraps: 0, quiet: 0, span: 0, n: 0 }
  const from = polls[0][0]
  const to = polls.at(-1)[0]
  const span = to - from
  const wraps = polls
    .map((p, i) => (i > 0 && p[1] < polls[i - 1][1] ? p[0] : null))
    .filter(t => t !== null)
  const slack = (POLL_MS / 1000) * 2
  const inside = runs
    .filter(([at, dur]) => at >= from && at + dur <= to)
    .map(([at, dur]) => ({
      at,
      ms: dur * 1000,
      wrapped: wraps.some(w => w >= at - slack && w <= at + dur + slack),
    }))
  const quiet = inside.reduce((a, r) => a + r.ms, 0) / 1000 / span
  // How much of the run the element spent seeking, off the same polls: the
  // reading the silence is being compared against, on one clock.
  const seeking = polls.filter(p => p[2] === 1).length / polls.length
  return {
    runs: inside,
    wraps: wraps.length,
    quiet,
    seeking,
    span,
    n: polls.length,
    // Reported rather than assumed, the way loopseek reports its tick rate: the
    // region clamp is checked once per step, so this is the resolution the lap
    // boundary has, and a run that came back at four steps a second was pacing
    // the loop rather than watching it.
    rate: polls.length / span,
  }
}

const results = []
for (const name of Object.keys(built)) {
  // Each arm twice, seeking and relaying, on the same machine minutes apart.
  // The absolute numbers here move about 2x with machine load, so an A/B across
  // two commits is comparing two afternoons — `?loophead=0` makes it one run.
  results.push({
    clip: name,
    ...(await arm(`${name}:seek`, name, true, false)),
  })
  results.push({ clip: name, ...(await arm(`${name}:head`, name, true)) })
}
// Same clip, nothing marked. It has to come back with no silence in it, or the
// arms above are measuring the harness.
const controlClip = built.dense !== undefined ? 'dense' : Object.keys(built)[0]
results.push({
  clip: controlClip,
  ...(await arm('control', controlClip, false)),
})

console.log(
  `\n${'arm'.padEnd(13)}${'keys'.padStart(5)}${'wraps'.padStart(7)}` +
    `${'seek'.padStart(9)}${'silence'.padStart(10)}${'worst'.padStart(9)}` +
    `${'quiet'.padStart(8)}${'seeking'.padStart(9)}${'steps/s'.padStart(9)}` +
    `${'free'.padStart(8)}`,
)
const read = {}
const fails = []
for (const r of results) {
  const a = analyse(r)
  read[r.label] = a
  const mine = a.runs.filter(x => x.wrapped)
  const ms = mine.map(x => x.ms)
  console.log(
    `${r.label.padEnd(13)}${String(built[r.clip]?.keys ?? 0).padStart(5)}` +
      `${String(a.wraps).padStart(7)}` +
      `${((r.health?.laps ?? 0) >= 2 ? `${r.health.medianMs.toFixed(0)}ms` : '--').padStart(9)}` +
      `${(mine.length === 0 ? '--' : `${pct(ms, 0.5).toFixed(0)}ms`).padStart(10)}` +
      `${(mine.length === 0 ? '--' : `${pct(ms, 1).toFixed(0)}ms`).padStart(9)}` +
      `${`${(a.quiet * 100).toFixed(0)}%`.padStart(8)}` +
      `${`${((a.seeking ?? 0) * 100).toFixed(0)}%`.padStart(9)}` +
      `${(a.rate ?? 0).toFixed(0).padStart(9)}` +
      // Wraps that made no sound at all. The single most useful column once a
      // second read head exists: a median over the laps that *did* drop out says
      // nothing about how many did not, and those are the ones the head bought.
      `${(a.wraps === 0 ? '--' : `${(((a.wraps - mine.length) / a.wraps) * 100).toFixed(0)}%`).padStart(8)}`,
  )
  if (r.bad !== undefined) fails.push(`${r.label}: ${r.bad}`)
  else if (a.n < 100)
    fails.push(`${r.label}: only ${a.n} steps — the arm did not run`)
}

// The control is what makes the rest a measurement rather than four numbers.
if ((read.control?.quiet ?? 1) > 0.02) {
  fails.push(
    `control: ${((read.control?.quiet ?? 1) * 100).toFixed(0)}% quiet with no ` +
      'loop marked — the silence is not the wrap',
  )
}
if ((read.control?.wraps ?? 1) > 0) {
  fails.push('control: wrapped without a loop marked')
}

const med = k =>
  pct(
    (read[k]?.runs ?? []).filter(x => x.wrapped).map(x => x.ms),
    0.5,
  )

// **The silence has to be at least the seek.** Two independent instruments on
// the same laps — a worklet on the audio thread, and the app's own `seeked`
// timing — and a silence *shorter* than the seek would mean one of them is
// measuring something else, which is the only way this run can be quietly wrong.
//
// **One-sided on purpose, and it took a loaded box to get that right.** The two
// do not measure the same span: the silence brackets the seek and then adds
// whatever the element takes to resume, and a resume is a scheduling cost rather
// than a decode — so it is small on a quiet machine and not small on a busy one.
// A symmetric band held at load 5 and failed at load 43 on the `intra` arm, on a
// 16ms seek heard as 53ms of silence, which is the harness reporting the box.
// The claim worth asserting is the direction.
for (const r of results) {
  const a = read[r.label]
  const seek = r.health?.medianMs ?? 0
  if (a.wraps < 3 || (r.health?.laps ?? 0) < 2) continue
  const heard = med(r.label)
  if (heard < seek - 25) {
    fails.push(
      `${r.label}: ${heard.toFixed(0)}ms of silence against a ${seek.toFixed(0)}ms ` +
        'seek — a wrap cannot be quieter than the seek it is made of, so the ' +
        'two instruments have stopped agreeing',
    )
  }
}

// The one ordering worth asserting, and the one loopseek's own header rests on:
// a clip with a single keyframe pays far more than a well-encoded one. Asserted
// on the *seeking* arms, because that is where a seek is what a wrap costs.
//
// **Deliberately not asserted between `intra` and `dense`.** Both are down where
// the run-to-run variance lives — one loaded run put intra at 67ms and dense at
// 28ms, and intra on its own measured 4ms — so an ordering between them would
// fail for reasons that are about the box. cuecheck makes the same call about
// the same pair of tiers.
if (read['sparse:seek'] !== undefined && read['dense:seek'] !== undefined) {
  if (!(med('sparse:seek') > med('dense:seek') * 2)) {
    fails.push(
      `sparse ${med('sparse:seek').toFixed(0)}ms should clearly exceed dense ` +
        `${med('dense:seek').toFixed(0)}ms — the silence has stopped tracking ` +
        'how the clip was encoded',
    )
  }
}

// **And the head has to be worth having.** Total silence per second of run, not
// a median over the laps that dropped out: the head's whole effect is on *how
// many* laps drop out, and the first cut of this scored a better median and a
// worse sound — two catastrophic laps in place of twelve ordinary ones. So the
// arm that keeps a head must be quieter overall than the arm that seeks, on
// every clip, which is the claim the feature makes and the one it failed before
// it learned to give the head back.
for (const name of Object.keys(built)) {
  const seek = read[`${name}:seek`]
  const head = read[`${name}:head`]
  if (seek === undefined || head === undefined) continue
  if (seek.wraps < 3 || head.wraps < 3) continue
  // A tenth of a percent of slack, so an arm that is silent either way does not
  // fail on floating-point dust.
  if (head.quiet > seek.quiet + 0.001) {
    fails.push(
      `${name}: ${(head.quiet * 100).toFixed(0)}% quiet with a second read head ` +
        `against ${(seek.quiet * 100).toFixed(0)}% without one — the head is ` +
        'costing more than the seek it replaced',
    )
  }
}

console.log('\n--- verdict ---')
if (fails.length === 0) console.log('  PASS — the readings are usable')
else for (const f of fails) console.log(`  FAIL ${f}`)
server.close()
if (KEEP) console.log(`\nfixtures kept in ${dir}`)
else rmSync(dir, { recursive: true, force: true })
process.exit(fails.length === 0 ? 0 : 1)
