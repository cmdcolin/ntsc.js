import { createContext, use } from 'react'

import type { Group, SliderDef } from './controls'

// The live control filter, lowercased and trimmed. Read from the tree: it
// reaches rows, groups and the sections holding them, and threading it by hand
// left Favorites filtering nothing while everything else filtered.
export const FilterContext = createContext('')

export const useFilterQuery = () => use(FilterContext)

// The one question a static slider def cannot answer: is this control moving?
// A routing never touches the resting value, so a modulated row is
// indistinguishable from an untouched one by every other signal the panel has —
// which left "show me what is wobbling" unaskable while the bay could hold eight
// of them, scattered across six stages.
//
// `∿` is what the row's own button is marked, and what the motion strip's count
// puts in the box; the words are there because nobody types `∿`. They union with
// the text match rather than replacing it, so searching "lfo" still finds the
// prose that mentions one.
export const MOVING_QUERY = '∿'
const MOVING_WORDS: readonly string[] = [
  MOVING_QUERY,
  'moving',
  'modulated',
  'motion',
  'lfo',
]
export const isMovingQuery = (query: string) => MOVING_WORDS.includes(query)

// Whether a control is driven by the bay. Passed in rather than read from a
// context here: this module is pure, and the bay lives in a context of its own
// precisely so a slider drag doesn't rebuild its consumers.
export type IsRouted = (key: SliderDef['key']) => boolean

const NONE_ROUTED: IsRouted = () => false

// Match help text too, not just labels: users hunt by artifact ("rainbow",
// "ghost", "comb"), and the mechanism prose is where those words live.
export const sliderMatches = (s: SliderDef, query: string, routed = false) =>
  (routed && isMovingQuery(query)) ||
  s.label.toLowerCase().includes(query) ||
  s.help.toLowerCase().includes(query)

// The rows a group has to show for a query. A name hit takes the whole group,
// as a heading always has — except for the motion query, where taking a stage
// whole would bury the two rows that are actually moving in the sixteen that
// are not.
export const matchedSliders = (
  group: Group,
  query: string,
  isRouted: IsRouted = NONE_ROUTED,
): SliderDef[] =>
  query === '' ||
  (!isMovingQuery(query) && group.name.toLowerCase().includes(query))
    ? group.sliders
    : group.sliders.filter(s => sliderMatches(s, query, isRouted(s.key)))

// Whether a group has anything to show — the same rule its rows are picked by,
// as data, so a stage drops off the spine without building its sections first
// and the two can never disagree about what a query means.
export const groupMatches = (
  group: Group,
  query: string,
  isRouted: IsRouted = NONE_ROUTED,
) => matchedSliders(group, query, isRouted).length > 0

// Whether a box wired to nothing survives a query. Name, blurb or one of the
// words it declares, which is the same rule a slider follows (label or help) —
// so "matches the prose too" means one thing across the whole panel.
//
// It takes the shape rather than a FreeStage so this module stays the pure one:
// panelChain imports from here, and the box that owns the type lives there.
//
// **Keywords are how a box opts into being searchable at all**, and the absence
// of them is a positive answer rather than an empty list. The two free boxes are
// not the same kind of thing under a query:
//
// Everything the DECK draws is a real row borrowed from the stage that owns it —
// the wipe is Mix's, the tracking is Tape's — so those rows are already in the
// results under their own names, and a box that matched on its contents would
// print them a second time. Its blurb names all of them ("the transition lever
// and its wipe patterns… the tracking knob"), so it would match "wipe" and
// "tracking" and be a duplicate exactly when it matched. It declares nothing and
// stays out of every query, which is what it did before this function existed.
//
// The bay's own rows — the gate, its rate, the tempo, the split against a held
// look — are borrowed from nowhere, live in no group and are in no palette pool.
// Dropping that box under a query is the one case where the filter hides
// controls that have no other home, which is exactly what it used to do.
export const freeMatches = (
  box: { name: string; blurb: string; keywords?: readonly string[] },
  query: string,
) => {
  // The motion query is left to the rows it was built for. `∿` answers "show me
  // what is wobbling", and the whole bay dropped on top of that answer would
  // bury the two rows that are actually moving under the surface that lists
  // them — the same reason matchedSliders refuses to take a group whole for it.
  if (box.keywords === undefined || isMovingQuery(query)) return false
  return (
    box.name.toLowerCase().includes(query) ||
    box.blurb.toLowerCase().includes(query) ||
    box.keywords.some(k => k.includes(query))
  )
}
