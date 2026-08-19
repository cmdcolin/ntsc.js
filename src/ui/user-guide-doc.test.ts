import { expect, test } from 'vitest'

import { SHIPPED_MODES } from '../sources/modes'
import { LOOP_STAGES } from './controls'
import { DEFAULT_STAB, STAB_MS_MAX, STAB_MS_MIN } from './modSlots'
import { MORPH_LABELS, MORPH_SECONDS } from './morph'
import { mutateAmountFor } from './mutate'
import { SIGNAL_TAPS } from './signalTap'

import { readFileSync } from 'node:fs'

// docs/USER-GUIDE.md is the page that survived being wrong the longest, because
// nothing reads it. A fact-check against these modules found morph's ceiling
// quoted two settings short (8s, against a ring that ends at 30s), ctrl/cmd
// described as one roll's own modifier when `mutateAmountFor` shares it across
// every roll, a stab's length given as the default as though it were the range,
// and source A's list missing the `screen` mode it ships. Every one of those
// numbers lives in an exported constant, so neither typecheck nor any test
// noticed the doc and the code disagreeing.
//
// The sibling page, docs/EFFECTS.md, solved this by not being written at all —
// scripts/docgen.mjs emits it from the control table. This page cannot go
// the same way: it is an argued tour of how to *drive* the app, and prose that
// makes a point does not come out of a table. So the countable claims inside
// the prose are pinned instead, which is the same bargain
// gpu/optimizations-doc.test.ts strikes for its own page.
//
// Flattened first, and that is load-bearing rather than tidy: oxfmt reflows
// markdown to 80 columns, so every phrase matched below sits one stray word
// away from being split over a line break.
const doc = readFileSync('docs/USER-GUIDE.md', 'utf8').replaceAll(/\s+/g, ' ')

test('the guide lists every morph duration the ring offers', () => {
  const labels = MORPH_SECONDS.map(s => MORPH_LABELS[s])

  expect(doc).toContain(`${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`)
})

test('the guide quotes the stab length as a default and a range', () => {
  expect(doc).toContain(`${DEFAULT_STAB.ms}ms by default`)
  expect(doc).toContain(`from ${STAB_MS_MIN} to ${STAB_MS_MAX}`)
})

// The failure this catches is the one the page actually had: `ctrl`/`cmd`
// written up as random motion's own modifier. One resolver answers for every
// roll, so a modifier the guide gives to one roll belongs to all of them.
test('the guide names every modifier the roll resolver honours', () => {
  const none = {
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  }

  expect(mutateAmountFor({ ...none, shiftKey: true })).toBe('wild')
  expect(mutateAmountFor({ ...none, altKey: true })).toBe('gentle')
  expect(mutateAmountFor({ ...none, ctrlKey: true })).toBe('turbo')
  expect(mutateAmountFor({ ...none, metaKey: true })).toBe('turbo')
  expect(mutateAmountFor(none)).toBe('normal')

  // Named on the roll they are introduced with, so the reader meets all three
  // before the bullet that says "same modifiers".
  expect(doc).toContain('`shift` for wilder, `alt` for gentler, `ctrl`/`cmd`')
  expect(doc).toContain('Same modifiers')
})

test('the guide walks every signal tap the View group steps through', () => {
  for (const tap of SIGNAL_TAPS.filter(t => t.value !== 0)) {
    expect(doc).toContain(tap.short)
  }
})

test('the guide names all three feedback loops', () => {
  expect(doc).toContain(LOOP_STAGES.map(l => l.loop).join(', '))
})

// Source A's picker is the list a reader is told to open first, and the page
// had been a mode behind it. Only the devices are pinned: the media entries are
// prose in the guide ("the bundled photo", "a file") and would make this a test
// about wording rather than about coverage.
test('the guide offers the devices source A actually ships', () => {
  expect(SHIPPED_MODES).toContain('screen')
  expect(SHIPPED_MODES).toContain('webcam')

  expect(doc).toContain('a shared screen')
  expect(doc).toContain('a webcam')
})
