import { describe, expect, it } from 'vitest'

import { sliderFor } from './controls'
import {
  FRAME_LOCK_LABELS,
  FRAME_LOCK_SHORT,
  frameLockLabel,
} from './frameLock'

describe('frame lock', () => {
  // The app menu and the Advanced dialog both render this control off its
  // definition rather than off a list of their own, so `choices` going away
  // would leave a menu row labelled "off" whatever the lock was set to, and a
  // dialog with no buttons in it — both of which render fine and say nothing.
  it('takes its labels from the control definition', () => {
    const def = sliderFor('frameLock')
    expect(FRAME_LOCK_LABELS).toEqual(def.choices)
    expect(FRAME_LOCK_LABELS.length).toBeGreaterThan(1)
    // index == value, which is what lets the menu step by adding one
    expect(def.min).toBe(0)
    expect(def.max).toBe(FRAME_LOCK_LABELS.length - 1)
    expect(def.step).toBe(1)
  })

  // The menu shows every setting at once in a 248px popover, so it shows them
  // short. One button per setting and no gaps, or the row would silently offer
  // fewer rates than the control has.
  it('has a menu-width label for every setting', () => {
    expect(FRAME_LOCK_SHORT.length).toBe(FRAME_LOCK_LABELS.length)
    for (const short of FRAME_LOCK_SHORT) {
      expect(short).not.toBe('')
      expect(short.length).toBeLessThanOrEqual(4)
    }
  })

  // A link can name any number, so the menu's label is a lookup that reports
  // what it found rather than an assertion — same rule tapFor follows.
  it('names an out-of-range setting rather than showing nothing', () => {
    expect(frameLockLabel(0)).toBe(FRAME_LOCK_LABELS[0])
    expect(frameLockLabel(99)).toBe('off')
  })
})
