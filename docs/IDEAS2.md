# Feedback presets + first-class dynamics (motion presets, mod-on-row, macros)

## Context

Follow-up to the sidebar redesign (fine tier + bench, shipped). The user's remaining
complaints: (b) too few feedback presets — "dialing in unique feedback settings
creates great visual effects"; (c) they still don't feel dialed into the advanced,
*dynamic* side — "not just a UI thing but giving more advanced wired-in dynamic
controls to the video."

The machinery exists but is second-class: a 4-slot mod matrix (sine/triangle/walk/
smooth/hold/lorenz LFOs + audio level/hit → any control) hidden in a collapsed
dropdown section; presets cannot carry motion; no slider shows it is being
modulated; nothing macro-like exists. User decisions (AskUserQuestion): ship static
feedback presets now; then motion-in-presets, mod-on-the-row, and performance
macros ("whatever you think is best to really surface the wild video effects");
scenes are not a priority (skip — note as follow-up).

Architecture facts that bound the design (verified):
- Mod applies per frame around `Engine.controls` with restore — never write-through;
  `Engine.snapshot` (the React/persistence source) never sees modulated values.
  `setModSlots` is write-only; slot state must be lifted into React, not read back.
- `ModState` waves are keyed by `id` (position-independent; pinned by
  modstate.spec.ts); 'smooth' uses id as its noise seed.
- Modulating any of the 5 `FILTER_KEYS` (encChromaMHz, demodMHz, chromaTail,
  lumaMHz, lumaPeak) rebuilds the FIR bank every frame — authored presets avoid
  those targets.
- Panel rules: nothing per-frame in the panel; “mark the lever as driven, don't
  draw the driven value”; panel renders in the popout's foreign document; React
  Compiler on (no manual memo); cssModules.test.ts forbids dead/unknown classes.
- presets.test.ts round-trip: for every preset, blendPresets(defaults,{name:1}) ==
  presetControls(patch) AND matchPreset finds it → patch values must sit on each
  control's step grid (snapToStep anchors at min) and no two presets may resolve
  identically.

Implementation is fanned out to Opus subagents (user preference), parent reviews
and commits with explicit pathspecs (shared worktree — other agents active; never
stash, never commit -a).

---

## Part A — ~10 new feedback presets (static; independent, ship first)

**File:** `src/ui/presets.ts` — insert contiguously at the end of the existing
`Feedback loops` run (after `fb bloom`, ~line 302; the group's chips render in
table order and group headers merge by name). Keep the group name `Feedback loops`
(randomPresetMix draws a group then one preset, so a 12-strong group widens
surprise-me variety without skewing group odds).

**Authoring rules** (from presets.test.ts + docshot-spec lore):
- Values on-grid: fbZoom/fbGain step .005, fbRotateDeg .1, fbShiftX/Y .001,
  cfbDelayUs .001, cfbKeyLevel/KeySoft .5, cfbFilterMHz/Boost .05, cfbLines int,
  cfbMix ≤ .95, cfbTrail ≤ .98. snapToStep anchors at min (fbZoom min 0.7 → 1.045
  on-grid).
- Respect gates: cfbKeyLevel/Soft need cfbKey≠0; cfbFilterQ/Boost need
  cfbFilterMHz>0; fb* need fbMix>0.
- Every patch carries a small `noiseIre` (1.2–3) — grain keeps loops analog.
- Names: lowercase, 1–3 words, device-evocative not look-evocative. Blurbs: one
  sentence, hardware fault → visible consequence (it's the hover caption).
- Push loops by **gain and mix, not geometry** (wound-up zoom+rotate reads as a
  kaleidoscope, "a different and much less analog thing"); a camera loop needs
  ~140 frames to develop; mixer-on-camera stacking reaches a flat noise wall in
  seconds unless heavily damped.

**The ten regimes** (starting patches; the implementer TUNES each in Firefox
Nightly via scripts/shot.mjs `?set=` strings at 300–500 frames and iterates until
distinct + stable — starting numbers are hypotheses, not spec):
1. `spiral core` — off-centre log spiral: fbMix .75, fbZoom 1.03, fbRotateDeg 6.5,
   fbShiftX .04, fbFocus 1.0, fbKnee .5, fbVign .3, crtBloom .3.
2. `collapse tunnel` — inward fall (zoom<1): fbMix .8, fbZoom .95, fbGain 1.05,
   fbBlack .05, crtGamma 1.3.
3. `infinity corridor` — straight outward tunnel, no rotate: fbMix .85, fbZoom
   1.09, fbVign .45, fbKnee .6, crtGamma 1.4.
4. `hue carousel` — mixer delay as hue rotation: cfbMix .7, cfbDelayUs .07
   (~90°/pass), cfbGain .95, cfbLines 1.
5. `polarity buzz` — negative loop gain, frame-alternating edges: cfbMix .6,
   cfbGain −.9, cfbDelayUs .15.
6. `subcarrier siren` — resonance self-oscillating on burst: cfbMix .55,
   cfbFilterMHz 3.6, cfbFilterQ .85, cfbFilterBoost 2.6.
7. `detail bars` — low resonance ringing on picture detail: cfbMix .5,
   cfbFilterMHz 1.1, cfbFilterQ .7, cfbFilterBoost 2.2, cfbLines 2.
8. `shadow ladder` — inverted key keeps darks, ladder walk: cfbMix .75, cfbKey
   −.7, cfbLines 4, cfbDelayUs .2.
9. `glass onion` — BOTH loops, heavily damped (the unexplored fbMix+cfbMix
   space): fbMix .6, fbZoom 1.025, fbKnee .7, fbVign .5, fbBlack .06 + cfbMix .3,
   cfbDelayUs .12, crtCutoff .08.
10. `halo burn` — key loop breeding faceplate halos: cfbMix .7, cfbKey .9,
    cfbKeyLevel 60, crtBloom .8, crtHalation .6, crtSat 1.25.

Also: fix the stale "all thirty-five" comment in `src/ui/useRecentPresets.ts`;
leave `STARTERS` (PresetsSection.tsx:52) unchanged unless one new preset clearly
out-heroes `mixer loop` — implementer proposes, parent decides at review.

**Verify:** `pnpm exec vitest run src/ui/presets.test.ts src/ui/urlParams.test.ts`
(round-trip + 4dp URL); shot.mjs screenshot per preset at ~400 frames; each looks
distinct and none collapses to white/black within ~1000 frames.

---

## Part B — motion-first-class plumbing (useModSlots, presets carry mod, URL, undo)

**New pure module `src/ui/modSlots.ts`** (unit-testable, no hook tooling in repo):
- `ModRouting {target, source, rateHz, depth}` (no '', no min/max — resolved
  from SLIDER_BY_KEY at apply so ranges never stale-cache in data/URLs);
  `UiSlot {target: ControlKey|'', source, rateHz, depth}` (moves from
  ModSection); `N_SLOTS = 8`; `EMPTY_SLOT`; `MOD_SOURCES` (8 today + macro1..3)
  and the labeled select-options list (ModSection's SOURCES + "macro 1/2/3" —
  one module, not a separate modSources.ts).
- `normalizeSlots(stored)` — pad to 8, **replace stale/malformed entries with
  EMPTY_SLOT in place, never compact**: positions are wave ids ('smooth' seeds
  noise by id; compact-then-pad today silently re-seeds/phase-swaps every slot
  below a stale one — fix it, note in commit message). Also field-checks
  elements (today's loadSlots throws at mount on a stored [null]).
- `toEngineSlots(slots)` — drop ''/0-depth, id = position, min/max from
  SLIDER_BY_KEY (ModSection's compaction comment moves here).
- `routingsToSlots(mod)` / `slotsToRoutings(slots)`.

**New `src/ui/useModSlots.ts` + `src/ui/ModSlotsContext.ts`** (context mirrors
ControlsContext with a useModSlotsApi() guard — separate context so slot edits
don't rebuild the controls context and vice versa). RECONCILED API (both parts
code against this):
```ts
interface ModSlotsApi {
  slots: readonly UiSlot[]                     // all 8, positional
  active: readonly ModSlot[]                   // engine view (section dot)
  setSlot(i, patch: Partial<UiSlot>): void     // ModSection positional edit
  setSlots(next: readonly UiSlot[]): void      // undo restore (positions kept)
  setRoutings(mod: readonly ModRouting[]): void // REPLACE-all: preset/URL apply
  modFor(key): UiSlot | null                   // first slot targeting key
  // Patch the slot targeting key in place (phase continuity); create in the
  // first free slot; ALL BUSY + no slot for key => NO-OP (row editor gates and
  // shows the busy hint — never silently evict another routing). null clears.
  setSlotForKey(key, r: Omit<ModRouting,'target'> | null): void
  macros: readonly [number, number, number]    // unipolar 0..1, default 0
  setMacro(i, v): void  // state + engine.setMacroValues synchronously
}
```
- Initial state: `parseSessionParams(location.search).mod` → routingsToSlots,
  else normalizeSlots(readArray('video_feedback_mod', [])) — the address bar
  still holds link params at first render (useUrlState rewrite is engineReady-
  gated + 250ms debounced), so no restoreSession threading.
- Persistence: same 'video_feedback_mod' key (old 4-arrays pad cleanly; no
  migration); macros under new 'video_feedback_macros'. Write-through setters.
- Engine push: effects `engine?.setModSlots(toEngineSlots(slots))` on
  [engine, slots] and `engine?.setMacroValues(macros)` on [engine, macros]
  (the async-engine case is why); engine stays write-only, React owns state.
- Macro VALUES deliberately don't ride the URL — the routing is the look, the
  gesture isn't; a comment says so.

**`src/ui/presets.ts`:** `PresetDef` gains `mod?: readonly ModRouting[]`.
Apply semantics: a preset WITH mod replaces all slots; a preset WITHOUT mod is
silent about motion (keeps current routings — a mod-less preset doesn't assert
stillness, and clear-always would make every chip click destroy hand-patched
motion); the `clean` empty-patch branch explicitly `setRoutings([])`.
`blendMod(weights): ModRouting[] | null` — heaviest-weighted preset WITH mod
wins outright, its depths scaled by its weight (mirrors the ENUM_KEYS
heaviest-mover rule; routings are patch cables, not summable scalars); null =
no statement (callers skip). matchPreset/controlsEqual stay control-only
(engine never writes mod through, so controls-equality is exactly what the
chip/mix honesty checks rely on).

**`src/ui/useMix.ts`:** args gain `mod: Pick<ModSlotsApi,'slots'|'setSlots'|'setRoutings'>`;
`undoSnapshot` becomes `{controls, mod: readonly UiSlot[]}`; undo restores both
(positional → phases resume); applyPreset/setPresetWeight/surprise apply
`blendMod` when non-null; mutate snapshots but never writes mod. Correct the
two comments (:44-52, :87-90) that wrongly claim mod moves controls. Ordering:
writeControls is sync, setRoutings lands next effect flush — bounded one-frame
skew, harmless (mod is additive+clamped); comment it, don't double-push.

**`src/ui/urlParams.ts` (+ test):** `?mod=target:source:rateHz:depth,...`
(same separator family as ?set=). parseMod validates target/source, clamps
depth [0,1] and rate [0.02,10], drops invalid, caps at 8. SessionParams.mod:
`?mod=` present → parsed (overrides preset's mod atomically); else preset's
mod; else null (old links keep localStorage routings). Writer always emits
`mod=` (even empty) — same marker argument as set= — from slotsToRoutings at
4dp. `useUrlState.ts` gains modSlots arg. Boot `?surprise` stays controls-only
(accepted asymmetry, noted).

**Docs/comments:** pipeline.ts:980-985 intent doc extended (+setMacroValues);
docs/USER-GUIDE.md "Making it move" (4→8 slots, macros, presets carry motion,
copy-link shares it); README.md:37 bullet; scenes noted as follow-up only.

**Tests:** new modSlots.test.ts (normalize pads/blanks-in-place — assert slot 2
keeps position 2 when slot 1 is stale; toEngineSlots ids; routingsToSlots cap);
presets.test.ts `describe('blendMod')` (full weight reproduces mod, half weight
halves depths, heaviest-with-mod wins, all-modless → null, schema check for
every authored mod entry); urlParams.test.ts (parse/round-trip/override/
empty-vs-absent). Existing round-trip untouched.

## Part C — mod on the row + performance macros

**Engine/signal (self-contained, do first):**
- `src/signal/modstate.ts`: extend `ModSource` with `'macro1'|'macro2'|'macro3'`;
  export `PASS_THROUGH: ReadonlySet<ModSource>` = {level, hit, macro1..3};
  `update(waves, level, hit, macros: readonly [number,number,number] = [0,0,0],
  rand = Math.random)` — macros are stateless pass-throughs like level/hit
  (rateHz ignored). Unipolar 0..1: a depth-scaled one-way push off resting value.
- `src/gpu/pipeline.ts`: `private macroValues` + `setMacroValues(v)` beside
  `setModSlots`; `applyMod()` passes them into `modState.update`.
- `src/signal/modstate.spec.ts`: insert `[0,0,0]` at call sites passing `rand`
  positionally; new tests: macros pass through + ignore rate; default to zero.
  Id-not-position and off-resumes-phase tests untouched.

**Threading (RECONCILED — no ControlsApi change):** rows read the new
`ModSlotsContext` directly via `useModSlotsApi()` (`modFor`, `setSlotForKey`,
`slots` for the busy hint) so slot edits don't rebuild the controls context.
`src/app.tsx`: `const modApi = useModSlots(eng.engine)`; provide the context
around the panel (both docked and popout render the same `panel` element, so
the provider wraps it once); `<MacroStrip macros onSet slots>` rendered just
BEFORE `.filterRow` (always visible, above the filter's result-set region);
`<ModSection />` reads the context (engine prop dropped). The sources
select-options list lives in `modSlots.ts` (not a separate modSources.ts).

**∿ accessory:** `src/ui/Slider.tsx` new optional prop
`mod?: {routed, open, onToggle}` — IconButton between MIDI icon and ☆, glyph ∿;
routed = static green tint (`.iconModSet { color: #7cbf9a }` in
Slider.module.css) — the lever marked, never the value, nothing animated.

**Row editor:** new `src/ui/ModRowEditor.tsx` + module.css — inline expansion
under the row (no dialog/popover: no positioning, popout-safe, fits a ~300px
bench column; precedent = .needs row). Contents: SelectRow of sources from a new
shared `src/ui/modSources.ts` (ModSection's list + macro 1/2/3), rate Slider
(hidden when `PASS_THROUGH.has(source)`), depth Slider, remove button. All edits
via `setModForKey(key, {...slot, ...patch})` — in-place patch keeps ModState
phase. All-8-busy path: hint naming the slot holders, no auto-evict.
`src/ui/ControlGroup.tsx` `ControlSlider`: row-local `modOpen` state;
claim-on-open — an unrouted row grabs a free slot with `DEFAULT_ROUTING`
(sine, 0.5 Hz, 0.2) so the first click already moves the picture; remove hands
it back. Fine-tweaks fold label gains a green `· ∿` when a hidden row is routed
(`.fineMod` in ControlGroup.module.css) — the amber touched count can't cover
mod since mod never moves the resting value.

**Macro strip:** new `src/ui/MacroStrip.tsx` + module.css — one always-visible
row (no Section fold), 3 cells: label button `m1/m2/m3` (click = zero, title
says so) + native range 0..1 step .01, fill anchored at 0, title lists current
assignments from slots ("driving: h position, crt zoom" / "unassigned — pick
'macro 1' as a source on any ∿"). Coarse-pointer sizing. Macros are not
ControlKeys → MIDI learn doesn't reach them; deliberate v1 cut, comment + noted
follow-up.

**ModSection:** stays editable but becomes a thin view — props
`{slots, setSlot}`; delete its local state/persistence/engine-push (the hook's
job now); 8 rows; sources from modSources.ts; hint gains "or press ∿ on any
control row".

**Filter/palette:** nothing in v1 (sliderMatches stays a pure function of the
static def); follow-up noted.

**Risks:** slot contention (claim-on-open is visible + reversible; fallback is
commit-on-first-edit, isolated in toggleMod); duplicate targets (ModSection can
alias two slots to one key; modFor addresses the first — comment it);
`modSlots` context identity changes per edit re-rendering mounted rows — same
cost model as `controls` writes; 9 new CSS classes each referenced or the
dead-class test fails.

## Sequencing / commits

1. `feat(ui): ten feedback presets` — Part A (independent; can land first).
2. `feat(ui): lift mod slots, presets carry motion, mod in share links` — Part B.
3. `feat(ui): modulate any control from its row; performance macros` — Part C
   (depends on B's useModSlots).
Docs pass rides with B/C (USER-GUIDE "Making it move", README line, stale
comments in useMix/ModSection/pipeline intent docs).
