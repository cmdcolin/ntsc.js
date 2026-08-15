// The board has to come back exactly as it was, and the case that breaks it is
// not the obvious one.
//
// Two routings may drive the same control, and the second stacks on the first —
// it reads the value the first already wrote. Whether that round-trips depends on
// something the caller never has to think about: a save/modulate loop written in
// one pass records the *stacked* value as the second slot's resting one, and a
// forward restore (last write wins) then hands the board back one frame of
// modulation richer. At frame rate that compounds, so the control walks away from
// where it was left for as long as the pair stays patched, and nothing in the
// panel says why.
//
// `SavedBoard` restores backwards so the earliest value saved for a key wins,
// which makes both loop shapes correct. These cases are here because the
// one-pass version was written first and typechecked perfectly.

import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { Overlay, SavedBoard } from './savedBoard'

import type { ControlKey, Controls } from '../controls'

const board = () => ({ ...DEFAULT_CONTROLS })

describe('SavedBoard', () => {
  it('hands back what one pass over distinct controls overwrote', () => {
    const c = board()
    const before = { fbMix: c.fbMix, tapeMix: c.tapeMix }
    const saved = new SavedBoard()
    saved.begin()
    for (const k of ['fbMix', 'tapeMix'] as const) {
      saved.save(c, k)
      c[k] = 0.9
    }
    expect(c.fbMix).toBe(0.9)
    saved.restore(c)
    expect(c.fbMix).toBe(before.fbMix)
    expect(c.tapeMix).toBe(before.tapeMix)
  })

  it('round-trips a control two routings both drive, saved as it goes', () => {
    // The shape that bites: save, write, save the *written* value, write again.
    const c = board()
    const rest = c.fbMix
    const saved = new SavedBoard()
    saved.begin()
    saved.save(c, 'fbMix')
    c.fbMix = rest + 0.1
    saved.save(c, 'fbMix') // records the stacked value, not the resting one
    c.fbMix = rest + 0.25
    saved.restore(c)
    expect(c.fbMix).toBe(rest)
  })

  it('round-trips the same pair saved up front instead', () => {
    // The other loop shape, which must land in the same place.
    const c = board()
    const rest = c.fbMix
    const saved = new SavedBoard()
    saved.begin()
    saved.save(c, 'fbMix')
    saved.save(c, 'fbMix')
    c.fbMix = rest + 0.25
    saved.restore(c)
    expect(c.fbMix).toBe(rest)
  })

  it('a frame does not restore anything the frame before it saved', () => {
    // The arrays are reused, so a shrinking bay must not leave a stale key
    // behind for the next restore to write back.
    const c = board()
    const restTape = c.tapeMix
    const saved = new SavedBoard()
    saved.begin()
    saved.save(c, 'fbMix')
    saved.save(c, 'tapeMix')
    c.fbMix = 0.9
    c.tapeMix = 0.9
    saved.restore(c)

    saved.begin()
    saved.save(c, 'fbMix')
    c.fbMix = 0.5
    c.tapeMix = 0.42 // set by something else this frame; not the bay's to undo
    saved.restore(c)
    expect(c.tapeMix).toBe(0.42)
    expect(c.tapeMix).not.toBe(restTape)
  })

  it('restores nothing after a begin with no saves', () => {
    const c = board()
    const saved = new SavedBoard()
    saved.begin()
    saved.save(c, 'fbMix')
    c.fbMix = 0.9
    saved.restore(c)
    saved.begin()
    c.fbMix = 0.33
    saved.restore(c)
    expect(c.fbMix).toBe(0.33)
  })
})

// The layer on top of it, and the rule that is easiest to lose when it is
// written out once per layer: **the restore has to mark the filter bank again.**
// The bank was designed from the value this frame laid on, so the next frame —
// possibly with the routing gone — has to start from the resting one. Two of the
// three layers in `render()` did that and the third had no reason to, which is
// the kind of difference a reader cannot tell from an oversight. Stated once
// here instead.
describe('Overlay', () => {
  const layer = (c: Controls, keys: ControlKey[], onFilterMove: () => void) =>
    new Overlay(c, new Set(keys), onFilterMove)

  it('hands the board back and marks the bank at both ends', () => {
    const c = board()
    const rest = c.lumaMHz
    let marks = 0
    const l = layer(c, ['lumaMHz'], () => marks++)
    l.begin()
    l.write('lumaMHz', rest + 1)
    const off = l.seal()
    expect(c.lumaMHz).toBe(rest + 1)
    expect(marks).toBe(1)
    off()
    expect(c.lumaMHz).toBe(rest)
    expect(marks).toBe(2)
  })

  it('marks nothing when nothing it moved feeds a filter', () => {
    const c = board()
    let marks = 0
    const l = layer(c, ['lumaMHz'], () => marks++)
    l.begin()
    l.write('fbMix', 0.9)
    l.seal()()
    expect(marks).toBe(0)
    expect(c.fbMix).toBe(DEFAULT_CONTROLS.fbMix)
  })

  // `begin` clears the flag as well as the record: a frame whose routing has
  // been unpatched must not go on marking the bank because the one before it did.
  it('does not carry a mark into the next frame', () => {
    const c = board()
    let marks = 0
    const l = layer(c, ['lumaMHz'], () => marks++)
    l.begin()
    l.write('lumaMHz', c.lumaMHz + 1)
    l.seal()()
    marks = 0
    l.begin()
    l.write('fbMix', 0.9)
    l.seal()()
    expect(marks).toBe(0)
  })

  // The stab layer's answer, and the one place the three disagree: it hands over
  // a no-op, because the gate marks the bank on the two edges of its own cycle.
  it('takes a no-op for a layer that marks the bank itself', () => {
    const c = board()
    const rest = c.lumaMHz
    const l = layer(c, ['lumaMHz'], () => {})
    l.begin()
    l.write('lumaMHz', rest + 1)
    l.seal()()
    expect(c.lumaMHz).toBe(rest)
  })

  // Inherited from SavedBoard, and worth pinning through the layer as well: two
  // routings on one control stack, and the earliest value saved is the one that
  // lands.
  it('round-trips a control two writes both drive', () => {
    const c = board()
    const rest = c.fbMix
    const l = layer(c, [], () => {})
    l.begin()
    l.write('fbMix', rest + 0.1)
    l.write('fbMix', c.fbMix + 0.15)
    l.seal()()
    expect(c.fbMix).toBe(rest)
  })
})
