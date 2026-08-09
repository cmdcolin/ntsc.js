// The case this exists for is the one where a stage has nothing to show, and it
// is reachable only from two unrelated rules meeting: a live filter suppresses
// pickers, and an inert stage's groups are dropped. Neither is wrong on its own.
// Together, on an unpatched Source B that a query happened to match, they listed
// a stage heading over a blank — which is exactly the dead end the panel drops
// empty stages to avoid, and which shipped.

import { describe, expect, it } from 'vitest'

import { B_GROUPS, SOURCE_B_STAGE } from './controls'
import { hasBody, stageBody } from './stageBody'

import type { StageLike } from './stageBody'

// A real group off the stage this is about, rather than a hand-built stand-in:
// nothing here reads a group's contents, so the only thing a fake would add is a
// cast that stops telling the truth the moment `Group` grows a field.
const GROUPS = B_GROUPS.slice(0, 1)
const picker = () => null
const TOP = { [SOURCE_B_STAGE]: picker }

const stage = (over: Partial<StageLike> = {}): StageLike => ({
  name: SOURCE_B_STAGE,
  groups: GROUPS,
  ...over,
})

describe('what a stage has to show', () => {
  it('draws its picker and its groups when both are there', () => {
    const body = stageBody(stage(), TOP, true)
    expect(body.picker).toBe(picker)
    expect(body.groups).toEqual(GROUPS)
    expect(hasBody(body)).toBe(true)
  })

  it('keeps the picker and drops the groups while nothing is patched in', () => {
    // The whole point of an inert stage opening at all: the picker is the way
    // out of the state, and the groups behind it cannot reach the picture.
    const body = stageBody(stage({ off: true }), TOP, true)
    expect(body.picker).toBe(picker)
    expect(body.groups).toEqual([])
    expect(hasBody(body)).toBe(true)
  })

  it('has nothing to show when a filter takes the picker off an inert stage', () => {
    // The regression. Listing this stage draws its name over a blank.
    const body = stageBody(stage({ off: true }), TOP, false)
    expect(body.picker).toBeUndefined()
    expect(body.groups).toEqual([])
    expect(hasBody(body)).toBe(false)
  })

  it('still shows a live stage under a filter, on its groups alone', () => {
    const body = stageBody(stage(), TOP, false)
    expect(body.picker).toBeUndefined()
    expect(hasBody(body)).toBe(true)
  })

  it('has nothing to show for a stage with no picker and no groups', () => {
    // Not reachable today — app.tsx drops stages a filter emptied — but it is
    // the same blank heading if it ever is, so the answer comes from one place.
    expect(hasBody(stageBody(stage({ groups: [] }), {}, true))).toBe(false)
  })

  it('offers no picker to a stage that has none', () => {
    const body = stageBody(stage({ name: 'Tape' }), TOP, true)
    expect(body.picker).toBeUndefined()
    expect(hasBody(body)).toBe(true)
  })
})
