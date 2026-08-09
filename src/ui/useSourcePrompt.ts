import { useState } from 'react'

import type { StashSlot } from './fileStash'

// Which source dialog is open, and which deck it was opened for.
//
// Five of the picker's entries do not change a source when you choose them —
// they ask a question first. "Clips…" opens the shelf, "Browse…" opens the
// media browser, "File…"'s siblings open a URL box, a text card or a browser
// permission. Backing out of any of them has to leave the deck exactly as it
// was, which is why none of them touches the engine until something is picked.
//
// This was five useStates and five setters, and the cost was not the five lines.
// It was that *closing* had become a thing each caller had to remember: the
// shelf closed itself from `loadClip`, the browser from the dialog's own
// onPlay, the YouTube box from app.tsx, and a kept roll played off the shelf
// went out through a path that closed nothing — so the shelf sat over the very
// picture it had just put up, with nothing in the code looking wrong. A rule
// spread over eight call sites in two files is a rule with a hole in it.
//
// One state closes the hole two ways:
//
//   Only one can be open. Five independent slots can represent "the shelf is
//     open for A and the browser is open for B", which is not a state this app
//     has — picking a source mode is what opens these, and a slot has one mode.
//
//   `dismiss` has one caller that matters: `beginLoad` in useEngine, which every
//     path that gives a slot a new source already goes through. So the question
//     goes away when it is answered, whoever answered it and however they got
//     there, and a new source path cannot forget because forgetting would mean
//     not calling the thing that also cancels its stale replies.

export type SourcePrompt =
  | 'library'
  | 'browse'
  | 'webcam'
  | 'youtube'
  | 'teletype'

export function useSourcePrompt() {
  const [asking, setAsking] = useState<{
    kind: SourcePrompt
    slot: StashSlot
  } | null>(null)

  return {
    // Which deck this dialog is open for, or null when it is not open. What a
    // render condition reads, and what a dialog takes as its `slot`: the two
    // cannot disagree, because they are the same answer.
    slotFor: (kind: SourcePrompt): StashSlot | null =>
      asking?.kind === kind ? asking.slot : null,
    ask: (kind: SourcePrompt, slot: StashSlot) => setAsking({ kind, slot }),
    // Closing, from the dialog's own × or Escape. Every other way a dialog
    // closes is a source landing, which goes through `beginLoad`.
    dismiss: () => setAsking(null),
  }
}
