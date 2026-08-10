# The A/B state pairs still inside useEngine

> **Done, 2026-08-09.** All seven pairs are `{a, b}` records, written through
> one `onDeck` updater that only takes the functional form — which is trap 1
> made unrepresentable rather than remembered. The modes stayed two types in one
> record (`{a: SourceMode; b: SourceBMode}`), trap 2's setter parameter turned
> out to be deletable rather than adaptable (`reopenStashed` was already being
> passed the key), and the `downloadYouTube` `label` parameter went first, as
> suggested. `commitA`/`commitB` stayed two functions: this document proposes
> one `commit(key, mode, …)`, but that signature can only take the mode by
> widening to the union trap 3 forbids, and the file's own comment already said
> so.
>
> Trap 1 was checked in the browser rather than argued about: a scratch harness
> loaded `?src=…&srcb=…` links and read both pickers back. It passes here, and
> reintroducing the direct-object update on purpose makes it fail with A on
> `bars` — so the check has teeth and the trap is real. `sourcecheck.mjs` and
> `poolcheck.mjs` both pass in full. `cuecheck.mjs` fails intermittently on
> different arms **at baseline too** (measured on a detached worktree at
> `e602237`), so it does not distinguish anything here.
>
> One thing this document did not know: `pnpm compiler` was already red before
> any of this, and in this same file. See the note at the end.

**2026-08-09.** Starting question: `useEngine` holds seven pairs of React state
that differ only in which deck they describe — `pendingA`/`pendingB`,
`cardA`/`cardB`, and so on — while three other pieces of the same file already
keep the same kind of thing as one `{ a, b }` record. Should the seven be
converted too?

Answer: yes, and the argument is not tidiness. `slotView.ts` already documents
the bug this shape produces, and the conversion is contained entirely within
`useEngine.ts` — no consumer changes at all. It was left undone on 2026-08-09
for one reason only: the file is 1963 lines, has no test coverage, and there is
no DOM test environment in this repo, so the whole change would be verified by
`tsc` alone. That is a real gap, but it is a smaller one than it first looks,
and this document is mostly about which parts `tsc` does and does not cover.

## What is already done — do not redo it

Three pieces of this landed before, and knowing that is what keeps the remaining
change small.

**The outward-facing half is finished.** `useEngine` used to hand the panel
about thirty flat fields ending in `A` or `B`; it now returns `a:` and `b:`
objects (`slotView.ts`). Read that file's header before starting — it is the
argument for this whole direction, written from the outside, and it names the
failure mode exactly:

> `<SourceSlot cue={props.cueB} wrapCost={props.wrapCostA} … />` — which
> typechecks perfectly, draws a plausible panel, and reports one deck's loop
> cost under the other deck's picture.

It also settles the one type question this change raises. `SourceMode` and
`SourceBMode` are different unions — only B can be `'none'`, only A can be
`'webcam'` — and `SlotView<T extends SourceMode | SourceBMode>` handles that by
being generic over the mode. Whatever holds the two modes internally wants the
same treatment; they are the one field where A and B genuinely differ in type,
and they must not be widened into a shared union to make the record fit.

**The source-loading half is finished.** `slotA` and `slotB` are built by one
`makeSlot` factory as of `4062df0`, so `attach`/`setImage`/`setNoise` and the
`lastSrc` bookkeeping behind them exist once.

**Nine things are already `{ a, b }`**: `speed`, `transport` and `cue` as state;
`pickRef`, `cardRef`, `cueRef`, `lastSrc`, `pendingCue` and `loadSeq` as refs.
So the target shape is not a proposal — it is the majority of the file already.

## The evidence

The strongest exhibit is four lines long. `setPick` writes the same fact twice,
in both shapes, side by side:

```ts
const setPick = (key: StashSlot, on: PoolPick | null) => {
  // paired: indexed by key
  pickRef.current[key] = on
  // unpaired: dispatched by hand
  if (key === 'a') setPickA(on)
  else setPickB(on)
}
```

`cardA`/`cardB` have the same shadow in `cardRef`. Two of the seven pairs are
therefore already stored in the paired shape _as well as_ the flat one, which is
the clearest possible statement that the flat one is a leftover.

The same `if (key === 'a') … else …` dispatch appears at two more sites, both
clearing `pendingA`/`pendingB` (lines 823 and 1059). Each collapses to a single
indexed write.

`commitA` and `commitB` are near-identical eleven-line functions; with paired
state they are one `commit(key, mode, …)` whose only genuine branch is B's
`setSourceBEnabled(mode !== 'none')`.

## Exactly what to change

Seven state pairs. Line numbers are as of `4062df0` and will drift.

| pair                         | line    | notes                                                          |
| ---------------------------- | ------- | -------------------------------------------------------------- |
| `sourceMode` / `sourceBMode` | 344,442 | **different types** — keep them so; see `slotView.ts`          |
| `sourceName` / `sourceBName` | 346,443 | see the note below — may not need pairing at all               |
| `pendingA` / `pendingB`      | 350,351 | passed _as a setter_ to `reopenStashed`; needs a `parkOn(key)` |
| `pickA` / `pickB`            | 371,372 | `pickRef` already paired — collapse both into one write        |
| `cardA` / `cardB`            | 377,378 | `cardRef` already paired — same                                |
| `videoA` / `videoB`          | 391,392 | plain, 2 setter sites each                                     |
| `ytUrlA` / `ytUrlB`          | 395,396 | plain, 2 setter sites each                                     |

Three ref pairs are the same shape and can follow, or not: `videoRef`/
`videoBRef`, `typerARef`/`typerBRef`, `fileInputRef`/`fileInputBRef`. These are
lower value — `VideoSlot` already hands `ref` and `typer` to the code that uses
them, so the pair is only visible at construction. `fileInputRef` is a DOM ref
handed to JSX and probably wants leaving alone.

**A cheaper win hiding in the table.** `setSourceName`/`setSourceBName` are
passed by value into `downloadYouTube(slotA, trimmed, fresh, setSourceName, …)`
as its `label` parameter — but `slot.setName` is _already_ that setter, on the
slot object passed in the same call, and the function's very next line
(`slot.setYtUrl(url)`, line 1141) is already reaching through the slot for its
sibling. Having it read `slot.setName` deletes the parameter and two uses of the
pair with no state change at all. Worth doing first and separately; it is a few
lines and independently correct.

## The four traps

**1. Two slots set in one tick — the only way to actually break this.** The boot
path sets both modes in one synchronous body:

```ts
if (params.src !== null)  { …; setSourceMode(params.src) }    // ~line 1432
if (params.srcb !== null) { …; setSourceBMode(params.srcb) }  // ~line 1437
```

As two independent states this is fine. As one record,
`setMode({ ...mode, a: x })` followed by `setMode({ ...mode, b: y })` reads the
_render-time_ `mode` twice and the second write silently drops the first — a
link with `?src=` and `?srcb=` would boot with A's source lost. **Every paired
setter must use the functional form**, `setMode(m => ({ ...m, a: x }))`. `tsc`
will not catch this; nothing will, until a two-source link is opened.

This is the single reason to be careful, and it is worth grepping the finished
diff for `set[A-Z]\w*\(\{` to confirm no direct-object update survived.

**2. Setters passed as values.** `reopenStashed('a', setPendingA)` hands the
setter itself to a callback. Paired, the call site needs a small adapter
(`parkOn('a')`) rather than a bare setter. There are two such sites.

**3. The mode types must stay apart.** Covered above. A
`{ a: SourceMode; b: SourceBMode }` record is fine; a
`Record<StashSlot, SourceMode | SourceBMode>` is not — it would let `'webcam'`
be assigned to B and `'none'` to A, and the compiler would stop objecting to
precisely the mistake this change exists to prevent.

**4. Do not widen the scope into `gpu/`.** The engine's `setVideoSource` /
`setVideoSourceB` pairs are a related smell and were deliberately left alone in
`4062df0`. Indexing those by slot id ripples through `pipeline.ts` and
`sources.ts`, which is where the pass-order invariants live, for a much smaller
gain. Keep this change inside `useEngine.ts`.

## How to verify it

The honest position: there is no DOM test environment here (no jsdom, no
happy-dom, no testing-library), so `useEngine` cannot be rendered in a test, and
none of this will be covered by `vitest`. What is available:

- **`tsc` covers more than it appears to.** Every consumer of these values is
  typed, and nothing leaks outside `useEngine` — the only external references to
  the flat names are `app.tsx`'s `ytUrlA`/`ytUrlB`, which are the _flat wire
  format_ being fed to `useUrlState` from `eng.a.ytUrl`/`eng.b.ytUrl` and are
  unrelated to internal state, and `vote/votes.ts`, where they are a serialized
  field name. So a rename that misses a site is a compile error, not a runtime
  surprise. The exception is trap 1, which is type-correct and wrong.
- **The browser is the real check**, and the cases worth actually opening are
  the ones where the two decks are used together: a `?src=…&srcb=…` link (trap
  1), a file on each deck then a device rebuild (`lastSrc` restore), a pool roll
  on each deck, and a teletype card on each.
- Long or repeated browser runs belong on a `git worktree add --detach` copy
  with its own vite server — this worktree is usually shared, and an `src/`
  write mid-run is HMR that resets the engine underneath whatever is being
  measured.

## What this is worth, honestly

It removes a class of mistake rather than lines: seven pairs is fourteen chances
to write `a` where `b` was meant, and the failure is quiet — the right picture
with the wrong deck's caption, cue, or stash under it. That is exactly the fault
`slotView.ts` was written to kill on the way out, and this is the same fault on
the way in.

It is not urgent. Nothing is known to be broken today; the pairs are currently
consistent. This is prophylactic work, and it should be done when `useEngine.ts`
and `app.tsx` are not both being edited by someone else — the change is
mechanical but it touches several dozen sites in one file, and it will conflict
with anything else in flight there.

## What was actually broken, which was something else

Found while establishing a baseline for the above, and worth more than the
refactor was: **`pnpm compiler` was failing, on this file, and had been since
`4062df0`** — the commit that built both slots from one factory. Bisected:

    4062df0~1  ok   useEngine
    4062df0    FAIL Cannot access refs during render  (x2)

The two errors point at the `makeSlot('a', {…})` / `makeSlot('b', {…})` call
sites, not at anything inside, and the detail names the cause exactly: _"Passing
a ref to a function may read its value during render."_ The `wiring` descriptor
carried the slot's two refs outright and three closures over `engineRef`, and
either is enough — a ref only _captured_ by a closure in the object passed
counts. `useEngine` was therefore unmemoized, which is `App`'s ~200 control rows
reconciling on every write that touched none of them. Nothing else in the build
reports this; that is what `scripts/compilercheck.mjs` exists for, and its
`KNOWN` list never had `useEngine.ts` on it, so this was a red gate rather than
a recorded bailout.

The fix keeps the factory and deletes its argument: `makeSlot(id)` reaches the
refs and the four React mirrors by `id`, and the three EngineApi entry points —
genuinely per-slot methods — branch on `id` inside the shared body. Nothing
ref-ish crosses the call, and `useEngine` optimizes again (131 optimized, 7
known bailouts, none here). This is the same finding `slotView.ts` records for
`makeSlotView`, in a second position, so the rule is worth stating plainly: **in
this hook, a helper called during render must not be handed anything that holds
or closes over a ref.** Re-check with `pnpm compiler` if `makeSlot` ever grows a
parameter again.
