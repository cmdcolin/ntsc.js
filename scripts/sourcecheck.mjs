// Verification harness for the *interactive* source paths: the picker on each
// deck, and the teletype dialog.
//
// It exists because those are the paths nothing else here can reach. Every
// other harness drives the app through the query string, and a link goes in
// through `restoreSession` — a different door from the one a hand uses. The
// picker's own route (useEngine's `commitA`/`commitB`) had no coverage at all:
// nine load paths, no unit test that can touch them (the hook is a bag of
// browser objects), and a mistake in any of them shows up as a deck that lands
// on the right mode and the wrong picture.
//
// Which is the thing this actually checks. "The canvas is not black" is not
// worth running: peak channel saturates at ~242 on every source this app draws,
// so it would pass a deck still showing the *previous* picture under the new
// mode's name — exactly the failure a shared commit path can introduce. So each
// step takes a coarse per-tile signature, and the run fails on how far the
// picture moved from the step before it.
//
// The link it loads on is part of the instrument, not a convenience. At stock
// the composite is A plus a whisper of B (`bGain` 0.16), and measured that way
// the two decks cannot be told apart: a healthy B mode change moves the picture
// 0.9-1.8 by the metric below, and a *broken* A commit — one that lands the
// mode on the picker and leaves the old picture up — moves it 0.9-1.8 as well.
// No threshold separates those, and a gap the size of the noise is exactly
// where thresholds go wrong (the lesson ui/cue.ts records about wrap cost).
//
// So the confound is removed rather than thresholded. `?srcb=none` keeps B out
// of the composite while A is driven, so A alone is the picture; `?set=bGain:1`
// makes B the whole of it when B's turn comes.
//
// Measured that way against a deliberately broken build — `commitA` landing the
// mode without `showGenerated` — the two do not overlap at all:
//
//   broken   0.00 on every A row (the picture is literally the previous one)
//   healthy  2.58 at its tightest (sweep to tv static, two full-frame
//            patterns with similar tile means), 3.0-12.5 everywhere else
//
// Usage: node scripts/sourcecheck.mjs [baseUrl]

import puppeteer from 'puppeteer-core'

// Boot waited for rather than slept through — see until.mjs.
import { appUp } from './until.mjs'

const origin = process.argv[2] ?? 'http://localhost:5199/'
const base = `${origin}?srcb=none&set=bGain:1`

// What counts as the picture having actually changed. The fault this catches
// reads as 0, so the bar sits well below the tightest honest change rather than
// just under it: 1.0 leaves a 2.5x margin on both sides. A harness that fails a
// build wants to be wrong in the safe direction.
const MOVED_MIN = 1

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
    'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true,
  },
})
const page = await browser.newPage()
// Before `goto`, never after: a viewport set after load swaps the realm and
// every later evaluate sees `window.vf` as undefined, which reads exactly like
// the app failing to boot. See the traps list in docs/DEVELOPMENT.md.
await page.setViewport({ width: 1352, height: 900 })

const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
// Filtered rather than forwarded whole: React's dev build logs a line per
// component per render, and shipping all of them back over BiDi is enough to
// stall a harness mid-run.
page.on('console', m => {
  const t = m.text()
  if (/video error|render error|gpu:|Uncaught/.test(t)) {
    errors.push(`console: ${t.slice(0, 200)}`)
  }
})

await page.goto(base, { waitUntil: 'networkidle0' })
await appUp(page, 4000)
// No frame watchdog here on purpose. This harness steps the engine from Node
// precisely so an occluded window cannot affect it (see the note below), which
// makes it the one check that is *already* immune to the fault frames.mjs
// catches — and a watchdog would only take that away.

// Frames are stepped from Node rather than waited for: an occluded window
// throttles rAF, which would read as the app not rendering.
//
// The real-time settle in front of it is not padding. Stepping 60 frames costs
// about 90ms of wall clock, and a bundled clip is a network fetch into a
// <video> that has to buffer before it decodes anything — so without the wait
// the clip sources probe while the slot is still showing whatever preceded
// them, which reads exactly like a commit that failed to change the picture.
const SETTLE_MS = 900
const step = async (frames = 60) => {
  await new Promise(r => setTimeout(r, SETTLE_MS))
  await page.evaluate(async n => {
    for (let i = 0; i < n; i++) {
      window.vf?.step()
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 15))
    }
  }, frames)
}

// The panel mounts one stage at a time, so a deck's picker is on screen only
// while that deck's stage is open. The map's boxes are `<g role=button>` — the
// click is dispatched on the element rather than aimed at a coordinate, so the
// harness does not depend on the diagram's layout.
const openStage = async label => {
  return page.evaluate(name => {
    const g = [...document.querySelectorAll('g[role=button]')].find(e =>
      (e.textContent ?? '').trim().toLowerCase().startsWith(name.toLowerCase()),
    )
    if (!g) return false
    g.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    )
    return true
  }, label)
}

// The open deck's picker, told apart by its first option: only B can be 'none'.
const deckSelect = async want => {
  for (const s of await page.$$('select')) {
    const first = await s.evaluate(el => el.options[0]?.value)
    if (want === 'a' && first === 'bars') return s
    if (want === 'b' && first === 'none') return s
  }
  return null
}

// The map box toggles and A's stage is already open on arrival, so ask for the
// picker first and only click when it is not there.
const ensureDeck = async deck => {
  for (let i = 0; i < 3; i++) {
    const sel = await deckSelect(deck)
    if (sel !== null) return sel
    if (!(await openStage(deck === 'a' ? 'Source A' : 'Source B'))) {
      throw new Error(`no ${deck} stage on the chain map`)
    }
    await new Promise(r => setTimeout(r, 700))
  }
  throw new Error(`no ${deck} picker after opening its stage`)
}

// Liveness and identity in one read. `sig` is a 4x3 grid of quantised tile
// means — coarse enough to shrug off a noise source jittering between frames,
// fine enough that two different pictures separate.
const probe = () =>
  page.evaluate(() => {
    const cv = document.querySelector('canvas')
    if (!cv) return { peak: -1, sig: '', sourceBOn: null }
    const off = document.createElement('canvas')
    off.width = 160
    off.height = 120
    const g = off.getContext('2d')
    g.drawImage(cv, 0, 0, 160, 120)
    const d = g.getImageData(0, 0, 160, 120).data
    let peak = 0
    const sums = new Array(12).fill(0)
    const counts = new Array(12).fill(0)
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 160; x++) {
        const i = (y * 160 + x) * 4
        peak = Math.max(peak, d[i], d[i + 1], d[i + 2])
        const t = Math.floor(y / 40) * 4 + Math.floor(x / 40)
        sums[t] += (d[i] + d[i + 1] + d[i + 2]) / 3
        counts[t] += 1
      }
    }
    return {
      peak,
      sig: sums.map((s, i) => Math.round(s / counts[i] / 8)).join('.'),
      sourceBOn: window.vf?.sourceBOn ?? null,
    }
  })

const rows = []
const drive = async (deck, modes) => {
  const sel = await ensureDeck(deck)
  for (const m of modes) {
    await sel.select(m)
    await step()
    rows.push({
      label: `${deck.toUpperCase()} ${m}`,
      want: m,
      got: await sel.evaluate(el => el.value),
      ...(await probe()),
    })
  }
}

// A: the generated sources, a bundled clip (the <video> path), and the bundled
// photo — which is the async branch, the one that reads the load token.
await drive('a', ['sweep', 'tv static', 'cat', 'clip-popeye', 'synth', 'bars'])

// B, including the one mode that means "stop summing". The enable is derived
// from the mode rather than set per caller, so 'none' is what proves it.
await drive('b', ['sweep', 'none', 'vhs static', 'bars'])

// B out of the composite again before the last two steps: it is at full gain
// here, so left summing it would drown out whatever A does next and the
// movement check would be measuring B.
const bSel = await ensureDeck('b')
await bSel.select('none')
await step()

// Teletype commits through a dialog, which is a path no link can take.
const aSel = await ensureDeck('a')
await aSel.select('teletype')
await new Promise(r => setTimeout(r, 600))
const printed = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(
    b => b.textContent.trim() === 'Print',
  )
  if (!btn) return false
  btn.click()
  return true
})
await step(120)
rows.push({
  label: 'A teletype (dialog)',
  want: 'teletype',
  got: await aSel.evaluate(el => el.value),
  ...(await probe()),
})

// And off it again: the commit that has to retire the reveal, or it goes on
// typing over whatever replaced it.
await aSel.select('bars')
await step()
rows.push({
  label: 'A bars after teletype',
  want: 'bars',
  got: await aSel.evaluate(el => el.value),
  ...(await probe()),
})

// How far this picture moved from the one before it: mean absolute difference
// across the twelve tiles.
const tiles = sig => sig.split('.').map(Number)
const moved = (a, b) => {
  const [x, y] = [tiles(a), tiles(b)]
  return x.length !== y.length
    ? 0
    : x.reduce((n, v, i) => n + Math.abs(v - y[i]), 0) / x.length
}
for (const [i, r] of rows.entries())
  r.moved = i === 0 ? null : +moved(r.sig, rows[i - 1].sig).toFixed(2)

console.table(rows.map(r => ({ ...r, sig: r.sig.slice(0, 20) })))

const fails = [
  // The first row of each deck's run is exempt: it is measured against whatever
  // the previous deck left, which is not a claim this harness makes.
  ...rows
    .filter(r => r.moved !== null && r.moved < MOVED_MIN)
    .map(r => `${r.label}: picture moved ${r.moved} (under ${MOVED_MIN})`),
  ...rows
    .filter(r => r.want !== r.got || r.peak <= 0)
    .map(r => `${r.label}: picker reads ${r.got}, peak ${r.peak}`),
  ...rows
    .filter(r => r.label === 'B none' && r.sourceBOn !== false)
    .map(r => `${r.label}: sourceBOn ${r.sourceBOn}, expected false`),
  ...rows
    .filter(
      r =>
        r.label.startsWith('B ') &&
        r.label !== 'B none' &&
        r.sourceBOn !== true,
    )
    .map(r => `${r.label}: sourceBOn ${r.sourceBOn}, expected true`),
  ...(printed ? [] : ['teletype dialog: no Print button found']),
  ...errors,
]

console.log(fails.length === 0 ? 'PASS' : `FAIL (${fails.length})`)
for (const f of fails) console.log(' -', f)
await browser.close()
process.exit(fails.length === 0 ? 0 : 1)
