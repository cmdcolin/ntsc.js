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
    // Rolling before anything is pressed: a cue is taken from the element's own
    // playhead, so there has to be one.
    await new Promise(r => setTimeout(r, 3500))
    const pressedAt = times.length
    if (during !== undefined) await during(page, times)
    // The address-bar mirror is debounced 250ms.
    await new Promise(r => setTimeout(r, 600))
    urlAfter = page.url()
    await new Promise(r => setTimeout(r, WATCH_MS))
    // The jsonValue round-trips are async; let the last few land.
    await new Promise(r => setTimeout(r, 800))
    return { label, times, urlAfter, pressedAt }
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
    await new Promise(r => setTimeout(r, 2500))
    const before = times.at(-1)
    await page.keyboard.press('o')
    await new Promise(r => setTimeout(r, 1200))
    stabbed = { before, after: times.at(-1) }
  }),
)
results.push(await armTwice('control', '?vurl=/test.mp4&debug'))

const fails = []
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
    const laps = after.filter((t, i) => i > 0 && t < after[i - 1]).length
    console.log(
      `         confined: ${inside ? 'yes' : 'NO'}, laps: ${laps}, distinct: ${new Set(after).size}`,
    )
    if (!inside) fails.push(`${r.label}: left its region`)
    if (laps < 2) fails.push(`${r.label}: did not lap`)
    // A loop that stopped delivering new frames is a still, not a loop.
    if (new Set(after).size < 3) fails.push(`${r.label}: stopped moving`)
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
