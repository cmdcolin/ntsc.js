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
//  - the stabs row reads what the gate is running at, and the freeze pins that
//    at 0 — so with ❚❚ down the slider snapped back to 0 wherever it was
//    dragged, wrote nothing to the engine, and said nothing about why
//  - the popout window portaled into the app shell and so inherited its phone
//    rule, which stacks the halves into a column; in a column the cross axis is
//    width, where the panel's `margin-inline: auto` cancels the stretch it took
//    its width from, and a 340px popout laid the panel out 0px wide

import puppeteer from 'puppeteer-core'

// A headed window that gets covered stops being drawn — see frames.mjs.
import { watchFrames } from './frames.mjs'
// Boot waited for rather than slept through — see until.mjs.
import { appUp } from './until.mjs'

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
    await appUp(page, 5000)
    await watchFrames(page, { label: 'panelcheck' })
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
  // The same button as strip(), however it reads: with the stab gate running it
  // carries a rate too ("0∿ 4/s"), which the count-only pattern above misses.
  const stripText = () => [...document.querySelectorAll('button')]
    .map(b => b.textContent ?? '').find(t => t.includes('∿')) ?? null
  // A box on the chain map, by the name it opens.
  const stage = name => [...document.querySelectorAll('svg[aria-label="signal chain"] g[role=button]')]
    .find(g => (g.getAttribute('aria-label') ?? '').startsWith(name))
  // A slider row by its visible label — the row's own <label for>, which is the
  // one handle on it that isn't a hashed class name.
  const rowFor = name => [...document.querySelectorAll('input[type=range]')]
    .find(i => [...document.querySelectorAll('label[for="' + CSS.escape(i.id) + '"]')]
      .map(l => l.textContent).join('').trim() === name)
  // React listens for input events on its own value setter, so the native one
  // has to be called through the prototype or the change never reaches state.
  const setRange = (input, v) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
      .set.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
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
  // Ten boxes that open: the five trunk stages, the three that hang under them
  // — input B, the sound and the view, none of which is a Phase — and the two
  // that hang off nothing at all, drawn on a free row below the branches: the
  // modulation bay and the deck. B is on out of the box so the mixer opens too;
  // the sound is *not* picked and its box still opens, because its picker is the
  // first thing inside it and patching one in is the whole reason to press it.
  // Mix is the one box that can stop opening — with B off it holds nothing but
  // controls that cannot act and there is no picker for "a second signal" — and
  // then this count drops to nine.
  //
  // It said six trunk stages and nine boxes while there were five and eight,
  // which is the shape of a count that has been wrong since the FEEDBACK box
  // came off the trunk: the number was right, the reason was not, and the two
  // came back into agreement by accident when the bay arrived on the map.
  check(
    cleared.stages.length === 10,
    `the map came back with ${cleared.stages.length} stages: ${cleared.stages}`,
  )
  // The two inputs are peers on the map, and the mixer is a box of its own. All
  // three were one box called Mix hanging off a wire tagged 'B'.
  for (const name of ['Source A', 'Source B', 'Mix', 'Modulation'])
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

// --- the fps stat is read only while something is looking at it -------------
// The loop reports the frame rate every fifteen frames and each report is a
// fresh object, so a reader that stays attached re-renders the whole app four
// times a second for a readout that is off by default and not persisted — the
// monitor perturbing the very thing it exists to measure.
//
// This phase used to prove that by reading `window.vf.onStats` and asserting the
// app swapped a real handler in when the readout opened. It no longer can, and
// the assertion sat failing for exactly that reason: the readout was moved onto
// a store (`subscribeStats` / `getStats` — pipeline.ts), and `onStats` is now
// the vote page's alone. A store is *subscribed by nobody* when nothing is
// mounted, so the invariant is no longer a handler swap to catch — it is the
// mount itself, and `FpsMonitor` calling `useSyncExternalStore` is the whole of
// it. So the checks below are the mount, plus the inverted form of the old one:
// `onStats` must stay a no-op even with the readout open, because going back to
// the callback is the regression that caused the problem in the first place.
//
// Deliberately *not* asserting the readout reaches a number above zero: rAF is
// throttled in an occluded window and `vf.step()` renders directly rather than
// through the loop that reports, so a backgrounded run reads "0 fps" however
// healthy the wiring.
await phase('fps stat', {}, async page => {
  const { run, settle } = runner(page)
  const handler = () => page.evaluate(() => String(window.vf.onStats))
  const noop = s => s.replace(/\s/g, '') === '()=>{}'
  // The readout, which carries the rate and — under a frame lock — a ·½ marker
  // after it, so this matches the number and lets the rest be.
  const readout = () =>
    run(`
    const el = [...document.querySelectorAll('span')]
      .find(s => /^\\d+ fps\\b/.test(s.textContent ?? ''))
    return el?.textContent ?? null`)

  check(
    (await readout()) === null,
    'the fps readout drew before it was asked for',
  )
  const off = await handler()
  check(
    noop(off),
    `frame stats are wired with the readout closed: ${off.slice(0, 60)}`,
  )

  await run(`press(byTitle('menu (s: still')); return 0`)
  await settle(400)
  await run(`press(byPart('show fps')); return 0`)
  await settle(800)
  check(
    (await readout()) !== null,
    'the fps readout did not appear from the ☰ menu',
  )
  const on = await handler()
  check(
    noop(on),
    `the readout is back on the onStats callback, which re-renders the whole panel four times a second: ${on.slice(0, 60)}`,
  )

  await run(`press(byTitle('hide the fps monitor')); return 0`)
  await settle(500)
  check(
    (await readout()) === null,
    'dismissing the readout left it mounted, so it is still subscribed',
  )
})

// --- the popout window, which is a shell of its own -------------------------
// --- the stab gate answers its own row --------------------------------------
//
// The one row in the bay whose reading is not the thing you dragged: it shows
// what the gate is *running* at, which the freeze and a beat lock both have a
// say in. That is worth having, and it is also how the row came to sit at 0
// however far it was dragged — so what this pins is that every state the row can
// be in is one the panel can get back out of.
//
// Panel-only on purpose, like everything else here: whether the picture actually
// cuts in and out at the dialed rate is a question for a harness with a canvas
// probe in it, not for the one that checks what the panel renders.
await phase('stab', {}, async page => {
  const { run, settle } = runner(page)
  await run(`press(stage('Modulation')); return 0`)
  await settle(700)

  const gate = () =>
    run(`
      const row = rowFor('stabs')
      return {
        reads: row?.value ?? null,
        disabled: row?.disabled ?? null,
        engine: window.vf?.stab?.hz ?? null,
        strip: stripText(),
        frozen: byTitle('let the motion run again') !== undefined,
      }`)

  const missing = await run(`return rowFor('stabs') === undefined`)
  check(!missing, 'the Modulation box opened without a stabs row in it')
  if (missing) return

  await run(`setRange(rowFor('stabs'), 4); return 0`)
  await settle(400)
  const on = await gate()
  check(on.reads === '4', `the stabs row read ${on.reads} after being set to 4`)
  check(on.engine === 4, `the engine's gate is at ${on.engine}, not 4`)
  check(
    on.strip === '0∿ 4/s',
    `the motion strip read "${on.strip}" with the gate at 4/s`,
  )

  // ❚❚ stops the gate outright rather than scaling it — half a stab is just a
  // shorter stab, and the length is already a knob.
  await run(`press(byTitle('hold everything still')); return 0`)
  await settle(400)
  const held = await gate()
  check(held.frozen, 'the freeze did not take')
  check(
    held.engine === 0,
    `a frozen bay left the gate running at ${held.engine}`,
  )
  check(
    held.strip === '0∿',
    `the strip claimed "${held.strip}" while the freeze held the gate at 0`,
  )

  // The regression: the row reads the resolved rate, so while the freeze pinned
  // that at 0 the slider snapped back to 0 wherever it was dragged and the
  // engine never heard about it — a dead control with nothing on it saying why.
  // Dialing the gate on is an unambiguous ask, so it lifts the freeze, the same
  // rule a claim and a restart in the bay already follow.
  await run(`setRange(rowFor('stabs'), 8); return 0`)
  await settle(400)
  const again = await gate()
  check(
    again.reads === '8',
    `dragging the stabs row while frozen left it reading ${again.reads}`,
  )
  check(
    again.engine === 8,
    `the engine's gate is at ${again.engine} after the row was dragged to 8`,
  )
  check(
    !again.frozen,
    'dialing the gate on left the freeze down, so the row it just answered does nothing',
  )
})

// --- the motion roll: the one verb in the look bar that moves no slider ------
//
// Every claim here is one the unit tests are structurally blind to, because each
// is about the app as a whole rather than about the roll: rollMod.test.ts can
// say what a rolled bay contains, and only a running board can say that pressing
// the button left the look alone and that the walk can take it back.
await phase('motion roll', {}, async page => {
  const { run, settle } = runner(page)

  const before = await page.evaluate(() => window.vf.getControls())
  const rolled = await run(`
    const b = byPart('random motion')
    press(b)
    return b !== undefined`)
  await settle(500)
  const after = await run(`return {
    strip: stripText(),
    controls: window.vf.getControls(),
  }`)
  check(rolled === true, 'no "random motion" button in the look bar')
  check(
    after.strip === '2∿',
    `a normal motion roll should cable two routings, the strip read ${after.strip}`,
  )
  // The promise on the button, and the reason it is a third roll rather than a
  // mode of the nudge: a routing swings a control inside the engine's own frame
  // and puts it back, so the resting board must come out of this identical.
  const moved = Object.keys(before).filter(k => before[k] !== after.controls[k])
  check(
    moved.length === 0,
    `the motion roll moved resting controls, which it must never do: ${moved.slice(0, 6).join(', ')}`,
  )

  // Twice, then back twice. This is the dedupe: the walk compares looks by their
  // controls, which a motion roll does not touch, so without the bay in the test
  // on this one path the second roll banks nothing and the first is the only one
  // undo can reach.
  await run(`press(byPart('random motion')); return 0`)
  await settle(500)
  const second = await run(`return stripText()`)
  check(
    second === '2∿',
    `a second roll should leave two routings patched, the strip read ${second}`,
  )
  await run(`press(byText('undo')); return 0`)
  await settle(500)
  const back = await run(`return stripText()`)
  check(
    back === '2∿',
    `one undo should land on the first roll's bay, the strip read ${back}`,
  )
  await run(`press(byText('undo')); return 0`)
  await settle(500)
  const empty = await run(`return stripText()`)
  check(
    empty === null || empty === '0∿',
    `undoing both rolls should leave the bay as it started, the strip read ${empty}`,
  )
})

// --- reset: the one verb that has to reach every part of a look at once ------
//
// Three stores answer to it — the engine's controls, React's bay, and the gate —
// and no unit test can see all three at the same time. What it must leave alone
// is here for the same reason: the magnifier is a control like any other to
// everything below the look bar, and only a running app can say the button did
// not move it.
await phase('reset', {}, async page => {
  const { run, settle } = runner(page)

  // What the app boots on with no link and no stored look, which is what stock
  // means — read from the running engine rather than imported, so this compares
  // against the board the user would actually be handed.
  const stock = await page.evaluate(() => window.vf.getControls())

  // Aimed by hand, through the row rather than through the engine: the reset
  // reads the board React holds, so a write that skipped it would be testing
  // nothing. Its own travel is curved, so the midpoint of the input is asked for
  // and whatever came back is what has to survive.
  await run(`press(byTitle('filter the controls')); return 0`)
  await settle(300)
  await page.type('input[type="search"]', 'magnifier')
  await settle(600)
  await run(`
    const row = rowFor('magnifier')
    if (row !== undefined) setRange(row, (Number(row.min) + Number(row.max)) / 2)
    return 0`)
  await settle(400)
  await run(`press(byTitle('clear the filter')); return 0`)
  await settle(400)
  const aimed = await page.evaluate(() => window.vf.getControls().crtZoom)
  check(
    aimed !== stock.crtZoom,
    'could not move the magnifier off stock, so nothing below says the reset left it alone',
  )

  await run(`press(byPart('random nudge')); return 0`)
  await settle(300)
  await run(`press(byPart('random motion')); return 0`)
  await settle(300)
  await run(`press(stage('Modulation')); return 0`)
  await settle(700)
  await run(`setRange(rowFor('stabs'), 4); return 0`)
  await settle(400)

  const wrecked = await run(`return {
    strip: stripText(),
    gate: window.vf?.stab?.hz ?? null,
  }`)
  check(
    wrecked.strip === '2∿ 4/s',
    `the board should be rolled and stabbing before the reset, the strip read "${wrecked.strip}"`,
  )
  check(wrecked.gate === 4, `the gate is at ${wrecked.gate}, not 4`)

  const pressed = await run(`
    const b = byText('reset')
    press(b)
    return b !== undefined`)
  await settle(600)
  const after = await run(`return {
    strip: stripText(),
    gate: window.vf?.stab?.hz ?? null,
    controls: window.vf.getControls(),
  }`)
  check(pressed === true, 'no "reset" button in the look bar')
  check(
    after.strip === null || after.strip === '0∿',
    `the reset left the bay reading "${after.strip}"`,
  )
  check(after.gate === 0, `the reset left the gate running at ${after.gate}`)
  check(
    after.controls.crtZoom === aimed,
    `the reset moved the magnifier from ${aimed} to ${after.controls.crtZoom} — where you are looking is not part of the look`,
  )
  const off = Object.keys(after.controls).filter(
    k => k !== 'crtZoom' && after.controls[k] !== stock[k],
  )
  check(
    off.length === 0,
    `the reset left controls off stock: ${off.slice(0, 6).join(', ')}`,
  )

  // One step, not three: everything the button wiped comes back together, which
  // is the whole reason the gate rides the walk with the bay.
  await run(`press(byText('undo')); return 0`)
  await settle(600)
  const back = await run(`return {
    strip: stripText(),
    gate: window.vf?.stab?.hz ?? null,
  }`)
  check(
    back.strip === '2∿ 4/s',
    `one undo should bring the whole look back, the strip read "${back.strip}"`,
  )
  check(back.gate === 4, `undo left the gate at ${back.gate} rather than 4`)
})

// The panel renders in two documents, and only one of them has a picture in it.
// Everything responsive in app.module.css describes the *shell* — a sidebar
// beside or under a stage — and the popout is the panel alone in a window
// somebody dragged to a size, so none of it may reach there. Both halves are
// checked, because scoping a rule too far is as wrong as not scoping it: the
// docked panel still has to stack under the picture in portrait.
await phase('popout', {}, async page => {
  const { run, settle } = runner(page)

  const shell = target =>
    target.evaluate(() => {
      const panel = document.querySelector('[class*=panel_]')
      const bench = document.querySelector('[class*=bench_]')
      return {
        win: window.innerWidth,
        panelW: Math.round(panel?.getBoundingClientRect().width ?? -1),
        dir: getComputedStyle(panel?.parentElement ?? document.body)
          .flexDirection,
        cols: bench
          ? getComputedStyle(bench).gridTemplateColumns.split(' ').length
          : 0,
      }
    })

  // The docked panel first, and it has to be first: popping out unmounts it, so
  // there is no second chance at this from the far side of the check. Scoping a
  // rule too far is as wrong as not scoping it, and this is the half that says
  // the shell rules still reach the shell.
  await page.setViewport({ width: 420, height: 900 })
  await settle(900)
  const docked = await shell(page)
  check(
    docked.dir === 'column',
    'the docked panel did not stack under the picture in portrait — the shell rules are scoped past it',
  )
  check(
    docked.panelW === docked.win,
    `the stacked panel is ${docked.panelW}px in a ${docked.win}px window`,
  )
  await page.setViewport({ width: 1352, height: 900 })
  await settle(700)

  // A fresh Firefox profile per phase means an empty localStorage, so the bench
  // flag starts off and the popout opens at one column — which is the width the
  // bug appeared at.
  await run(`press(byTitle('menu (s: still')); return 0`)
  await settle(400)
  await run(`press(byPart('pop out controls')); return 0`)
  await settle(2500)

  const pages = await page.browser().pages()
  const pop = pages.at(-1)
  await new Promise(r => setTimeout(r, 1200))

  // No canvas in this document, so no second WebGPU session is spent on it.
  const one = await shell(pop)
  check(
    one.panelW === one.win,
    `the popout panel does not fill its window: ${one.panelW}px of ${one.win}px — a shell media query has reached it`,
  )
  check(
    one.dir === 'row',
    `the popout laid out as a ${one.dir}, which is the portrait rule: in a column the cross axis is width, and there margin-inline collapses the panel to 0`,
  )

  // Switching the bench on from inside asks the window for the room two columns
  // need. Without that the toggle reads as doing nothing: the container query
  // folds them straight back at one-column width.
  await pop.evaluate(`(() => {${HELPERS}
    press(byTitle('menu (s: still'))
  })()`)
  await settle(400)
  await pop.evaluate(`(() => {${HELPERS}
    press(byPart('wide bench'))
  })()`)
  await settle(1600)

  const two = await shell(pop)
  check(
    two.win > one.win,
    `the bench went on but the popout stayed ${two.win}px wide, so the columns fold straight back`,
  )
  check(
    two.cols === 2,
    `the bench in the popout came out in ${two.cols} column(s) at ${two.panelW}px`,
  )
})

if (fails.length) {
  console.error('FAIL (panelcheck)')
  for (const f of fails) console.error('  -', f)
  process.exit(1)
}
console.log('PASS (panelcheck)')
