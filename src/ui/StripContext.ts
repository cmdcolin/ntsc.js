import { createContext, use } from 'react'

import type { StripApi } from './useStrip'

// The rundown, read by anything that fires a row: the tray and its cards today,
// the command palette and a MIDI pad shortly.
//
// A context rather than props for the same reason `ModSlotsContext` is one — a
// row card is three levels down and a pad is not in the tree at all — and a
// context *of its own* for the reason that file gives: the strip moves when a
// hand edits it or a row boundary passes, while the controls move on every
// pointer step of a slider drag. Sharing one would put the whole rundown
// through a rebuild on each drag frame.
//
// What is deliberately **not** here is the hold's progress. It moves every
// frame, so it travels as a subscribe/get pair on the API and is read by the
// one element that draws it (`useSyncExternalStore` in StripRow) — the same
// arrangement `morph.ts` uses, and the whole of why a running strip does not
// re-render the tray sixty times a second. See docs/EDITOR.md › _The React
// shape_.
export const StripContext = createContext<StripApi | null>(null)

export function useStripApi(): StripApi {
  const api = use(StripContext)
  if (api === null) throw new Error('strip read outside the tray')
  return api
}
