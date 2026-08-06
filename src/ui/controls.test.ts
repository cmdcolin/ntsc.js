import { describe, expect, it } from 'vitest'

import { CONTROL_KEYS } from '../controls'
import {
  AB_GROUPS,
  ALL_SLIDERS,
  AUTOMAP_KEYS,
  FEED_A_GROUP,
  FEED_B_GROUP,
  GROUPS,
  MIX_STAGE,
  NEEDS,
  PHASE_ORDER,
  SLIDER_BY_KEY,
  sliderFor,
  stageGroups,
  VIEW_KEYS,
} from './controls'

import type { ControlKey } from '../controls'

describe('control tables', () => {
  // sliderFor is total because of this: every control reaches the panel, and
  // nothing has to fall back to showing a raw key where a label belongs.
  it('gives every control exactly one slider', () => {
    expect(ALL_SLIDERS.length).toBe(CONTROL_KEYS.length)
    expect(SLIDER_BY_KEY.size).toBe(CONTROL_KEYS.length)
    for (const key of CONTROL_KEYS) expect(sliderFor(key).key).toBe(key)
  })

  it('gates controls on controls that exist', () => {
    for (const need of Object.values(NEEDS))
      expect(SLIDER_BY_KEY.has(need.key)).toBe(true)
  })

  it('names every group once', () => {
    const names = GROUPS.map(g => g.name)
    expect(new Set(names).size).toBe(names.length)
  })

  // Every group has to be behind some stage the map can open, or its controls
  // exist and nothing reaches them. This is the check that would have caught
  // the A/B groups being orphaned when their section went away: `place` is the
  // single source of placement truth, and stageGroups is what turns it back
  // into a stage — so the two have to agree over the whole table.
  it('puts every group behind a stage the map opens', () => {
    const reachable = new Set(
      [...PHASE_ORDER, MIX_STAGE].flatMap(name =>
        stageGroups(name).map(g => g.name),
      ),
    )
    for (const g of GROUPS)
      if (g.place !== 'audio') expect(reachable.has(g.name)).toBe(true)
  })

  // The branch is not a Phase, and the lookup that opens a stage has to know
  // it anyway — a miss returns [], which is a stage that opens onto nothing.
  it('finds the B branch’s groups by name', () => {
    expect(stageGroups(MIX_STAGE)).toBe(AB_GROUPS)
    expect(AB_GROUPS.length).toBeGreaterThan(0)
    expect(stageGroups('Screen').length).toBeGreaterThan(0)
    expect(stageGroups('nonesuch')).toEqual([])
  })

  // The two feeds are one shader bound twice, and the diagram draws a box per
  // feed that opens the panel at that group by name. A rename that touched
  // only the group would leave a box opening its stage at nothing.
  it('keeps the two feed groups’ names reachable', () => {
    for (const name of [FEED_A_GROUP, FEED_B_GROUP])
      expect(GROUPS.some(g => g.name === name)).toBe(true)
  })
})

describe('fine tier', () => {
  // A mode switch is never a trim: it decides which mechanism runs, so folding
  // one away hides the branch its neighbours' help text talks about.
  it('leaves mode switches on show', () => {
    for (const s of ALL_SLIDERS)
      if (s.choices !== undefined) expect(s.fine).toBeUndefined()
  })

  // Mirrors FRAMES in ControlGroup.tsx: these are already behind the
  // miniature's ▸ sliders toggle, and a second fold would bury them.
  it('leaves the miniature-backed controls on show', () => {
    const framed: ControlKey[] = [
      'wipePos',
      'pipX',
      'pipY',
      'pipW',
      'pipH',
      'crtZoomX',
      'crtZoomY',
    ]
    for (const key of framed) expect(sliderFor(key).fine).toBeUndefined()
  })

  // A disclosure is only worth its own row if it hides more than one control,
  // and only worth reading past if what stays is still a group.
  it('folds at least two rows and leaves at least three', () => {
    for (const g of GROUPS) {
      const fine = g.sliders.filter(s => s.fine === true).length
      if (fine === 0) continue
      expect(fine, g.name).toBeGreaterThanOrEqual(2)
      expect(g.sliders.length - fine, g.name).toBeGreaterThanOrEqual(3)
    }
  })

  // The groups the tier exists for: past eight rows a group stops being
  // scannable, so every one of them has to give something up.
  it('thins every long group', () => {
    for (const g of GROUPS)
      if (g.sliders.length > 8)
        expect(
          g.sliders.filter(s => s.fine === true).length,
          g.name,
        ).toBeGreaterThanOrEqual(2)
  })

  // What the auto-map ranking is for: a 64-knob controller reaches every
  // look-maker before it spends a knob on a trim or on the magnifier.
  it('ranks look-makers ahead of trims in the auto-map', () => {
    expect(AUTOMAP_KEYS.length).toBe(CONTROL_KEYS.length)
    const rank = (key: ControlKey) =>
      VIEW_KEYS.has(key) ? 2 : sliderFor(key).fine === true ? 1 : 0
    const ranks = AUTOMAP_KEYS.map(rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(AUTOMAP_KEYS.slice(-4)).toEqual([
      'crtZoom',
      'crtZoomX',
      'crtZoomY',
      'scope',
    ])
  })
})
