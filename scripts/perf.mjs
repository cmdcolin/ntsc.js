// GPU frame-cost harness: best-of wall-clock over batched vf.step() runs —
// the methodology that replaced the ?prof timestamp profiler (a9bf95f), which
// mis-attributed queue backlog to whichever pass ran first.
//
//   node scripts/perf.mjs <url> <label> [batches] [framesPerBatch]
//   node scripts/perf.mjs <url> <label> --ablate [framesPerBatch] [--rounds=N]
//
// --vp=WxH sets the viewport BEFORE navigation — the one safe moment; after
// load it swaps the BiDi realm and window.vf vanishes (see below). The canvas
// the run actually measured is reported, since layout and dpr decide it.
//
// --ablate attributes cost per pass: it disables one pass at a time by
// overriding its `when` gate, interleaving full and ablated batches in one
// session, and reports each pass's delta. The deltas are not perfectly
// additive (passes overlap on the GPU) but they rank the hot spots honestly.
//
// USE --ablate TO RANK, NOT TO SIZE. Its deltas are the least trustworthy
// number this script prints, and they read like the most precise. crt_face's
// scatter gather was recorded from one at 0.9 ms and is 0.30; the same pass has
// come back anywhere from 0.16 to 1.01 ms across identical runs on a quiet box.
// Two separate reasons, and neither announces itself:
//
//  - Another GPU client shifts whole batches ~0.8 ms while leaving the best
//    alone. A second stepped session costs +3.6 ms here, an idle app tab left
//    presenting +0.17 ms. Both modes now flag this as DISTURBED. Clean sessions
//    spread under 2% across batches, hence the 5% threshold — but it only
//    catches a neighbour that ARRIVES mid-run. One running steadily through the
//    whole session inflates every batch together, the spread stays tight, and
//    nothing here will tell you. Check what else holds a WebGPU tab open first.
//  - The baseline drifts within a session, and a delta is a subtraction against
//    it. Paired per-round subtraction (below) removes that term; what is left
//    still ranges 0.38-0.55 ms on a small pass, so a SHAKY row is marked.
//
// To size a change, build both versions and A/B whole frames, best-of,
// interleaved, one dev server per arm off its own worktree. That method held to
// 0.001 ms over three rounds on a change the ablate delta could not resolve at
// all. `scripts/pixdiff.mjs` is its other half, for what the change costs the
// picture.
//
// Traps, learned the hard way:
// - Never call page.setViewport AFTER navigation under Firefox BiDi — it
//   swaps the realm and every later evaluate sees window.vf undefined.
//   Before goto (as scripts/shot.mjs does) it is safe.
// - One browser per config; a page driven through many WebGPU sessions
//   detaches its frame partway through a run.
// - Serve from a `git worktree add --detach` copy when anyone (or any agent)
//   might touch the tree: an HMR reload mid-run tears the engine down and the
//   remaining batches measure a dead page.
// - For A/B, alternate base and patched runs back to back; session-to-session
//   GPU clock drift is several percent.

import puppeteer from 'puppeteer-core'

const args = process.argv.slice(2)
const ablate = args.includes('--ablate')
const vpArg = args.find(a => a.startsWith('--vp='))
const roundsArg = args.find(a => a.startsWith('--rounds='))
const [url, label, a3, a4] = args.filter(a => !a.startsWith('--'))
// Ablate rounds are how many samples each pass's delta is a best-of. Three is
// enough to rank the hot spots and not enough to trust one row's number against
// another session's — raise it when a specific delta is the point of the run.
const batches = ablate ? Number(roundsArg?.slice(9) ?? 3) : Number(a3 ?? 6)
const frames = Number((ablate ? a3 : a4) ?? 120)
const vp = vpArg ? vpArg.slice(5).split('x').map(Number) : null

if (!url || !label) {
  console.error(
    'usage: node scripts/perf.mjs <url> <label> [--ablate] [batches] [framesPerBatch] [--rounds=N] [--vp=WxH]',
  )
  process.exit(1)
}

// Spread across a run's batches, as a fraction of its fastest. Contention only
// ever adds time, so this is one-sided and the fastest batch is the reference.
const SPREAD_LIMIT = 0.05
const spread = ts =>
  ts.length < 2 ? 0 : (Math.max(...ts) - Math.min(...ts)) / Math.min(...ts)
const disturbed = ts => spread(ts) > SPREAD_LIMIT

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
  page.on('pageerror', err =>
    console.log('[pageerror]', String(err).slice(0, 300)),
  )
  if (vp) await page.setViewport({ width: vp[0], height: vp[1] })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.vf !== undefined, { timeout: 20000 })
  await new Promise(r => setTimeout(r, 2500)) // sources settle

  if (!ablate) {
    const res = await page.evaluate(
      async (batches, frames) => {
        const vf = window.vf
        vf.loop.stop()
        const done = () => vf.gpu.device.queue.onSubmittedWorkDone()
        for (let i = 0; i < 40; i++) vf.step() // pipelines compiled, caches hot
        await done()
        const times = []
        for (let b = 0; b < batches; b++) {
          const t0 = performance.now()
          for (let i = 0; i < frames; i++) vf.step()
          await done()
          times.push((performance.now() - t0) / frames)
        }
        const cv = document.querySelector('canvas')
        return { times, cw: cv?.width ?? 0, ch: cv?.height ?? 0 }
      },
      batches,
      frames,
    )
    const best = Math.min(...res.times)
    const med = [...res.times].sort((x, y) => x - y)[
      Math.floor(res.times.length / 2)
    ]
    console.log(
      `${label}\tbest ${best.toFixed(3)} ms/frame\tmedian ${med.toFixed(3)}\tcanvas ${res.cw}x${res.ch}\tall [${res.times.map(t => t.toFixed(2)).join(', ')}]`,
    )
    if (disturbed(res.times))
      console.log(
        `  ! DISTURBED: batches spread ${(spread(res.times) * 100).toFixed(0)}%, which is not one workload. Usually another GPU client; if it is the FIRST batch that is slow it is more likely the page still settling, so read the list. Contention only adds time, so the best above probably survives either way — the median does not.`,
      )
  } else {
    const res = await page.evaluate(
      async (batches, frames) => {
        const vf = window.vf
        vf.loop.stop()
        const done = () => vf.gpu.device.queue.onSubmittedWorkDone()
        const meas = async () => {
          const t0 = performance.now()
          for (let i = 0; i < frames; i++) vf.step()
          await done()
          return (performance.now() - t0) / frames
        }
        for (let i = 0; i < 40; i++) vf.step()
        await done()
        const groups = [vf.prePasses, vf.loopPasses, vf.postPasses]
        const active = []
        for (const g of groups)
          for (const p of g)
            if (p.when === undefined || p.when()) active.push(p)
        const full = []
        const abl = new Map(active.map(p => [p.label, []]))
        for (let round = 0; round < batches; round++) {
          full.push(await meas())
          for (const p of active) {
            const orig = Object.prototype.hasOwnProperty.call(p, 'when')
              ? p.when
              : undefined
            p.when = () => false
            abl.get(p.label).push(await meas())
            if (orig === undefined) delete p.when
            else p.when = orig
          }
        }
        const fullBest = Math.min(...full)
        return {
          fullBest,
          full,
          rows: active.map(p => {
            const samples = abl.get(p.label)
            // Paired, not best-of-minus-best-of. Each round's ablation is
            // subtracted from the baseline measured moments earlier in the SAME
            // round, so session drift cancels instead of landing in every delta
            // at once. min(full) - min(samples) put all of the baseline's noise
            // into every row: across three identical runs the ABLATED numbers
            // held to ~0.03 ms while the deltas built that way swung 0.16-0.42
            // for one pass, because only fullBest was moving.
            //
            // This fixes the drift term and not the rest. `channel` went from
            // 1.52/1.78/1.74 to 1.77/1.76 run over run, but small passes still
            // range (crtFace 0.38-0.55), and a pass cheaper than the noise can
            // land negative — which is the honest answer, not a bug to hide.
            // Ablation ranks. It does not size. See the note printed below.
            const paired = samples.map((s, r) => full[r] - s)
            const sorted = [...paired].sort((x, y) => x - y)
            return {
              label: p.label,
              delta: sorted[Math.floor(sorted.length / 2)],
              without: Math.min(...samples),
              paired,
            }
          }),
        }
      },
      batches,
      frames,
    )
    console.log(
      `== ${label}  full best ${res.fullBest.toFixed(3)} ms/frame  (all full: ${res.full.map(t => t.toFixed(2)).join(', ')})`,
    )
    // A delta is fullBest minus that pass's best ablated batch, so a pass whose
    // own batches disagree was measured across a disturbance and its row is the
    // one to distrust — the baseline can be clean while a single row is not.
    // Two different complaints, and conflating them sends people to the wrong
    // fix. A spread BASELINE means the run itself was disturbed and nothing in
    // it is safe. A clean baseline with spread ROWS is usually just three
    // samples being three samples — those deltas are low-confidence, and more
    // rounds, not a quieter box, is what buys the confidence back.
    // A row is shaky when its own per-round deltas disagree — that is the thing
    // being reported, so it is the thing to measure the confidence of.
    const shaky = r => Math.max(...r.paired) - Math.min(...r.paired) > 0.15
    const dirty = res.rows.filter(shaky)
    if (disturbed(res.full))
      console.log(
        `  ! DISTURBED: baseline spread ${(spread(res.full) * 100).toFixed(0)}% across ${res.full.length} rounds — the run was interrupted, so read every delta below as a ranking and nothing more.`,
      )
    if (dirty.length > 0)
      console.log(
        `  ! SHAKY: ${dirty.length} of ${res.rows.length} rows vary over 0.15 ms between rounds (marked !). --rounds=${Math.max(6, batches * 2)} narrows it.`,
      )
    console.log(
      `  (deltas are per-round paired medians. Ablation RANKS passes; it does not size them well enough to quote — a delta here has been off by 8x. Size a change with a direct A/B of two builds, best-of, interleaved.)`,
    )
    for (const r of res.rows.sort((x, y) => y.delta - x.delta))
      console.log(
        `  ${shaky(r) ? '!' : ' '} ${r.label.padEnd(16)} ~${r.delta.toFixed(3)} ms  (without: ${r.without.toFixed(3)})`,
      )
  }
  await page.evaluate(() => window.vf?.destroy())
} finally {
  await browser.close()
}
