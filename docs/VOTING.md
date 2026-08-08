# Teaching the app which looks are good

Two ways of collecting labels, feeding one dataset: a `tags` menu inside the
app, and a pairwise comparison page at `/vote.html`. The goal is to answer
"which settings are cool" with a model rather than with `surprise`'s uniform
roll.

## The app's tags menu — the main collector

One button in the look bar beside `saved` (`src/ui/TagsPopover.tsx`). It
describes whatever is on screen: ten perceptual tags, and a 1-5 rating that
files the row and closes the menu in one click.

It is in the app rather than only on the labelling page for one reason — a
separate page only ever collects from someone who set out to label, which is one
person on a good evening. The app is where looks are already being made and
looked at.

Three objections to collecting here turn out not to bite, and one does:

- **"It isn't blind — you can see the preset chips."** The model's target is
  this user's taste, and knowing a look is built on vhs is part of that taste
  rather than noise contaminating it.
- **"The stimulus isn't controlled."** Judging looks over your own content is
  the deployment condition; training on it is more correct than training on
  bars.
- **"The sample isn't random."** True of browsing, false of rolling — `surprise`
  draws from the same distribution the labelling page samples, so a run of
  surprise-rate-surprise is an unbiased sample sitting inside a biased
  collection. Every row carries `provenance` so it can be sliced back out.
- **What does bite: rating must be cheaper than moving on.** If scoring a bad
  roll costs more than rolling again, nobody scores the bad ones and the dataset
  is all positives — the one shape a preference model cannot be fitted from.
  Hence one click to commit and no confirm step.

**Nothing leaves the browser until somebody signs in.** A signed-out session
queues to `localStorage` and never uploads; signing in is the consent, not a
checkbox.

### The vocabulary, and why it avoids mechanism

`calm violent warm cold geometric organic legible destroyed rhythmic dreamy`

There is deliberately no `vhs` or `feedback` tag. The record already stores the
preset weights and the resolved board, so a model can read the mechanism
straight off the parameters; what it cannot read is how the result _feels_, and
that is the only thing a human is adding. Every tag above cuts across mechanism
— two unrelated recipes can both be calm and warm, and learning that mapping is
the point.

`TAG_SET_VERSION` is stamped on every row. Adding an eleventh tag does not
retroactively label the rows already collected — those are simply silent about
it. Cheap to represent, not cheap to fix, so the list is worth getting right
early.

### What a rating row holds

`/ratings/{auto}` — private to its author, immutable, unqueryable from a client.

```
{ v, tagSet, look, query, weights, preset, provenance, tags, cool, ms, source, at, by, sat }
```

`look` is a hash of the **resolved board**, not of a preset recipe — a look
dialled in by hand has no recipe behind it, and both collectors have to land in
one key space. `query` is the app's own `?set=` string, so prefix the origin and
the link _is_ the look.

`provenance` (`surprise` / `preset` / `mutate` / `hand`) is a best-effort hint.
The question that actually matters — "was this an untouched roll?" — is answered
offline and needs nothing from collection time: `weights` and `query` are both
stored, so a row whose query is what those weights serialize to _is_ an
untouched recipe, whatever the hint says.

## The comparison page — the clean holdout

`/vote.html`, a separate vite entry (`src/vote/main.tsx`) so a visitor to
`index.html` never downloads a byte of it. It is no longer the main collector —
the app's tags menu is — but it keeps a job the app cannot do: absolute ratings
drift between sessions (what you called a 4 today is a 3 next week), while
pairwise comparisons are scale-free. So the comparisons are the anchor that
calibrates the 1-5 scale, and the small blind unbiased set you _evaluate_ on. A
hundred or two is enough for that, which is an evening.

It rolls a pair of candidates onto **two engines running side by side**, lets
them develop, and writes down which one you picked.

`←` / `→` pick, `↓` skip, `n` both bad, `r` another pair (records nothing).

There is no recording step. An earlier version rendered the two candidates one
at a time and captured each to a webm the page looped in a `<video>`, because
with one engine they could not both be on screen. Two engines made that
apparatus pointless and dropping it was not just simplification:

- **The develop time stopped being dead waiting.** A clip could not be shown
  until it existed, so every pair began with a stare at nothing. A live canvas
  is watchable from the first frame, and watching a feedback look bloom is part
  of judging it.
- **No codec between the labeller and the pixels.** VP9 on grain and dot crawl
  is worst case for a codec — every frame a fresh noise field — and if it
  mangled one candidate's texture differently from the other's, the vote was
  partly about the encoder.
- **The pair is simultaneous in the strongest sense**: not the same number of
  frames each, but literally the same frames, on the same clock.
- **A failure mode went away.** A clip recorded in a throttled tab came back
  with a handful of frames and had to be detected and discarded; a live canvas
  in a throttled tab is just a slow canvas, equally on both sides.

**Both engines share one GPUDevice.** `initGpu` stashes the device it creates
and hands it to the next caller, so the second `Engine.create` configures a
second canvas against the first one's device: one device, two swapchains,
`gpuBuilds()` still 1. Nothing here touches the budget `docs/adr/0004` is about.
That reuse is why the two creates are **sequential, not concurrent** — run in
parallel they would both race past the "is a live device stashed?" check and the
page would cost two devices instead of one.

Measured on Firefox Nightly / Linux, in an occluded harness window: **3.7 s from
a vote to the next judgeable pair** (it was ~11 s with the recorder), and both
engines presenting at the same rate as each other — 21-27 fps each. Whether that
ceiling is GPU load or the rAF throttling an unfocused window applies has not
been separated; the page shows a live per-side fps readout so it can be read on
a focused window. The rate does not skew the experiment either way, because both
sides always come back equal and the develop gate is wall-clock.

## The search space

A candidate is a **recipe**: a sparse weighting over the ~70 authored presets,
which `blendPresets` expands into the full ~215-control board. This is the same
space `randomPresetMix` samples for the `surprise` button.

That choice is the whole reason the project is tractable. A human casts a few
hundred votes, and no preference model fits 215 free dimensions from that. Two
or three preset weights is a space a few hundred comparisons say something
about. The resolved controls ride along in each candidate record anyway, so a
later model is free to look at them instead.

Sampling is seeded (`src/vote/candidates.ts`). A label that could not be
re-rendered would be worthless, so a recipe carries the seed that produced it
and a pair regenerates from one number.

## What is recorded

Two collections, because that is the shape a Bradley–Terry fit wants — items,
and comparisons between them.

`/candidates/{id}` — one per recipe, id = a hash of the weighting, so two people
rolling the same look write one document. Immutable by rule.

```
{ v, id, seed, kind: 'mix' | 'anchor', weights: {presetName: weight}, query, by, sat }
```

`query` is the resolved board as a `?set=` string from the app's own serializer:
prefix the app's origin and the link **is** the look, so any row in the training
set can be opened in the instrument. It is source-agnostic on purpose.

`/votes/{auto}` — one per comparison. Immutable and undeletable by rule.

```
{ v, a, b, choice: 'a'|'b'|'skip'|'neither', ms, seed, source, at, by, sat }
```

- `a` / `b` are candidate ids **in the order they were on screen**, not
  normalized — so a left-hand bias is measurable after the fact.
- `ms` is deliberation time, a cheap confidence proxy and the honest way to find
  the votes cast while not really looking.
- `at` is the client clock, `sat` is the server's. The gap between them is a
  vote cast offline and flushed later.
- `by` and `sat` are pinned by the rules; a client cannot forge who voted or
  when.

Votes are queued in `localStorage` first and flushed on sign-in, so the first
session is not wasted and no label is lost to a dropped connection.

## Exporting it for training

```
node scripts/labels.mjs [outDir=labels]
```

Writes `ratings.jsonl`, `votes.jsonl`, `candidates.jsonl`, and two flattened
tables:

- **`ratings.csv`** — one row per rating with the tags as one-hot columns
  (`tag_dreamy`, `tag_calm`, …). The shape ten independent per-tag regressions
  want.
- **`ratings_weights.csv`** — long form, one row per (rating, preset, weight).
  This is the design matrix for attributing a tag to the presets behind it:
  regressing the tag one-hots on these weights is what separates "worn tape is
  dreamy" from "the look it happened to appear in was dreamy".

It also prints how many ratings came from `surprise` rolls and how many distinct
presets they cover — the two numbers that decide whether anything can be fitted
yet. Coverage is the binding constraint, not volume: each roll names 2-3
presets, so ~150 rolls gets each of the ~70 presets seen about five times.

The rules deliberately allow `get` and not `list`, so no signed-in client can
enumerate these collections — a stranger cannot pull the pool down. That makes
export an admin job, and the script authenticates two ways: a service-account
key in `GOOGLE_APPLICATION_CREDENTIALS` (the robust path, and the one for CI or
another machine), or the credential `firebase login` already left on this
machine (zero setup, but it reads firebase-tools' own config, so it is what will
break first if the CLI changes).

Set `FIRESTORE_EMULATOR_HOST` to run it against the emulator instead — which is
how the flattening is tested, and how to dry-run a change to it without touching
the real database.

`pnpm test:rules` exercises the whole rules boundary against the real rules
engine.

## The biases this is built to avoid

Worth knowing before trusting the data, because each of these would have quietly
made the labels about something other than the look:

- **Blind.** Nothing on screen names a preset, a weight or a seed. A labeller
  who can see that the left canvas is built on a look they already like is not
  judging the canvas.
- **Identical boxes.** The two previews match in size, border and background,
  and neither has a hover that lifts it. Anything that makes one side prettier
  to look _at_ becomes a bias in the dataset.
- **Same stimulus.** Both sides are rendered over the same synthetic source
  (`bars` or `sweep` — pure functions, identical on every machine, no fetch and
  no decode timing to vary), at a pinned 640×480 raster that does not follow
  devicePixelRatio.
- **Same time to develop.** Feedback and tape looks bloom over seconds — the
  gallery harness steps 150-900 frames for the same reason — so both sides get
  the same develop window on the same clock before either can be voted on.
- **Decontaminated.** An engine each means neither candidate develops in the
  other's leftovers. What is left is across _pairs_ — the left engine goes
  straight from this pair's left candidate to the next one's — so both engines
  are flushed to stock signal between pairs, and which recipe lands on which
  side is randomized from the seed.
- **Anchors.** ~15% of pairs put a hand-authored preset on one side. It
  calibrates the scale, and it is the control for a model that has only learned
  to recognise the 70 curated looks.
- **Equal frame rates.** The two engines share one device and are measured
  separately, so the readout shows both — a stutter on one side only would
  collect a vote about the stutter. It turns amber below 20 fps on either side.
  (Every run so far has come back exactly equal; a persistent gap would be worth
  investigating rather than voting through.)

## Timing

`FLUSH_MS` 600 then `DEVELOP_MS` 3000, both wall-clock rather than frame counts.
Frame counts were the first instinct and they were wrong here: two engines on
one device run slower than one, so a fixed count stretched the wait in
proportion to how busy the GPU was. Seconds are what the labeller experiences,
and both sides develop for the same seconds whatever rate the loop manages.

The pick buttons stay disabled until the develop window passes, because an
answer at frame three is an answer about two looks that had not arrived yet.

## How many labels is enough

`node scripts/affinity.mjs simulate` answers this rather than guessing at it. It
generates ratings from a known affinity, fits, and measures how much came back,
averaged over eight independent ground truths per row:

```
ratings   tag r    cool r
    100    0.23     0.65
    200    0.25     0.80
    400    0.39     0.87
    800    0.49     0.92
   1600    0.66     0.96
```

**`cool` is usable at ~200 ratings; the tags need something like 1600.** The
reason is information per row: `cool` is 1-5 and every rating carries it, while
a tag is one noisy bit that is mostly absent. An earlier estimate of "about 150
for everything" was wrong by roughly 10x for the tags.

What follows for the order of work: **`surprise: cooler` is an evening or two of
rating away, and `random → dreamy` is a much longer haul.** Build the first one
first. It also argues for a small, high-prevalence tag vocabulary — a tag picked
40% of the time carries far more than one picked 5%.

Two things this simulation cannot settle, which the real data will. Whether tags
cluster by preset family (if all the Tape wear presets really are dreamier, the
sampler could steer at the _group_ level, where there are ten parameters instead
of sixty-four and the roll already makes its choice — but a simulation that
assumed no clustering cannot tell you). And whether a real person's tagging is
as noisy as the model assumes.

Two things worth knowing about the fitter itself. It is verified: against a
noiseless target it returns r = 1.000 at every sample size, so the numbers above
measure noise rather than bias. And it had a bug that this check is what caught
— it centered the target but not the columns of the design, leaving no intercept
to absorb the base rate. It did not look like a bug; it looked like a hard
problem needing more data.

## Then what

The votes are the input to a preference model — the ML half of the idea, and not
built yet. The shape it is aimed at:

1. A heuristic viability filter on image statistics (black, blown out, frozen,
   flat) — the baseline the learned model has to beat, and the pre-filter that
   stops humans voting on garbage.
2. A warm start with no votes at all: the 70 authored presets are "cool" by
   construction and turbo-mutate rolls mostly are not, so a classifier can be
   trained before the first label is cast.
3. A Bradley–Terry head on the real votes, over the preset-weight vector plus
   frozen pretrained vision features of the clip frames.
4. Active learning — show the pairs the model is least sure about.
5. Search: CMA-ES over preset weights with the model as fitness. That is the new
   `surprise` button, and the blind A/B against the current one is the number
   worth reporting.
