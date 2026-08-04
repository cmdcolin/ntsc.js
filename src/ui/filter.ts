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
// of them, scattered across five stages.
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
