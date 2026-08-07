import puppeteer from 'puppeteer-core'

// Does the discrete card suspend underneath a live GPUDevice, and does coming
// back out of that produce the hang the app now rebuilds through?
//
// The claim is a kernel-level one, so it is read from the kernel:
// /sys/class/drm/cardN/device/power/runtime_status, sampled from Node while the
// page is driven in and out of the foreground. Nothing inside the page can see
// this, which is exactly why the app only ever saw its own symptom — submitted
// work that never completes.
//
//   node scripts/gpusleep.mjs [--port=5199] [--hide=180] [--mode=tab|minimize]
//                             [--low-power] [--rounds=1]
//
// `--mode=minimize` hides the whole window rather than switching tabs: a
// background *tab* still belongs to a mapped window the compositor is holding a
// surface for, and the two are not obviously the same to runtime PM.
//
// The control this run always ends with is the important one. After the last
// round it closes the page — destroying the device while the browser stays up —
// and watches the card. A card that suspends there and not while the tab was
// hidden says what pins it is the open device, not submission.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const flags = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = flags.find(f => f.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const port = flag('port', '5199')
const hideMs = Number(flag('hide', '180')) * 1000
const mode = flag('mode', 'tab')
const rounds = Number(flag('rounds', '1'))
const lowPower = flags.includes('--low-power')

const LOOK = 'fbMix:0.45,cfbMix:0.3,phosphor:0.6,crtGlow:0.7,dubGens:3'
const url = `http://localhost:${port}/?set=${LOOK}${lowPower ? '&gpu=low-power' : ''}`
// Two hang strikes plus a rebuild, with room to see frames advance afterwards.
const SHOW_MS = 30_000
const CARDS = [1, 2]

const status = card => {
  try {
    return readFileSync(
      `/sys/class/drm/card${card}/device/power/runtime_status`,
      'utf8',
    ).trim()
  } catch {
    return '?'
  }
}

const t0 = Date.now()
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6)
const log = m => console.log(`${at()}s ${m}`)
const settle = ms => new Promise(r => setTimeout(r, ms))

const transitions = []
let phase = 'boot'
const last = { 1: status(1), 2: status(2) }
log(
  `start: card1=${last[1]} card2=${last[2]}  mode=${mode} hide=${hideMs / 1000}s${lowPower ? ' [low-power]' : ''}`,
)

// 250 ms against a 5 s autosuspend delay: a suspend that happens and is undone
// before the next sample would have to last under a quarter second.
const poller = setInterval(() => {
  for (const c of CARDS) {
    const now = status(c)
    if (now !== last[c]) {
      transitions.push({
        t: +((Date.now() - t0) / 1000).toFixed(1),
        card: c,
        to: now,
        phase,
      })
      log(`  card${c}: ${last[c]} -> ${now}   (${phase})`)
      last[c] = now
    }
  }
}, 250)

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
    'media.autoplay.default': 0,
    'media.autoplay.blocking_policy': 0,
  },
})

const page = await browser.newPage()
await page.setViewport({ width: 1100, height: 760 })
const notable = []
page.on('console', m => {
  const s = m.text()
  if (/stopped completing|rebuil|device lost|strike|hang|frozen/i.test(s)) {
    notable.push({
      t: +((Date.now() - t0) / 1000).toFixed(1),
      phase,
      s: s.slice(0, 180),
    })
    log(`  [page] ${s.slice(0, 160)}`)
  }
})
page.on('pageerror', e => log(`  [pageerror] ${String(e).slice(0, 160)}`))

// A blank second tab is the only honest way to hide the first: it is what a user
// does, and it is what the browser itself reads visibility from. Blank on
// purpose — a second WebGPU context in one browser is a known way to kill this
// Firefox outright, and would confound what this is testing.
const blank = await browser.newPage()
await blank.goto('about:blank')
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.bringToFront()

// Reduce in the page, return the reduction — handing a full readback back across
// BiDi is how a harness crashes this browser.
const probe = () =>
  page.evaluate(() => {
    const l = window.vf?.loop
    const txt = document.body.innerText
    return {
      frame: window.vf?.frame ?? -1,
      live: l?.live ?? null,
      strikes: l?.hangStrikes ?? null,
      confirmed: l?.everConfirmed ?? null,
      stalled: l?.stalled ?? null,
      vis: document.visibilityState,
      fatal: /Close this browser tab|could not be replaced|stopped trying/.test(
        txt,
      ),
      rebuilding: /rebuilding/.test(txt),
    }
  })

// xdotool talks to XWayland, which is where this Firefox's window lives. Matched
// on *our own browser's pid* and nothing else: this box is shared with other
// agents driving headed browsers, and a title match would happily minimise one
// of theirs.
const xdo = args => {
  try {
    return execFileSync('xdotool', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
const browserPid = browser.process()?.pid
const appWindow = () =>
  browserPid === undefined
    ? ''
    : (xdo(['search', '--pid', String(browserPid)])
        .split('\n')
        .filter(Boolean)
        .at(-1) ?? '')

await settle(5000)
let s = await probe()
log(
  `booted: frame ${s.frame} live=${s.live} confirmed=${s.confirmed} vis=${s.vis}`,
)
if (s.frame < 1) {
  log('!! never rendered a frame — aborting')
  clearInterval(poller)
  await browser.close()
  process.exit(1)
}

phase = 'warm'
await settle(10_000)
const warm = await probe()
log(`warm: frame ${warm.frame} card1=${status(1)} card2=${status(2)}`)

const results = []
for (let r = 1; r <= rounds; r++) {
  phase = `hidden-${r}`
  log(`--- round ${r}: hiding (${mode}) for ${hideMs / 1000}s ---`)
  const before = await probe()
  let win = ''
  if (mode === 'minimize') {
    win = appWindow()
    // Loudly, and fatally. A minimize run that quietly degrades into a tab
    // switch reports the tab-switch result under the minimize label, which is
    // worse than not running it.
    if (!win) {
      log('!! --mode=minimize asked for, no window found for our browser pid')
      log('!! refusing to silently fall back to a tab switch — aborting')
      clearInterval(poller)
      await browser.close()
      process.exit(2)
    }
    log(`  minimizing window ${win}`)
    xdo(['windowminimize', win])
  } else {
    await blank.bringToFront()
  }

  // Sample through the hidden stretch rather than only at its end: the page has
  // to actually read as hidden and actually stop rendering, or the run proves
  // nothing about a card that had no reason to idle.
  const hiddenMarks = []
  for (let i = 0; i < Math.max(1, Math.round(hideMs / 15_000)); i++) {
    await settle(Math.min(15_000, hideMs))
    const p = await probe()
    hiddenMarks.push({
      t: +((Date.now() - t0) / 1000).toFixed(1),
      frame: p.frame,
      vis: p.vis,
      card2: status(2),
    })
    log(
      `  hidden +${(i + 1) * 15}s: vis=${p.vis} frame ${p.frame} card2=${status(2)}`,
    )
  }
  const renderedWhileHidden = hiddenMarks.at(-1).frame - before.frame

  phase = `shown-${r}`
  log(`--- round ${r}: showing for ${SHOW_MS / 1000}s ---`)
  if (mode === 'minimize' && win) xdo(['windowactivate', win])
  await page.bringToFront()
  const marks = []
  for (let i = 0; i < SHOW_MS / 2500; i++) {
    await settle(2500)
    marks.push({
      t: +((Date.now() - t0) / 1000).toFixed(1),
      ...(await probe()),
    })
  }
  const after = marks.at(-1)
  results.push({
    round: r,
    hiddenVis: hiddenMarks.map(m => m.vis),
    renderedWhileHidden,
    card2WhileHidden: [...new Set(hiddenMarks.map(m => m.card2))],
    frameAfter: after.frame,
    advancedOnReturn: after.frame - hiddenMarks.at(-1).frame,
    rebuilt: marks.some(m => m.rebuilding),
    fatal: after.fatal,
    live: after.live,
  })
  log(
    `  round ${r}: hidden rendered ${renderedWhileHidden}, on return +${results.at(-1).advancedOnReturn}, rebuilt=${results.at(-1).rebuilt}, fatal=${after.fatal}`,
  )
}

// The control. Close the page — the device goes with it — and leave the browser
// up. If the card suspends here within its 5 s delay but never did while the tab
// was hidden, then what pins it awake is the open device and not submission.
phase = 'device-closed'
log('--- control: closing the app page, browser stays up ---')
await page.close()
await settle(30_000)
const afterClose = status(2)
log(`  30s after the device went: card2=${afterClose}`)

clearInterval(poller)
console.log('\n===== RESULT =====')
console.log(
  JSON.stringify(
    {
      mode,
      hideSec: hideMs / 1000,
      lowPower,
      transitions,
      results,
      afterClose,
      notable,
    },
    null,
    1,
  ),
)
await browser.close()
