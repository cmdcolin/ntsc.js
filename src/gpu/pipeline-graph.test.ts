import { expect, test } from 'vitest'

import { readFileSync } from 'node:fs'

// docs/graphviz/pipeline.dot and the "Pass order" block in docs/ARCHITECTURE.md are both
// hand-maintained views of the pass arrays in pipeline.ts, so both can silently
// fall behind — `enhancer` was missing from the diagram for several releases.
// These tests read the arrays as the source of truth and hold the two docs to
// them: the diagram for which passes exist and which are gated, the markdown for
// the order as well.
//
// Reading pipeline.ts as text rather than importing it keeps this a unit test:
// constructing an Engine needs a GPUDevice, which vitest has no adapter for.
const source = readFileSync('src/gpu/pipeline.ts', 'utf8')
const dot = readFileSync('docs/graphviz/pipeline.dot', 'utf8')
const architecture = readFileSync('docs/ARCHITECTURE.md', 'utf8')

// Comments hold apostrophes ("Decode's two bind groups"), so they have to go
// before anything tracks quote state.
const stripComments = (text: string) =>
  text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/[^\n]*/g, '')

// The region from `open` to its matching close bracket, exclusive.
const balanced = (text: string, open: string) => {
  const start = text.indexOf(open) + open.length
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  let depth = 1
  let quote = ''
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (quote !== '') {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch in pairs) depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i)
    }
  }
  throw new Error(`unbalanced ${open}`)
}

// Split on commas that are not nested inside a call, array, object or string.
const topLevelParts = (body: string) => {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote !== '') {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts.map(p => p.trim()).filter(p => p !== '')
}

interface EnginePass {
  name: string
  gated: boolean
}

const clean = stripComments(source)

// composePass and decodePass are built by hand as object literals and then
// referenced by name inside the arrays, so their labels come from `label: '…'`.
const namedPass = (property: string) => {
  const body = balanced(clean.slice(clean.indexOf(`this.${property} = {`)), '{')
  const label = /label: '([^']+)'/.exec(body)
  if (label === null) throw new Error(`no label on this.${property}`)
  return label[1]
}

// `pass(label, pipeline, resources, [x, y], when?)` — the optional fifth
// argument is the predicate that gates it, which is what a dashed border and a
// bracketed name in the docs both mean.
const readArray = (property: string): EnginePass[] =>
  topLevelParts(
    balanced(clean.slice(clean.indexOf(`this.${property} = [`)), '['),
  ).map(element => {
    const reference = /^this\.(\w+)$/.exec(element)
    if (reference !== null) {
      return { name: namedPass(reference[1]), gated: false }
    }
    const args = topLevelParts(balanced(element, '('))
    const label = /^'([^']+)'$/.exec(args[0])
    if (label === null)
      throw new Error(`unparsed pass: ${element.slice(0, 40)}`)
    return { name: label[1], gated: args.length >= 5 }
  })

const enginePasses = [
  ...readArray('prePasses'),
  ...readArray('loopPasses'),
  ...readArray('postPasses'),
]
const engineNames = enginePasses.map(p => p.name)
const gatedInEngine = new Set(
  enginePasses.filter(p => p.gated).map(p => p.name),
)

// Each node names the pass(es) it draws; `present` is a render pass, not one of
// these, so it carries no attribute.
const drawnNodes = [
  ...dot.matchAll(/(\w+)\s+\[([^\]]*passes="([^"]+)"[^\]]*)\]/g),
].map(m => ({
  passes: m[3].split(','),
  dashed: m[2].includes('dashed'),
}))

// Sorted by name, said explicitly. toSorted()'s default compares stringified
// elements, which happens to be right for a list of pass names and stops being
// right the moment one of these lists holds anything else.
const byName = (a: string, b: string): number => a.localeCompare(b)

test('the diagram draws exactly the passes the engine builds', () => {
  // Comparator spelled out: these are name arrays, and toSorted()'s default
  // is a lexicographic sort of stringified elements, which is only accidentally
  // right for strings.
  expect(drawnNodes.flatMap(n => n.passes).toSorted(byName)).toEqual(
    [...engineNames].toSorted(byName),
  )
})

test('a dashed node is a gated pass, and every gated pass is dashed', () => {
  // A node covering several passes is dashed when any of them is gated.
  const dashedInDiagram = new Set(
    drawnNodes.filter(n => n.dashed).flatMap(n => n.passes),
  )
  const expected = new Set(
    drawnNodes
      .filter(n => n.passes.some(p => gatedInEngine.has(p)))
      .flatMap(n => n.passes),
  )
  expect([...dashedInDiagram].toSorted(byName)).toEqual(
    [...expected].toSorted(byName),
  )
  expect([...gatedInEngine].every(p => dashedInDiagram.has(p))).toBe(true)
})

// prePasses/loopPasses/postPasses lines of the ARCHITECTURE.md code block, where
// `→` separates passes and `[brackets]` mark the gated ones — around a single
// name or around a run of them.
const documentedOrder = () => {
  const passes: EnginePass[] = []
  for (const stage of ['prePasses', 'loopPasses', 'postPasses']) {
    const line = new RegExp(`^${stage} +(.+)$`, 'm').exec(architecture)
    if (line === null) throw new Error(`no ${stage} line in ARCHITECTURE.md`)
    // Drop the trailing "(× dubGens, ≤ 4)" aside.
    const text = line[1].replace(/\([^)]*\)\s*$/, '')
    let depth = 0
    let token = ''
    const flush = () => {
      const name = token.trim()
      if (name !== '') passes.push({ name, gated: depth > 0 })
      token = ''
    }
    for (const ch of text) {
      if (ch === '[') depth++
      else if (ch === ']') {
        flush()
        depth--
      } else if (ch === '→') flush()
      else token += ch
    }
    flush()
  }
  return passes
}

test('ARCHITECTURE.md lists the passes in the order the engine runs them', () => {
  expect(documentedOrder().map(p => p.name)).toEqual(engineNames)
})

test('ARCHITECTURE.md brackets exactly the gated passes', () => {
  expect(
    documentedOrder()
      .filter(p => p.gated)
      .map(p => p.name)
      .toSorted(byName),
  ).toEqual([...gatedInEngine].toSorted(byName))
})

test('the extraction is non-trivial, so a broken parse fails loudly', () => {
  expect(engineNames.length).toBeGreaterThan(15)
  expect(gatedInEngine.size).toBeGreaterThan(4)
})
