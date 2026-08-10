// The open stage survives a reload through one string, and that string has to
// answer for three kinds of stored value.
//
// A first session rests on the map alone: nothing unfolds itself, because a
// sidebar that opens a stage on every browser that has never stored the key — a
// fresh profile, a private window, another port in dev — puts a panel in front
// of the map for no reason the session asked for. The map's SOURCE A box is
// pressable with nothing patched in, so the picker is still one click away.
//
// The empty string is what an older build wrote for "closed on purpose", back
// when that had to be told apart from "never chosen" so that closing the stage
// did not re-open it on the next load. Both now mean closed, and the empty
// string is kept readable rather than kept meaningful.
//
// The third is a stage name that no longer renders, which is remapped rather
// than left to open a panel showing nothing.

import { describe, expect, it } from 'vitest'

import { CAMERA_LOOP_STAGE, SOURCE_A_STAGE } from './controls'
import { openStageFrom } from './usePanelNav'

describe('the open stage, across a reload', () => {
  it('rests a first session on the map alone', () => {
    expect(openStageFrom(null)).toBeNull()
  })

  it('reads an older build’s "closed" the same way', () => {
    expect(openStageFrom('')).toBeNull()
  })

  it('reopens whatever stage was left open', () => {
    for (const name of [SOURCE_A_STAGE, 'Tape', 'Source B', 'Sound']) {
      expect(openStageFrom(name)).toBe(name)
    }
  })

  it('lands a stage that no longer exists somewhere that renders', () => {
    expect(openStageFrom('Feedback')).toBe(CAMERA_LOOP_STAGE)
  })
})
