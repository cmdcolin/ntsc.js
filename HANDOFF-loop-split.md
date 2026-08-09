# Handoff — the Feedback stage split into three loop stages

## What changed and why

`Feedback` was one sidebar stage over three unrelated machines, and it was also
one box on the trunk of the chain map. Both were wrong for the same reason: the
three loops do not re-enter the chain at the same place. From `gpu/pipeline.ts`:

| loop   | taps       | re-enters                                    |
| ------ | ---------- | -------------------------------------------- |
| camera | `Screen`   | `compose` — inside **Source A**, pre-encoder  |
| mixer  | `Receiver` | `fbComposite` — straight after **Mix**        |
| tape   | `Mix`      | `tapePlay`/`tapeRec` — same node, one pass on |

So one box could never be where all three land. It is gone. Each loop is now a
stage of its own, opened by pressing its own return on the map — the run is the
door, because none of the three is something the picture passes through and so
none of them has a place on the trunk to draw a box. The five groups split three
ways with nothing left over:

- **Camera loop** — `Camera loop (optical)`, `Tube face (what the camera shoots)`
- **Mixer loop** — `Mixer loop (electrical)`
- **Tape loop** — `Tape loop (loop bin)`, `Loop transport & heads`

Opening a loop now shows one or two group headers instead of five, and the loop
you can see running is the loop a click reaches.

## The shape of it

`src/ui/controls.ts` holds the one table, `LOOP_STAGES` (`loop`, `name`, `short`,
`blurb`, `what`, `mix`). Five surfaces used to answer these questions for
themselves and are now all read off it: the miniature's run labels, the full
diagram's labels, its legend sentences, the panel's stage headings, and the
three mixes that say a loop is running.

- `PHASE_ORDER` lost `'Feedback'` — the trunk is five boxes.
- `Placement` gained `'camera' | 'mixer' | 'tape'` (`LOOP_PLACES`); `loopGroups()`
  and `stageGroups()` resolve them, `placement.ts`'s `OFF_SPINE_STAGE` maps them
  to stage names for "This look" captions.
- `chainLayout.ts` `RETURNS` now carries `tap` / `into` stage names instead of one
  hard-coded Feedback node. A self loop **straddles** the box it returns to
  (`SELF_STRADDLE`) rather than landing on it twice — three verticals on the
  24-unit MIX box read as a knot.
- `ChainMap` takes `loops: ChainLoopStage[]`; a run wears the same states a box
  does (idle / amber edit / accent open) plus `live`, and calls the same `onOpen`.
  `onOpenLoop` is gone.
- `SignalPath` takes `loops: LoopNode[]`, rendered between the trunk and the
  branches on both the spine and the bench.
- `SignalPathDialog` dropped a column (7 → 6), so every box is 15% wider.
- `usePanelNav` migrates a persisted `'Feedback'` to `Camera loop` (`GONE`).

## State

`npx tsc --noEmit` clean, `npx vitest run` 959 passing. Verified in the browser
(Firefox Nightly, throwaway worktree): the map draws, a run opens its own stage,
the sidebar shows the two camera groups and nothing else.

## Remaining work

1. **Re-shoot the map after the straddle change.** The screenshots that confirmed
   the design were taken with the loop bin's ends still on the MIX box top; the
   straddle went in after and has only been checked by test. One run of a
   throwaway worktree + `scripts/shot.mjs`-style harness against the sidebar's
   `svg[aria-label="signal chain"]` settles it.
2. **`node scripts/panelshots.mjs --update`** — the `rest` state frames the chain
   map, so its baseline is stale by construction. Wants a GPU and a display.
3. **`docs/img/chain.jpg` and `docs/img/signal-path.jpg`** still show the six-box
   trunk with FEEDBACK. `scripts/docshots.mjs` regenerates them; the prose in
   `docs/USER-GUIDE.md` is already updated to match the new drawing.
4. Nothing else references `FEEDBACK_STAGE` — it no longer exists.

## Note for whoever picks this up

`src/app.tsx`, `src/ui/ClipPicker.tsx`, `src/ui/SourceSlot.tsx` and
`src/ui/useEngine.ts` are being edited concurrently by another agent in this
shared worktree (an archive.org / clip-library line of work). A `props.slot is
undefined` page error seen during verification came from there, not from this
change. Commit with an explicit pathspec.
