import { expect, test } from 'vitest'

import { readFileSync } from 'node:fs'

// docs/pipeline.dot is a hand-drawn view of the pass list in pipeline.ts, so it
// can silently fall behind — `enhancer` was missing from it for several
// releases. Each node carries a `passes="a,b"` attribute naming the passes it
// stands for; this asserts that set is exactly what the engine builds.
//
// Reading the source as text rather than importing the engine keeps this a unit
// test: constructing an Engine needs a GPUDevice, which vitest has no adapter
// for. The tradeoff is that a pass whose label is not a literal would be missed,
// which is why the label argument is required to be one.
const source = readFileSync('src/gpu/pipeline.ts', 'utf8')
const dot = readFileSync('docs/pipeline.dot', 'utf8')

const matchAll = (text: string, re: RegExp) =>
  [...text.matchAll(re)].map(m => m[1])

// `pass('name', ...)` covers the three pass arrays; composePass and decodePass
// are built by hand with an object literal, so they use `label: 'name'`.
const enginePasses = new Set([
  ...matchAll(source, /\bpass\(\s*'([a-zA-Z]+)'/g),
  ...matchAll(source, /\blabel: '([a-zA-Z]+)'/g),
])

const drawnPasses = new Set(
  matchAll(dot, /passes="([^"]+)"/g).flatMap(list => list.split(',')),
)

test('every pass the engine builds is drawn in docs/pipeline.dot', () => {
  expect([...enginePasses].filter(p => !drawnPasses.has(p))).toEqual([])
})

test('docs/pipeline.dot draws no pass the engine does not build', () => {
  expect([...drawnPasses].filter(p => !enginePasses.has(p))).toEqual([])
})

test('the pass lists are non-trivial, so a broken regex fails loudly', () => {
  expect(enginePasses.size).toBeGreaterThan(15)
})
