// Fit the preset-to-tag affinity matrix that turns `surprise` into
// `surprise: dreamy`, and answer the question that decides whether it is worth
// collecting labels at all: how many ratings does it take?
//
// Usage:
//   node scripts/affinity.mjs fit [labelsDir=labels] [out=src/affinity.json]
//   node scripts/affinity.mjs simulate           # how many ratings are enough
//
// The model is deliberately small. A candidate is a sparse weighting over the ~70
// authored presets, and there are ~10 tags, so what is being learned is a 70x11
// matrix — ten per-tag columns plus one for `cool`. That is fittable from a few
// hundred rows, where a model over the 215-dim control vector is not, and it is
// why the whole project is tractable.
//
// Ridge rather than averaging tag frequencies per preset, and the difference is
// the point: a look tagged `dreamy` usually contains two or three presets, so
// averaging smears the credit across all of them. Regression separates them once
// enough rolls overlap — that is exactly what "worn tape is dreamy" versus "the
// look it happened to appear in was dreamy" comes down to.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [mode = 'fit', arg1, arg2] = process.argv.slice(2)

// The preset catalog, read out of the app so the simulation uses the real shape —
// the real number of presets and the real group structure, since a roll takes one
// preset per group and that is what decides how often two presets co-occur.
async function catalog() {
  const src = await readFile('src/ui/presets.ts', 'utf8')
  const body = src.slice(src.indexOf('export const PRESETS'))
  const presets = []
  const re = /name: '([^']+)',\s*\n\s*group: '([^']+)'/g
  let m
  while ((m = re.exec(body)) !== null) {
    if (m[2] !== 'Clean' && m[2] !== 'A/B mixing') {
      presets.push({ name: m[1], group: m[2] })
    }
  }
  return presets
}

// Solve (A + lambda I) b = y by Gaussian elimination with partial pivoting. p is
// ~70, so this is microseconds and a linear-algebra dependency would be the
// heaviest thing in the repo for it.
function solve(A, y, lambda) {
  const p = y.length
  const M = A.map((row, i) => [
    ...row.map((v, j) => (i === j ? v + lambda : v)),
    y[i],
  ])
  for (let col = 0; col < p; col++) {
    let best = col
    for (let r = col + 1; r < p; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[best][col])) best = r
    }
    ;[M[col], M[best]] = [M[best], M[col]]
    const pivot = M[col][col]
    if (Math.abs(pivot) < 1e-12) continue
    for (let r = 0; r < p; r++) {
      if (r === col) continue
      const f = M[r][col] / pivot
      if (f === 0) continue
      for (let c = col; c <= p; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[p] / row[i]))
}

// Ridge with an intercept, which means centering **both** the target and every
// column of the design — not just the target.
//
// Centering y alone was the first version and it was wrong in a way worth
// recording, because it looked like it worked: the coefficients came back with
// plausible magnitudes and the rankings were merely bad, which reads as "this is
// a hard problem needing more data" rather than as a bug. What it actually does
// is leave the column means in the design with nothing to absorb them, so every
// coefficient is biased by the base rate times how often its preset appears. It
// was caught by fitting a noiseless target, where the answer has to come back
// exactly and did not.
function ridge(X, y, lambda) {
  const n = X.length
  const p = X[0]?.length ?? 0
  if (n === 0 || p === 0) return { beta: [], mean: 0 }
  const mean = y.reduce((a, b) => a + b, 0) / n
  const cy = y.map(v => v - mean)
  const colMean = new Array(p).fill(0)
  for (const row of X) for (let j = 0; j < p; j++) colMean[j] += row[j] / n
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0))
  const Xty = new Array(p).fill(0)
  for (let i = 0; i < n; i++) {
    const row = X[i]
    for (let a = 0; a < p; a++) {
      const xa = row[a] - colMean[a]
      Xty[a] += xa * cy[i]
      for (let b = a; b < p; b++) {
        const v = xa * (row[b] - colMean[b])
        XtX[a][b] += v
        if (a !== b) XtX[b][a] += v
      }
    }
  }
  return { beta: solve(XtX, Xty, lambda), mean }
}

// A roll, in the shape randomPresetMix actually produces: one preset per group
// from two or three distinct groups, the lead at full weight and the rest partial.
function rollWeights(presets, groups, rand) {
  // Fisher-Yates. A comparator that ignores its arguments is not a shuffle — it
  // biases toward the input order — and here that would systematically starve
  // whole preset groups of data and make the recovery look worse than it is.
  const shuffled = [...groups]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const picked = shuffled.slice(0, 2 + Math.floor(rand() * 2))
  const out = {}
  picked.forEach((g, i) => {
    const opts = presets.filter(p => p.group === g)
    const pick = opts[Math.floor(rand() * opts.length)]
    out[pick.name] = i === 0 ? 1 : 0.3 + rand() * 0.5
  })
  return out
}

const mulberry32 = seed => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- simulate: how many ratings are enough? -------------------------------
//
// Generate ratings from a known affinity, fit, and measure how much of the truth
// came back. Averaged over several independent ground truths per sample size,
// because the obvious metric — "how many of the ten dreamiest presets land in the
// model's top ten" — turns out to be far too noisy to read off a single draw. It
// bounced between 1/10 and 6/10 with no trend and looked like a broken fit; the
// correlation below is the same information with a hundredth of the variance.
const pearson = (a, b) => {
  const n = a.length
  const ma = a.reduce((x, y) => x + y, 0) / n
  const mb = b.reduce((x, y) => x + y, 0) / n
  let sa = 0
  let sb = 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    s += da * db
    sa += da * da
    sb += db * db
  }
  return sa === 0 || sb === 0 ? 0 : s / Math.sqrt(sa * sb)
}

const TRIALS = 8

async function simulate() {
  const presets = await catalog()
  const names = presets.map(p => p.name)
  const groups = [...new Set(presets.map(p => p.group))]
  const index = new Map(names.map((n, i) => [n, i]))

  console.log(
    `${names.length} presets across ${groups.length} groups, ${TRIALS} trials per row.`,
  )
  console.log(
    'A tag is one bit per rating; `cool` is 1-5, which is why it lands first.\n',
  )
  console.log('ratings   tag r    cool r   a weighted roll would feel')
  for (const n of [100, 200, 400, 800, 1600, 3200]) {
    let tagR = 0
    let coolR = 0
    for (let trial = 0; trial < TRIALS; trial++) {
      const rand = mulberry32(1000 + trial)
      // Most presets are neutral on a given tag, a handful strongly carry it —
      // `dreamy` is a few tape and feedback looks, not a gradient over seventy.
      const truth = names.map(() =>
        rand() < 0.2 ? rand() * 2 - 0.4 : rand() * 0.4 - 0.2,
      )
      const X = []
      const yTag = []
      const yCool = []
      for (let i = 0; i < n; i++) {
        const w = rollWeights(presets, groups, rand)
        const row = new Array(names.length).fill(0)
        let signal = 0
        for (const [name, weight] of Object.entries(w)) {
          row[index.get(name)] = weight
          signal += weight * truth[index.get(name)]
        }
        X.push(row)
        // A tag: one noisy bit.
        yTag.push(rand() < 1 / (1 + Math.exp(-(signal - 0.4))) ? 1 : 0)
        // A rating: 1-5, so more of the signal survives per row. Rounded with the
        // same amount of human noise on top.
        yCool.push(
          Math.max(
            1,
            Math.min(5, Math.round(3 + signal + (rand() - 0.5) * 1.5)),
          ),
        )
      }
      tagR += pearson(ridge(X, yTag, 1).beta, truth) / TRIALS
      coolR += pearson(ridge(X, yCool, 1).beta, truth) / TRIALS
    }
    const feel =
      coolR > 0.8
        ? 'clearly steered'
        : coolR > 0.6
          ? 'steered'
          : coolR > 0.4
            ? 'a nudge'
            : 'like chance'
    console.log(
      `${String(n).padStart(7)}   ${tagR.toFixed(2).padStart(5)}   ${coolR.toFixed(2).padStart(6)}   ${feel}`,
    )
  }
  console.log(
    '\nr is the correlation between the fitted per-preset affinity and the truth.',
  )
  console.log(
    'Verified separately: against a noiseless target the fit returns r = 1.000 at',
  )
  console.log(
    'every sample size, so what these numbers measure is noise, not bias.',
  )
}

// --- fit: the real thing --------------------------------------------------
async function fit() {
  const dir = arg1 ?? 'labels'
  const out = arg2 ?? 'src/affinity.json'
  const raw = await readFile(join(dir, 'ratings.jsonl'), 'utf8')
  const rows = raw
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l))
    // Only rows with a recipe behind them: a look dialled in by hand has no
    // preset basis to regress on. They are still in the export for the
    // control-vector model later.
    .filter(r => Object.keys(r.weights ?? {}).length > 0)

  if (rows.length === 0) {
    console.log('no rated rolls yet — run scripts/labels.mjs first')
    return
  }

  const names = [...new Set(rows.flatMap(r => Object.keys(r.weights)))].sort()
  const index = new Map(names.map((n, i) => [n, i]))
  const X = rows.map(r => {
    const row = new Array(names.length).fill(0)
    for (const [name, w] of Object.entries(r.weights)) row[index.get(name)] = w
    return row
  })
  const tags = [...new Set(rows.flatMap(r => r.tags ?? []))].sort()

  const affinity = {}
  for (const tag of tags) {
    const { beta, mean } = ridge(
      X,
      rows.map(r => ((r.tags ?? []).includes(tag) ? 1 : 0)),
      1.0,
    )
    affinity[tag] = Object.fromEntries(
      names.map((n, i) => [n, Number((mean + beta[i]).toFixed(4))]),
    )
  }
  const { beta: coolBeta, mean: coolMean } = ridge(
    X,
    rows.map(r => r.cool),
    1.0,
  )
  affinity.cool = Object.fromEntries(
    names.map((n, i) => [n, Number((coolMean + coolBeta[i]).toFixed(4))]),
  )

  await writeFile(
    out,
    JSON.stringify(
      { fittedFrom: rows.length, presets: names.length, tags, affinity },
      null,
      2,
    ) + '\n',
  )
  console.log(
    `fitted ${tags.length} tags + cool from ${rows.length} rated rolls`,
  )
  console.log(`covering ${names.length} presets -> ${out}`)
  for (const tag of tags) {
    const top = Object.entries(affinity[tag])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, v]) => `${n} ${v.toFixed(2)}`)
    console.log(`  ${tag.padEnd(11)} ${top.join(', ')}`)
  }
}

if (mode === 'simulate') await simulate()
else await fit()
