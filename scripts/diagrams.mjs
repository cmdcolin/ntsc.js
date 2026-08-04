#!/usr/bin/env node
// Renders docs/graphviz/*.dot to light and dark SVGs in docs/img/. The .dot
// sources use placeholder colour tokens rather than literal hex so one graph
// definition produces both themes -- the previous approach recoloured only
// edges, leaving pale fills and near-black label text on a dark page.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs')
const graphviz = join(docs, 'graphviz')
const img = join(docs, 'img')
const graphs = ['pipeline', 'pipeline-simple', 'domains', 'controls']

// Paired by role, so a missing dark value is a syntax error rather than a
// silently light-looking diagram.
const palette = {
  //                 light        dark
  FG: /*         */ ['#111111', '#e8ebf1'], // node label text
  STROKE: /*     */ ['#33333322', '#ffffff26'], // node border
  EDGE: /*       */ ['#555555', '#8b95a5'], // edge + edge label
  CLTEXT: /*     */ ['#334155', '#9aa7bd'], // cluster title
  SRC: /*        */ ['#e7eefc', '#25334d'], // source blocks
  ENCBG: /*      */ ['#f3f6fb', '#161b23'],
  ENCLN: /*      */ ['#c9d4e6', '#2d3a4a'],
  ENC1: /*       */ ['#cfe3cb', '#2f5138'], // encoder, load-bearing pass
  ENC2: /*       */ ['#dbe9d8', '#243a2a'], // encoder, helper pass
  CHBG: /*       */ ['#fbf1f1', '#20171a'],
  CHLN: /*       */ ['#e6cccc', '#4a2f33'],
  CH1: /*        */ ['#e9c9c9', '#5a2f34'],
  CH2: /*        */ ['#f0d9d9', '#3f2429'],
  SYN: /*        */ ['#cfdcf0', '#2b3f5e'], // sync domain, in domains.dot
  SYN2: /*       */ ['#e2eaf7', '#22314a'],
  DUB: /*        */ ['#b06a72', '#c98d95'], // same-frame dub repeat
  RXBG: /*       */ ['#f3f1fb', '#1b1826'],
  RXLN: /*       */ ['#d4cce6', '#3b3355'],
  RX1: /*        */ ['#d3cbeb', '#3b3260'],
  RX2: /*        */ ['#e0daf3', '#2b2544'],
  DSP: /*        */ ['#dfe3ea', '#2b313b'], // display blocks
  OUT: /*        */ ['#e4e0d4', '#3a362a'], // outboard box (enhancer)
  STORE: /*      */ ['#f6e6c8', '#4a3a1d'], // frame / loop stores
  GOLD: /*       */ ['#c8961a', '#e0a83a'], // composite feedback loop
  GREEN: /*      */ ['#3aa049', '#5fc06e'], // image feedback loop
}

// --check compares instead of writing, so a committed SVG cannot drift from the
// .dot it came from without CI noticing.
const check = process.argv.includes('--check')
const stale = []

for (const graph of graphs) {
  const src = readFileSync(join(graphviz, `${graph}.dot`), 'utf8')
  for (const [i, theme] of ['light', 'dark'].entries()) {
    const filled = src.replace(/@([A-Z0-9]+)@/g, (_, key) => {
      if (!(key in palette)) throw new Error(`${graph}.dot: unknown @${key}@`)
      return palette[key][i]
    })
    const svg = execFileSync('dot', ['-Tsvg'], { input: filled })
    const out = join(img, `${graph}-${theme}.svg`)
    if (check) {
      const current = existsSync(out) ? readFileSync(out) : Buffer.alloc(0)
      if (!current.equals(svg)) stale.push(out)
    } else {
      writeFileSync(out, svg)
      console.log(`wrote ${out}`)
    }
  }
}

if (stale.length > 0) {
  console.error(`stale, run \`pnpm run docs\`:\n  ${stale.join('\n  ')}`)
  process.exitCode = 1
} else if (check) {
  console.log('diagrams up to date')
}
