import { describe, expect, it } from 'vitest'

import {
  SOURCE_B_MODES,
  SOURCE_DESC,
  SOURCE_KIND,
  SOURCE_KIND_LABEL,
  SOURCE_KIND_ORDER,
  SOURCE_MODES,
  sourceOptions,
} from './modes'

import type { SourceKind } from './modes'

describe('source pickers', () => {
  // The kinds are a Record, so a mode with no kind cannot compile. What this
  // holds is the other half: a kind nobody put in the order would drop every
  // option filed under it out of the picker entirely, silently.
  it('offers every kind in a stated order', () => {
    const kinds = new Set<SourceKind>(Object.values(SOURCE_KIND))
    for (const kind of kinds) expect(SOURCE_KIND_ORDER).toContain(kind)
    expect(new Set(SOURCE_KIND_ORDER).size).toBe(SOURCE_KIND_ORDER.length)
  })

  it('names every kind it labels', () => {
    for (const kind of SOURCE_KIND_ORDER)
      expect(Object.hasOwn(SOURCE_KIND_LABEL, kind)).toBe(true)
  })

  // Banding reorders the list, so this is the check that it only reorders: every
  // mode offered still reaches the picker, exactly once, with the label it had.
  it.each([
    ['A', SOURCE_MODES],
    ['B', SOURCE_B_MODES],
  ])(
    'keeps every %s mode exactly once, relabelled by nobody',
    (_slot, modes) => {
      const options = sourceOptions(modes)
      expect(options.map(o => o.value).toSorted()).toEqual(
        [...modes].toSorted(),
      )
      for (const o of options) expect(o.label).toBe(SOURCE_DESC[o.value])
    },
  )

  // A band is a run of consecutive options: SelectRow builds its <optgroup>s by
  // walking the array and starting a new one whenever the heading changes, so a
  // kind whose options were split across the list would render as two headings
  // with the same name.
  it('keeps each band contiguous', () => {
    for (const modes of [SOURCE_MODES, SOURCE_B_MODES]) {
      const groups = sourceOptions(modes).map(o => o.group)
      const runs = groups.filter((g, i) => i === 0 || g !== groups[i - 1])
      expect(new Set(runs).size).toBe(runs.length)
    }
  })

  // The production build drops YouTube, and B has no webcam. Neither may leave a
  // heading standing over nothing — an empty <optgroup> is a dead row in the list.
  it('drops a band the caller has nothing left in', () => {
    // No cast: `sourceOptions` is generic over `readonly T[]`, so the filtered
    // array satisfies it as it stands. The cast that used to be here asserted a
    // 14-element tuple from a filter that returns fewer by construction, which
    // is what the test is about — TypeScript called it "may be a mistake" and
    // nothing was listening, because test files were excluded from the build.
    const noLive = SOURCE_MODES.filter(m => SOURCE_KIND[m] !== 'live')
    const groups = sourceOptions(noLive).map(o => o.group)
    expect(groups).not.toContain(SOURCE_KIND_LABEL.live)
    // ...and the bands that survive are unaffected.
    expect(groups).toContain(SOURCE_KIND_LABEL.pattern)
  })

  // B's only live input is the screen share. That is a real asymmetry — a webcam
  // is an A-only input — and the band heading is what says so in passing, so it
  // has to survive rather than collapse into the band above it.
  it('leaves B a live band holding the screen share alone', () => {
    const live = sourceOptions(SOURCE_B_MODES).filter(
      o => o.group === SOURCE_KIND_LABEL.live,
    )
    expect(live.map(o => o.value)).toEqual(['screen'])
  })

  it('puts B’s off switch above every band, unheaded', () => {
    const options = sourceOptions(SOURCE_B_MODES)
    expect(options[0].value).toBe('none')
    expect(options[0].group).toBe(null)
    expect(options.filter(o => o.group === null)).toHaveLength(1)
  })
})
