import { createContext, use } from 'react'

import type { Group, SliderDef } from './controls'

// The live control filter, lowercased and trimmed. Read from the tree: it
// reaches rows, groups and the sections holding them, and threading it by hand
// left Favorites filtering nothing while everything else filtered.
export const FilterContext = createContext('')

export const useFilterQuery = () => use(FilterContext)

// Match help text too, not just labels: users hunt by artifact ("rainbow",
// "ghost", "comb"), and the mechanism prose is where those words live.
export const sliderMatches = (s: SliderDef, query: string) =>
  s.label.toLowerCase().includes(query) || s.help.toLowerCase().includes(query)

// Whether a group has anything to show — the same test its rows use, as data,
// so a stage drops off the spine without building its sections first.
export const groupMatches = (group: Group, query: string) =>
  query === '' ||
  group.name.toLowerCase().includes(query) ||
  group.sliders.some(s => sliderMatches(s, query))
