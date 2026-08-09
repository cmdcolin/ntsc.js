// The open stage survives a reload through one string, and that string has to
// carry three states out of two obvious values.
//
// Before the source pickers moved into the stages, it carried two: a stage name,
// or nothing at all for the map on its own — which was where a session started
// and where the × put you back. A first run now opens on Source A instead,
// because that stage is where A's picker is and the alternative is a first load
// that draws a rig and offers no way to put a picture into it.
//
// That leaves "never chosen" and "closed on purpose" needing different answers
// from the same slot, and the failure if they share one is not visible in a
// single session: you close the stage, it closes, and the next *load* re-opens
// it. Forever, on every load, with nothing in the panel to say why.

import { describe, expect, it } from 'vitest'

import { SOURCE_A_STAGE } from './controls'
import { openStageFrom, storeOpenStage } from './usePanelNav'

describe('the open stage, across a reload', () => {
  it('opens a first session on the stage holding A’s picker', () => {
    expect(openStageFrom(null)).toBe(SOURCE_A_STAGE)
  })

  it('keeps a closed panel closed', () => {
    // The round trip that the two-state version got wrong: close, reload, and
    // the map is still on its own.
    expect(openStageFrom(storeOpenStage(null))).toBeNull()
  })

  it('reopens whatever stage was left open', () => {
    for (const name of [SOURCE_A_STAGE, 'Tape', 'Source B', 'Sound']) {
      expect(openStageFrom(storeOpenStage(name))).toBe(name)
    }
  })

  it('never stores null, which is the value that means "never chosen"', () => {
    // usePersistedString deletes the key when handed null, so a null reaching
    // storage is indistinguishable from a fresh browser — which is exactly the
    // collision the empty string exists to avoid.
    expect(storeOpenStage(null)).not.toBeNull()
    expect(storeOpenStage('Tape')).not.toBeNull()
  })
})
