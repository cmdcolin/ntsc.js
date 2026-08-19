// The map's structure as data. Two of these are regressions, and both are the
// same shape: a query that reaches a stage which is not on the trunk. 37 of the
// app's controls live in a feedback loop and 26 on a branch, so "vignette" and
// "bass" are ordinary things to type — and the panel used to answer both with
// "nothing matches", because the trunk was what it counted and what it drew.

import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../core/controls'
import {
  CAMERA_LOOP_STAGE,
  DECK_STAGE,
  MIX_STAGE,
  MOD_KEYWORDS,
  MOD_STAGE,
  PHASE_ORDER,
  SOUND_STAGE,
  SOURCE_B_STAGE,
  VIEW_STAGE,
} from './controls'
import { panelChain } from './panelChain'

import type { Controls } from '../core/controls'
import type { FreeStage } from './panelChain'

const free: FreeStage[] = [
  {
    name: MOD_STAGE,
    blurb: 'the bay',
    // The real list, not a stand-in: 'strobe' is the word the whole asymmetry
    // below was worth building for, so a test that invented its own keywords
    // would pass while the app kept hiding the gate.
    keywords: MOD_KEYWORDS,
    load: { n: 2, say: '2 slots patched' },
    body: () => null,
  },
  {
    // No keywords, deliberately — see the deck test below.
    name: DECK_STAGE,
    blurb: 'the deck',
    load: { n: 0, say: '' },
    body: () => null,
  },
]

const chain = (
  over: {
    query?: string
    moving?: boolean
    bOn?: boolean
    soundOn?: boolean
    controls?: Controls
    patched?: Record<string, string | undefined>
  } = {},
) =>
  panelChain({
    controls: over.controls ?? DEFAULT_CONTROLS,
    filter: { text: over.query ?? '', moving: over.moving ?? false },
    isRouted: () => false,
    bOn: over.bOn ?? true,
    soundOn: over.soundOn ?? true,
    onOpenGroup: () => {},
    patched: over.patched ?? {},
    free,
  })

const names = (nodes: { name: string }[]) => nodes.map(n => n.name)
// The boxes a query actually reached. Every box is on the map whatever is in
// the search field — the chain is what the map is for, and it used to be
// re-laid-out around whatever survived — so "the filter did not find this" is
// now a flag on a box that is still drawn, and that is what these read.
const lit = (nodes: { name: string; dim?: boolean }[]) =>
  names(nodes.filter(n => n.dim !== true))

describe('the boxes on the map', () => {
  it('draws the whole chain with nothing filtered', () => {
    const c = chain()
    expect(names(c.nodes)).toEqual([...PHASE_ORDER])
    expect(c.loops).toHaveLength(3)
    // The three wired branches, then the two boxes wired to nothing — the order
    // the map reads in from the top, branch row before free row.
    expect(names(c.branches)).toEqual([
      SOURCE_B_STAGE,
      SOUND_STAGE,
      VIEW_STAGE,
      MOD_STAGE,
      DECK_STAGE,
    ])
    expect(c.anyStage).toBe(true)
  })

  it('keeps a free box out of a query it does not answer to', () => {
    const c = chain({ query: 'hue' })
    expect(lit(c.branches)).not.toContain(MOD_STAGE)
    expect(lit(c.branches)).not.toContain(DECK_STAGE)
    // Still drawn, though — dimming is what "out of this query" looks like now,
    // and a box that vanished would take a row of the drawing with it.
    expect(names(c.branches)).toContain(MOD_STAGE)
  })

  // The regression this pass exists for. The bay holds the gate, its rate, the
  // tempo and the split against a held look — none of which is in a group, on
  // another stage, or in the palette's pool. So while the filter dropped this
  // box, a query for the one word most people use for the gate found the beam's
  // blanking strobe and the mixer loop's strobe hold and hid the third.
  it('brings the bay back for a query it answers to', () => {
    const c = chain({ query: 'strobe' })
    expect(names(c.branches)).toContain(MOD_STAGE)
    // …and the panel must not then print "nothing matches" over it.
    expect(c.anyStage).toBe(true)
    expect(c.blocked).toEqual([])
  })

  // The word on the row, not just the word in the list. Both spellings have to
  // land: "stabs" is what the rate row is labelled and therefore what gets
  // typed, and `freeMatches` asks whether a *keyword* contains the query — so
  // the plural is the entry that has to be there and the singular falls out of
  // it. A list holding only 'stab' passes every other test in this file.
  it('answers to the word written on the row', () => {
    for (const q of ['stab', 'stabs', 'tempo', 'flip'])
      expect(names(chain({ query: q }).branches)).toContain(MOD_STAGE)
  })

  it('matches a searchable box on its blurb, the way a row matches on its help', () => {
    expect(names(chain({ query: 'bay' }).branches)).toContain(MOD_STAGE)
  })

  // The asymmetry, and the reason keywords are an opt-in rather than an extra
  // list bolted onto a name-and-blurb match. Every row the deck draws is
  // borrowed from the stage that owns it, so those rows are already in the
  // results under their own names — and its blurb names all of them, so a box
  // matching on prose alone would match "wipe" and be a duplicate in the very
  // query it matched. Declaring nothing, it stays out of every query, which is
  // what both free boxes did before the bay needed to come back.
  it('leaves a box that declares nothing out of every query', () => {
    for (const q of ['strobe', 'tempo', 'wipe', 'tracking', 'deck'])
      expect(lit(chain({ query: q }).branches)).not.toContain(DECK_STAGE)
  })

  // The motion mode asks which rows are wobbling. The bay is where routings are
  // read as a set, but dropped on top of that answer it would bury the two rows
  // that are actually moving under the surface that lists them — with or without
  // text narrowing it further.
  it('leaves the free boxes out of the motion mode', () => {
    for (const text of ['', 'strobe']) {
      expect(lit(chain({ query: text, moving: true }).branches)).not.toContain(
        MOD_STAGE,
      )
    }
  })

  // What a dimmed box is still allowed to say. A count on the map is a fact
  // about the look — these controls are off stock — and the search field has no
  // business editing it, so a box the query missed keeps the count it would
  // have had. Built off the stage's whole group set for that reason: the
  // matched set is empty by definition, and counting *that* would make every
  // dimmed box read as untouched.
  it('keeps a dimmed box’s count off its own stage, not the query', () => {
    const moved = { ...DEFAULT_CONTROLS, chromaCoarse: 0.42 }
    const on = chain({ controls: moved })
    const off = chain({ query: 'zzzznothing', controls: moved })
    const receiver = (c: ReturnType<typeof chain>) =>
      c.nodes.find(n => n.name === 'Receiver')
    expect(receiver(on)?.touched).toBeGreaterThan(0)
    expect(receiver(off)?.dim).toBe(true)
    expect(receiver(off)?.touched).toBe(receiver(on)?.touched)
    // Its groups do go, though — a dimmed box lists nothing under the map, and
    // that is the half `SignalPath` reads to decide what renders.
    expect(receiver(off)?.groups).toEqual([])
    expect(receiver(off)?.onJumpTouched).toBeUndefined()
  })

  it('carries what a free box is holding as its own count and clause', () => {
    const bay = chain().branches.find(b => b.name === MOD_STAGE)
    expect(bay?.touched).toBe(2)
    expect(bay?.touchedSay).toBe('2 slots patched')
    // Nothing to jump to inside one: opening it *is* arriving.
    expect(bay?.onJumpTouched).toBeUndefined()
  })
})

describe('a stage with nothing patched into it', () => {
  it('draws Source B and the mixer inert with no second signal', () => {
    const c = chain({ bOn: false })
    const b = c.branches.find(n => n.name === SOURCE_B_STAGE)
    const mix = c.nodes.find(n => n.name === MIX_STAGE)
    expect(b?.off).toBe(true)
    expect(mix?.off).toBe(true)
    // The hint comes off OFF_HINT, and the two boxes get different ones: you
    // press SOURCE B to end the state, and there is nothing to press on Mix.
    expect(b?.offHint).toMatch(/click to pick one/)
    expect(mix?.offHint).toMatch(/pick a source B/)
  })

  it('wears no amber, however far off stock its controls sit', () => {
    const edited: Controls = { ...DEFAULT_CONTROLS, bHueDeg: 40, wipeMode: 2 }
    const on = chain({ controls: edited })
    const off = chain({ controls: edited, bOn: false })
    expect(on.branches.find(n => n.name === SOURCE_B_STAGE)?.touched).toBe(1)
    expect(off.branches.find(n => n.name === SOURCE_B_STAGE)?.touched).toBe(0)
    expect(off.nodes.find(n => n.name === MIX_STAGE)?.touched).toBe(0)
  })

  it('leaves the view alone — there is no input for it to be missing', () => {
    const c = chain({ bOn: false, soundOn: false })
    expect(c.branches.find(n => n.name === VIEW_STAGE)?.off).toBeUndefined()
  })
})

describe('a query that reaches nothing on the trunk', () => {
  it('still finds a loop', () => {
    const c = chain({ query: 'vignette' })
    expect(lit(c.nodes)).toEqual([])
    expect(lit(c.loops)).toEqual([CAMERA_LOOP_STAGE])
    expect(c.anyStage).toBe(true)
    // The trunk stays drawn under it. This is the half the old shape got wrong
    // in the other direction: with nothing on the trunk matching, the map had
    // no boxes to place anything off and drew nothing at all — so a query that
    // found 37 controls came out as a blank where the chain had been.
    expect(names(c.nodes)).toEqual([...PHASE_ORDER])
  })

  it('still finds a branch', () => {
    const c = chain({ query: 'bass' })
    expect(lit(c.nodes)).toEqual([])
    expect(lit(c.branches)).toEqual([SOUND_STAGE])
    expect(c.anyStage).toBe(true)
  })

  it('reports nothing when the branch it found cannot act', () => {
    // The other half of the same answer: the stage is listed on the map so the
    // dead box is visible, but its groups are suppressed (stageBody), so there
    // is no result on screen and "nothing matches" is the honest line.
    const c = chain({ query: 'bass', soundOn: false })
    expect(lit(c.branches)).toEqual([SOUND_STAGE])
    expect(c.anyStage).toBe(false)
    // And says which box to press, rather than "nothing matches" over seven
    // controls that exist.
    expect(c.blocked).toEqual([SOUND_STAGE])
  })

  it('reports nothing when the only trunk stage it found is inert', () => {
    const c = chain({ query: 'blended border along the wipe edge', bOn: false })
    expect(lit(c.nodes)).toEqual([MIX_STAGE])
    expect(c.anyStage).toBe(false)
    expect(c.blocked).toEqual([MIX_STAGE])
  })

  it('reports nothing for a query that reaches no stage at all', () => {
    const c = chain({ query: 'zzzznothing' })
    expect(lit(c.nodes)).toEqual([])
    expect(lit(c.loops)).toEqual([])
    expect(lit(c.branches)).toEqual([])
    expect(c.anyStage).toBe(false)
    expect(c.blocked).toEqual([])
  })

  // `blocked` names the boxes standing between the query and its result, and
  // every box is on the map now — so an inert stage the query never reached
  // must not be reported as one of them. B is unpatched here and 'vignette' is
  // in the camera loop, which has nothing to do with it.
  it('does not blame a dead box the query never reached', () => {
    const c = chain({ query: 'zzzznothing', bOn: false, soundOn: false })
    expect(names(c.nodes)).toEqual([...PHASE_ORDER])
    expect(c.blocked).toEqual([])
  })

  it('says nothing about a dead box while something else did match', () => {
    // A result on screen answers first: the query found live rows, and a note
    // about a stage that also matched and cannot act would be second-guessing
    // them.
    const c = chain({ query: 'hue', bOn: false })
    expect(c.anyStage).toBe(true)
    expect(c.blocked).toEqual([])
  })
})
