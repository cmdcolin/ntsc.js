// Does a transition break the picture, cut in the middle, and give the board
// back?
//
//   node scripts/faultcheck.mjs [port]
//
// The shelf is a table of recipes over controls that already exist
// (docs/EDITOR.md › _Transitions_), so what needs checking is not the values —
// `ui/transitions.test.ts` holds those against the slider ranges — but the three
// claims the engine makes about running one:
//
//   1. it moves the picture, which is the only observable the fault has;
//   2. it never touches the resting board, so the panel never sees it and a
//      preset saved mid-transition is the look rather than the fault;
//   3. it lands the cut on the frame the picture is least legible, which is the
//      whole reason the cut is a callback and not something React polls for;
//   4. and it **resolves** — which is the word in the name, and the one thing
//      here that is a measurement rather than an assertion about a number.
//
// **The picture does not come back on the frame the board does**, and that is
// the mechanism rather than a defect in it. The first version of the fourth
// check asserted a hash match one frame after the span ended and failed on every
// entry by the same amount: the board is handed back inside the frame, but the
// phosphor is still holding the tracking band, the loop bin has recorded the
// broken frames, and the PLL is still walking its lock back. So what is measured
// is the shape — far from rest at the cut, near it again after the memory has
// had a moment — which is what "a fault that resolves" actually claims.
//
// And measured against a control rather than against zero, for a reason worth
// knowing before trusting any number this file prints: see the floor arm below.
//
// Driven frame by frame off `step()` under a take, so the fault's own clock is
// the only thing moving and every reading below is exact rather than sampled
// out of a running loop. Sampled through a 64x48 downscale rather than
// `getImageData` on the real canvas: a 1352x900 read per frame is 4.8MB, five
// hundred times over, and it was most of the run.
//
// **Give it the front window.** This is one of the harnesses docs/DEVELOPMENT.md
// means when it says a check that samples the canvas as it paints has to own the
// screen — behind another window nothing consumes the swapchain, `step()` itself
// backs up, and a run that takes two minutes in front takes past the protocol
// timeout behind. It is a slow run rather than a wrong one, and it reports as a
// `ProtocolError` naming no cause, which is why everything below is as few
// stepped frames as the claims allow.

import puppeteer from 'puppeteer-core'

// Boot waited for rather than slept through — see until.mjs.
import { appUp } from './until.mjs'

import process from 'node:process'

const port = process.argv[2] ?? '5199'

const fail = []
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`,
  )
  if (!ok) fail.push(name)
}

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  // 480s, matching `rendercheck.mjs` and for the same reason: a run that takes
  // two minutes with the window in front takes far longer behind another one,
  // and it reports as a `ProtocolError` naming no cause rather than as a slow
  // run. On a shared box that is a harness that fails for reasons that have
  // nothing to do with the app.
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
// Bars, and B on air at half — a still source so nothing but the fault moves,
// and both decks live so the cut has somewhere to throw to.
await page.goto(`http://localhost:${port}/?set=bGain:0.5,bGenlock:1`, {
  waitUntil: 'domcontentloaded',
})
await appUp(page, 6000)
await page.bringToFront()

// **One take across all five entries, warmed up once.** Stepping frames costs
// far more than it looks in a window that is not in front — nothing is
// consuming the swapchain, so submission itself backs up — and a take per entry
// meant re-warming a cleared signal path five times, which is what blew the
// protocol timeout twice. The floor arm below settles whatever the previous
// entry left, so sharing the take costs nothing that is measured here.
const setup = () =>
  page.evaluate(async () => {
    const vf = window.vf
    vf.pauseLoop()
    await new Promise(r =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    )
    vf.startTake({ fps: 60, seed: 1 })
    // The take starts from a cleared signal path, so the first frames are a
    // receiver finding its lock rather than a resting picture.
    for (let i = 0; i < 40; i++) vf.step()
  })

const teardown = () =>
  page.evaluate(() => {
    window.vf.endTake()
    window.vf.resumeLoop()
  })

// Run one shelf entry frame by frame, sampling the canvas, and report what the
// board looked like on either side of it.
const runFault = name =>
  page.evaluate(async transition => {
    const { TRANSITIONS, faultPlan } = await import('/src/ui/transitions.ts')
    const vf = window.vf
    const cv = document.querySelector('canvas')
    const t = TRANSITIONS.find(x => x.name === transition)
    const W = 64
    const H = 48
    const oc = new OffscreenCanvas(W, H)
    const ctx = oc.getContext('2d')
    // A downscaled frame, as bytes. Small enough to take one every frame, and
    // the scale is doing the averaging that makes a *difference* between two of
    // them mean "the picture moved" rather than "one pixel of grain did".
    const grab = () => {
      ctx.drawImage(cv, 0, 0, W, H)
      return ctx.getImageData(0, 0, W, H).data
    }
    // Mean absolute difference per byte, 0..255.
    const diff = (a, b) => {
      let sum = 0
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
      return sum / a.length
    }
    const before = { ...vf.getControls() }
    const rest = grab()

    // **The control arm: the same gap, with no fault in it.** How far the
    // picture drifts from `rest` over twenty frames of doing nothing, so that
    // every claim past this point is about the fault's *excess* over whatever
    // the board was doing anyway. It doubles as the settling gap for whatever
    // the previous entry left behind.
    //
    // It reads ~0 now and it did not always, which is the reason it is measured
    // rather than assumed. When each entry took its own `startTake`, `rest` was
    // captured thirty frames into a *cleared* signal path — a phosphor still
    // filling — so the picture kept getting brighter on its own and every
    // entry's settled reading came back 15-17/255 from rest whatever its fault
    // had done. That is a harness reporting its own warmup. Warming up once and
    // sharing the take fixed it; measuring the floor is what makes the arm hold
    // either way, including in a run where the window is behind another one and
    // the readback is stale.
    const GAP = 20
    for (let i = 0; i < GAP; i++) vf.step()
    const floorDiff = diff(grab(), rest)

    const cuts = []
    vf.startFault(
      faultPlan(t, () => {
        cuts.push(vf.frameNo())
      }),
    )
    // **Every fifth frame, not every frame.** `getImageData` forces a readback
    // and blocks on the GPU, so it is the other half of what this run costs.
    // The depth is a smoothstep, so a fifth of the frames still lands within a
    // hair of the peak and every reading below is the same reading.
    const total = Math.round(t.seconds * 60)
    const frames = []
    for (let i = 0; i < total; i++) {
      vf.step()
      if (i % 5 === 0) frames.push({ at: vf.frameNo(), d: diff(grab(), rest) })
    }
    // The board is back on the very next frame. The picture is not — the
    // phosphor, the loop bin and the PLL all carry the broken frames — so it is
    // given the same gap the floor was measured over before being asked how far
    // from rest it is.
    vf.step()
    const after = { ...vf.getControls() }
    for (let i = 0; i < GAP; i++) vf.step()
    const settledDiff = diff(grab(), rest)

    return {
      keys: Object.keys(t.peak),
      cuts,
      // Which of the fault's own frames the cut landed on, 0-based, taken off
      // the engine's counter rather than off the sampled list — which only
      // holds every third frame.
      cutIndex: cuts.length === 1 ? cuts[0] - frames[0].at : -1,
      total,
      // How far the picture got from rest, how far from it the fault left
      // things once the memory had half a second to decay, and what the same
      // gap costs with no fault at all.
      peakDiff: Math.max(...frames.map(f => f.d)),
      settledDiff,
      floorDiff,
      // Did the board come back? Compared over every key, not just the ones the
      // recipe names, so a fault that clobbered something it never mentioned
      // shows up here.
      boardHeld: Object.keys(before).every(k => before[k] === after[k]),
    }
  }, name)

await setup()
for (const name of ['tracking', 'roll', 'collapse', 'shuttle', 'dub']) {
  const r = await runFault(name)
  // Everything below is stated over the floor — see the control arm in
  // `runFault`. `broke` is how much of the picture the fault moved that the
  // grain did not; `left` is how much of that it had not given back.
  const broke = r.peakDiff - r.floorDiff
  const left = r.settledDiff - r.floorDiff
  // **The only observable a fault has.** It never touches the resting board, so
  // "did it run" cannot be read off the controls — the picture is the report.
  //
  // The bar is 2 and not something rounder because of `tracking`, which is the
  // one entry whose fault is *local* by nature: a band of noise across a
  // fifteenth of the frame, averaged over the whole of it, measured 3.9 past a
  // 16 floor where `collapse` — which folds the entire raster — measured 53.5.
  // Both are working. A whole-frame mean understates a band, and the answer is
  // a bar that a band clears rather than a metric tuned until a band looks like
  // a raster collapse. What it still catches is the failure this arm exists
  // for: two of the five recipes once measured 0.4-0.6, which is nothing.
  check(
    `${name}: breaks the picture`,
    broke > 2,
    `${broke.toFixed(1)}/255 past a ${r.floorDiff.toFixed(1)} floor, driving ${r.keys.join(', ')}`,
  )
  check(
    `${name}: cuts once, inside its own span`,
    r.cuts.length === 1 && r.cutIndex > 0 && r.cutIndex < r.total - 1,
    `frame ${r.cutIndex} of ${r.total}`,
  )
  // The invariant the whole design rests on: applied and undone inside a frame,
  // so React never sees it, a preset saved mid-transition is the look rather
  // than the fault, and undo has nothing to walk back.
  check(`${name}: hands the resting board back untouched`, r.boardHeld)
  // And resolves. Not "is identical" — see the header: the board comes back
  // inside the frame and the picture follows as the memory decays, which is a
  // mechanism this project exists to have rather than a settling error.
  check(
    `${name}: and the picture resolves after it`,
    left < broke / 3,
    `${left.toFixed(1)} left half a second later, of ${broke.toFixed(1)} broken`,
  )
}

await teardown()

// --- the shelf, as something a hand can press --------------------------------
const pressed = await page.evaluate(async () => {
  const { TRANSITIONS } = await import('/src/ui/transitions.ts')
  // The deck is **a box on the map**, not a section header — it is not there
  // until it is pressed, which is `DECK_STAGE`'s whole argument. Two things
  // follow for anything driving it. It is an SVG `<g role="button">`
  // (ui/MapBox.tsx) rather than a `<button>`, so `.click()` is not a method it
  // has and the press has to be a dispatched event. And its `aria-label` is the
  // stage name *and its blurb* — a paragraph — so the match is on the prefix.
  document
    .querySelector('[role="button"][aria-label^="Deck"]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 500))
  const shelf = document.querySelector('[data-shelf]')
  const btns = [...(shelf?.querySelectorAll('button') ?? [])]
  const labels = btns.map(b => b.textContent?.trim())
  if (btns.length === 0) return { found: 0, labels, moved: false }
  const vf = window.vf
  const at = vf.getControls().bGain
  // The first entry, whose own `seconds` is what decides how long to wait.
  btns[0].click()
  await new Promise(r => setTimeout(r, (TRANSITIONS[0].seconds + 0.6) * 1000))
  return {
    found: btns.length,
    labels,
    wanted: TRANSITIONS.map(t => t.label),
    moved: vf.getControls().bGain !== at,
  }
})
check(
  'every shelf entry has a key in the deck',
  JSON.stringify(pressed.labels) === JSON.stringify(pressed.wanted),
  (pressed.labels ?? []).join(' '),
)
check(
  'and pressing one throws the bar when its cut lands',
  pressed.moved,
  'bGain moved',
)

// --- a row arriving behind one -----------------------------------------------
//
// The shelf's other cut. Off the deck a transition throws the T-bar; off a row
// it does the row's whole step — the same fault, a different `onCut`, which is
// why `faultPlan` takes it from its caller. What is asserted is the *timing*,
// because that is the whole claim: the step lands in the middle of the fault,
// not when the row fires.
//
// Two rows rather than one, and the second is what makes the preroll assertion
// below possible: the walk looks one row ahead, so firing row 1 is also what
// asks for row 2's clip. Row 1's hold is two seconds, comfortably past the
// ninety frames stepped here, so nothing but row 1 ever fires.
const arrived = await page.evaluate(async () => {
  const { offlineWalk } = await import('/src/ui/stripRun.ts')
  const { transitionOf, faultPlan } = await import('/src/ui/transitions.ts')
  const vf = window.vf
  // A sink standing in for the app's, with the one verb under test wired the
  // way `useEngine.faultTo` wires it: a plan off the shelf whose cut runs the
  // step. What is being timed is when each verb lands, not what it writes.
  const at = []
  const sink = {
    session: () => at.push({ kind: 'session', frame: vf.frameNo() }),
    fault: (name, onCut) => {
      at.push({ kind: 'fired', frame: vf.frameNo() })
      const t = transitionOf(name)
      vf.startFault(
        faultPlan(t, () => {
          at.push({ kind: 'cut', frame: vf.frameNo() })
          onCut()
        }),
      )
    },
    roll: () => {},
    jitter: () => {},
    preroll: () => at.push({ kind: 'preroll', frame: vf.frameNo() }),
  }
  const hold = { bars: 1, drift: 0 }
  const rows = [
    {
      id: 'r1',
      name: '',
      session: 'set=vSize:0.6',
      fill: { kind: 'clip' },
      hold,
      arrive: { seconds: 0, transition: 'collapse' },
    },
    {
      id: 'r2',
      name: '',
      session: 'vurl=/clips/next.mp4',
      fill: { kind: 'clip' },
      hold,
      arrive: { seconds: 0, transition: null },
    },
  ]
  vf.pauseLoop()
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  vf.startTake({ fps: 60, seed: 1 })
  const step = offlineWalk({ rows, seed: 1, loop: false }, sink, {
    bpm: 120,
    fps: 60,
  })
  // `collapse` is a one-second entry cutting at 0.5, so its cut is ~30 frames
  // after the row fires. Ninety frames is comfortably past it.
  for (let i = 0; i < 90; i++) {
    step(i)
    vf.step()
  }
  vf.endTake()
  vf.resumeLoop()
  return at
})
const where = arrived.map(a => `${a.kind}@${a.frame}`).join(' ')
const fired = arrived.find(a => a.kind === 'fired')
const cut = arrived.find(a => a.kind === 'cut')
const session = arrived.find(a => a.kind === 'session')
const preroll = arrived.find(a => a.kind === 'preroll')
check(
  'a row with a transition fires a fault instead of a bare session',
  fired !== undefined && session !== undefined && session.frame > fired.frame,
  where,
)
// The point of the whole feature. A plain row applies its session on the frame
// it fires; this one applies it half a transition later, which is the frame the
// picture is least legible and therefore the frame that hides the edit.
check(
  'and its cut lands in the middle of the fault, not when the row fired',
  cut !== undefined && fired !== undefined && cut.frame - fired.frame > 20,
  cut === undefined
    ? 'no cut'
    : `${cut.frame - fired.frame} frames after firing, for a 60-frame fault cutting at 0.5`,
)
// And the rest of the step rides with it. A slot parks one element, so a
// lookahead spent while this row's own session was still waiting for the cut
// retired the clip that cut was about to promote — every transition cut paying
// the cold price, on exactly the rows preroll was built for. What that looked
// like from here was a `preroll@0` beside a `session@30`.
check(
  'and the next row’s preroll waits for the cut rather than pre-empting it',
  preroll !== undefined &&
    session !== undefined &&
    preroll.frame === session.frame &&
    preroll.frame === cut?.frame,
  where,
)

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(fail.length === 0 ? '\nfault ok' : `\n${fail.length} failed`)
process.exit(fail.length === 0 ? 0 : 1)
