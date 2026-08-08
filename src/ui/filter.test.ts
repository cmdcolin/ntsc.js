import { describe, expect, it } from 'vitest'

import { GROUPS, sliderFor } from './controls'
import {
  MOVING_QUERY,
  groupMatches,
  isMovingQuery,
  matchedSliders,
  sliderMatches,
} from './filter'

import type { ControlKey } from '../controls'
import type { Group } from './controls'

const groupFor = (key: ControlKey): Group => {
  const g = GROUPS.find(group => group.sliders.some(s => s.key === key))
  if (g === undefined) throw new Error(`${key} is in no group`)
  return g
}

// A control whose own words say nothing about motion, so a text match can't be
// what a passing motion query is finding.
const QUIET: ControlKey = 'noiseIre'
const onlyQuiet = (key: ControlKey) => key === QUIET

describe('text matching', () => {
  it('matches the mechanism prose, not just the label', () => {
    // What the box is for: users hunt by the artifact they can see, and the
    // word for it lives in the help rather than in the control's name.
    const s = sliderFor('combMode')
    expect(s.label.toLowerCase()).not.toContain('rainbow')
    expect(s.help.toLowerCase()).toContain('rainbow')
    expect(sliderMatches(s, 'rainbow')).toBe(true)
  })

  it('takes a whole group on a name hit', () => {
    const group = GROUPS[0]
    expect(matchedSliders(group, group.name.toLowerCase())).toEqual(
      group.sliders,
    )
  })
})

describe('the motion query', () => {
  it('is asked by the ∿ the rows are marked with, and by words', () => {
    expect(isMovingQuery(MOVING_QUERY)).toBe(true)
    expect(isMovingQuery('moving')).toBe(true)
    expect(isMovingQuery('rainbow')).toBe(false)
  })

  it('finds a routed control that says nothing about motion', () => {
    const s = sliderFor(QUIET)
    expect(sliderMatches(s, MOVING_QUERY, false)).toBe(false)
    expect(sliderMatches(s, MOVING_QUERY, true)).toBe(true)
  })

  it('keeps the text match alongside it, so words still find prose', () => {
    // 'lfo' asks the motion question *and* stays a word, or typing it would
    // stop finding the help text that explains what an LFO does here.
    const routed = sliderMatches(sliderFor(QUIET), 'lfo', true)
    expect(routed).toBe(true)
    const prose = GROUPS.flatMap(g => g.sliders).filter(s =>
      s.help.toLowerCase().includes('lfo'),
    )
    for (const s of prose) expect(sliderMatches(s, 'lfo', false)).toBe(true)
  })

  it('narrows a group to the rows that are moving, not the whole group', () => {
    // The one that would defeat the query: a name hit takes a group whole, and
    // a stage of sixteen would bury the two rows that are actually wobbling.
    const group = groupFor(QUIET)
    const shown = matchedSliders(group, MOVING_QUERY, onlyQuiet)
    expect(shown.map(s => s.key)).toEqual([QUIET])
    expect(group.sliders.length).toBeGreaterThan(1)
  })

  it('drops a group with nothing moving in it', () => {
    const other = GROUPS.find(g => !g.sliders.some(s => s.key === QUIET))
    expect(other).toBeDefined()
    expect(groupMatches(groupFor(QUIET), MOVING_QUERY, onlyQuiet)).toBe(true)
    expect(groupMatches(other as Group, MOVING_QUERY, onlyQuiet)).toBe(false)
  })

  it('shows nothing at all when the bay is empty', () => {
    for (const g of GROUPS) expect(groupMatches(g, MOVING_QUERY)).toBe(false)
  })
})

describe('the two halves agree', () => {
  // groupMatches decides whether a stage appears on the spine; matchedSliders
  // decides what the opened group holds. A stage that appears and then renders
  // nothing is the failure this rules out.
  it('says a group matches exactly when it has rows to show', () => {
    for (const query of ['', 'rainbow', 'ghost', 'zzznope', MOVING_QUERY]) {
      for (const g of GROUPS) {
        expect(groupMatches(g, query, onlyQuiet)).toBe(
          matchedSliders(g, query, onlyQuiet).length > 0,
        )
      }
    }
  })
})
