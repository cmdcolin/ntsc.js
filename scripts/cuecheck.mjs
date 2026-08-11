// Does a cued loop actually hold the playhead, in the real app?
//
// The clamp itself is unit-tested (gpu/videopump.test.ts) and so is the gesture
// (ui/cue.test.ts). What no test covers is the *wiring*, which crosses four
// layers and is where this feature can plausibly be broken while every unit test
// passes: a link's cue has to survive the async source load that clears it, a
// keypress has to reach the panel and be written through to the pump, and the
// pump has to be the one holding the playhead rather than the 10 Hz poll.
//
//   node scripts/cuecheck.mjs [port]
//
// Needs a dev server already running on that port (see docs/DEVELOPMENT.md — put
// it on a worktree copy if other agents are editing, since an src/ write mid-run
// is an HMR reload that resets the engine underneath the measurement).
//
// Four arms:
//
//   loop     ?cuea=1,1.4 on a link. Exercises the restore path: the cue is armed
//            before the source loads and claimed by `attach` afterwards, because
//            stopSlot deliberately clears it on the way through.
//   keys     `i` twice. Exercises tapCue -> writeCue -> setVideoRegion.
//   stab     `i` once, then `o`. A cue with no loop, and the retrigger jumping
//            back to it — the gesture that works with no loop involved at all.
//   control  no cue. Must roam the whole clip, or the other three prove nothing.
//
// Two readings per arm, and they check different things. `videoA.time` comes out
// of the ?debug frame log, which is the pump's own view of the element. The cue
// comes out of the address bar, which useUrlState mirrors the panel's state into
// — so the region each arm is judged against is the one the panel actually
// recorded, rather than one this file assumed. That is what makes the verdict
// unambiguous: `public/test.mp4` is 6s and loops on its own, so "the playhead
// went backwards" cannot tell a cued wrap from the clip ending.

import puppeteer from 'puppeteer-core'

// A headed window that gets covered stops being drawn — see frames.mjs.
import { watchFrames } from './frames.mjs'
// Waiting on the clip's own playhead rather than on a duration — see until.mjs.
import { until } from './until.mjs'

const PORT = process.argv[2] ?? '5173'
const IN = 1.0
const OUT = 1.4
// Long enough to be sure of several laps of a 0.4s loop, and of the 6s clip
// ending at least once in the control arm.
const WATCH_MS = 6000

const launch = () =>
  puppeteer.launch({
    browser: 'firefox',
    executablePath: '/usr/bin/firefox-nightly',
    headless: false,
    extraPrefsFirefox: {
      'dom.webgpu.enabled': true,
      'gfx.webgpu.ignore-blocklist': true,
      // An occluded window has its rAF throttled to nothing, and this harness
      // reads a per-frame log. Same reason scripts/loopseek.mjs sets it.
      'layout.frame_rate': 60,
    },
    protocolTimeout: 60000,
  })

// A fresh browser per arm. A second presenting page in the same browser came back
// with one sample and `DEBUG frame 0`, which is a tab that has lost its rendering
// step (docs/adr/0004) and says nothing about the loop.
const arm = async (label, query, during) => {
  const browser = await launch()
  const times = []
  let urlAfter = ''
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 800 })
    page.on('console', m => {
      const t = m.text()
      if (!t.includes('DEBUG frame')) return
      // The frame log's third argument is the object; console text() renders it
      // as a handle, so it has to be pulled across rather than scraped.
      const arg = m.args()[2]
      arg
        ?.jsonValue()
        .then(o => {
          if (o?.videoA?.time !== undefined) times.push(o.videoA.time)
        })
        .catch(() => {})
    })
    await page.goto(`http://127.0.0.1:${PORT}/${query}`, {
      waitUntil: 'domcontentloaded',
    })
    await page.bringToFront()
    // This is the harness with the most to lose from a window being clicked
    // away — it reads a per-frame log, so no frames means no samples, and the
    // `armTwice` retry below was written for exactly that and can only guess at
    // it after the fact. The watchdog says so while it is happening.
    await watchFrames(page, { label: `cuecheck ${label}` })
    // Rolling before anything is pressed: a cue is taken from the element's own
    // playhead, so there has to be one.
    //
    // Waited for rather than slept through. A clip has to be fetched and
    // decoded before it has a playhead at all, and 3.5s was a guess about a
    // network — miss it and `times` is empty, every cue below is taken from
    // nothing, and the run reports a fault in cueing. The frame log filling up
    // is the app saying the clip is rolling, which is the actual precondition.
    await until(
      () => Promise.resolve(times.length),
      n => n >= 2,
      {
        budget: 8000,
      },
    )
    const pressedAt = times.length
    if (during !== undefined) await during(page, times)
    // The address-bar mirror is debounced 250ms.
    await new Promise(r => setTimeout(r, 600))
    urlAfter = page.url()
    await new Promise(r => setTimeout(r, WATCH_MS))
    // The jsonValue round-trips are async; let the last few land.
    await new Promise(r => setTimeout(r, 800))
    // What the app itself concluded about the wrap cost, off the engine the
    // harnesses already reach through. This is the number the cue row's "stalls
    // Nx" note is rendered from.
    const health = await page
      .evaluate(() => window.vf?.loopHealth?.().a ?? null)
      .catch(() => null)
    return { label, times, urlAfter, pressedAt, health }
  } finally {
    await browser.close().catch(() => {})
    await new Promise(r => setTimeout(r, 700))
  }
}

// Too few samples means the tab stopped being rendered, which is a fact about
// this machine's GPU rather than about the loop — retried rather than reported.
const armTwice = async (...args) => {
  let r = await arm(...args)
  if (r.times.length < 6) {
    console.log(`  ${r.label}: ${r.times.length} samples, retrying`)
    r = await arm(...args)
  }
  return r
}

// The cue the panel says it holds, read back off the address bar.
const cueFromUrl = url => {
  const hit = /[?&]cuea=([^&]*)/.exec(url)
  if (hit === null) return null
  const [a, b] = decodeURIComponent(hit[1]).split(',').map(Number)
  return { in: a, out: b === undefined ? null : b }
}

const results = []
results.push(await armTwice('loop', `?vurl=/test.mp4&cuea=${IN},${OUT}&debug`))
results.push(
  await armTwice('keys', '?vurl=/test.mp4&debug', async page => {
    await page.keyboard.press('i')
    await new Promise(r => setTimeout(r, 400))
    await page.keyboard.press('i')
  }),
)
let stabbed = { before: NaN, after: NaN }
results.push(
  await armTwice('stab', '?vurl=/test.mp4&debug', async (page, times) => {
    await page.keyboard.press('i')
    // Far enough past the in-point that the jump back is unambiguous — the
    // check below wants more than half a second of it. Waited for rather than
    // slept through: a `<video>` advances in wall time but only *reports* where
    // it got to once per rendered frame, and this window is occluded.
    const from = times.at(-1) ?? 0
    await until(
      () => Promise.resolve(times.at(-1) ?? 0),
      t => t > from + 1,
      {
        budget: 8000,
      },
    )
    const before = times.at(-1)
    await page.keyboard.press('o')
    // The playhead going *backwards* is the retrigger, and it is the one
    // reading that cannot happen any other way while a clip plays forward.
    await until(
      () => Promise.resolve(times.at(-1) ?? 0),
      t => t < before,
      {
        budget: 8000,
      },
    )
    stabbed = { before, after: times.at(-1) }
  }),
)
results.push(await armTwice('control', '?vurl=/test.mp4&debug'))

// Does the app's own wrap-cost reading agree with what loopseek measures from the
// outside? Two clips in public/, looped at the same in-point, differing only in how
// they were encoded: test.mp4 has one keyframe in six seconds, demo-v2.mp4 one every
// ~0.45s.
//
// The assertion is the **ordering**, not a threshold, and that is the finding rather
// than a convenience. The absolute numbers move by about 2x with machine load — the
// same file and in-point has read 137ms and 513ms on this box — so a fixed cutoff
// misclassifies one clip or the other depending on what else is running. The
// ordering has held across every run, which is what the panel's readout relies on
// and all it claims.
const stallArms = [
  { label: 'enc:sparse', file: 'test.mp4' },
  { label: 'enc:dense', file: 'demo-v2.mp4' },
]
const encRead = {}
for (const a of stallArms) {
  const r = await armTwice(a.label, `?vurl=/${a.file}&cuea=5.1,5.4&debug`)
  const h = r.health
  encRead[a.label] = h
  console.log(
    `${a.label.padEnd(11)} laps=${h?.laps ?? 0} ` +
      `wrap=${h?.medianMs?.toFixed(0) ?? '--'}ms`,
  )
}

const fails = []
const sparse = encRead['enc:sparse']
const dense = encRead['enc:dense']
if ((sparse?.laps ?? 0) < 2 || (dense?.laps ?? 0) < 2) {
  fails.push('enc: one of the arms never measured two laps')
} else if (!(sparse.medianMs > dense.medianMs * 1.4)) {
  fails.push(
    `enc: sparse ${sparse.medianMs.toFixed(0)}ms should clearly exceed dense ` +
      `${dense.medianMs.toFixed(0)}ms — the reading has stopped tracking how the ` +
      'clip was encoded',
  )
}

for (const r of results) {
  const cue = cueFromUrl(r.urlAfter)
  // Only the samples taken after the cue existed can be judged against it.
  const after = r.times.slice(r.pressedAt)
  const lo = after.length === 0 ? NaN : Math.min(...after)
  const hi = after.length === 0 ? NaN : Math.max(...after)
  const label =
    cue === null
      ? '(no cue)'
      : cue.out === null
        ? `cue ${cue.in.toFixed(2)}`
        : `loop ${cue.in.toFixed(2)}..${cue.out.toFixed(2)}`
  console.log(
    `${r.label.padEnd(8)} n=${String(after.length).padStart(3)} ` +
      `range=${lo.toFixed(2)}..${hi.toFixed(2)}  ${label}`,
  )
  // A closed loop must confine the playhead. The tolerance is one frame's worth
  // either side: the wrap is issued on the frame the out-point was crossed, so
  // the sample can legitimately sit just past it.
  if (cue !== null && cue.out !== null) {
    const inside = after.every(t => t >= cue.in - 0.05 && t <= cue.out + 0.1)
    const moved = new Set(after).size
    // Wraps *seen* in the samples, reported but not asserted on. The ?debug log
    // prints every 30 frames — about twice a second — so a sub-second loop aliases
    // against it and a run can show one backward step or none while looping
    // perfectly. That cost a false failure.
    //
    // Confinement plus movement is the proof and needs no lap count: a paused clip
    // would show one distinct value, and one playing freely would have covered most
    // of its six seconds instead of staying inside a 0.4s window.
    const laps = after.filter((t, i) => i > 0 && t < after[i - 1]).length
    console.log(
      `         confined: ${inside ? 'yes' : 'NO'}, moving: ${moved}, wraps seen: ${laps}`,
    )
    if (!inside) fails.push(`${r.label}: left its region`)
    if (moved < 3) fails.push(`${r.label}: stopped moving`)
  }
}

const control = results.find(r => r.label === 'control')
if (Math.max(...control.times) < OUT + 0.5) {
  fails.push('control: never got past the out-point, so it proves nothing')
}
const keys = cueFromUrl(results.find(r => r.label === 'keys').urlAfter)
if (keys === null || keys.out === null)
  fails.push('keys: `i` twice made no loop')
const stab = cueFromUrl(results.find(r => r.label === 'stab').urlAfter)
if (stab === null || stab.out !== null) {
  fails.push('stab: one `i` should mark a cue and no loop')
}
const jumped = stabbed.before - stabbed.after
console.log(
  `\nretrigger: ${stabbed.before?.toFixed(2)} -> ${stabbed.after?.toFixed(2)} (back ${jumped.toFixed(2)}s)`,
)
if (!(jumped > 0.5)) fails.push('stab: `o` did not jump back to the cue')

console.log('\n--- verdict ---')
if (fails.length === 0) console.log('  PASS')
else for (const f of fails) console.log(`  FAIL ${f}`)
process.exit(fails.length === 0 ? 0 : 1)
