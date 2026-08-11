// Does the strip tray actually drive the app, in the real app?
//
// The walk is unit-tested (ui/strip.test.ts), and so is the driver's own logic
// against a fake sink (ui/stripRun.test.ts). What no test covers is the
// *wiring*, which is where this can be broken with every unit test passing: a
// captured row has to be a query string the engine's own session apply accepts,
// a chip has to reach the runner and back out to the card, a drag has to
// reorder without also firing the row it grabbed, and the rundown has to
// survive as JSON.
//
//   node scripts/traycheck.mjs [port]
//
// Needs a dev server already running on that port (see docs/DEVELOPMENT.md —
// put it on a worktree copy if other agents are editing, since an src/ write
// mid-run is an HMR reload that resets the engine underneath the measurement).
//
// **The hold bar is checked by forcing a re-render, not by watching it.** Both
// the engine's frame counter and the strip's own tick are driven by rAF, and a
// browser throttles rAF for an occluded window — which is the trap
// docs/DEVELOPMENT.md already records for every harness here. Under puppeteer
// the window is nearly always occluded, so the bar sits still however long you
// wait, and that is the window manager rather than the app. Stepping the engine
// by hand advances the counter; a click then forces React to re-read the store,
// and the value it comes back with is what the bar *would* have been showing.
// Worth knowing about the feature and not only about the harness: when the tab
// stops getting frames the picture and the rundown freeze together, which is
// the right behaviour and a property of clocking the walk on frames rather than
// on the wall.

import puppeteer from 'puppeteer-core'

// A headed window that gets covered stops being drawn — see frames.mjs.
import { watchFrames } from './frames.mjs'
// Waiting for an answer rather than for a duration — `until.mjs` says which of
// the two a given line wants, and `until.test.mjs` covers the loop itself
// without a browser.
import { appUp, until } from './until.mjs'

import process from 'node:process'

const port = process.argv[2] ?? '5199'
const url = `http://localhost:${port}/`

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
    // The music arm hands over a track through the file input rather than a
    // click, so there is no user gesture behind the play() that follows and
    // Firefox would refuse it.
    'media.autoplay.default': 0,
    'media.autoplay.blocking_policy': 0,
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 900 })
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await appUp(page, 6000)
// Before the frame watchdog, not after: a headed window that opens behind the
// terminal it was launched from is never drawn, and everything below then
// reports the stall this file's own message describes — which is true, and
// about the window manager rather than the app. `rendercheck.mjs` has always
// asked for the front for the same reason; this had not, and was unrunnable on
// a box where new windows do not take focus.
await page.bringToFront()
await watchFrames(page, { label: 'traycheck' })

const wait = ms => new Promise(r => setTimeout(r, ms))

// One round trip per click: the panel has ~1000 buttons, and walking them a
// handle at a time over the wire costs minutes.
const click = (text, exact = false) =>
  page.evaluate(
    (t, ex) => {
      const hit = [...document.querySelectorAll('button')].find(b =>
        ex ? b.textContent?.trim() === t : b.textContent?.includes(t),
      )
      hit?.click()
      return hit !== undefined
    },
    text,
    exact,
  )

const cards = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-index]')].map(c => ({
      name: c.querySelector('button[data-drag] > span:last-child')?.textContent,
      // By name rather than by position — see `data-act` in StripRow.tsx. The
      // two arrivals are separate chips because they are separate things: the
      // look glides over `arrive`, and the source arrives behind `transition`.
      hold: c.querySelector('[data-act="hold"]')?.textContent,
      arrive: c.querySelector('[data-act="arrive"]')?.textContent,
      transition: c.querySelector('[data-act="transition"]')?.textContent,
      live: /live/.test(c.className),
    })),
  )

const fail = []
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`,
  )
  if (!ok) fail.push(name)
}

// --- capture ---------------------------------------------------------------
//
// What the board matches right now, by preset name — the same question
// `app.tsx` asks to decide what a captured row is called (`matchPreset`, then
// `mix.lastPreset` when the answer is nothing).
const matched = () =>
  page.evaluate(async () => {
    const { matchPreset } = await import('/src/ui/presets.ts')
    return matchPreset(window.vf.getControls())?.name ?? null
  })

await click('strip')
await wait(400)
for (const preset of ['vhs', 'broadcast', 'neon tube']) {
  const before = await matched()
  // A chip that is not on the shortlist is a harness that clicks nothing and
  // then reports it three assertions later as a feature being broken — which is
  // the same failure `data-act` was added for, one section down.
  check(`the ${preset} chip is there to press`, await click(preset, true))
  // Deliberately *inside* the look bar's default 1s morph. A capture taken
  // mid-morph must bank where the look is going, not the frame it has reached —
  // "a tween is a frame, not a look", the rule useMix.banked() already follows.
  // Before that fix this arm was flaky and recorded half-way boards.
  //
  // **Waited for rather than slept through**, because a morph advances on
  // *rendered frames* and this window is occluded — the trap this file's header
  // already names for the hold bar. A stalled rAF chain left the board still
  // exactly equal to the preset before it, so `matchPreset` went on answering
  // with that one and the row was captured under the previous look's name:
  // `["vhs","vhs 2","neon tube"]`, about one run in eight, reported as three
  // failures in naming and duplication. The board having left the last look is
  // the earliest moment a capture means anything, and it is still inside the
  // morph, which is the property the sleep was here to test.
  await until(matched, m => m !== before)
  await click('+ row')
  await wait(1200)
}
let rows = await cards()
check(
  'three rows captured off three boards',
  rows.length === 3,
  `${rows.length}`,
)
check(
  'each row starts on the loose default',
  rows.every(r => r.hold === '≈4 bars'),
  JSON.stringify(rows.map(r => r.hold)),
)
// The whole reason rows carry a name: three look changes over one source all
// derive as "look only", which is accurate and useless.
check(
  'a capture takes the name of the look it was captured from',
  JSON.stringify(rows.map(r => r.name)) ===
    JSON.stringify(['vhs', 'broadcast', 'neon tube']),
  JSON.stringify(rows.map(r => r.name)),
)

// --- the third filling ------------------------------------------------------
await click('+ shake')
await wait(400)
rows = await cards()
check(
  'a shake row can be made, and says what it does',
  rows.length === 4 && rows[3].name === 'shake · normal',
  `${rows.length} / ${rows[3]?.name}`,
)
await page.evaluate(() => {
  const card = document.querySelectorAll('[data-index]')[3]
  card?.querySelector('[data-act="drop"]')?.click()
})
await wait(300)
check('and taken out again', (await cards()).length === 3)

// --- undo -------------------------------------------------------------------
await click('↶')
await wait(300)
check(
  'undo puts a removed row back',
  (await cards()).length === 4,
  `${(await cards()).length}`,
)
await click('↷')
await wait(300)
check('and redo takes it out again', (await cards()).length === 3)

// --- duplicate ---------------------------------------------------------------
await page.evaluate(() => {
  const card = document.querySelectorAll('[data-index]')[0]
  card?.querySelector('[data-act="dup"]')?.click()
})
await wait(300)
rows = await cards()
check(
  'a duplicate lands next to its original, numbered off it',
  rows.length === 4 && rows[1].name === 'vhs 2',
  `${rows.length} / ${JSON.stringify(rows.map(r => r.name))}`,
)
await click('↶')
await wait(300)
check('and undo takes the duplicate back out', (await cards()).length === 3)

// --- renaming --------------------------------------------------------------
const rename = (i, value) =>
  page.evaluate(
    async (index, text) => {
      const card = document.querySelectorAll('[data-index]')[index]
      card?.querySelector('[data-act="rename"]')?.click()
      await new Promise(r => setTimeout(r, 60))
      const field = card?.querySelector('input')
      if (field === null || field === undefined) return 'no field'
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(field, text)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
      return 'ok'
    },
    i,
    value,
  )
check('the rename field opens', (await rename(0, 'the drop')) === 'ok')
await wait(300)
rows = await cards()
check(
  'and the name lands on its own row',
  rows[0].name === 'the drop',
  rows[0].name,
)
check('leaving the others alone', rows[1].name === 'broadcast', rows[1].name)

await rename(0, '')
await wait(300)
rows = await cards()
check(
  'clearing a name falls back to what the session reads as',
  rows[0].name === 'look only',
  rows[0].name,
)
await rename(0, 'the drop')
await wait(300)

// --- the chips -------------------------------------------------------------
const stepNth = (i, act, times) =>
  page.evaluate(
    (index, which, n) => {
      const card = document.querySelectorAll('[data-index]')[index]
      for (let k = 0; k < n; k++)
        card?.querySelector(`[data-act="${which}"]`)?.click()
    },
    i,
    act,
    times,
  )
await stepNth(0, 'hold', 2)
await stepNth(0, 'arrive', 1)
await wait(300)
rows = await cards()
check(
  'the hold chip steps its own row only',
  rows[0].hold === '≈16 bars',
  rows[0].hold,
)
check(
  'and the other rows are untouched',
  rows[1].hold === '≈4 bars',
  rows[1].hold,
)
check('the arrival chip steps too', rows[0].arrive === '4s', rows[0].arrive)

// The other half of "how it arrives", and the two are separate chips because
// they are separate things — the look glides while the fault does the cutting,
// so stepping one must not disturb the other.
await stepNth(0, 'transition', 1)
await wait(300)
rows = await cards()
check(
  'the transition chip arms a row off the shelf',
  rows[0].transition === '∿',
  rows[0].transition,
)
// The one thing on this page that has to be measured rather than clicked.
//
// `element.click()` reaches a button whether or not a hand could — it does no
// hit-testing — so a control clipped out of the card by `overflow: hidden`
// goes on passing every other check here. This chip used to draw the shelf's
// *word*, and "collapse" beside a "≈16 bars" hold pushed the ✕ 8 to 21px past
// the card's right edge, where it was invisible and unclickable and the only
// way to remove a row.
const outside = await page.evaluate(() =>
  [...document.querySelectorAll('[data-index]')].flatMap(card => {
    const box = card.getBoundingClientRect()
    return [...card.querySelectorAll('button')]
      .filter(b => {
        const r = b.getBoundingClientRect()
        return r.right > box.right + 0.5 || r.left < box.left - 0.5
      })
      .map(b => `row ${card.dataset.index}'s ${b.dataset.act ?? 'face'}`)
  }),
)
check(
  'and every control on an armed row is still inside its card',
  outside.length === 0,
  outside.join(', '),
)
check(
  'and does not disturb how the look arrives',
  rows[0].arrive === '4s',
  rows[0].arrive,
)
check(
  'while the rows beside it still cut straight in',
  rows[1].transition === '↷',
  rows[1].transition,
)
// All the way round the ring and back to the plain cut, which is where it has
// to end up: a hand that stepped past the one it wanted needs a way back that
// is not undo.
await stepNth(0, 'transition', 5)
await wait(300)
rows = await cards()
check(
  'and steps round the shelf back to a plain cut',
  rows[0].transition === '↷',
  rows[0].transition,
)

// --- the walk --------------------------------------------------------------
await click('▶ play')
await wait(500)
rows = await cards()
check('play lights the first row', rows[0].live === true)

await page.evaluate(() => {
  for (let i = 0; i < 240; i++) window.vf?.step()
})
await wait(200)
// See the header: a click forces the store re-read that throttled rAF is not
// delivering.
await click('↻ loop')
await wait(300)
const fill = await page.evaluate(() => {
  const i = document.querySelector('[data-index] i')
  return i === null ? null : getComputedStyle(i).transform
})
const scale = fill === null ? -1 : Number(fill.slice(7).split(',')[0])
check('the hold bar tracks the frame counter', scale > 0.01, `scaleX(${scale})`)

await click('■ stop')
await wait(300)

// --- the drag --------------------------------------------------------------
const before = (await cards()).map(r => r.hold)
const boxes = await page.evaluate(() =>
  [...document.querySelectorAll('[data-index]')].map(c => {
    const r = c.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 14 }
  }),
)
await page.mouse.move(boxes[0].x, boxes[0].y)
await page.mouse.down()
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(
    boxes[0].x + ((boxes[2].x - boxes[0].x) * i) / 12,
    boxes[0].y,
  )
  await wait(25)
}
await page.mouse.up()
await wait(400)
const after = (await cards()).map(r => r.hold)
check(
  'a drag moves the row it grabbed to where it was dropped',
  after[2] === before[0] && after[0] === before[1],
  `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
)
check(
  'and does not also fire it',
  (await cards()).every(r => !r.live),
)

// --- the music ---------------------------------------------------------------
//
// The rule in one sentence: the track runs while the walk runs. `new Audio()`
// is detached, so there is no element in the DOM to read — but the analyser's
// source node hands it back (`MediaElementAudioSourceNode.mediaElement`), which
// is the playhead without the app exposing anything for a test's benefit.
await page.evaluate(() => {
  // 20 seconds of 440Hz, built here rather than shipped as a fixture: nothing
  // listens to it, only to whether it is playing and where its playhead is.
  const rate = 8000
  const n = rate * 20
  const buf = new ArrayBuffer(44 + n * 2)
  const view = new DataView(buf)
  const ascii = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const v = Math.sin((i / rate) * 440 * 2 * Math.PI) * 8000
    view.setInt16(44 + i * 2, v, true)
  }
  const dt = new DataTransfer()
  dt.items.add(new File([buf], 'tone.wav', { type: 'audio/wav' }))
  const input = document.querySelector('input[type=file][accept*="audio"]')
  if (input === null) return
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
// Named once `play()` resolves, not when the change event was dispatched — so
// this waits for the answer rather than for a duration. See `until`.
const trackLabel = await until(
  () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('button')]
          .map(b => b.textContent ?? '')
          .find(t => t.startsWith('♪')) ?? '',
    ),
  t => t.includes('tone.wav'),
)
check(
  'the tray names the loaded track',
  trackLabel.includes('tone.wav'),
  trackLabel,
)

const head = () =>
  page.evaluate(() => {
    const el = window.vf?.audioState?.input?.mediaElement
    return el === undefined || el === null
      ? null
      : { time: el.currentTime, paused: el.paused }
  })

// Two seconds of playhead, waited for rather than slept through: the assertion
// is still "past one second", and the extra second is the margin the restart
// below is measured against.
const ran = await until(head, h => (h?.time ?? 0) > 2)
check('the track plays, and runs on', (ran?.time ?? 0) > 1, JSON.stringify(ran))

// `restart` sets `currentTime` and calls `play()` in one synchronous body, so
// what is being waited for is the click reaching it — and the playhead going
// *backwards* is the one reading that cannot happen any other way, since it
// only ever climbs while the track runs.
await click('▶ play')
const restarted = await until(head, h => (h?.time ?? 99) < (ran?.time ?? 0))
check(
  'play takes it back to the top, with the walk',
  (restarted?.time ?? 99) < (ran?.time ?? 0),
  `${ran?.time} -> ${restarted?.time}`,
)
check('and leaves it playing', restarted?.paused === false)

await click('■ stop')
const paused = await until(head, h => h?.paused === true)
check('stop pauses it', paused?.paused === true, JSON.stringify(paused))

// --- ●, and what it writes down ---------------------------------------------
//
// The wiring rather than the arithmetic: `automation.test.ts` owns which frame
// an event belongs to, and what a browser is needed for is that a hand on a
// slider ends up on the tape at all — which crosses `useMidi`'s write path,
// App's tap and the recorder, none of which a unit test sees together.
//
// The whole point of tapping `useMidi` is that a *controller* is recorded too,
// and that is the one thing this cannot reach: there is no MIDI device here.
// What it can say is that the store-origin half arrives, and that the two
// halves are the same three lines in the same file.
const bar = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => ({
      text: b.textContent?.trim() ?? '',
      on: b.className.includes('active'),
    })),
  )
await click('● rec')
const rolling = (await bar()).find(b => b.text === '● rec')
check('● lights up and the walk goes with it', rolling?.on === true)
check(
  'and the transport says the rundown is running',
  (await bar()).some(b => b.text === '■ stop'),
)
// A write through the panel while the tape rolls — the ordinary path, not a
// poke at the engine: `writeControl` is what a slider calls and what the tap
// hangs off, so reaching past it would test nothing this arm is about.
await page.evaluate(async () => {
  await new Promise(r => setTimeout(r, 200))
  const hit = [...document.querySelectorAll('input[type="range"]')][0]
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  set?.call(hit, String(Number(hit.max) / 2))
  hit.dispatchEvent(new Event('input', { bubbles: true }))
})
await click('● rec')
const readout = (await bar()).find(b => b.text.startsWith('⏺'))
// A non-zero number, deliberately: this arm rolls the tape for a fraction of a
// second, and a readout that rounds to nearest called that `0s` — a take that
// renders perfectly well, described as nothing, next to a `⎙ render 0s` that
// reads as a button with nothing to do. Found here, and the reason the tray
// rounds durations up.
check(
  'stopping seals a take whose length is the time it rolled',
  readout !== undefined && /^⏺\s*[1-9]\d*s\s*✕$/.test(readout.text),
  readout?.text ?? 'no readout',
)
// The render offers the take rather than the song, which is what says the two
// are wired to each other and not merely both present.
check(
  'and ⎙ offers to render the take that was just performed',
  (await bar()).some(b => /^⎙ render [1-9]\d*s$/.test(b.text)),
  (await bar()).find(b => b.text.startsWith('⎙'))?.text ?? '',
)
// The readout is a discard as well as a fact — the only way to throw a bad take
// away without recording over it.
await click('⏺')
check(
  'and the readout throws the take away when it is asked to',
  !(await bar()).some(b => b.text.startsWith('⏺')),
)

// --- persistence -----------------------------------------------------------
const stored = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('ntsc.js.strip') ?? 'null'),
)
check('the rundown is stored', stored !== null && stored.rows.length === 3)
check(
  'with a seed, so a take can be asked for again',
  typeof stored?.seed === 'number' && stored.seed > 0,
  String(stored?.seed),
)
check(
  'and each row carries a session a link would accept',
  (stored?.rows ?? []).every(
    r => typeof r.session === 'string' && r.session !== '',
  ),
)

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(fail.length === 0 ? '\ntray ok' : `\n${fail.length} failed`)
process.exit(fail.length === 0 ? 0 : 1)
