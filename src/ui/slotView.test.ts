// The two slot literals in useEngine's return must each be built out of their
// own slot, and nothing but reading enforces it.
//
// This is the guard that ui/slotView.ts explains it could not get structurally.
// A `makeSlotView(key, …)` helper would have projected ten of these fields out of
// the key and left nothing to cross — but any call in that position costs
// `useEngine` its React Compiler memoization outright (measured; see the note in
// slotView.ts), so the assembly has to stay two inline object literals. Which
// leaves exactly one place where A can be handed B's value, and `speed: speed.b`
// inside the object built for A typechecks perfectly.
//
// So the test reads the source. That is idiomatic here rather than a hack —
// cssModules, shaders and pipeline-graph all assert over source text, and
// controls.test.ts makes this same argument for the two feed groups: the failure
// being guarded is one slot silently taking on the other's wiring, which no
// runtime assertion in a GPU-owning hook is going to reach.

import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

const SOURCE = readFileSync('src/ui/useEngine.ts', 'utf8')

// The body of one slot literal, between `<key>: {` and the `satisfies` that
// closes it. Anchored on `satisfies SlotView<…>` rather than on a brace, so the
// arrow bodies and ternaries inside cannot end the match early — and so that a
// literal which loses its type annotation fails here rather than silently
// matching nothing.
function slotLiteral(key: 'a' | 'b'): string {
  const open = `\n    ${key}: {\n`
  const start = SOURCE.indexOf(open)
  expect(
    start,
    `no \`${key}: {\` literal in useEngine's return`,
  ).toBeGreaterThan(-1)
  const end = SOURCE.indexOf('} satisfies SlotView<', start)
  expect(
    end,
    `\`${key}\` literal is not closed by a satisfies`,
  ).toBeGreaterThan(start)
  return SOURCE.slice(start + open.length, end)
}

// An identifier naming the *other* slot. The uppercase letter has to be the tail
// of the identifier or be followed by another capital, so this catches both
// `videoB` and `sourceBMode` while leaving `cue`, `stall` and `changeSpeed`
// alone. Paired with the quoted key, which is what the verb closures carry.
const foreign = (slot: 'A' | 'B') =>
  new RegExp(`\\b[a-z]\\w*${slot}(?=[A-Z]|\\b)`, 'g')

describe("useEngine's slot literals", () => {
  it("builds A's view out of A alone", () => {
    const body = slotLiteral('a')
    expect(body.match(foreign('B')) ?? []).toEqual([])
    expect(body).not.toContain("'b'")
    expect(body).not.toContain('transport.b')
    expect(body).not.toContain('cue.b')
    expect(body).not.toContain('stall.b')
    expect(body).not.toContain('speed.b')
  })

  it("builds B's view out of B alone", () => {
    const body = slotLiteral('b')
    expect(body.match(foreign('A')) ?? []).toEqual([])
    expect(body).not.toContain("'a'")
    expect(body).not.toContain('transport.a')
    expect(body).not.toContain('cue.a')
    expect(body).not.toContain('stall.a')
    expect(body).not.toContain('speed.a')
  })

  // The pair has to stay a pair. A field added to SlotView reaches the panel
  // through both slots or neither, and the compiler only catches the half that
  // is missing from the type — a field present in both literals but read off the
  // wrong state in one of them is what the two tests above are for, and a field
  // quietly given to one slot only is what this one is for.
  it('gives both slots the same fields', () => {
    const fields = (body: string) =>
      body
        .split('\n')
        .map(line => /^\s{6}(\w+)[,:]/.exec(line)?.[1])
        .filter(name => name !== undefined)
        .toSorted()
    expect(fields(slotLiteral('a'))).toEqual(fields(slotLiteral('b')))
  })
})
