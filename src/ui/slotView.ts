// Everything the panel knows about one input slot, gathered into one object.
//
// **Not `VideoSlot`** (videoSlot.ts), which points the other way: that is the
// handful of refs and setters the source-loading paths *write through* to put a
// picture on a slot. This is what comes back out — what a slot currently is, and
// the verbs a hand has for it. Nor is it `SourceSlot` (SourceSlot.tsx), which
// is the component that draws one of these.
//
// It exists to delete a whole class of mistake rather than to save typing. The
// engine used to hand these back as thirty flat fields ending in A or B, and the
// panel fanned them out into two identical component calls by hand:
//
//     <SourceSlot cue={props.cueB} wrapCost={props.wrapCostA} … />
//
// which typechecks perfectly, draws a plausible panel, and reports one deck's
// loop cost under the other deck's picture. There were twenty chances to write
// it in the fan-out and twenty more in the props list feeding it. Handed over as
// one object per slot, the pairing happens once, in one place, and every caller
// downstream is A/B-free: it takes *a slot* and cannot ask which.
//
// Generic over the mode union because that is where the two genuinely differ —
// only B can be 'none', only A can be 'webcam' — so neither slot will accept the
// other's mode even though everything else about them is the same shape.

import type { ArchivePick } from '../sources/archive'
import type { CommonsId, CommonsPick } from '../sources/commons'
import type { SourceBMode, SourceMode } from '../sources/modes'
import type { TeletypeCard } from '../sources/teletype'
import type { Cue } from './cue'
import type { StashSlot } from './fileStash'
import type { SlotKind } from './videoSlot'

// What a slot has off Wikimedia Commons: the file that came back, and the
// channel it was rolled out of (or '' for one played back off the starred
// shelf, which is a list rather than a pool). Lives here rather than in
// useEngine because it is a fact about a slot, and this is the file that says
// what those are.
export interface WikiOnSlot {
  pick: CommonsPick
  channel: CommonsId | ''
}

export interface SlotView<T extends SourceMode | SourceBMode> {
  // Which slot this is. Carried on the object so nothing downstream has to be
  // told a second time — a component handed a slot can look up its own keyboard
  // shortcuts and its own dialog target without the caller pairing those by hand
  // as well.
  key: StashSlot
  // The same fact as the label a human reads: 'A' or 'B'.
  tag: string

  // The picker: what is patched in, what it is called, and how to change it.
  mode: T
  name: string
  select: (mode: T) => void
  // Whether a real element is rolling on this slot, and of what kind — a clip
  // has a timeline, a stream does not.
  live: SlotKind

  // The teletype card, edited in place while this slot is on teletype.
  // `retype` lands an edit on the live card; `loadTeletype` is the dialog's
  // commit, which also puts the slot on teletype if it was elsewhere.
  teletype: TeletypeCard
  retype: (patch: Partial<TeletypeCard>) => void
  loadTeletype: (patch: Partial<TeletypeCard>) => void

  ytUrl: string
  loadYouTube: (url: string) => void

  // Last session's file, waiting on a click to re-grant read; '' when there is
  // nothing waiting.
  pendingFile: string
  reopenFile: () => void
  // The <input type=file> change handler. The *ref* to that input deliberately
  // does not live here — see the note on `fileInputRef` in useEngine's return.
  onFile: (file: File | undefined) => void

  // The transport. A duration of 0 is "this source has no timeline" — a pattern,
  // a still, a webcam — and everything below is off in that state.
  time: number
  duration: number
  seek: (time: number) => void

  // The cue point and the three things a hand does to one: tap it (mark, close
  // the loop, re-arm), stab back to it, drop it. Marked on the clip's own
  // timeline, so it goes away with the clip rather than with a look.
  cue: Cue | null
  tapCue: () => void
  retrigger: () => void
  clearCue: () => void
  // What this slot's loop wrap is measured to cost, in ms, or null before there
  // is a reading. Reported, not judged — see ui/cue.ts.
  wrapCost: number | null

  // Playback rate, and the pitch that falls with it.
  speed: number
  changeSpeed: (rate: number) => void

  wiki: WikiOnSlot | null
  // What this slot has off archive.org, if anything. A second field rather than
  // a widened `wiki` because the two are not the same thing to the UI: a Commons
  // pick can be starred and this cannot — there is no shelf for it — and its url
  // is a `blob:` allocation holding the whole clip, which is a fact about its
  // lifetime that nothing on the Commons side has.
  archive: ArchivePick | null
}

// Either slot, whichever mode union it carries. What to write when a caller
// takes a slot and does not care which one it is — which, now that the pairing
// is done upstream, is nearly all of them.
export type AnySlotView = SlotView<SourceMode> | SlotView<SourceBMode>

// Why there is no `makeSlotView(key, …)` helper here, and the two views are
// assembled as plain object literals in useEngine's return instead.
//
// A builder is the obvious move: `transport`, `cue` and `stall` are already kept
// as {a, b} records and the four verbs are already key-first functions, so a
// helper could project ten of the fields below out of the key and leave nothing
// to cross. It was written, both ways — as a local closure and as an exported
// function here — and **both cost `useEngine` its memoization entirely**:
//
//     React Compiler could not optimize 2:
//       src/ui/useEngine.ts  Cannot access refs during render   (x2)
//
// Measured by bisection with `pnpm compiler`, and the result is blunt: *any* call
// to a helper in that position fails, while the identical object written inline
// compiles. It is not the arguments — stripping the verbs, then every field of
// the payload, then the whole payload, leaves the failure exactly where it was;
// replacing the call with `({ … })` and changing nothing else clears it. The hook
// holds four refs, and a call it cannot see through is enough for the compiler to
// assume one is read during render.
//
// That is not a cost worth paying for it. useEngine builds `App`'s entire input
// surface, and an unmemoized hook there is the panel re-rendering ~200 control
// rows on writes that touched none of them — against a pairing mistake that is
// now confined to two adjacent literals in one file, under field names that carry
// no A or B of their own, where `speed: speedB` in the object built for A reads
// as the mistake it is.
//
// So: keep the two literals side by side, and re-check with `pnpm compiler` on a
// React Compiler upgrade — nothing else in the build reports this.
