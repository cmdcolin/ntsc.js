import { describe, expect, it } from 'vitest'

import { GROUPS, sliderFor } from './controls'
import {
  NO_FILTER,
  filterActive,
  groupMatches,
  matchedSliders,
  readFilter,
  sliderMatches,
} from './filter'

import type { ControlKey } from '../core/controls'
import type { Group } from './controls'
import type { Filter } from './filter'

const groupFor = (key: ControlKey): Group => {
  const g = GROUPS.find(group => group.sliders.some(s => s.key === key))
  if (g === undefined) throw new Error(`${key} is in no group`)
  return g
}

const text = (t: string): Filter => ({ text: t, moving: false })
const MOVING: Filter = { text: '', moving: true }

// A control whose own words say nothing about motion, so a text match can't be
// what a passing motion filter is finding.
const QUIET: ControlKey = 'noiseIre'
const onlyQuiet = (key: ControlKey) => key === QUIET

describe('text matching', () => {
  it('matches the mechanism prose, not just the label', () => {
    // What the box is for: users hunt by the artifact they can see, and the
    // word for it lives in the help rather than in the control's name.
    const s = sliderFor('combMode')
    expect(s.label.toLowerCase()).not.toContain('rainbow')
    expect(s.help.toLowerCase()).toContain('rainbow')
    expect(sliderMatches(s, text('rainbow'))).toBe(true)
  })

  it('takes a whole group on a name hit', () => {
    const group = GROUPS[0]
    expect(matchedSliders(group, text(group.name.toLowerCase()))).toEqual(
      group.sliders,
    )
  })
})

describe('the motion mode', () => {
  it('is a mode, not a word — so the words stay searchable', () => {
    // The strip's button sets it with nothing typed, and a pasted ∿ is the same
    // state arriving through the box.
    expect(readFilter('', true)).toEqual(MOVING)
    expect(readFilter('∿', false)).toEqual(MOVING)
    // These used to mean the mode, which cost the prose that uses them: 'lfo'
    // is in the help text of the controls that explain what one does here, and
    // typing it stopped finding them.
    for (const word of ['moving', 'modulated', 'motion', 'lfo']) {
      expect(readFilter(word, false)).toEqual(text(word))
    }
    const prose = GROUPS.flatMap(g => g.sliders).filter(s =>
      s.help.toLowerCase().includes('lfo'),
    )
    expect(prose.length).toBeGreaterThan(0)
    for (const s of prose)
      expect(sliderMatches(s, text('lfo'), false)).toBe(true)
  })

  it('finds a routed control that says nothing about motion', () => {
    const s = sliderFor(QUIET)
    expect(sliderMatches(s, MOVING, false)).toBe(false)
    expect(sliderMatches(s, MOVING, true)).toBe(true)
  })

  it('narrows a group to the rows that are moving, not the whole group', () => {
    // The one that would defeat it: a name hit takes a group whole, and a stage
    // of sixteen would bury the two rows that are actually wobbling.
    const group = groupFor(QUIET)
    const shown = matchedSliders(group, MOVING, onlyQuiet)
    expect(shown.map(s => s.key)).toEqual([QUIET])
    expect(group.sliders.length).toBeGreaterThan(1)
  })

  it('drops a group with nothing moving in it', () => {
    const other = GROUPS.find(g => !g.sliders.some(s => s.key === QUIET))
    expect(other).toBeDefined()
    expect(groupMatches(groupFor(QUIET), MOVING, onlyQuiet)).toBe(true)
    expect(groupMatches(other as Group, MOVING, onlyQuiet)).toBe(false)
  })

  it('shows nothing at all when the bay is empty', () => {
    for (const g of GROUPS) expect(groupMatches(g, MOVING)).toBe(false)
  })
})

describe('the two halves narrow together', () => {
  // The whole point of splitting the mode out of the query string: as one
  // string they were alternatives, and "the moving rows that say ghost" could
  // not be asked at all.
  it('intersects the mode with the text', () => {
    const s = sliderFor(QUIET)
    const word = s.label.toLowerCase()
    const both: Filter = { text: word, moving: true }
    expect(sliderMatches(s, both, true)).toBe(true)
    // Moving but not matching the words, and matching the words but not moving:
    // either miss is a miss.
    expect(sliderMatches(s, both, false)).toBe(false)
    expect(sliderMatches(s, { text: 'zzznope', moving: true }, true)).toBe(
      false,
    )
  })

  it('keeps a group-name hit out of the mode', () => {
    // A group name still takes the group whole for text alone, and must not once
    // the mode is up — otherwise the stage holding one moving row hands back all
    // sixteen. Under the mode the name is matched per row like any other text,
    // so what comes back is a subset of what is moving rather than the group.
    const group = groupFor(QUIET)
    const name = group.name.toLowerCase()
    expect(matchedSliders(group, text(name), onlyQuiet)).toEqual(group.sliders)
    const moving = matchedSliders(
      group,
      { text: name, moving: true },
      onlyQuiet,
    )
    for (const s of moving) expect(s.key).toBe(QUIET)
    expect(moving.length).toBeLessThan(group.sliders.length)
  })

  it('narrows nothing when neither half is asked', () => {
    expect(filterActive(NO_FILTER)).toBe(false)
    expect(filterActive(MOVING)).toBe(true)
    expect(filterActive(text('ghost'))).toBe(true)
    for (const g of GROUPS) {
      expect(matchedSliders(g, NO_FILTER, onlyQuiet)).toEqual(g.sliders)
    }
  })
})

describe('the two halves agree', () => {
  // groupMatches decides whether a stage appears on the spine; matchedSliders
  // decides what the opened group holds. A stage that appears and then renders
  // nothing is the failure this rules out.
  it('says a group matches exactly when it has rows to show', () => {
    const filters: Filter[] = [
      NO_FILTER,
      text('rainbow'),
      text('ghost'),
      text('zzznope'),
      MOVING,
      { text: 'noise', moving: true },
    ]
    for (const f of filters) {
      for (const g of GROUPS) {
        expect(groupMatches(g, f, onlyQuiet)).toBe(
          matchedSliders(g, f, onlyQuiet).length > 0,
        )
      }
    }
  })
})
