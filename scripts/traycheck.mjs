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
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 900 })
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await new Promise(r => setTimeout(r, 6000))

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
      hold: c.querySelectorAll('button')[1]?.textContent,
      arrive: c.querySelectorAll('button')[2]?.textContent,
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
await click('strip')
await wait(400)
for (const preset of ['vhs', 'broadcast', 'neon tube']) {
  await click(preset, true)
  // Deliberately *inside* the look bar's default 1s morph. A capture taken
  // mid-morph must bank where the look is going, not the frame it has reached —
  // "a tween is a frame, not a look", the rule useMix.banked() already follows.
  // Before that fix this arm was flaky and recorded half-way boards.
  await wait(350)
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
  card?.querySelectorAll('button')[5]?.click() // the ✕
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
  card?.querySelectorAll('button')[4]?.click() // the ⧉
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
      // The ✎ is the third chip in the feet.
      card?.querySelectorAll('button')[3]?.click()
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
const stepNth = (i, button, times) =>
  page.evaluate(
    (index, which, n) => {
      const card = document.querySelectorAll('[data-index]')[index]
      for (let k = 0; k < n; k++)
        card?.querySelectorAll('button')[which]?.click()
    },
    i,
    button,
    times,
  )
await stepNth(0, 1, 2)
await stepNth(0, 2, 1)
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
