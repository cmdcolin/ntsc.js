import { describe, expect, it } from 'vitest'

import { CONTROL_KEYS, STOCK_HOLD } from '../controls'
import {
  ALL_SLIDERS,
  AUDIO_GROUPS,
  AUTOMAP_KEYS,
  B_GROUPS,
  CAMERA_LOOP_GROUP,
  FEED_A_CABLE_GROUP,
  FEED_A_GROUP,
  FEED_B_CABLE_GROUP,
  FEED_B_GROUP,
  FEEDBACK_STAGE,
  GROUPS,
  MIXER_LOOP_GROUP,
  MIX_STAGE,
  NEEDS,
  PHASE_ORDER,
  SLIDER_BY_KEY,
  sliderFor,
  SOUND_JOIN,
  SOUND_STAGE,
  SOURCE_B_STAGE,
  stageGroups,
  SYNTH_GROUP,
  TAPE_LOOP_GROUP,
  VIEW_GROUPS,
  VIEW_KEYS,
  VIEW_STAGE,
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
      [...PHASE_ORDER, SOURCE_B_STAGE, SOUND_STAGE, VIEW_STAGE].flatMap(name =>
        stageGroups(name).map(g => g.name),
      ),
    )
    for (const g of GROUPS) expect(reachable.has(g.name)).toBe(true)
  })

  // The rule the panel is arranged by, as an assertion rather than as prose in
  // three comments. A Phase is a place in the signal path, so a control that
  // does not touch the signal may not sit on one — and the two that did were
  // caught by hand, late, by noticing what they made the panel *say*: the audio
  // routings had no box at all and lived in a section at the foot of the
  // sidebar, and the View group sat on Screen, which lit that stage amber with
  // `• 1` and grew a row in "This look" whenever anyone magnified the picture.
  // Neither is visible to any other test here: both tables were internally
  // consistent, and every group did render somewhere.
  // The engine cannot import the panel's schema, so it carries its own copy of
  // this list (STOCK_HOLD) for the stab gate to hold. Same rule, same five keys,
  // and this is what stops the two drifting: retuning the View group without
  // touching the engine's set would leave a gate that yanks the magnifier and
  // rechooses the frame lock several times a second.
  it('holds the same keys back from a whole-board clean as it keeps off a mutate', () => {
    expect([...STOCK_HOLD].toSorted()).toEqual([...VIEW_KEYS].toSorted())
  })

  it('keeps the view controls off the signal path', () => {
    for (const g of GROUPS) {
      const view = g.sliders.filter(s => VIEW_KEYS.has(s.key))
      if (view.length > 0) {
        expect([g.name, g.place]).toEqual([g.name, 'view'])
      }
    }
    // And the other direction: the 'view' placement holds nothing *but* view
    // keys, so a signal control cannot be smuggled out of the path either — that
    // is what would let a mutate stop reaching something it should move.
    for (const s of VIEW_GROUPS.flatMap(g => g.sliders)) {
      expect([s.key, VIEW_KEYS.has(s.key)]).toEqual([s.key, true])
    }
  })

  // Neither branch is a Phase, and the lookup that opens a stage has to know
  // them anyway — a miss returns [], which is a stage that opens onto nothing.
  // That is exactly what the audio group had before it was a branch: a section
  // of its own at the foot of the sidebar and no box on the map at all, which
  // is why the check above had to carry an exception for it.
  it('finds each branch’s groups by name', () => {
    expect(stageGroups(SOURCE_B_STAGE)).toBe(B_GROUPS)
    expect(B_GROUPS.length).toBeGreaterThan(0)
    expect(stageGroups(SOUND_STAGE)).toBe(AUDIO_GROUPS)
    expect(AUDIO_GROUPS.length).toBeGreaterThan(0)
    expect(stageGroups('Screen').length).toBeGreaterThan(0)
    expect(stageGroups('nonesuch')).toEqual([])
  })

  // The sound climbs into the stage it is actually patched into, and the map
  // draws the wire from that name — so a rename of the stage that missed the
  // join would leave the branch rising into whatever the filter left last.
  it('joins the sound branch to a real stage', () => {
    expect(PHASE_ORDER).toContain(SOUND_JOIN)
  })

  // The two inputs are the same rig twice, and the panel says so by giving each
  // the same three groups in the same order: what the signal is, what the deck
  // did to it, what the wire did after. A control that drifts from one side to
  // the other (B's polarity invert sat in the mixer group for a year) breaks
  // the pairing quietly — nothing renders wrong, the two stages just stop
  // mirroring each other.
  it('gives A and B the same three groups', () => {
    // The two generator groups are the exception, and they are an exception in
    // the same way: neither belongs to input A, they describe whichever slot is
    // showing a generated source. Named rather than pattern-matched so a third
    // generator has to be admitted here deliberately.
    const shape = (name: string) =>
      stageGroups(name)
        .map(g => g.name)
        .filter(n => !n.startsWith('Noise source') && n !== SYNTH_GROUP)
    expect(stageGroups('Source A').length).toBeGreaterThan(0)
    expect(shape('Source A')).toEqual([
      'Signal (source A)',
      FEED_A_GROUP,
      FEED_A_CABLE_GROUP,
    ])
    expect(shape(SOURCE_B_STAGE)).toEqual([
      'Signal (source B)',
      FEED_B_GROUP,
      FEED_B_CABLE_GROUP,
    ])
  })

  // The mixer stage is what the two inputs meet at, so nothing that belongs to
  // one signal alone may sit in it — that is the mistake the split undid.
  it('leaves nothing one-sided in the Mix stage', () => {
    const keys = stageGroups(MIX_STAGE).flatMap(g => g.sliders.map(s => s.key))
    expect(keys).toContain('bGain')
    expect(keys).not.toContain('bInv')
    expect(keys).not.toContain('bHueDeg')
  })

  // The two feeds are one shader bound twice, and the diagram draws a box per
  // feed that opens the panel at that group by name. A rename that touched
  // only the group would leave a box opening its stage at nothing.
  it('keeps the two feed groups’ names reachable', () => {
    for (const name of [FEED_A_GROUP, FEED_B_GROUP])
      expect(GROUPS.some(g => g.name === name)).toBe(true)
  })

  // The same trap one level down, and a worse one: each of the three feedback
  // returns is now a *button* that opens the Feedback stage at its own group by
  // name. A rename touching only the group would leave a wire that lights up
  // while its loop runs and opens nothing when pressed — which looks like a
  // dead drawing rather than a broken lookup, so nothing would ever report it.
  it('keeps each loop’s group reachable from its own return', () => {
    const names = stageGroups(FEEDBACK_STAGE).map(g => g.name)
    expect(names.length).toBeGreaterThan(0)
    for (const group of [CAMERA_LOOP_GROUP, MIXER_LOOP_GROUP, TAPE_LOOP_GROUP])
      expect(names, group).toContain(group)
  })

  // Each return also claims a loop is running off one control, and the pass
  // that closes that loop is gated on the same one (gpu/pipeline.ts). If a mix
  // stopped being the gate, a lit wire and a dispatched pass would part
  // company.
  it('gives every loop a mix to be judged running by', () => {
    const keys = stageGroups(FEEDBACK_STAGE).flatMap(g =>
      g.sliders.map(s => s.key),
    )
    for (const key of ['fbMix', 'cfbMix', 'tapeMix'] as const)
      expect(keys, key).toContain(key)
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
      'crtPurityX',
      'crtPurityY',
      'crtPuritySize',
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
    expect([...ranks].toSorted((a, b) => a - b)).toEqual(ranks)
    // The View group, in its own order, and nothing else after it. Spelled out
    // rather than compared against VIEW_KEYS so that adding a key to that set
    // has to be a deliberate edit here too — this is the tail of the ranking a
    // 64-knob sweep never reaches.
    expect(AUTOMAP_KEYS.slice(-VIEW_KEYS.size)).toEqual([
      'crtZoom',
      'crtZoomX',
      'crtZoomY',
      'timeScale',
      'frameLock',
    ])
  })
})
