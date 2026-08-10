// The map's structure as data. Two of these are regressions, and both are the
// same shape: a query that reaches a stage which is not on the trunk. 37 of the
// app's controls live in a feedback loop and 26 on a branch, so "vignette" and
// "bass" are ordinary things to type — and the panel used to answer both with
// "nothing matches", because the trunk was what it counted and what it drew.

import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import {
  DECK_STAGE,
  MIX_STAGE,
  MOD_STAGE,
  PHASE_ORDER,
  SOUND_STAGE,
  SOURCE_B_STAGE,
  VIEW_STAGE,
} from './controls'
import { panelChain } from './panelChain'

import type { Controls } from '../controls'
import type { FreeStage } from './panelChain'

const free: FreeStage[] = [
  {
    name: MOD_STAGE,
    blurb: 'the bay',
    load: { n: 2, say: '2 slots patched' },
    body: () => null,
  },
  {
    name: DECK_STAGE,
    blurb: 'the deck',
    load: { n: 0, say: '' },
    body: () => null,
  },
]

const chain = (
  over: {
    query?: string
    bOn?: boolean
    soundOn?: boolean
    controls?: Controls
  } = {},
) =>
  panelChain({
    controls: over.controls ?? DEFAULT_CONTROLS,
    query: over.query ?? '',
    isRouted: () => false,
    bOn: over.bOn ?? true,
    soundOn: over.soundOn ?? true,
    onOpenGroup: () => {},
    free,
  })

const names = (nodes: { name: string }[]) => nodes.map(n => n.name)

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

  it('keeps the free boxes out while a query is live', () => {
    const c = chain({ query: 'hue' })
    expect(names(c.branches)).not.toContain(MOD_STAGE)
    expect(names(c.branches)).not.toContain(DECK_STAGE)
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
    expect(c.nodes).toEqual([])
    expect(names(c.loops)).toEqual(['Camera loop'])
    expect(c.anyStage).toBe(true)
  })

  it('still finds a branch', () => {
    const c = chain({ query: 'bass' })
    expect(c.nodes).toEqual([])
    expect(names(c.branches)).toEqual([SOUND_STAGE])
    expect(c.anyStage).toBe(true)
  })

  it('reports nothing when the branch it found cannot act', () => {
    // The other half of the same answer: the stage is listed on the map so the
    // dead box is visible, but its groups are suppressed (stageBody), so there
    // is no result on screen and "nothing matches" is the honest line.
    const c = chain({ query: 'bass', soundOn: false })
    expect(names(c.branches)).toEqual([SOUND_STAGE])
    expect(c.anyStage).toBe(false)
  })

  it('reports nothing when the only trunk stage it found is inert', () => {
    const c = chain({ query: 'blended border along the wipe edge', bOn: false })
    expect(names(c.nodes)).toEqual([MIX_STAGE])
    expect(c.anyStage).toBe(false)
  })

  it('reports nothing for a query that reaches no stage at all', () => {
    const c = chain({ query: 'zzzznothing' })
    expect(c.nodes).toEqual([])
    expect(c.loops).toEqual([])
    expect(c.branches).toEqual([])
    expect(c.anyStage).toBe(false)
  })
})
