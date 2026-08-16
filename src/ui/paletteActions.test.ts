// The palette's rows, and the one thing about them worth pinning: which of them
// is the only way to search-and-reach the modulation bay.
//
// Everything else the palette lists is indexed from somewhere else as well — a
// preset is in PRESETS, a control is in GROUPS — so a blurb that drifts costs a
// ranking. The bay is in neither table, so its blurb *is* the index, and a
// rewrite that loses a word silently takes the app's most visible single effect
// off one of its two search surfaces. That has happened once already.

import { describe, expect, it } from 'vitest'

import { MOD_KEYWORDS, MOD_STAGE } from './controls'
import { paletteActions } from './paletteActions'

import type { AnySlotView } from './slotView'

const noop = () => {}

// Every verb stubbed: this file is about the rows the list is built from, and
// none of these is called by reading one.
const actions = () => {
  const opened: string[] = []
  const list = paletteActions({
    onSurprise: noop,
    onMutate: noop,
    onRollMotion: noop,
    onReset: noop,
    onUndo: noop,
    onRedo: noop,
    slots: [] as readonly AnySlotView[],
    onVaporwave: noop,
    roll: { can: true, up: null, kept: false, again: noop, keep: noop },
    save: { can: true, as: 'my look', run: noop },
    onCopyLink: noop,
    onRecord: noop,
    onStill: noop,
    onFullscreen: noop,
    onBench: noop,
    onPopout: noop,
    onFilter: noop,
    onOpenStage: name => opened.push(name),
    onDiagram: noop,
    onAdvanced: noop,
    onAbout: noop,
  })
  return { list, opened }
}

// What CommandPalette matches an action on: its name and its blurb, nothing
// else (see `score` there). Spelled out here rather than imported because the
// point is to fail if the palette ever narrows what it searches.
const findable = (
  list: { name: string; blurb: string }[],
  query: string,
): string[] =>
  list
    .filter(
      a =>
        a.name.toLowerCase().includes(query) ||
        a.blurb.toLowerCase().includes(query),
    )
    .map(a => a.name)

describe('the way into the modulation bay', () => {
  it('is reachable by the word most people call the gate', () => {
    // "strobe" finds the beam's blanking strobe and the mixer loop's strobe hold
    // through GROUPS. The gate is the third thing by that name and the only one
    // this list can answer for.
    expect(findable(actions().list, 'strobe')).toContain('modulation bay')
  })

  it('is reachable by what the gate does to two looks', () => {
    for (const q of ['flip', 'hold', 'beat', 'tempo', 'stab'])
      expect(findable(actions().list, q)).toContain('modulation bay')
  })

  // The filter box answers the same queries through MOD_KEYWORDS, and the two
  // surfaces are meant to agree on the load-bearing ones. Not every keyword —
  // the blurb is prose and 'bpm' would read as a list — but a query that the
  // sidebar answers by drawing the box and the palette answers with nothing is
  // the app disagreeing with itself about where a feature lives.
  it('agrees with the filter box on the words that matter', () => {
    const shared = MOD_KEYWORDS.filter(k => k === 'strobe' || k === 'flip')
    expect(shared).toHaveLength(2)
    for (const k of shared)
      expect(findable(actions().list, k)).toContain('modulation bay')
  })

  it('opens the bay when it is run', () => {
    const { list, opened } = actions()
    list.find(a => a.name === 'modulation bay')?.run()
    expect(opened).toEqual([MOD_STAGE])
  })
})
