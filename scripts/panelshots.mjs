// Visual regression for the control panel: seven states — five of the panel
// and two dialogs — screenshotted and diffed against committed baselines.
//
//   node scripts/panelshots.mjs            compare, exit 1 on drift
//   node scripts/panelshots.mjs --update   rewrite the baselines
//   node scripts/panelshots.mjs --url http://localhost:5173
//
// Why this exists. The panel is ~1000 CSS declarations across 27 modules, and
// the refactors it invites — hoist a rule, drop one the UA already draws, share
// a primitive — are all the kind that either change nothing or change one
// surface nobody had open. Nothing here could tell the difference. A textarea
// lost its border to exactly that class of edit and was caught only because
// somebody happened to look at it, which is not a test.
//
// The diff runs in the page rather than in Node: comparing two PNGs needs a
// decoder, and there is a whole browser already open with one. Both images go
// in as data URIs, onto canvases, and come back as a count of pixels that moved
// by more than a channel or two.
//
// Firefox Nightly, not Chrome — same reason as every other harness here (see
// CLAUDE.md). Deliberately not part of `pnpm test`: it wants a GPU and a
// display. And the baselines are this machine's font rendering, so a first run
// somewhere else will differ everywhere at once; that reads as "regenerate",
// not as a regression, and --update is how.

import puppeteer from 'puppeteer-core'

// Boot waited for rather than slept through — see until.mjs.
import { appUp } from './until.mjs'

import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const UPDATE = process.argv.includes('--update')
const argUrl = process.argv.indexOf('--url')
const PORT = 5198
const SHOTS = join(dirname(import.meta.dirname), 'scripts', 'panelshots')

// Above a couple of channels is a real change; below it is antialiasing on the
// same glyph. The gate is on how *many* pixels moved, not how far: a dropped
// border moves a thin line a long way, a changed padding moves everything a
// little, and both clear 0.2% of a 332px-wide shot comfortably.
const CHANNEL_TOLERANCE = 6
const MAX_MOVED = 0.002

// Each state names what it is for, so a failure says which surface broke rather
// than which number changed. `open` names sections to unfold; `reach` is a
// function run in the page for anything a fold cannot get to.
//
// The last two are dialogs, and they are not an afterthought: the regression
// that prompted all of this was a textarea inside one, and a suite of panel
// states would have sailed straight past it. A dialog is exactly the surface
// that is never open while you are editing the CSS.
const STATES = [
  {
    name: 'masthead',
    height: 95,
    what: 'the chrome button family, the look bar, the catalog handle',
  },
  {
    name: 'presets',
    height: 300,
    what: 'the filled chip family and the section header',
  },
  {
    name: 'rest',
    height: 950,
    what: 'every section header and the chain map, folded',
  },
  {
    name: 'input',
    height: 420,
    what: 'the native selects and the A/B/♪ rows',
    open: ['Input'],
  },
  {
    name: 'controls',
    height: 640,
    what: 'slider rows — track, readout, badges, the ⋮ and the ? ',
    open: ['Sound into'],
  },
  {
    name: 'stage',
    height: 700,
    what: 'an open stage — its rail, the lid across the head, and a group below',
    // The one state that is not a fold, and the surface with the most CSS per
    // pixel in the panel: a stage's box is drawn by three rules in two files
    // and nothing else on screen looks like it. It got here the way it always
    // does — the map is the only way in — and the boxes are SVG groups rather
    // than buttons, so `textContent` on one runs its <title> into its label and
    // the name has to be read off the <text> child. Uppercased in CSS and not
    // in the DOM, which is why this matches "Tape" rather than "TAPE".
    reach: () => {
      const box = [...document.querySelectorAll('g[role="button"]')].find(
        g => g.querySelector('text')?.textContent.trim() === 'Tape',
      )
      box?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    },
  },
  {
    name: 'help-dialog',
    dialog: true,
    what: 'the dialog card, its prose and heads, links, and a flush .btn row',
    // the wordmark is the help trigger
    reach: () => {
      document.querySelector('img[alt=""]')?.closest('button')?.click()
    },
  },
  {
    name: 'teletype-dialog',
    dialog: true,
    what: 'the skinned textarea, the tab pair, the mosaic chips and the tools',
    // Two steps, because the card editor only exists once the source is one.
    // React tracks the value on the node itself, so assigning through the
    // prototype setter is what makes it see a real change — a plain
    // `select.value = x` fires the event and changes nothing.
    reach: () => {
      // Not the first select on the page: the masthead's morph-duration
      // picker is one too, and sits earlier in the DOM.
      const s = [...document.querySelectorAll('select')].find(sel =>
        [...sel.options].some(o => /teletype/i.test(o.textContent)),
      )
      const opt = [...s.options].find(o => /teletype/i.test(o.textContent))
      const set = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set
      set.call(s, opt.value)
      s.dispatchEvent(new Event('change', { bubbles: true }))
    },
    then: () => {
      const b = [...document.querySelectorAll('button')].find(b =>
        /edit|card|type/i.test(b.title ?? ''),
      )
      b?.click()
    },
  },
]

let vite = null
let base = argUrl > 0 ? process.argv[argUrl + 1] : null
if (base === null) {
  vite = spawn(
    'node',
    ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore' },
  )
  base = `http://localhost:${PORT}`
  for (let i = 0; ; i++) {
    try {
      await fetch(base)
      break
    } catch {
      if (i > 40) throw new Error('vite never came up')
      await new Promise(r => setTimeout(r, 250))
    }
  }
}

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})

const fails = []
const report = []
try {
  const page = await browser.newPage()
  // DPR 1 and a fixed viewport: the panel is a fixed 332px here, and a scaled
  // shot only adds resampling noise to the diff.
  await page.setViewport({ width: 1352, height: 950, deviceScaleFactor: 1 })

  for (const state of STATES) {
    // A fresh page per state. Sections remember whether they were open, so
    // reusing one would make each shot depend on the order of the ones before.
    await page.goto(base, { waitUntil: 'load' })
    await appUp(page, 3500)
    // Park the pointer clear of the panel. Headed Firefox puts the real cursor
    // wherever the WM left it, and over a preset chip that swaps the caption
    // for that preset's blurb — one line becoming up to five, under a shot
    // that is supposed to be of the resting panel.
    await page.mouse.move(400, 900)
    await new Promise(r => setTimeout(r, 800))

    if (state.open !== undefined) {
      await page.evaluate(titles => {
        for (const t of titles) {
          const b = [...document.querySelectorAll('button')].find(
            b =>
              b.textContent.trim().startsWith(t) &&
              b.getAttribute('aria-expanded') === 'false',
          )
          b?.click()
        }
      }, state.open)
      await new Promise(r => setTimeout(r, 900))
    }
    // A step that throws is this state failing, not the run failing. These are
    // navigation written against a UI that moves — a control changes shape and
    // the line that reached for it throws in the page — and an uncaught one
    // takes the whole suite down from wherever it happens to sit in the list,
    // so the states after it are never shot and the ones before it never get
    // reported. Recorded like any other miss instead, and the run carries on.
    let reached = true
    for (const step of [state.reach, state.then]) {
      if (step === undefined) continue
      try {
        await page.evaluate(step)
      } catch (e) {
        fails.push(`${state.name}: could not get to it — ${e.message}`)
        reached = false
        break
      }
      await new Promise(r => setTimeout(r, 1200))
    }
    if (!reached) continue

    // A dialog is in the top layer and centred, so it is measured rather than
    // clipped to the panel — and it is the whole subject of its own shot.
    const box = await page.evaluate(
      (h, wantDialog) => {
        const target = wantDialog
          ? document.querySelector('dialog[open] > *')
          : [...document.querySelectorAll('div')].find(
              d =>
                getComputedStyle(d).overflowY === 'auto' &&
                d.scrollHeight > 400,
            )
        if (target === null || target === undefined) return null
        const r = target.getBoundingClientRect()
        if (r.width < 40 || r.height < 40) return null
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: wantDialog ? Math.round(r.height) : Math.min(h, r.height),
        }
      },
      state.height ?? 0,
      state.dialog === true,
    )
    if (box === null) {
      fails.push(
        `${state.name}: ${state.dialog === true ? 'no open dialog' : 'no panel'} on the page`,
      )
      continue
    }

    const shot = await page.screenshot({ clip: box, encoding: 'base64' })
    const file = join(SHOTS, `${state.name}.png`)

    if (UPDATE) {
      mkdirSync(SHOTS, { recursive: true })
      writeFileSync(file, Buffer.from(shot, 'base64'))
      report.push(`  ${state.name.padEnd(9)} written — ${state.what}`)
      continue
    }

    let baseline
    try {
      baseline = readFileSync(file).toString('base64')
    } catch {
      fails.push(`${state.name}: no baseline (run with --update)`)
      continue
    }

    const diff = await page.evaluate(
      async (a, b, tol) => {
        const load = src =>
          new Promise((res, rej) => {
            const img = new Image()
            img.onload = () => res(img)
            img.onerror = rej
            img.src = `data:image/png;base64,${src}`
          })
        const [imgA, imgB] = await Promise.all([load(a), load(b)])
        if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
          return {
            resized: `${imgB.width}x${imgB.height} -> ${imgA.width}x${imgA.height}`,
          }
        }
        const px = img => {
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const g = c.getContext('2d', { willReadFrequently: true })
          g.drawImage(img, 0, 0)
          return g.getImageData(0, 0, img.width, img.height).data
        }
        const [pa, pb] = [px(imgA), px(imgB)]
        let moved = 0
        let worst = 0
        for (let i = 0; i < pa.length; i += 4) {
          const d = Math.max(
            Math.abs(pa[i] - pb[i]),
            Math.abs(pa[i + 1] - pb[i + 1]),
            Math.abs(pa[i + 2] - pb[i + 2]),
          )
          if (d > worst) worst = d
          if (d > tol) moved++
        }
        return { moved, total: pa.length / 4, worst }
      },
      shot,
      baseline,
      CHANNEL_TOLERANCE,
    )

    if (diff.resized !== undefined) {
      fails.push(`${state.name}: size changed ${diff.resized} — ${state.what}`)
      writeFileSync(
        join(SHOTS, `${state.name}.actual.png`),
        Buffer.from(shot, 'base64'),
      )
      continue
    }
    const frac = diff.moved / diff.total
    const line = `  ${state.name.padEnd(9)} ${(frac * 100).toFixed(3)}% moved (worst channel ${diff.worst})`
    if (frac > MAX_MOVED) {
      fails.push(
        `${state.name}: ${(frac * 100).toFixed(3)}% of pixels moved — ${state.what}`,
      )
      writeFileSync(
        join(SHOTS, `${state.name}.actual.png`),
        Buffer.from(shot, 'base64'),
      )
      report.push(`${line}  <-- written to ${state.name}.actual.png`)
    } else {
      report.push(line)
    }
  }
} finally {
  await browser.close()
  vite?.kill()
}

console.log(report.join('\n'))
if (fails.length > 0) {
  console.error('\nFAIL (panelshots)')
  for (const f of fails) console.error('  -', f)
  console.error(
    '\nIf the change was intended: node scripts/panelshots.mjs --update',
  )
  process.exit(1)
}
if (!UPDATE) {
  const n = readdirSync(SHOTS).filter(
    f => f.endsWith('.png') && !f.includes('.actual.'),
  ).length
  console.log(`panelshots ok — ${n} baselines`)
}
