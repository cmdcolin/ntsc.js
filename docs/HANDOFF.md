# Handoff — the motion + exploration pass

Written at the end of the session that did the work in `IDEAS2.md`. Delete this
file once someone has picked the remaining work up; the durable parts are
already in `ARCHITECTURE.md` (how the mod bay works), `IDEAS.md` (what was
deliberately not built), `DEVELOPMENT.md` (the screening harness) and
`USER-GUIDE.md` (what a user sees).

## What shipped

Eleven commits, from `feat(ui): motion on any row, and a search you can walk
back along` onward. Tests, `tsc -b` and `oxlint` are green; the modulation UI
was driven end to end in Firefox Nightly (claim a slot from a row, confirm the
engine sees it, freeze/thaw, apply a preset over it, undo back).

**Motion is first-class.** `∿` on every control row claims a slot and starts the
wobble on the first press. The bay lifted out of `ModSection` into
`useModSlots` + `ModSlotsContext`, eight slots. Presets carry motion (four of
the old ones now do, plus two new), and so do scenes and `?mod=` links. A motion
strip appears once anything is routed: one amount over every routing, plus a
freeze that holds phase.

**The search is retraceable.** `ctrl+z` / `ctrl+shift+z` walk a bounded history
of whole looks — controls *and* routings. `mutate` gained gentle and wild
strengths; every stage heading has a `⚄` that shakes only that stage.

**Seven new presets**, found by screening rather than by derivation: four
feedback (`wound spiral`, `shadow ladder`, `ladder climb`, `subcarrier siren`)
and a new **Full board** group of stacks (`transmission fault`, `night monitor`,
`deep end`) — the table had no multi-stage presets at all, though the look the
guide leads with is one.

**`scripts/contact.mjs`**, the harness that made the preset work tractable.

## Where this diverged from the plan in `IDEAS2.md`

Read that file as the proposal, not the record.

- **Macros were cut.** They were specced to route through the same eight slots
  as the LFOs, which makes the good case (one macro driving several controls)
  the expensive one — four clicks and a slot per control, out of eight. A global
  motion amount does the one-gesture-scales-the-patch job with no assignment
  ritual. Reasoning and the conditions for bringing them back are in `IDEAS.md`.
- **Scenes carry motion**, which the plan proposed skipping. Once presets and
  links carry it, a scene that stored only controls is the one recall that
  leaves the previous patch's LFOs running over the new look.
- **A preset only re-cables the bay on a whole apply**, never on a partial drag.
  The plan's `blendMod` would have let a 30% drag replace hand-patched routings,
  which is the destruction the "a mod-less preset says nothing" rule existed to
  prevent.
- **An exploration pass was added** that the plan did not have — the undo walk,
  scoped mutate, mutate strengths. The plan treated finding a look as a solved
  problem; it is the actual bottleneck.
- **Ten static feedback presets became seven, in two groups.** The evidence for
  splitting is in `scripts/candidates.example.mjs`.

## In flight

**Round 2 of preset screening is unfinished.** Ten retuned candidates, all
schema-checked, in `scripts/candidates.example.mjs`. To run:

```sh
npx vite build && npx vite preview --port 5211 --strictPort   # or any server
node scripts/contact.mjs scripts/candidates.example.mjs docs/contact http://localhost:5211/
```

Then open `docs/contact/index.html` — every tile links to its live patch — or
look at the paged `sheet-N.png`. Re-render one retuned candidate with
`--only='spiral core'`; resume an interrupted batch with `--missing`. Results
accumulate in `results.json`, so nothing already rendered is redone.

**It needs a quiet machine.** Each candidate is ~800 stepped frames; on a loaded
box that ran to minutes each and several candidates tripped the protocol timeout
outright. Nothing depends on this work — the seven shipped presets stand alone.

## Known stale

**The guide's screenshots.** `docs/img/modulation.jpg` shows the old four-slot
Modulation section, while the text now describes `∿` on rows and the motion
strip, which no figure shows. `pnpm docshots` regenerates; `scripts/
docshot-specs.mjs` probably wants a new entry for the row affordance. The guide
claims to be captured from the running app, so this is real drift.

## Worth doing next

1. **Widen MIDI beyond `ControlKey`.** `BindingMap` in `src/ui/midi.ts` is keyed
   by control, so the motion amount — now the single most performance-useful
   fader in the app — cannot be bound to a knob. The same change would let a
   knob drive a *preset weight*, which is the bigger prize: the chips are
   already a macro system, and one already does what three macros were going to.
2. **Finish round 2**, on a quiet machine.
3. **Regenerate the docshots.**

## Traps worth knowing (all cost real time)

- One Firefox does not survive a long WebGPU batch — after a handful of sessions
  it detaches the frame and every later page dies with "Target closed". The
  harness recycles browsers every three candidates and treats any failure as the
  browser being spent.
- Never `page.setViewport` after load under Firefox BiDi: it swaps the realm and
  every later `evaluate` sees `window.vf` undefined.
- A `file://` image taints the canvas it is drawn on, so the departure pass
  passes frames in as `data:` URIs.
- `?set=` silently drops any key the schema does not know, so a typo costs a
  full render and comes back looking merely uninteresting. The harness now
  reports what did not land.
- Run the render server from a `git worktree add --detach` copy, or from a
  production build, if another agent is editing the tree — an HMR reload
  mid-batch resets the engine under the frame counter.
