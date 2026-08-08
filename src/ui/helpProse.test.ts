import { describe, expect, it } from 'vitest'

import { GROUPS } from './controls'
import { helpBlocks } from './helpProse'

// The parser behind every control blurb. It is worth pinning because the copy
// it reads is authored as an indented template literal inside an object
// literal — the leading whitespace on every line but the first is an accident
// of where the string sits in the file, and a parser that stopped ignoring it
// would turn every blurb into one run-on paragraph without failing anything.
describe('helpBlocks', () => {
  it('leaves an unmarked blurb as one paragraph', () => {
    expect(helpBlocks('One sentence. And another.')).toEqual([
      { list: false, items: ['One sentence. And another.'] },
    ])
  })

  it('splits paragraphs on a blank line', () => {
    expect(helpBlocks('First.\n\nSecond.')).toEqual([
      { list: false, items: ['First.'] },
      { list: false, items: ['Second.'] },
    ])
  })

  it('gathers consecutive "- " lines into one list', () => {
    expect(helpBlocks('Lead.\n\n- one\n- two')).toEqual([
      { list: false, items: ['Lead.'] },
      { list: true, items: ['one', 'two'] },
    ])
  })

  it('rejoins a bullet wrapped across source lines', () => {
    // The indentation is the point: this is what a blurb looks like where it
    // is written, four levels deep in GROUPS.
    const text = `Lead.

      - **pin** — the centre breaks the signal
        path, so the jack sees an open.
      - **both** — a wiggled plug.`
    expect(helpBlocks(text)).toEqual([
      { list: false, items: ['Lead.'] },
      {
        list: true,
        items: [
          '**pin** — the centre breaks the signal path, so the jack sees an open.',
          '**both** — a wiggled plug.',
        ],
      },
    ])
  })

  it('closes a list at a blank line, so a trailing note is its own paragraph', () => {
    expect(helpBlocks('Lead.\n\n- one\n\nAfterwards.')).toEqual([
      { list: false, items: ['Lead.'] },
      { list: true, items: ['one'] },
      { list: false, items: ['Afterwards.'] },
    ])
  })
})

// A mode switch's help exists to say what each position does, so explaining
// some of them and not the rest is the failure worth catching: it reads as
// complete, and the position it leaves out is the one somebody was looking up.
// Blurbs that bold nothing a switch offers are describing something else (which
// lines the VBI fills, say) and are left alone.
describe('mode switch blurbs', () => {
  const BOLD = /\*\*([^*]+)\*\*/g
  const sliders = GROUPS.flatMap(g => g.sliders)
  const modes = sliders.filter(
    s => s.choices !== undefined && s.help !== undefined,
  )

  it('has mode switches to check', () => {
    expect(modes.length).toBeGreaterThan(10)
  })

  for (const s of modes) {
    const choices = s.choices ?? []
    const bold = new Set(
      [...(s.help ?? '').matchAll(BOLD)].map(m => m[1].toLowerCase()),
    )
    const named = choices.filter(c => bold.has(c.toLowerCase()))
    if (named.length === 0) continue
    it(`${s.key} names every position it offers`, () => {
      expect(choices.filter(c => !bold.has(c.toLowerCase()))).toEqual([])
    })
  }
})
