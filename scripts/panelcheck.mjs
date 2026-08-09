// Drives the control panel and checks the things only a real browser can answer
// — the class of bug the unit tests are structurally blind to, because every one
// of them is about what the panel *renders* and what has focus.
//
//   npx vite --port 5371 --strictPort
//   node scripts/panelcheck.mjs [url]
//
// Firefox Nightly, not Chrome: same reason as every other harness here (see
// CLAUDE.md). Serve it from a `git worktree add --detach` copy if anything else
// might be editing the tree — an HMR reload mid-run remounts the panel under the
// assertions and every later probe reads a different app.
//
// Wants the **dev server**: one check reads back which handler the app put on
// the engine, which only says anything unminified.
//
// Each check below is a regression that shipped:
//
//  - a query matching nothing drew the chain map anyway, over a stage list with
//    nothing in it, so the wires came out at x="NaN"
//  - …under a door offering to open "0 of them", directly above the panel's own
//    "nothing matches" line
//  - the filter box focused itself from an inline ref callback, so it stole
//    focus back on every re-render — four times a second, from the fps stat
//  - the fps stat was wired whether or not anything read it, which is what made
//    that four times a second
//  - `remove` in a row's modulation editor left the editor up claiming the bay
//    was full, having just freed a slot in it
//  - a routing could be removed but not held, so there was no way to hear the
//    picture without one wobble and then have it back

import puppeteer from 'puppeteer-core'

const url = new URL(process.argv[2] ?? 'http://localhost:5371/')
const fails = []
const check = (ok, msg) => {
  if (!ok) fails.push(msg)
}

// One browser per phase, and one WebGPU session per browser. A page driven
// through several — a reload counts — detaches its frame partway, and every
// evaluate after that dies with "Attempted to use detached Frame", which reads
// exactly like the panel having crashed.
const phase = async (name, { seed = null, query = '' } = {}, body) => {
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
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1352, height: 900 })
    page.on('pageerror', e =>
      fails.push(`${name}: pageerror: ${String(e).slice(0, 200)}`),
    )
    if (seed !== null) {
      // localStorage is per origin, so it has to be written from a loaded page
      // before the one under test.
      await page.goto(url.href, { waitUntil: 'networkidle0' })
      await page.evaluate(
        s => localStorage.setItem('video_feedback_mod', s),
        JSON.stringify(seed),
      )
    }
    await page.goto(`${url.href}${query}`, { waitUntil: 'networkidle0' })
    // Park the pointer clear of the preset chips: a stray hover swaps the
    // caption and a stray press applies a preset, either of which quietly
    // measures a different app than the one the check names.
    await page.mouse.move(400, 500)
    await new Promise(r => setTimeout(r, 5000))
    await page.mouse.move(400, 500)
    await body(page)
  } catch (e) {
    fails.push(`${name}: threw: ${String(e).slice(0, 200)}`)
  } finally {
    await browser.close()
  }
}

// Injected into every evaluate: the panel's class names are CSS-module hashes,
// so everything here addresses buttons by their text or their title.
const HELPERS = `
  const byText = t => [...document.querySelectorAll('button')]
    .find(b => (b.textContent ?? '') === t)
  const byPart = t => [...document.querySelectorAll('button')]
    .find(b => (b.textContent ?? '').includes(t))
  const byTitle = p => [...document.querySelectorAll('button')]
    .find(b => b.title.startsWith(p))
  const press = el => el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const chain = () => document.querySelector('svg[aria-label="signal chain"]')
  const strip = () => [...document.querySelectorAll('button')]
    .find(b => /^\\d+∿$/.test(b.textContent ?? ''))
`
const runner = page => ({
  run: body => page.evaluate(`(() => {${HELPERS}\n${body}})()`),
  settle: (ms = 400) => new Promise(r => setTimeout(r, ms)),
})

// A routing in the shape a session before the run switch existed would have left
// it: no `on` field, which is the back-compat case.
const OLD_BAY = [{ target: 'fbMix', source: 'sine', rateHz: 0.5, depth: 0.4 }]
const HELD_BAY = [{ ...OLD_BAY[0], on: false }]
// What useUrlState would have written for that bay. Passed as a query rather
// than reached by reloading, so this stays one WebGPU session — and it pins the
// mechanism directly: ?mod= wins over the stored bay at load, so the run switch
// has to be re-applied there or a held routing comes back running.
const MOD_QUERY = '?mod=fbMix:sine:0.5:0.4'

// --- the panel, a query that reaches nothing, and where focus lands ----------
await phase('filter', { seed: OLD_BAY }, async page => {
  const { run, settle } = runner(page)

  const start = await run(`return {
    panel: [...document.querySelectorAll('div')]
      .some(d => getComputedStyle(d).overflowY === 'auto' && d.scrollHeight > 400),
    chain: chain() !== null,
    strip: strip()?.textContent ?? null,
  }`)
  check(start.panel, 'no scrolling panel rendered at all')
  check(start.chain, 'the chain map is missing from a resting panel')
  check(
    start.strip === '1∿',
    `a bay stored without the run switch should load running, strip read ${start.strip}`,
  )

  await run(`press(byTitle('filter the controls')); return 0`)
  await settle(300)
  await page.type('input[type="search"]', 'zzzqqq')
  await settle(600)
  const empty = await run(`
    const svg = chain()
    return {
      chain: svg !== null,
      nan: svg === null ? [] : [...svg.querySelectorAll('*')].flatMap(el =>
        [...el.attributes].filter(a => a.value.includes('NaN'))
          .map(a => el.tagName + '.' + a.name)),
      door: document.body.innerText.includes('click a stage'),
      saidSo: document.body.innerText.includes('nothing matches'),
    }`)
  check(!empty.chain, 'a query matching nothing still drew the chain map')
  check(empty.nan.length === 0, `NaN attributes on the map: ${empty.nan}`)
  // The instruction lives on the map's heading now rather than in the empty
  // state below it, so this covers both: with nothing to open, the whole
  // section — heading included — is gone.
  check(!empty.door, 'the "click a stage" cue showed with no stage to open')
  check(empty.saidSo, 'nothing said the query matched nothing')

  // The filter box takes focus on mount and must never take it again: with the
  // box open, an ordinary control write is what a slider drag does per frame.
  await run(`press(byTitle('clear the filter')); return 0`)
  await settle(300)
  await run(`press(byTitle('filter the controls')); return 0`)
  await settle(300)
  await page.type('input[type="search"]', 'ghost')
  await settle(600)
  const focus = await page.evaluate(() => {
    const range = [...document.querySelectorAll('input[type="range"]')].at(-1)
    if (range === undefined) return { skipped: true }
    range.focus()
    const before = document.activeElement?.getAttribute('type')
    const c = window.vf.getControls()
    window.vf.setControl('crtScan', c.crtScan === 0 ? 0.5 : 0)
    return new Promise(res =>
      setTimeout(
        () =>
          res({ before, after: document.activeElement?.getAttribute('type') }),
        250,
      ),
    )
  })
  check(!focus.skipped, 'the filter left no control row to focus')
  check(focus.before === 'range', 'could not put focus on a control row')
  check(
    focus.after === 'range',
    `a control write pulled focus to "${focus.after}" — the filter box is grabbing it back`,
  )

  await run(`press(byTitle('clear the filter')); return 0`)
  await settle(400)
  // Every box on the map that opens. The three feedback runs are pressable too
  // and are not boxes, so they are dropped by the one thing that separates them:
  // a run says what pressing it does, a box names a stage and describes it.
  const cleared = await run(`return {
    chain: chain() !== null,
    stages: [...document.querySelectorAll('svg[aria-label="signal chain"] g[role=button]')]
      .map(g => g.getAttribute('aria-label') ?? '')
      .filter(l => !l.endsWith('open its controls'))
      .map(l => l.split(' — ')[0]),
  }`)
  check(
    cleared.chain,
    'the chain map did not come back when the filter cleared',
  )
  // Nine boxes that open: the six trunk stages, plus the three that hang under
  // them — input B, the sound and the view, none of which is a Phase. B is on
  // out of the box so the mixer opens too; the sound is *not* picked and its box
  // still opens, because its picker is the first thing inside it and patching
  // one in is the whole reason to press it. Mix is the one box that can stop
  // opening — with B off it holds nothing but controls that cannot act and there
  // is no picker for "a second signal" — and then this count drops to eight.
  check(
    cleared.stages.length === 9,
    `the map came back with ${cleared.stages.length} stages: ${cleared.stages}`,
  )
  // The two inputs are peers on the map, and the mixer is a box of its own. All
  // three were one box called Mix hanging off a wire tagged 'B'.
  for (const name of ['Source A', 'Source B', 'Mix'])
    check(
      cleared.stages.includes(name),
      `${name} is missing from the map: ${cleared.stages}`,
    )
})

// --- a routing can be held still from its own row ---------------------------
await phase('hold', { seed: OLD_BAY }, async page => {
  const { run, settle } = runner(page)
  await run(`press(strip()); return 0`) // the ∿ count filters to the driven rows
  await settle(500)
  await run(`press(byText('∿')); return 0`)
  await settle(500)
  const parked = await run(`
    const badge = byText('∿')
    return {
      strip: strip()?.textContent ?? null,
      struck: badge === undefined ? null
        : getComputedStyle(badge).textDecorationLine.includes('line-through'),
    }`)
  check(
    parked.strip === '0∿',
    `holding one routing left the count at ${parked.strip}`,
  )
  check(
    parked.struck === true,
    'a held routing is not marked as held on its row',
  )

  // The switch is coalesced to localStorage like the rest of the bay.
  await settle(1200)
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('video_feedback_mod') ?? '[]'),
  )
  check(stored[0]?.on === false, `the hold was not persisted: ${stored[0]?.on}`)
})

// --- …and it is still held when the link brings the routing back ------------
await phase(
  'held survives the link',
  { seed: HELD_BAY, query: MOD_QUERY },
  async page => {
    const { run, settle } = runner(page)
    const back = await run(`return { strip: strip()?.textContent ?? null }`)
    check(
      back.strip === '0∿',
      `?mod= cleared the hold on load — strip read ${back.strip}`,
    )

    await run(`press(strip()); return 0`)
    await settle(500)
    await run(`press(byText('∿')); return 0`)
    await settle(500)
    const restarted = await run(
      `return { strip: strip()?.textContent ?? null }`,
    )
    check(
      restarted.strip === '1∿',
      `restarting a held routing left the count at ${restarted.strip}`,
    )

    // remove folds the editor rather than leaving it claiming the bay is full.
    await run(`press(byTitle('more for')); return 0`)
    await settle(400)
    await run(`press(byPart('driving it')); return 0`)
    await settle(500)
    const editorUp = await run(`return {
    open: byText('remove') !== undefined,
    holdable: document.body.innerText.includes('hold still'),
  }`)
    check(editorUp.open, 'the ⋮ did not open the row editor')
    check(
      editorUp.holdable,
      'the row editor offers no way to hold the routing still',
    )

    await run(`press(byText('remove')); return 0`)
    await settle(500)
    const afterRemove = await run(`return {
    busy: document.body.innerText.includes('modulation slots are busy'),
    editor: byText('remove') !== undefined,
  }`)
    check(!afterRemove.busy, 'remove left the row claiming every slot is busy')
    check(
      !afterRemove.editor,
      'remove left the editor open with nothing to edit',
    )
  },
)

// --- the fps stat is wired only while something reads it --------------------
// The loop reports the frame rate every fifteen frames and each report is a
// fresh object, so leaving the callback wired re-renders the whole app four
// times a second for a readout that is off by default and not persisted.
//
// Which handler is on the engine is the direct evidence. Deliberately *not*
// asserting the readout reaches a number above zero: rAF is throttled in an
// occluded window and `vf.step()` renders directly rather than through the loop
// that reports, so a backgrounded run reads "0 fps" however healthy the wiring.
await phase('fps stat', {}, async page => {
  const { run, settle } = runner(page)
  const handler = () => page.evaluate(() => String(window.vf.onStats))
  const noop = s => s.replace(/\s/g, '') === '()=>{}'

  const off = await handler()
  check(
    noop(off),
    `frame stats are wired with the readout closed: ${off.slice(0, 60)}`,
  )

  await run(`press(byTitle('menu (s: still')); return 0`)
  await settle(400)
  await run(`press(byPart('show fps')); return 0`)
  await settle(800)
  const shown = await run(`
    const el = [...document.querySelectorAll('span')]
      .find(s => /^\\d+ fps$/.test(s.textContent ?? ''))
    return { text: el?.textContent ?? null }`)
  check(shown.text !== null, 'the fps readout did not appear from the ☰ menu')
  const on = await handler()
  check(!noop(on), 'the readout is open and the frame stats are still no-oped')

  await run(`press(byTitle('hide the fps monitor')); return 0`)
  await settle(500)
  const again = await handler()
  check(
    noop(again),
    `dismissing the readout left the stats wired: ${again.slice(0, 60)}`,
  )
})

if (fails.length) {
  console.error('FAIL (panelcheck)')
  for (const f of fails) console.error('  -', f)
  process.exit(1)
}
console.log('PASS (panelcheck)')
