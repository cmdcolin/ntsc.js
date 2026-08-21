# Changelog

All notable changes to ntsc.js are documented here.

## [0.29.1](https://github.com/cmdcolin/ntsc.js/compare/v0.29.0...v0.29.1) - 2026-08-21

### Features
- *(ui)* [`3ace6d8`](https://github.com/cmdcolin/ntsc.js/commit/3ace6d8209d4cdd43ebffddfcbbc12036ee15e12) fetch any yt-dlp URL, report the wait, and shelve what lands

## [0.29.0](https://github.com/cmdcolin/ntsc.js/compare/v0.28.12...v0.29.0) - 2026-08-21

### Features
- *(gpu)* [`45bda89`](https://github.com/cmdcolin/ntsc.js/commit/45bda89b9009bd1e907aa10e2e7e40a1500e7d53) headless per-pass GPU profiler on Deno, with WGSL binding reflection
- *(ui)* [`9970075`](https://github.com/cmdcolin/ntsc.js/commit/9970075627e17bb9a840219de874dd37c2ed7d3e) pick, hold and eject a source from the slot's own row
- *(ui)* [`b9b408f`](https://github.com/cmdcolin/ntsc.js/commit/b9b408ffc5068af47ff82edee37120ab257796a6) eject any source off a deck, not only a clip
- *(signal)* [`5711d66`](https://github.com/cmdcolin/ntsc.js/commit/5711d66d49b7b0f4d6be1a3116565284dd5d90e3) model the deck a source file was captured off, ahead of the chain

### Performance
- *(gpu)* [`0ceaab8`](https://github.com/cmdcolin/ntsc.js/commit/0ceaab80208e3b8dd02067b81e0e640e90ac1594) fold the RGB->YUV pass into encodeComposite for source A
- *(gpu)* [`7e74b3a`](https://github.com/cmdcolin/ntsc.js/commit/7e74b3ad44d254c93838313653708c0fc7ea9361) bake the phosphor grain field once instead of hashing it per frame
- *(gpu)* [`a359316`](https://github.com/cmdcolin/ntsc.js/commit/a359316784dbaac60679cbdca9cc2ad1ddaba1cc) run the feedback camera's gather only while it is patched in
- *(gpu)* [`1d255dc`](https://github.com/cmdcolin/ntsc.js/commit/1d255dc1bb16f05cb242deb4f3c5d6139fbf31a8) tier the halation gather on strength, as bloom already does
- *(gpu)* [`f05d86f`](https://github.com/cmdcolin/ntsc.js/commit/f05d86f3dc1f06c38134efddc052bad4eab955ed) read source B's texel in its three encoders; delete encode_yuv
- *(gpu)* [`d605e42`](https://github.com/cmdcolin/ntsc.js/commit/d605e4245ca1e7c20558f1c0a32fb49fc1a3e3f7) keep channel's colour-under path in shared memory under a Y/C delay, and table the FM fold
- *(gpu)* [`a8ea1b6`](https://github.com/cmdcolin/ntsc.js/commit/a8ea1b60f91a8232ea814dd4b3f7f53472b468d0) walk the flywheel and the deflection sag in two waves
- *(gpu)* [`64e61b6`](https://github.com/cmdcolin/ntsc.js/commit/64e61b693d1eeafdcf9ac43c4ce91cc0b8f55cf4) apply the gun's cutoff and gamma where decode writes the screen
- *(gpu)* [`b614725`](https://github.com/cmdcolin/ntsc.js/commit/b61472587079447e744aec6a59d8a71e91171752) drop channel's threshold table; it cost 0.2 ms at stock while never running
- *(gpu)* [`b8f1917`](https://github.com/cmdcolin/ntsc.js/commit/b8f1917fdff9813a498153ccffa8fdafe87db1f1) design tape_play's head layout once per workgroup
- *(gpu)* [`da83d5e`](https://github.com/cmdcolin/ntsc.js/commit/da83d5e2d7443f4866714e11d4db52cfadc2ef0c) saturate each gather's result once instead of every tap

### Refactor
- *(gpu)* [`b4e8130`](https://github.com/cmdcolin/ntsc.js/commit/b4e8130fb6679ea1e1e8481641939d53055ff535) lift uniform packing and the filter-bank design out of Engine

### Documentation
- [`9c30ebe`](https://github.com/cmdcolin/ntsc.js/commit/9c30ebe47c7fe7adfc3a1266ad728ac93b707c9a) record the headless profiler and what its first pass measured
- *(gpu)* [`5ffcb98`](https://github.com/cmdcolin/ntsc.js/commit/5ffcb9878696f17621a7fe226c3ba39e64cd3fd8) the Firefox confirmation of the stock-frame wins
- *(gpu)* [`bd8d20d`](https://github.com/cmdcolin/ntsc.js/commit/bd8d20dce34abcf3f622fa840b7e06135b477494) the second profiler pass — the looks, two reverted arms, sync in two waves
- *(gpu)* [`4c4ac8b`](https://github.com/cmdcolin/ntsc.js/commit/4c4ac8be9214d26a21faf48623ebe11ab41a6b86) the Firefox confirmation of the second pass
- *(handoff)* [`d000dd8`](https://github.com/cmdcolin/ntsc.js/commit/d000dd891e72bfb1ebfccfd2896846939f8524ea) the headless profiler, and the frame time it has not yet taken

### Other Changes
- [`a0d3e4d`](https://github.com/cmdcolin/ntsc.js/commit/a0d3e4d97a92487423a548fe77557572532b3296) Another sample

## [0.28.12](https://github.com/cmdcolin/ntsc.js/compare/v0.28.11...v0.28.12) - 2026-08-21

### Fixes
- *(audio)* [`ff8dd5e`](https://github.com/cmdcolin/ntsc.js/commit/ff8dd5e02c6cfae3a6a49fe47308ba60c87ce6dc) upload the waveform even while the input is off

### Refactor
- *(ui)* [`d863849`](https://github.com/cmdcolin/ntsc.js/commit/d86384952d352d6cf4b6ac808c32cb834e4bb76c) name the model modules apart from their components

## [0.28.11](https://github.com/cmdcolin/ntsc.js/compare/v0.28.10...v0.28.11) - 2026-08-20

### Features
- *(ui)* [`89d15fa`](https://github.com/cmdcolin/ntsc.js/commit/89d15fa8f0ac96bb7b279cc1696f8d918c142425) a preset for colour driven past the output stage's rails
- *(ui)* [`9b517ce`](https://github.com/cmdcolin/ntsc.js/commit/9b517ce05edc1eef73fa2e5548663921442debdc) a teletype card can arrive over a wire bad enough to misspell it
- *(ui)* [`c537602`](https://github.com/cmdcolin/ntsc.js/commit/c5376027d7807ed34cd191913d4d901c6ff3f49d) a garbled card can deliver a line to the wrong row
- *(ui)* [`d14d4ff`](https://github.com/cmdcolin/ntsc.js/commit/d14d4ffb996e9028eb4a42cb75c44154a2551041) isolate the output-stage rails, and put the sound through them

### Documentation
- [`200e6cb`](https://github.com/cmdcolin/ntsc.js/commit/200e6cb162a8ca1286ae3553e3815587f8d71adc) the card's timer now carries three animations, not two

## [0.28.10](https://github.com/cmdcolin/ntsc.js/compare/v0.28.9...v0.28.10) - 2026-08-19

### Fixes
- *(ui)* [`2abafc3`](https://github.com/cmdcolin/ntsc.js/commit/2abafc34727228b9d86ddad8da9c21f82f9e2c0e) the open stage's head stops painting over the map

### Refactor
- [`5a6526b`](https://github.com/cmdcolin/ntsc.js/commit/5a6526b3266c5524cb58be9480de66441f194093) put the signal path under src/core, and hold the boundary in lint

### Documentation
- [`cfb00a9`](https://github.com/cmdcolin/ntsc.js/commit/cfb00a90990f10c4a42df28d95d4736c5c0871c2) name the core/app split and the paths that moved with it
- [`c79b02e`](https://github.com/cmdcolin/ntsc.js/commit/c79b02e2fb95a0c18974f3aaf4ed0d805c70e3fd) rewrap the paragraphs the longer core paths pushed past 80 columns

### Tests
- *(ui)* [`54464e9`](https://github.com/cmdcolin/ntsc.js/commit/54464e9d87d6a18882c5f225a7faab6df237f76b) panelcheck can find the strip once a routing is held

## [0.28.9](https://github.com/cmdcolin/ntsc.js/compare/v0.28.8...v0.28.9) - 2026-08-19

### Features
- *(ui)* [`375667e`](https://github.com/cmdcolin/ntsc.js/commit/375667ec925f308a6b0eee3ba156a18224c063e6) the boxes with a picker say what is standing in them
- *(ui)* [`bcd632a`](https://github.com/cmdcolin/ntsc.js/commit/bcd632aeeb6409ddf03cc49a66a445eec31d93c8) the diagram card captions its picker boxes too
- *(ui)* [`180f60d`](https://github.com/cmdcolin/ntsc.js/commit/180f60db41b5fca1630efa6e725012c262ed5d2e) a wire can land on another wire's depth or rate
- *(sync)* [`8521ae3`](https://github.com/cmdcolin/ntsc.js/commit/8521ae3478791f4fab5e2eace61e9357858e237f) a paperclip held against a point inside the set

### Documentation
- [`afedbec`](https://github.com/cmdcolin/ntsc.js/commit/afedbeca3c162dcc7ad75ba11e85414be69db3a2) generate EFFECTS.md from the control table, split the prose into FEATURES.md
- [`a05c6d0`](https://github.com/cmdcolin/ntsc.js/commit/a05c6d0bc7d560e9ca3b7b7567a3d7516a52867f) pull the feedback-loop prose from LOOP_STAGES

### Tests
- [`466c02e`](https://github.com/cmdcolin/ntsc.js/commit/466c02ee94b21c3f670f74602c4c836f2b115c22) pin the user guide's countable claims to their constants

### Chores
- [`6605cea`](https://github.com/cmdcolin/ntsc.js/commit/6605ceaf86d82b9fa1e2bad832112d0ecc1f4692) gate the generated page in build, not in a pre-commit hook

## [0.28.8](https://github.com/cmdcolin/ntsc.js/compare/v0.28.7...v0.28.8) - 2026-08-19

### Fixes
- *(ui)* [`1c6b2e9`](https://github.com/cmdcolin/ntsc.js/commit/1c6b2e90c13b05b350b96fa91f5403242d86303b) the motion count says what pressing it will show, and `/` opens the filter

### Refactor
- *(ui)* [`119625c`](https://github.com/cmdcolin/ntsc.js/commit/119625cb3cb0a7bc07cc8de36a6f5848e5701817) draw the free boxes in the map, not beside it

### Documentation
- [`674a9c8`](https://github.com/cmdcolin/ntsc.js/commit/674a9c89748f681fba1393bbcdbb5a4e29734580) a FAQ for the integration questions
- *(ui)* [`1070698`](https://github.com/cmdcolin/ntsc.js/commit/107069822c6489841e59d3faa82fe5db5c902c41) the two drawings carry the same free row again
- [`656e9f7`](https://github.com/cmdcolin/ntsc.js/commit/656e9f79dc093b5027ad96543fc62f534ce5dbb5) recapture the two figures the map's new shape moved
- [`4ea76e2`](https://github.com/cmdcolin/ntsc.js/commit/4ea76e29da8278f79a9087754a74ae286df13658) lead the readme's signal path with the boxed window shot
- [`b15f02f`](https://github.com/cmdcolin/ntsc.js/commit/b15f02f27d270f292279e934ebbd8dc9f11871bf) put the three FAQ answers in the readme
- [`6de305c`](https://github.com/cmdcolin/ntsc.js/commit/6de305c9a4b362559da786c0dd0ae007cad06ef5) correct the user guide against the source
- [`7f3f4a8`](https://github.com/cmdcolin/ntsc.js/commit/7f3f4a8694a4027845ec1425650aa4aa0fd74ec9) one figure for the signal path, composed rather than captured

### Style
- [`281b7aa`](https://github.com/cmdcolin/ntsc.js/commit/281b7aa5c380790d252240d22ba10c9f197e11e4) run oxfmt over the readme

## [0.28.7](https://github.com/cmdcolin/ntsc.js/compare/v0.28.6...v0.28.7) - 2026-08-19

### Fixes
- *(ui)* [`b41df87`](https://github.com/cmdcolin/ntsc.js/commit/b41df87427c269f1ffadfac1d0d7ba194fc73568) set the free chips at the map's size, not the panel's

### Refactor
- *(ui)* [`379ed22`](https://github.com/cmdcolin/ntsc.js/commit/379ed2223c3757a075783d20b10d0507fc473371) the motion filter is a mode, not a magic query string

### Documentation
- [`91196d5`](https://github.com/cmdcolin/ntsc.js/commit/91196d5a19037fcfa05d5162448bf254761ffdbe) lead the readme with the signal path diagram
- [`1328146`](https://github.com/cmdcolin/ntsc.js/commit/13281467bd510b34a2f6fbbf21008cc0639abfff) show the sidebar's own signal path map in the readme
- [`16990d2`](https://github.com/cmdcolin/ntsc.js/commit/16990d21e24660b777a32367335e62a39f45b481) document shift+i and ctrl+y in the keyboard table

## [0.28.6](https://github.com/cmdcolin/ntsc.js/compare/v0.28.4...v0.28.6) - 2026-08-19

### Refactor
- *(ui)* [`acf61b5`](https://github.com/cmdcolin/ntsc.js/commit/acf61b58a8a07ffffc428badbc35d1ba81604cb0) one shuttle ring, not one per surface
- *(ui)* [`4f9a42c`](https://github.com/cmdcolin/ntsc.js/commit/4f9a42c59720b19dd9f16b810c17572b6c469c9b) shuttle strip is a native range input

### Documentation
- [`b6e3829`](https://github.com/cmdcolin/ntsc.js/commit/b6e3829fc41d3bda8719a3b70ce5e00fc79e116d) tighten the user guide

### Style
- [`e83c5c1`](https://github.com/cmdcolin/ntsc.js/commit/e83c5c16b29765980d812367eb37fff9f938d7ae) run oxfmt over README.md and docs/COMPARISON.md

### Other Changes
- [`5d27caf`](https://github.com/cmdcolin/ntsc.js/commit/5d27cafcc8356e2a8372f0e0793000739a1ec5ee) New

## [0.28.4](https://github.com/cmdcolin/ntsc.js/compare/v0.28.3...v0.28.4) - 2026-08-18

### Features
- *(ui)* [`aa50de2`](https://github.com/cmdcolin/ntsc.js/commit/aa50de2d719299bdd5f39d561c096c76da0db719) three more shapes of roll, and a nudge that is one again

### Fixes
- *(ui)* [`a8a071f`](https://github.com/cmdcolin/ntsc.js/commit/a8a071fe6f1068ab57447f4cf9edcee60a6e6d7d) a rated roll stops filing itself as hand-made
- *(ui)* [`f75dd0b`](https://github.com/cmdcolin/ntsc.js/commit/f75dd0b57e29c8e7d188b3fadb7fd77d4c2a0139) a rated roll stops filing itself as hand-made

## [0.28.3](https://github.com/cmdcolin/ntsc.js/compare/v0.28.2...v0.28.3) - 2026-08-18

### Features
- *(audio)* [`b299dbc`](https://github.com/cmdcolin/ntsc.js/commit/b299dbce6f2644aece7818c89c4b5fc3eb565405) the tail adds to the clips, and the dry gets a fader of its own
- *(ui)* [`de5f2bb`](https://github.com/cmdcolin/ntsc.js/commit/de5f2bbd1313f21b2479a94aea8ff194f821d0a3) a morph crosses a control along its track

### Fixes
- *(ui)* [`714343e`](https://github.com/cmdcolin/ntsc.js/commit/714343e5fbab9909f8b1fbee1462754c579513ac) a roll stops stumbling into a smear that never clears
- *(ui)* [`5d9fd8f`](https://github.com/cmdcolin/ntsc.js/commit/5d9fd8fb9e8f0db50766c4e910f43c85daded885) random look stops starting a strobe
- *(ui)* [`01a3ae1`](https://github.com/cmdcolin/ntsc.js/commit/01a3ae1ee92e1a9af4540b45ef114b25ef55c7ad) drop the Popeye bundled clip

### Documentation
- [`ef5efbb`](https://github.com/cmdcolin/ntsc.js/commit/ef5efbbfa8bcc19dd8dc054ce51fe890a21c0a89) add BENDR to the comparison page
- [`72b2c2f`](https://github.com/cmdcolin/ntsc.js/commit/72b2c2f1a3e87dd4b41f4238bd3c935b4e45e1cb) the comparison page gives each tool its own subsection

### Other Changes
- [`6aa0123`](https://github.com/cmdcolin/ntsc.js/commit/6aa0123290c723afc93d72eec6aa82de9be03df1) Stray dot

## [0.28.2](https://github.com/cmdcolin/ntsc.js/compare/v0.28.1...v0.28.2) - 2026-08-18

### Documentation
- [`07ac3af`](https://github.com/cmdcolin/ntsc.js/commit/07ac3afa95cb39829c3c2862431696a55c9650ad) an optimizations page for the techniques the frame budget is made of
- [`d53467f`](https://github.com/cmdcolin/ntsc.js/commit/d53467f6c62db4d9ac1d47cf00a7840cf590da84) correct the workgroup-memory section, and the main-thread costs it missed
- *(adr)* [`151c3e9`](https://github.com/cmdcolin/ntsc.js/commit/151c3e97fe26faf5128f03287ab252d49159646f) the FIR passes are not ALU-bound, so ablate before optimizing

### Tests
- [`af72bdb`](https://github.com/cmdcolin/ntsc.js/commit/af72bdb21e287d77a4dbf27e702da642d62470d3) pin the countable claims in OPTIMIZATIONS.md to the code

## [0.28.1](https://github.com/cmdcolin/ntsc.js/compare/v0.28.0...v0.28.1) - 2026-08-16

### Features
- *(ui)* [`745bcfd`](https://github.com/cmdcolin/ntsc.js/commit/745bcfd19d6ab540a40a0a16dae8c73bec6c5d61) a reset in the look bar, and a gate that rides the walk

### Fixes
- *(ui)* [`9e232e7`](https://github.com/cmdcolin/ntsc.js/commit/9e232e7f6a44b3cf6e8c5ccd811bcb226a378d0d) a roll must not start a strobe
- *(ui)* [`ca8b13c`](https://github.com/cmdcolin/ntsc.js/commit/ca8b13c98c230e6cd924fd20608543d4f011f807) a motion roll must not cable a shut gate

### Tests
- [`102615d`](https://github.com/cmdcolin/ntsc.js/commit/102615d7289d5dfb06359dddb2f59b515dcc1c93) panelcheck had been red since the map was reshaped

## [0.28.0](https://github.com/cmdcolin/ntsc.js/compare/v0.27.0...v0.28.0) - 2026-08-16

### Features
- *(ui)* [`9cdbe29`](https://github.com/cmdcolin/ntsc.js/commit/9cdbe2908d0f6cbdcfe38ce67ba44c2274ad2e30) the shelf measures a clip rather than waiting to be told
- *(ui)* [`9f34d3d`](https://github.com/cmdcolin/ntsc.js/commit/9f34d3d7e76197576f97025517ef6a2ae2b01049) a rundown of clips plays at its clips' lengths, and ⎙ renders all of it
- *(ui)* [`da6eead`](https://github.com/cmdcolin/ntsc.js/commit/da6eead6d8017ec5a6c9703f81d052c850d67270) ⎙ says which of four lengths it is about to render
- *(audio)* [`2473e4c`](https://github.com/cmdcolin/ntsc.js/commit/2473e4c4134cc9c35a21fc03b19f05448b19be88) intercarrier buzz — the picture arriving on the audio line
- *(ui)* [`5951491`](https://github.com/cmdcolin/ntsc.js/commit/5951491c33c46b87b02dbc1df17c708c2b93aaba) a rundown of shelf clips prerolls, so its cuts are swaps

### Fixes
- *(ui)* [`92faf86`](https://github.com/cmdcolin/ntsc.js/commit/92faf86999ec6e8ce0de2fae27315af6dc7dcbbc) a row with no clip key fired a clip effect at nothing
- *(audio)* [`1d460d7`](https://github.com/cmdcolin/ntsc.js/commit/1d460d7dff1d3772145cb8d86b321f550026d70b) the buzz is deaf to the roll, and a harness that says so
- *(ui)* [`0d2e2c0`](https://github.com/cmdcolin/ntsc.js/commit/0d2e2c05e6222f29f2483fa8016dc9c5abadebf6) the clip preroll's try/catch cost useEngine its memoization
- *(ui)* [`324b735`](https://github.com/cmdcolin/ntsc.js/commit/324b735f147b649db2ccff34a9dc5fb1b0118a4c) a still must not be prerolled, and a measurement is not an edit
- *(ui)* [`e2e107d`](https://github.com/cmdcolin/ntsc.js/commit/e2e107df3ed0cd873c71e808a38221eacac95eaf) a lookahead that resolves late must not park after its moment

### Documentation
- *(ui)* [`8dfaa05`](https://github.com/cmdcolin/ntsc.js/commit/8dfaa051383e6fa742902cf061153689c29a312b) preroll's "two that can be named" was missing the ordinary one
- *(ideas)* [`489574b`](https://github.com/cmdcolin/ntsc.js/commit/489574bae7bddc366f67b736a63341ce49ff4393) why the buzz detector still runs on the main thread
- *(ui)* [`a71eaf1`](https://github.com/cmdcolin/ntsc.js/commit/a71eaf1cbf31c3aabf54f4f541e2f412034c9c42) the three faults an async lookahead introduced

## [0.27.0](https://github.com/cmdcolin/ntsc.js/compare/v0.26.5...v0.27.0) - 2026-08-15

### Fixes
- *(ui)* [`6638e56`](https://github.com/cmdcolin/ntsc.js/commit/6638e561e24873b53013a83621a2b786128d7332) two reads of localStorage that a blocked store turns into a blank app
- *(ui)* [`2ac3d0c`](https://github.com/cmdcolin/ntsc.js/commit/2ac3d0c7634c0aa6559290c34b072863ec3c2a84) the lookahead nobody spends is now handed back when the walk ends

### Refactor
- [`54fb718`](https://github.com/cmdcolin/ntsc.js/commit/54fb7186e84ae312b765cbd90a6e40e05410dab6) eight private copies of clamp and one of wrap, back onto math.ts
- *(gpu)* [`4426bba`](https://github.com/cmdcolin/ntsc.js/commit/4426bba0e4730c964d38492221a56da4ece0401d) three copies of 'lay a layer over the board' become one
- [`092885a`](https://github.com/cmdcolin/ntsc.js/commit/092885a68eb1aaf1819944dcf07566a116975e64) seven copies of a store's notify half become one Listeners
- [`e080ed9`](https://github.com/cmdcolin/ntsc.js/commit/e080ed9e21c5524446468215fce7a1aa2d1eef61) name the read half too — ControlStore, MorphStore, StatsStore are Store<T>
- *(ui)* [`80db44b`](https://github.com/cmdcolin/ntsc.js/commit/80db44bed7d6ccd5fb09f8468af0150e928099a5) four miniatures, one arrow-key decode
- *(ui)* [`21c5b87`](https://github.com/cmdcolin/ntsc.js/commit/21c5b87aac3ae6d194c4d569c92a21be871b2cb5) NUDGE_STEP is the default, not API

### Documentation
- *(ui)* [`71f27de`](https://github.com/cmdcolin/ntsc.js/commit/71f27de5463216130d9c3c3f60f78093647832e0) the deck refs stay flat, and now say what indexing them costs
- [`2cd1cc6`](https://github.com/cmdcolin/ntsc.js/commit/2cd1cc664a72ce8246359e33657d2046944ce336) listeners.ts header describes both halves, not one

## [0.26.5](https://github.com/cmdcolin/ntsc.js/compare/v0.26.4...v0.26.5) - 2026-08-13

### Fixes
- *(midi)* [`01e8627`](https://github.com/cmdcolin/ntsc.js/commit/01e8627b4b7aa4736d059e2eab3f58066af79655) a second grant would leak the timer that watches the clock

### Refactor
- *(ui)* [`be7195a`](https://github.com/cmdcolin/ntsc.js/commit/be7195ae5086a4174ce3f38a0eb8ac6301a5b655) one walk round the divisions, not one per thing that locks
- *(gpu)* [`f424de0`](https://github.com/cmdcolin/ntsc.js/commit/f424de047ba4148f14cf98116cf0c6dc68916d6a) drop two guards that were answering answered questions
- [`caf3270`](https://github.com/cmdcolin/ntsc.js/commit/caf32705a0edfa929dea18d702571be400d89939) stop exporting the 88 names nothing imports

## [0.26.4](https://github.com/cmdcolin/ntsc.js/compare/v0.26.3...v0.26.4) - 2026-08-13

### Features
- *(ui)* [`ddda289`](https://github.com/cmdcolin/ntsc.js/commit/ddda289f639b390d715411961fa3a16cc55b6aa0) the stab gate's far end can be a look you held
- *(ui)* [`656d69b`](https://github.com/cmdcolin/ntsc.js/commit/656d69bd0467a250189bb573b99747934adf3804) the map holds still, and a query dims what it did not reach
- *(ui)* [`807ce2e`](https://github.com/cmdcolin/ntsc.js/commit/807ce2e17f58a70054097482436300f19b4fbbb1) the map re-proportioned — 24px boxes, and the free row leaves the drawing

### Fixes
- *(ui)* [`3fb62a6`](https://github.com/cmdcolin/ntsc.js/commit/3fb62a6d718c5c4a26b7c6256537c63f102c1765) the filter can reach the modulation bay again
- *(ui)* [`d1ef55a`](https://github.com/cmdcolin/ntsc.js/commit/d1ef55a015447ca84d378d678331a79ecd978fe6) ⌘K answers "strobe" with the gate that is one
- *(ui)* [`9b3fcf4`](https://github.com/cmdcolin/ntsc.js/commit/9b3fcf44b9fd2be6474726ce4863247e039852a2) drop the caret from the open stage — it points at a chip, not a box

### Refactor
- *(ui)* [`4b76386`](https://github.com/cmdcolin/ntsc.js/commit/4b763865f584172e01d7ba0cbe1a6defa4fb2a85) the map is always there, so the head stops asking

### Documentation
- [`d1c1447`](https://github.com/cmdcolin/ntsc.js/commit/d1c1447890beac3e19cb9846c37b22450b56fee7) the gate's far end, in the guide and the backlog
- *(ui)* [`ccf9470`](https://github.com/cmdcolin/ntsc.js/commit/ccf9470a5d06d2def0386fa97409d5e3eca23089) the card keeps the free row, and says why the miniature does not

### Tests
- *(ui)* [`e30afc8`](https://github.com/cmdcolin/ntsc.js/commit/e30afc8e913b58ea9212be7e068c3f55cc66d55d) pin the row the app actually draws, and say which branches are dead

### Chores
- *(ui)* [`f2c8848`](https://github.com/cmdcolin/ntsc.js/commit/f2c8848b59369b6b416df47e546c9e04344f0516) regen the panel baselines — the map's new proportions, and 20 commits of drift

## [0.26.3](https://github.com/cmdcolin/ntsc.js/compare/v0.26.2...v0.26.3) - 2026-08-12

### Features
- *(ui)* [`bcbbb38`](https://github.com/cmdcolin/ntsc.js/commit/bcbbb380e44a73255d1b5db16c0d6ac45c3727c9) a third roll, for what is moving rather than where it rests
- *(ui)* [`8f9ce7a`](https://github.com/cmdcolin/ntsc.js/commit/8f9ce7ae0ef7f1f6baf7aaa9a5c39cdbceb1b1e5) the help dialog becomes an about box — guide, source, version

### Fixes
- *(ui)* [`459efb4`](https://github.com/cmdcolin/ntsc.js/commit/459efb4c18081cf31523eb5226f717c16b798824) a slot head says it is driving, and the name looks like the jump
- *(ui)* [`418aa57`](https://github.com/cmdcolin/ntsc.js/commit/418aa579b011820211542e6f6400ef1b26d4bf1d) the open stage's box gets its top edge back
- *(test)* [`d79d65e`](https://github.com/cmdcolin/ntsc.js/commit/d79d65e36f7a74aaebba69a02e5b9a3704d9767c) the vote-queue cap test was a timeout waiting to happen
- *(test)* [`bcd7acb`](https://github.com/cmdcolin/ntsc.js/commit/bcd7acb573049516b647a83d269372bd270bc4de) panelshots can reach the teletype editor again, and one state at a time

### Refactor
- *(ui)* [`9d573d4`](https://github.com/cmdcolin/ntsc.js/commit/9d573d4801b156baea0504c0569a1e8000c7dc05) the runs go back to one word, and the card keeps the name
- *(ui)* [`166bfbb`](https://github.com/cmdcolin/ntsc.js/commit/166bfbb252d39aab79a3a71bec0e923c76a47ac0) one rail, for every block that hangs off the thing above it
- *(ui)* [`26da467`](https://github.com/cmdcolin/ntsc.js/commit/26da467add914e650c45df876bc76773648e8a78) one picker ladder for both decks, not two kept in step by hand
- *(ui)* [`750dc30`](https://github.com/cmdcolin/ntsc.js/commit/750dc30e615839c298b56e8f0f5324c0c2982664) the frozen box a pad drags against is a hook, not a habit
- *(ui)* [`7788165`](https://github.com/cmdcolin/ntsc.js/commit/778816529dd1566c51921cfdb69a7d2272ef9b88) the URL hook takes a session instead of restating one
- *(gpu)* [`255127b`](https://github.com/cmdcolin/ntsc.js/commit/255127bffd5fe6e30407573976969f1cf7ae9dbf) one slot-texture descriptor, since both slots wanted the same one

### Documentation
- [`a766354`](https://github.com/cmdcolin/ntsc.js/commit/a76635412dd8fb3941dc1f975b20b21d57060fb5) building the pipelines costs 9ms, so the async version was never worth it

### Tests
- *(ui)* [`8d8c93f`](https://github.com/cmdcolin/ntsc.js/commit/8d8c93f6018732a3602ebc526f98476a757340e6) panelshots watches an open stage, and one bad state stops taking the suite with it

## [0.26.2](https://github.com/cmdcolin/ntsc.js/compare/v0.26.1...v0.26.2) - 2026-08-12

### Features
- *(ui)* [`b146af0`](https://github.com/cmdcolin/ntsc.js/commit/b146af0b6ae480d738b413b0ac1d539d1b57886b) the runs say what the machine is, not that it is a loop

### Fixes
- *(ui)* [`a2e25b4`](https://github.com/cmdcolin/ntsc.js/commit/a2e25b4d37493106cda6b0a3b86433581bdfdb11) an open stage is one object, and it says which one while you scroll

### Refactor
- *(ui)* [`6f14427`](https://github.com/cmdcolin/ntsc.js/commit/6f14427e721f93693b53f77845ad6a1211629794) drop the spine's stage blurb, and let a folded group say how much
- *(ui)* [`dbfc366`](https://github.com/cmdcolin/ntsc.js/commit/dbfc366f6851f762b4f4465f4b432a412471cc11) tape loop, and the label moves to where that name is free

## [0.26.1](https://github.com/cmdcolin/ntsc.js/compare/v0.26.0...v0.26.1) - 2026-08-11

### Features
- *(ui)* [`76ae450`](https://github.com/cmdcolin/ntsc.js/commit/76ae45090b1ea5c3bcfd4c4d6e5b5b5a40618b1b) an MP4 demuxer, so frames can come off a decoder instead of a seek
- *(ui)* [`5872e67`](https://github.com/cmdcolin/ntsc.js/commit/5872e67bd68f0775fb52c546c85a4d3aa17a1fc1) pull a clip's frame N as a function of N, off the decoder
- *(gpu)* [`bed7898`](https://github.com/cmdcolin/ntsc.js/commit/bed78986c0c59e9cc5317720632a89a3150cae1e) the take's clock reaches the video, so a clip renders as a function of N
- *(ui)* [`9b93725`](https://github.com/cmdcolin/ntsc.js/commit/9b937253630a7a546b72dbbda80eacc35c253aa0) an offline render waits for the row it just fired
- *(ui)* [`2573c64`](https://github.com/cmdcolin/ntsc.js/commit/2573c6478c6f890af494e0b44abaac858b24499e) a take records the hands, and the render plays them back
- *(ui)* [`e03c877`](https://github.com/cmdcolin/ntsc.js/commit/e03c877468e1de29823db4ca0f5e009bc9c03be3) a row names its clip, so a rundown can be a sequence of clips
- *(ui)* [`c04feb3`](https://github.com/cmdcolin/ntsc.js/commit/c04feb304a0d90355b4fe0c239085719b8f94b06) the shelf can put a clip straight into the rundown
- *(ui)* [`0a237ce`](https://github.com/cmdcolin/ntsc.js/commit/0a237ceabc17be300ac93a1d0fae97b6ccf1eb4c) a row can hold for as long as its clip runs

### Fixes
- *(ui)* [`abe3336`](https://github.com/cmdcolin/ntsc.js/commit/abe3336f7865072ab226f7be187c4b920aac8dd0) the strip stops moving when its own text changes
- [`e99c9ac`](https://github.com/cmdcolin/ntsc.js/commit/e99c9accfcc4d3605b45be5b935ca1b638d188f3) pnpm test stops running other worktrees' suites, and a puller is bounded

### Documentation
- *(ui)* [`ae7d570`](https://github.com/cmdcolin/ntsc.js/commit/ae7d5705e38757dd0c4f34cc99dd9c891b910211) the demuxer's header describes what it does with an edit list
- [`6787c72`](https://github.com/cmdcolin/ntsc.js/commit/6787c7233cf4eec456a13934690c0ad1c51bfc17) what the two routes to frame-exact pull actually cost
- [`f801d6c`](https://github.com/cmdcolin/ntsc.js/commit/f801d6c18985735bf8ab263057deeffc7332c79e) frame-exact pull is wired, and which half of the awaiting sink it is
- *(editor)* [`7bbd27a`](https://github.com/cmdcolin/ntsc.js/commit/7bbd27ab0aeb80f4888f2ce0fb83829bdeb232af) automation recording is landed, and the funnel it named was wrong
- *(editor)* [`3a8f6dd`](https://github.com/cmdcolin/ntsc.js/commit/3a8f6dd5440437f5129c78a6f43e141200fc8d73) the row's clip landed, and it was the gap that mattered
- *(editor)* [`8e30abf`](https://github.com/cmdcolin/ntsc.js/commit/8e30abfd67a51fbd065ed62437788854e01e4ddd) the strip is a rundown that reads like a filmstrip

### Tests
- [`00ee370`](https://github.com/cmdcolin/ntsc.js/commit/00ee370a937a734093d564ab42275705a432c51b) measure both routes to frame-exact video pull, and close one
- *(ui)* [`4a6df7b`](https://github.com/cmdcolin/ntsc.js/commit/4a6df7b1c6048102068724dd29dfa23ecbc37a8b) the harnesses ask whether a tape reaches the file, and the tray
- *(render)* [`a7731f3`](https://github.com/cmdcolin/ntsc.js/commit/a7731f3007272a733aee2d82109d86112a2e7b58) the recorder arm steps the engine instead of sleeping

## [0.26.0](https://github.com/cmdcolin/ntsc.js/compare/v0.25.7...v0.26.0) - 2026-08-11

### Features
- *(midi)* [`3360b7a`](https://github.com/cmdcolin/ntsc.js/commit/3360b7a58f4c79629585a55b3dcb9cf408abfdab) give notes a binding family of their own
- *(ui)* [`ddbb224`](https://github.com/cmdcolin/ntsc.js/commit/ddbb22444d0f064327899c7a3f3ffe9a9aff36ce) put fire-all on a key, and write the pads up
- *(ui)* [`404418b`](https://github.com/cmdcolin/ntsc.js/commit/404418b20d0e23220537911caf5fd2c06c3f4fce) the rundown, and the walk down it
- *(ui)* [`75189d1`](https://github.com/cmdcolin/ntsc.js/commit/75189d1e3d2b1ae3bd18eedee98308a9f34fad23) run the walk — the sink, the driver, and one apply for both callers
- *(ui)* [`3cc4f59`](https://github.com/cmdcolin/ntsc.js/commit/3cc4f59ea077b790d80bc8fa27009dbee801d4dc) the tray — a rundown under the picture
- *(ui)* [`7ea6e76`](https://github.com/cmdcolin/ntsc.js/commit/7ea6e769afcb1b0c5c64f35ffe43b19700859940) let a row carry a name
- *(ui)* [`3f6256e`](https://github.com/cmdcolin/ntsc.js/commit/3f6256e06a0bde7def20df54cce9d9e183ae6465) make the rundown safe to edit — undo, duplicate, shake rows
- *(ui)* [`dc47294`](https://github.com/cmdcolin/ntsc.js/commit/dc4729464abddfa97e5e9ef18aefbce1f7cc9415) play the rundown and the track together
- *(ui)* [`15d7bb3`](https://github.com/cmdcolin/ntsc.js/commit/15d7bb3f6e2755af05854a71ed43ec89edfb6a88) a constant-framerate MP4, instead of a wall-clock WebM
- *(gpu)* [`aa850c0`](https://github.com/cmdcolin/ntsc.js/commit/aa850c0698ab1cc0dbad2b9537c4c7a2cb283a1d) count time in frames, so frame N is a function of N
- *(ui)* [`447d029`](https://github.com/cmdcolin/ntsc.js/commit/447d0299e6d9a1d078dc397abec5c38c89e57fcd) render a take offline, on frames the render owns
- *(ui)* [`eff8f42`](https://github.com/cmdcolin/ntsc.js/commit/eff8f429796b2504ab8de6e589635303b78cc23b) a render button, so the offline render has a way in
- *(gpu)* [`9cf23ca`](https://github.com/cmdcolin/ntsc.js/commit/9cf23cab3e6fcfe42388b4bf2d0e24e61947d507) a take starts from a known state, so a render reproduces
- *(ui)* [`9e0d76c`](https://github.com/cmdcolin/ntsc.js/commit/9e0d76cd1f751ab3946c72e66c0b60515351ed06) the transition shelf — a fault that resolves, not a drawn wipe
- *(ui)* [`f1395f0`](https://github.com/cmdcolin/ntsc.js/commit/f1395f07fec089e472f1cc54360e24e9cc8a2b60) render the rundown, not just the board — the strip's offline walk
- *(ui)* [`81ea1fd`](https://github.com/cmdcolin/ntsc.js/commit/81ea1fd92aafcc9fe836ab45c89e6184d509f6f8) preroll depth 1 — load the next clip during this one
- *(ui)* [`72bb405`](https://github.com/cmdcolin/ntsc.js/commit/72bb405ba8cee42253075662b1982ff71472b3a4) transitions between rows — a row arrives behind a fault
- *(ui)* [`c1813fd`](https://github.com/cmdcolin/ntsc.js/commit/c1813fd5e4ac52a4d7aad20156978bf66bb45b40) a loop's second read head — wrap by changing elements, not seeking

### Fixes
- *(ui)* [`44d1434`](https://github.com/cmdcolin/ntsc.js/commit/44d143462d20d1d1419f7ef77608dc32c4010084) keep a search that only reaches a loop or a branch
- *(ui)* [`b5f6bb4`](https://github.com/cmdcolin/ntsc.js/commit/b5f6bb4aa1cf4a4cdbd5e49313238b406269b036) say which box to press when a search lands on a dead branch
- *(ui)* [`0ede3c9`](https://github.com/cmdcolin/ntsc.js/commit/0ede3c92360f4686b409d2248f7bb632585715b0) don't wait on animation frames a tab has stopped delivering
- *(ui)* [`93328b7`](https://github.com/cmdcolin/ntsc.js/commit/93328b73f4cca115ff0b00584ecfae6c35ea12df) a row with no transition arrives plainly, not behind an undefined one
- *(ui)* [`ac2b63e`](https://github.com/cmdcolin/ntsc.js/commit/ac2b63ea29f232630ad6759622bc1088ad8925c9) a transition defers the row's whole step, not only its session
- *(ui)* [`debc230`](https://github.com/cmdcolin/ntsc.js/commit/debc23064e8736e98125a985cfcb36a269062a66) a pending cut goes stale when the walk moves under it
- *(ui)* [`a08127f`](https://github.com/cmdcolin/ntsc.js/commit/a08127f7f1860b4dd34dfbbf16c7708b828100ca) the transition chip is one glyph, so the ✕ stays on the card
- *(ui)* [`e460743`](https://github.com/cmdcolin/ntsc.js/commit/e460743691c8cdd4352114e8c02150a86d9c725a) the speed slider reaches the loop's second read head too
- *(ui)* [`b2ddcb0`](https://github.com/cmdcolin/ntsc.js/commit/b2ddcb0c1f8a7d7491de7d66571bb47de50be874) hold a re-park against its lap with a deadline, not a stopwatch
- *(gpu)* [`f5b18d1`](https://github.com/cmdcolin/ntsc.js/commit/f5b18d1d564791fd839853674c7ca213c49234fa) a relayed wrap clears the health window, so the cue row means now

### Refactor
- *(ui)* [`320d476`](https://github.com/cmdcolin/ntsc.js/commit/320d476a81326288d364b27d080ab0e3ce1f9f3a) move the palette's verb list out of App
- *(ui)* [`d520a08`](https://github.com/cmdcolin/ntsc.js/commit/d520a089a14290810d6f991fcff67202bfb8d495) one press rule for both drawings' loop runs
- *(ui)* [`6f4756c`](https://github.com/cmdcolin/ntsc.js/commit/6f4756c7c33d8bdfa2a07a42c8c89d22193fa8be) one hold, for the two things that park at zero
- *(ui)* [`4e30a8d`](https://github.com/cmdcolin/ntsc.js/commit/4e30a8daf085098a4acdf28718eb8cf48aa49ebd) one preset chip, not two whole buttons
- [`39e76f9`](https://github.com/cmdcolin/ntsc.js/commit/39e76f9011596b0453c8ef7e3dd79a2bf60649e3) one home for randomness a take can be asked to repeat
- *(ui)* [`4c515dc`](https://github.com/cmdcolin/ntsc.js/commit/4c515dc54c23f6e76593f2fc1f2e68a246c4ba28) the loop bin is not the Tape stage, so stop calling it one
- *(ui)* [`4398ef9`](https://github.com/cmdcolin/ntsc.js/commit/4398ef9ed1a6ca3e023a046b7e690ceaba9e4c25) delay loop — the machine this models, named for what it is

### Documentation
- [`ba02f85`](https://github.com/cmdcolin/ntsc.js/commit/ba02f85b131680b849b6e88e20809ad9cad55637) decline the NLE plugin, and say what the portable part was
- [`6a39d7c`](https://github.com/cmdcolin/ntsc.js/commit/6a39d7c1c28aaef21399f8f7154dd205db81036b) gather the editor work into one document, and design its transitions
- *(ui)* [`b642640`](https://github.com/cmdcolin/ntsc.js/commit/b64264086c90328dc50fb42add18858a7a39c415) design the editor into the app, and rule out a page of its own
- *(ui)* [`f87fe3e`](https://github.com/cmdcolin/ntsc.js/commit/f87fe3ed16c9c74e0a364f160eeebad5ef50c7bb) settle the strip's React shape before a component exists
- [`ccb31cc`](https://github.com/cmdcolin/ntsc.js/commit/ccb31cc15228b105ac353f648658255973a5d2b6) say what to build next, from having built the rest
- [`fc71e24`](https://github.com/cmdcolin/ntsc.js/commit/fc71e24908f119856b900ce9ca2d83084f730a42) write up take state, and make the seeding rule an ADR
- [`f3c1842`](https://github.com/cmdcolin/ntsc.js/commit/f3c1842b1e8653becd6261fe2d9710e3958362f1) say what the harness floor actually was
- [`cd706d0`](https://github.com/cmdcolin/ntsc.js/commit/cd706d0e78313544807e637c8591005e4bf5d819) the loop's wrap is a half-second dropout, not a click
- [`5471636`](https://github.com/cmdcolin/ntsc.js/commit/5471636379f3af55a4bf3c708b7716f955bc31c4) the wrap's dropout is the seek, measured rather than inferred
- [`33454e1`](https://github.com/cmdcolin/ntsc.js/commit/33454e1c36e2303af57406697a2d47b65b0ff721) the second read head landed, and what it corrected on the way
- *(editor)* [`31b0847`](https://github.com/cmdcolin/ntsc.js/commit/31b0847eedbf78996c8666a2b50beabe4df13922) the crossfade's mechanism landed; the crossfade did not

### Style
- *(docs)* [`77c2c63`](https://github.com/cmdcolin/ntsc.js/commit/77c2c63eea69bdf9fe910fca7eb9f58dd029521a) run the formatter, so CI gets past its first gate

### Tests
- *(midi)* [`bc6a376`](https://github.com/cmdcolin/ntsc.js/commit/bc6a376a4ea1b427a34d3d8c89e349737619e8f4) drive the note path, and unrot the rest of midicheck
- *(ui)* [`7472964`](https://github.com/cmdcolin/ntsc.js/commit/747296460c35ee0256537a2cae1b8d58ad2dc9d0) make faultcheck cheap enough to finish, and honest about its floor
- *(ui)* [`5e43dbd`](https://github.com/cmdcolin/ntsc.js/commit/5e43dbd5151be5d436557d13d79646f07bc21081) traycheck waits for answers instead of sleeping past them
- [`99db0aa`](https://github.com/cmdcolin/ntsc.js/commit/99db0aab76890c58c57c9c3759e5682cfc2d8038) harnesses wait for the app and the archives, not for a duration
- [`cb398bc`](https://github.com/cmdcolin/ntsc.js/commit/cb398bcffe816bcf57833dd84a3c4abbabc7dd51) two harnesses learn that the panel mounts one stage at a time
- [`1dd7425`](https://github.com/cmdcolin/ntsc.js/commit/1dd7425202e865c2f889b6edf5cc1d17d86b349d) one command that runs every browser harness, because CI cannot
- [`719b921`](https://github.com/cmdcolin/ntsc.js/commit/719b921f7ef8fb7629917ebe290feac40f538d15) a harness says when its window stopped being drawn
- *(audio)* [`407e006`](https://github.com/cmdcolin/ntsc.js/commit/407e0067ae5cb296d9bd866d354cafdf0b6602e6) listen to a loop's wrap instead of inferring it from the seek
- *(ui)* [`00a6c61`](https://github.com/cmdcolin/ntsc.js/commit/00a6c61695338381322b770b249f39fc110d35ae) ?loophead=0 puts the seeking wrap back, so the A/B is one run
- *(audio)* [`c505a0c`](https://github.com/cmdcolin/ntsc.js/commit/c505a0c724aa31750fdd9ec9fc133c862c9f35a2) assert the direction, not a band, when comparing the two clocks
- *(ui)* [`6f652d4`](https://github.com/cmdcolin/ntsc.js/commit/6f652d49b99d9ee2d90270b51a871ad7bc908c61) prerollcheck's slot double gains the second read head's field
- *(ui)* [`35023a3`](https://github.com/cmdcolin/ntsc.js/commit/35023a3f619d922664d2b6984ec43d05c822e1a7) the read head's ordering, in vitest rather than only in a browser

## [0.25.7](https://github.com/cmdcolin/ntsc.js/compare/v0.25.6...v0.25.7) - 2026-08-10

### Fixes
- *(gpu)* [`42b4a8e`](https://github.com/cmdcolin/ntsc.js/commit/42b4a8e67b3f47c138be707c13499b39e8587cbe) reset the presented count when the render loop restarts

### Refactor
- *(midi)* [`96c4428`](https://github.com/cmdcolin/ntsc.js/commit/96c4428e8af951829028ab46ef8e27466a6476ff) drop takeover state in clearAll, like its two siblings
- *(signal)* [`0adead2`](https://github.com/cmdcolin/ntsc.js/commit/0adead2a6aa7d339a1d42add9a5d7bd9ca8b8d0d) give the two decks one head-crossing precession
- [`ae48cc7`](https://github.com/cmdcolin/ntsc.js/commit/ae48cc72cf677d979046e3fd6a6a695afffafd52) one definition each for clamp, clamp01 and wrap

### Documentation
- *(ui)* [`9b84627`](https://github.com/cmdcolin/ntsc.js/commit/9b8462714a51a0cfc6ad0ba88ce9952ff517528d) design the clip strip as a rundown, and seed its rolls

## [0.25.6](https://github.com/cmdcolin/ntsc.js/compare/v0.25.5...v0.25.6) - 2026-08-10

### Features
- *(ui)* [`d91eefa`](https://github.com/cmdcolin/ntsc.js/commit/d91eefaedc2c225f3b8413ee64eeff6ee4d4d1cc) rest a first session on the map alone

### Fixes
- *(docs)* [`bb0c0bb`](https://github.com/cmdcolin/ntsc.js/commit/bb0c0bb3454148b28f327cd3d29432acb2fe11c4) stop pointing at the Input section, which is gone

### Documentation
- [`440320f`](https://github.com/cmdcolin/ntsc.js/commit/440320f4c1acfbda201bfaacd81e0baf6c70e1b6) cut how-it-works down to how the code works
- [`84387f3`](https://github.com/cmdcolin/ntsc.js/commit/84387f383d93d716cf99881d632514b818ac9497) cut the effects and user guide pages down to what reads
- *(ui)* [`d2b1a8f`](https://github.com/cmdcolin/ntsc.js/commit/d2b1a8ff0e61bd68bd794dac863cc007a647f625) reshoot the gallery past the point the picture survives
- [`590c061`](https://github.com/cmdcolin/ntsc.js/commit/590c0614d23da7cc0eaa2105808d114df9468735) another pass for minimum
- *(docs)* [`3db8939`](https://github.com/cmdcolin/ntsc.js/commit/3db8939186e8432fc2971242b52bac99979bedf0) record what was measured about the two public archives
- [`27e5300`](https://github.com/cmdcolin/ntsc.js/commit/27e530054ed72203e77b9cb556dce429fa0ac769) rewrite the README opening to say what this is
- [`60dbe69`](https://github.com/cmdcolin/ntsc.js/commit/60dbe697039395848f7e3796c83231144a8b9bd1) make the contributor docs navigable, and fix what the doc rewrite broke

### Other Changes
- [`c9db28e`](https://github.com/cmdcolin/ntsc.js/commit/c9db28ec45b27afc51e6947b784bec5bcb09a9fa) Bump pnpm-lock.yaml

## [0.25.5](https://github.com/cmdcolin/ntsc.js/compare/v0.25.4...v0.25.5) - 2026-08-10

### Features
- *(ui)* [`fa2dbb2`](https://github.com/cmdcolin/ntsc.js/commit/fa2dbb2f604f54e7ace419ab000945cfddb85a63) log slider travel around a control's stock setting
- *(ui)* [`a476e12`](https://github.com/cmdcolin/ntsc.js/commit/a476e125467da97de7623157280e3108bddd7ecb) make modulation a floating box on the signal-path map
- *(ui)* [`bffaf08`](https://github.com/cmdcolin/ntsc.js/commit/bffaf08569e40f37843200db2152bdb5c5717af8) make the deck a box on the signal-path map
- *(docs)* [`4d5c8d4`](https://github.com/cmdcolin/ntsc.js/commit/4d5c8d4f645bd0b4d1a5466a7cc26af2a3855296) rebuild the guide site around navigating it

### Fixes
- *(ui)* [`d6e91f6`](https://github.com/cmdcolin/ntsc.js/commit/d6e91f6015e41e56f4008a503533afb47805b0b2) stop Ctrl/Cmd chords from firing bare-key shortcuts
- *(ui)* [`f844961`](https://github.com/cmdcolin/ntsc.js/commit/f8449615bcaeb3f6a658277b71ec13d1226053a2) keep a localStorage failure from taking down the app
- *(gpu)* [`1d3e2cf`](https://github.com/cmdcolin/ntsc.js/commit/1d3e2cf548a6ec97e75d9a0dfefe20811ee6d939) one ?debug predicate, and store getters that cannot throw
- *(ui)* [`d4bb389`](https://github.com/cmdcolin/ntsc.js/commit/d4bb38925f815fde5355065a35adf514bfb02bdf) announce failures, and say what a curved slider reads
- *(ui)* [`fd0833c`](https://github.com/cmdcolin/ntsc.js/commit/fd0833c93c1d629d83376df10087947d71416240) let the popped-out controls fill their window
- *(ui)* [`e602237`](https://github.com/cmdcolin/ntsc.js/commit/e60223781a31e7366bcdd99e4220cbb217dfb1ea) let the stabs slider answer while the motion is frozen
- *(ui)* [`48ce706`](https://github.com/cmdcolin/ntsc.js/commit/48ce706f4acbba40f301d5ecc68d85926f9b6488) say so when the clipboard refuses a link

### Refactor
- *(ui)* [`4062df0`](https://github.com/cmdcolin/ntsc.js/commit/4062df0538ab4a0c78b3df0824e8c33b849fe11c) build both source slots from one factory
- *(ui)* [`e979f6b`](https://github.com/cmdcolin/ntsc.js/commit/e979f6b839a3a053037ab40298c5956c4556bf5f) pair every A/B state in useEngine, and stop paying for it

### Documentation
- [`485e07e`](https://github.com/cmdcolin/ntsc.js/commit/485e07ee2d8dbea213be072eeb72cd37c2733d0a) hand off the A/B state pairs left inside useEngine
- *(docs)* [`185cb49`](https://github.com/cmdcolin/ntsc.js/commit/185cb491a65eb5a1b32d8d634016bdba080f5e99) note what the stab gate still owes
- *(docs)* [`886a560`](https://github.com/cmdcolin/ntsc.js/commit/886a560ec3cb28da5ede1dc6eb183028ff469ba2) close the A/B pairing handoff, and record what it turned up

### Tests
- *(ui)* [`b881d1e`](https://github.com/cmdcolin/ntsc.js/commit/b881d1e29cb3ffaf21bd4d143175368b6a091388) pin what the stab gate is running at
- *(ui)* [`7589750`](https://github.com/cmdcolin/ntsc.js/commit/7589750e77f30d92fc28b1ee6b554ff44ab076d0) drive the stab gate in panelcheck

### Chores
- *(ui)* [`39439a1`](https://github.com/cmdcolin/ntsc.js/commit/39439a17a9c2029177eb3fbb10e099f9f36ff723) regen the panel baselines for the deck's move to the map
- *(docs)* [`df75f45`](https://github.com/cmdcolin/ntsc.js/commit/df75f45e3de3753cf91b128f00621cd842d3bad7) re-wrap a paragraph oxfmt had left drifted
- [`e264c12`](https://github.com/cmdcolin/ntsc.js/commit/e264c12d9c14e52fd651d06fc597aaf604acb4f1) move the actions off the Node 20 runtime

## [0.25.4](https://github.com/cmdcolin/ntsc.js/compare/v0.25.3...v0.25.4) - 2026-08-10

### Documentation
- [`0e71458`](https://github.com/cmdcolin/ntsc.js/commit/0e714587391d55c63bdf3685d255efa930c4f722) tighten README and cut duplicated content
- [`0d2a853`](https://github.com/cmdcolin/ntsc.js/commit/0d2a853bca21ead611290ce20b4deaf182a92c15) add FEATURES.md, wire it into the guide site, slim the README
- [`c1f771c`](https://github.com/cmdcolin/ntsc.js/commit/c1f771c9abe6549a2870e8f401d8df066db4c97f) cut the site in half, and merge features into effects

## [0.25.3](https://github.com/cmdcolin/ntsc.js/compare/v0.25.2...v0.25.3) - 2026-08-09

### Other Changes
- [`9fa87de`](https://github.com/cmdcolin/ntsc.js/commit/9fa87de730431dbd0f5325da327c224d54b31886) Bump java

## [0.25.2](https://github.com/cmdcolin/ntsc.js/compare/v0.25.1...v0.25.2) - 2026-08-09

### Fixes
- [`7243a05`](https://github.com/cmdcolin/ntsc.js/commit/7243a050b3dde3fc63a41ba25bd507a5ff1e998d) allow re2 native build in pnpm workspace

## [0.25.1](https://github.com/cmdcolin/ntsc.js/compare/v0.25.0...v0.25.1) - 2026-08-09

### Other Changes
- [`70b922e`](https://github.com/cmdcolin/ntsc.js/commit/70b922ec61d7e0832f60fd93e82398d44f13bccd) Bump deps

## [0.25.0](https://github.com/cmdcolin/ntsc.js/compare/v0.24.0...v0.25.0) - 2026-08-09

### Features
- *(ui)* [`8213da3`](https://github.com/cmdcolin/ntsc.js/commit/8213da3fee76d5bb6f3ac0b76b26333cf00f3151) keep a downloaded archive.org clip across the reload

### Fixes
- *(ui)* [`1469d64`](https://github.com/cmdcolin/ntsc.js/commit/1469d64a6a59088f28b1209e5c1bab9f61bd997e) pay for an archive.org clip once, and bound the kept shelf
- *(ui)* [`f9dc701`](https://github.com/cmdcolin/ntsc.js/commit/f9dc70128f75c8b231f20c682cfff0868b88b8be) drop a YouTube download the deck has moved on from
- *(ui)* [`6e94c71`](https://github.com/cmdcolin/ntsc.js/commit/6e94c71586670d851705e8b1461b07603d79ac7c) say how many clips a folder rescan turned away
- *(ui)* [`0f25ff5`](https://github.com/cmdcolin/ntsc.js/commit/0f25ff52db27b3d4b6ed2f96792c60df67752e6e) tell every waiting deck how the download is going
- *(gpu)* [`b7d1e7f`](https://github.com/cmdcolin/ntsc.js/commit/b7d1e7f90884e2d51b0baa82e20a90c002f2b49c) stop a link freezing the picture on frame 0
- *(ui)* [`88acd51`](https://github.com/cmdcolin/ntsc.js/commit/88acd51019dc8b8396646df97d31ff76cfa9a970) keep the picture when a camera is refused

### Refactor
- *(ui)* [`c7a552f`](https://github.com/cmdcolin/ntsc.js/commit/c7a552f94ff2195e56bec6cf1e693ea2f9e3f050) tidy what the two cache tiers left behind
- *(ui)* [`6c3d5b7`](https://github.com/cmdcolin/ntsc.js/commit/6c3d5b7b007709775888b8ba9d8a14af2f15032e) say once what committing a source to a deck does

### Tests
- *(ui)* [`5a582a5`](https://github.com/cmdcolin/ntsc.js/commit/5a582a5e87e432ff9ad4d0551fa9c7a968123e2e) drive the source pickers, which no link can reach

### Other Changes
- [`e8fcb97`](https://github.com/cmdcolin/ntsc.js/commit/e8fcb9731d76d80eb5a340bcb310e9d51c75293c) Format markdown

## [0.24.0](https://github.com/cmdcolin/ntsc.js/compare/v0.23.0...v0.24.0) - 2026-08-09

### Features
- *(gpu)* [`e0c7a0e`](https://github.com/cmdcolin/ntsc.js/commit/e0c7a0e4a9441aaef6d94b2cf1fc2704648ca9fe) model phosphor decay as second-order, not a frame echo
- *(signal)* [`a48a13c`](https://github.com/cmdcolin/ntsc.js/commit/a48a13c43ad7dd041d27d95ba47310418c5a6ae1) stab the whole look into a clean picture on the beat
- *(ui)* [`2a95feb`](https://github.com/cmdcolin/ntsc.js/commit/2a95feb19f34729cabeb80ed012fba4784761386) give persistence a log dial, and key halation off beam current
- *(ui)* [`d80ae13`](https://github.com/cmdcolin/ntsc.js/commit/d80ae13f217e7fe14c84f143d73f2efd9c3a42d6) morph undo and redo, and draw a morph in flight
- *(ui)* [`9e0da4c`](https://github.com/cmdcolin/ntsc.js/commit/9e0da4c6bb3114425c2d8a796ee1d5ea49da4c07) give presets camelCase identifiers, with displayName for the words
- *(gpu)* [`e273959`](https://github.com/cmdcolin/ntsc.js/commit/e27395987383fb49094f29b4c426bf5ab13f89a5) key, synthesize and strobe, with a one-shot to play them
- *(midi)* [`44ac39f`](https://github.com/cmdcolin/ntsc.js/commit/44ac39f1296527c89c30efa98beb999fa0748a3c) let a note fire the bay's one-shots, at its velocity
- *(ui)* [`ac6792a`](https://github.com/cmdcolin/ntsc.js/commit/ac6792aa3ac74e0b928381bb6232be6ba509adcc) keep a shelf of your own clips, reopenable without the OS dialog
- *(ui)* [`66d2f76`](https://github.com/cmdcolin/ntsc.js/commit/66d2f761326aa7ee1e48f24a7c9bc32a65e0f8ca) roll sources off Wikimedia Commons, and star the ones worth keeping
- *(ui)* [`727884a`](https://github.com/cmdcolin/ntsc.js/commit/727884af74b9959cebefb80e6b305812159af884) cue a clip, loop a marked section, stab back to the cue
- *(ui)* [`e182099`](https://github.com/cmdcolin/ntsc.js/commit/e182099b811a034b0adc00f50169a06ae7ce0eda) put the cue verbs in the command palette
- *(ui)* [`583992a`](https://github.com/cmdcolin/ntsc.js/commit/583992a77ae99585622e65506aa0d10ae6dddd9c) show what a loop's jump back costs, measured on the clip
- *(ui)* [`5fd56e0`](https://github.com/cmdcolin/ntsc.js/commit/5fd56e07b3074ad332a0671a3c7eb757dd4ec205) roll clips from archive.org, a pool Commons doesn't have
- *(ui)* [`4ad132e`](https://github.com/cmdcolin/ntsc.js/commit/4ad132e24afa08fef3916ec8c528754748072223) search the archives, instead of only rolling out of them
- *(ui)* [`2803339`](https://github.com/cmdcolin/ntsc.js/commit/2803339d30acd9eaa751341ca27f62b6ed3b2186) say what an archive.org clip will cost before it costs it

### Fixes
- *(ui)* [`f2e1d8e`](https://github.com/cmdcolin/ntsc.js/commit/f2e1d8e586a1eaf365134b3fd3595be30e1dee97) make a random look land somewhere an author put it
- *(gpu)* [`a19c485`](https://github.com/cmdcolin/ntsc.js/commit/a19c485e25edfc57094f27579be7311e4251778a) stop counting device creations against a session
- *(gpu)* [`4590fc3`](https://github.com/cmdcolin/ntsc.js/commit/4590fc3d31009bdaead6c0af20cd5e4bc7fa4bcc) stop perf.mjs reporting an ablate delta it cannot support
- *(ui)* [`c819614`](https://github.com/cmdcolin/ntsc.js/commit/c819614f8e0f0cdbe0c8e526bc2a1cb4206e052c) stop the tape deck's speed keys impersonating a transport
- *(ui)* [`4df2a65`](https://github.com/cmdcolin/ntsc.js/commit/4df2a6540e6221ed04efe1558b78de18b8341821) state the deck's wipe gate once, not once per row
- *(ui)* [`771bf2e`](https://github.com/cmdcolin/ntsc.js/commit/771bf2ec7ea041a946b6ec1f720957d1048baff5) stop "This look" moving the panel under your pointer
- *(ui)* [`430a63f`](https://github.com/cmdcolin/ntsc.js/commit/430a63f7923c034935db27bc4f397ce32fc80d8e) stop a cue marked at the clip's end collapsing into a seek storm
- *(ui)* [`1cb68c4`](https://github.com/cmdcolin/ntsc.js/commit/1cb68c414b219e5a7c0c24acb3f1c5253b8f5d41) let an unclaimed one-shot trigger expire instead of queueing
- *(gpu)* [`ac3d521`](https://github.com/cmdcolin/ntsc.js/commit/ac3d5216f8a49dc04e5b0c888ccecbd89749fe9e) keep the keyer's fill out of circuit when the key is at zero
- *(ui)* [`a4560c8`](https://github.com/cmdcolin/ntsc.js/commit/a4560c83dd9cff76b814a5c048c38d0f69299445) stop a filter listing an inert stage as a heading over nothing

### Performance
- *(gpu)* [`efe437c`](https://github.com/cmdcolin/ntsc.js/commit/efe437c17162f6c414a92d4dbe44fc41766fcd17) gate the two scatter spreads apart, and tier bloom's taps
- *(gpu)* [`f232449`](https://github.com/cmdcolin/ntsc.js/commit/f232449d023d4e2d8f2976837363535455c1b532) design each filter once, not once per sample
- *(gpu)* [`00ff671`](https://github.com/cmdcolin/ntsc.js/commit/00ff6714d0f601b1d9a6fa9525ce4a3f3125b225) stop rebuilding the bay's undo record on every frame

### Refactor
- *(signal)* [`4863299`](https://github.com/cmdcolin/ntsc.js/commit/4863299fea509a6ebe0bf1dbe48ccdfd556e66f7) state the pulse train's two rules once, not once per gate
- *(ui)* [`0d85735`](https://github.com/cmdcolin/ntsc.js/commit/0d85735d05b3dd3c12060066a79b90a6d86fd1dc) hand the panel a slot, not thirty fields ending in A or B
- *(gpu)* [`e1d16b4`](https://github.com/cmdcolin/ntsc.js/commit/e1d16b45084bc5f8026b16e7b7e5990506d21934) state each mechanism once, and name the last three indices
- *(ui)* [`bf8c3ae`](https://github.com/cmdcolin/ntsc.js/commit/bf8c3ae9cb2666ce3729ffc780f08b77ed4a4604) pick a mod target at the control, not out of a list of all 273
- *(ui)* [`e4ac2f8`](https://github.com/cmdcolin/ntsc.js/commit/e4ac2f8b5333ca8fe7a0e9db8c349d8bfccb8e39) put the source picker in the box that already carries its name
- *(ui)* [`3ac9db7`](https://github.com/cmdcolin/ntsc.js/commit/3ac9db7cbead547a386279b00c4da2df83030f2b) say once what an unpatched box is, and what pressing it does
- *(ui)* [`580ae14`](https://github.com/cmdcolin/ntsc.js/commit/580ae146d0b893ef6d687eb36db0f97d3cb61b89) split the Feedback stage into three loop stages

### Documentation
- [`fa30767`](https://github.com/cmdcolin/ntsc.js/commit/fa30767a26927e10f7b6fed4822a80d7d8dd74ef) compare the analog-video tools and correct the ntsc-rs entry
- [`8730669`](https://github.com/cmdcolin/ntsc.js/commit/87306696411de0d3b6b38d0b6889755a7d6c125f) name the setTimeout half of the occluded-window trap
- *(ui)* [`3d66954`](https://github.com/cmdcolin/ntsc.js/commit/3d66954a52a245fcd06834bbe946f3cdf8b5015a) correct the phosphor comments the decay rewrite outdated
- [`8e2efd6`](https://github.com/cmdcolin/ntsc.js/commit/8e2efd60d6a0911d51ce80b855ecbc9a44d9564f) write up the keyer, the synth, the strobe and the one-shot
- [`69c5c4f`](https://github.com/cmdcolin/ntsc.js/commit/69c5c4f9a8c81d51277701a8334f46829a0bd982) measure what the keyer, the synth and the strobe actually cost
- [`3e9a3c7`](https://github.com/cmdcolin/ntsc.js/commit/3e9a3c7815b2fd03261616a15586ebf7a95a19e9) write down how to actually get a worktree copy serving
- [`e634181`](https://github.com/cmdcolin/ntsc.js/commit/e634181ea42c36e2a985d6940e17dcf25a87cc52) name what makes the perf numbers bimodal, and correct the scatter cost
- [`fc57d18`](https://github.com/cmdcolin/ntsc.js/commit/fc57d18065000064ccbe133af321683e88c2cfd4) ablation ranks passes, it does not size them
- [`bc6b141`](https://github.com/cmdcolin/ntsc.js/commit/bc6b14104c0a2eae96b4fcddd20527738a68add1) measure the real clips, and correct what the loop cost model claimed
- *(gpu)* [`c758081`](https://github.com/cmdcolin/ntsc.js/commit/c758081790a22a0e18deb389e1a0a0a6c53e8281) write down what pixdiff cannot compare
- *(ui)* [`62de78c`](https://github.com/cmdcolin/ntsc.js/commit/62de78cdcf6cc80acbf43bf91e6bd7889ed7485e) the bay is read and unpatched here, not patched here
- [`4e0b8df`](https://github.com/cmdcolin/ntsc.js/commit/4e0b8df597d67e68b6e0933f93e46231bd748391) reflow COMPARISON.md and adr/0004 to the line width
- [`5ceda57`](https://github.com/cmdcolin/ntsc.js/commit/5ceda57e4a33cb556b27ea953fc905cdf83e6768) sketch fixed-framerate export and what a desktop shell would buy

### Style
- *(ui)* [`b60692d`](https://github.com/cmdcolin/ntsc.js/commit/b60692d89ed9b9ca58390c39494e1962cd17df2e) set buttons in the app's face, not the monospace one

### Tests
- *(ui)* [`da138f0`](https://github.com/cmdcolin/ntsc.js/commit/da138f04b4e9a8fd732bbdd01116311f9c56fae3) hold the docs' quoted control count to the schema
- *(gpu)* [`0d3c865`](https://github.com/cmdcolin/ntsc.js/commit/0d3c865f24102d3592fb5a31da39b9098c721597) add a pixel differ for proving an approximation is free

### Chores
- [`2df4493`](https://github.com/cmdcolin/ntsc.js/commit/2df449319ced6112ba25752971e624f28f7d59b3) check the test files, and catch React Compiler bailouts
- *(ui)* [`85daca0`](https://github.com/cmdcolin/ntsc.js/commit/85daca0799b3af634fbae92f1b9d81c52630b607) regen doc/panel screenshots for the loop-stage split
- [`94662f7`](https://github.com/cmdcolin/ntsc.js/commit/94662f7af983e05e9cee43c8f2a1be1c3ca25924) drop the loop-split handoff doc

## [0.23.0](https://github.com/cmdcolin/ntsc.js/compare/v0.22.2...v0.23.0) - 2026-08-08

### Features
- *(ui)* [`579205d`](https://github.com/cmdcolin/ntsc.js/commit/579205d86748ca2180fc402aa68b4a7827e981e8) a wobble's rate can lock to the beat, and the beat can be tapped in
- *(ui)* [`8440498`](https://github.com/cmdcolin/ntsc.js/commit/8440498de3fa3aeca8f92d33d1746fdd0a75236d) give the purity patch a drag-to-place widget
- *(ui)* [`33169b0`](https://github.com/cmdcolin/ntsc.js/commit/33169b055941b05a0d6da9ebf745705b03360e40) move the signal tap into the panel's View group
- *(ui)* [`89624cb`](https://github.com/cmdcolin/ntsc.js/commit/89624cbc1448967a759968db0284fb7b4845c15b) band the source picker options by kind
- *(ui)* [`2ed9ae1`](https://github.com/cmdcolin/ntsc.js/commit/2ed9ae128a576e30cd5c79d3b8c394827e2d999e) keep the scroll position steady when "This look" grows
- *(ui)* [`b18f203`](https://github.com/cmdcolin/ntsc.js/commit/b18f203dd697db52a6907233bb81c10317d8c384) add tape-wear, broadcast, and CRT preset chips
- *(ui)* [`74e3df9`](https://github.com/cmdcolin/ntsc.js/commit/74e3df978acef38a2be0bc795312c2feada2fd5c) tell the inert miniatures why they do nothing
- *(ui)* [`79ca197`](https://github.com/cmdcolin/ntsc.js/commit/79ca1972a5bff694d0a95f50977da68a2f1f6f6c) a teletype card can be redrawn by an unsteady hand
- *(ui)* [`b352593`](https://github.com/cmdcolin/ntsc.js/commit/b352593f3a683f6d0d33e7df5e8877d412441839) rate and tag looks, to learn which settings are good
- [`7b30597`](https://github.com/cmdcolin/ntsc.js/commit/7b30597baee82029c43489b283a7cfc37412d631) export the label dataset, and fit the affinity it is for
- *(ui)* [`e8450e3`](https://github.com/cmdcolin/ntsc.js/commit/e8450e37e92ea63239514c9a5da18d9482d8759c) the same controls again, filed by the gesture that moves them
- *(ui)* [`438557c`](https://github.com/cmdcolin/ntsc.js/commit/438557c6771bf83a6bddf5dbc0152ebfb18cdb0e) a mode switch that fits its row takes one line
- *(ui)* [`3a5508f`](https://github.com/cmdcolin/ntsc.js/commit/3a5508f24052580cd8c04e4aceab48307cc9ce12) the open stage says how to close it, and Escape agrees
- *(gpu)* [`42862b3`](https://github.com/cmdcolin/ntsc.js/commit/42862b3ba1145b961c2713c3bff63f38076a6c6c) a tap that draws the line instead of painting it
- *(ui)* [`0785da8`](https://github.com/cmdcolin/ntsc.js/commit/0785da83e9e2b3174f152746cd0d9841cb6fec17) help copy that can be a list when it is one
- *(ui)* [`8e6fc9d`](https://github.com/cmdcolin/ntsc.js/commit/8e6fc9de62300f05fd83a40f2e672533f73f7cbe) add Sound and View control stages, keep view controls off signal path
- *(ui)* [`f8661a4`](https://github.com/cmdcolin/ntsc.js/commit/f8661a40ba4328af260c56bfe6bb496009533ccb) support multiple visual branches and pressable loop returns on chain map
- *(ui)* [`8b86efc`](https://github.com/cmdcolin/ntsc.js/commit/8b86efc25a224633eddc793fed48b42eced9f923) update signal path overlay dialog and loops configuration view
- *(audio)* [`4d03c04`](https://github.com/cmdcolin/ntsc.js/commit/4d03c04444faf02a1bd36264a4e3d152746935da) add video audio input mode and reverb slider to drive simulation

### Fixes
- *(ui)* [`6ffd3ce`](https://github.com/cmdcolin/ntsc.js/commit/6ffd3ce4dc213783cf5e3b5090d6f289ce5cd2fd) default frame rate lock to auto
- *(ui)* [`34ee900`](https://github.com/cmdcolin/ntsc.js/commit/34ee9006044e6022703caafe75914385a94ce7ed) unfolding the preset catalog opens the section holding it
- *(ui)* [`0d530e6`](https://github.com/cmdcolin/ntsc.js/commit/0d530e6bf1046b7778736f37b2ecd0aa2b8d52a1) a rating needs an author, so ask for one instead of queueing
- *(ui)* [`c34f38d`](https://github.com/cmdcolin/ntsc.js/commit/c34f38d88679211c0125bcc27189fab02f6e7807) the per-stage shake button was a speck; draw the die
- *(ui)* [`f2571f0`](https://github.com/cmdcolin/ntsc.js/commit/f2571f036ed155ac9fda2de5eb5aebccbba5f92a) the tags menu asks for an account the way the saved menu does
- *(ui)* [`8d663ba`](https://github.com/cmdcolin/ntsc.js/commit/8d663ba21f3d4f76d2580476b62a17f38495d049) border the search box's clear button like its neighbors
- *(ui)* [`da817ab`](https://github.com/cmdcolin/ntsc.js/commit/da817ab228b4070a983c31105615c0485395b5df) a miniature is measured where you grabbed it, not where it drifted to

### Performance
- *(ui)* [`f083394`](https://github.com/cmdcolin/ntsc.js/commit/f08339454b8f38d02a9e3becbb1147db43de6fae) subscribe each control row to its own key

### Refactor
- *(ui)* [`8e90b37`](https://github.com/cmdcolin/ntsc.js/commit/8e90b370dc1b005167e2aa6892f90974a584364a) split oversized control groups by mechanism
- *(ui)* [`1c2acc6`](https://github.com/cmdcolin/ntsc.js/commit/1c2acc68248f156cf7091e2a6df408f7779320ba) trim the app menu's search glyph and GitHub link
- *(ui)* [`241f0f4`](https://github.com/cmdcolin/ntsc.js/commit/241f0f43bb671609d29f445b8bdee94a3cff0f9e) trim resting-state copy in the signal map and preset caption
- *(ui)* [`0053e46`](https://github.com/cmdcolin/ntsc.js/commit/0053e46464d37cb068ee7189a79eb89bc31e9a45) the number keys reach the library instead of a bank of their own
- *(ui)* [`82cfdcd`](https://github.com/cmdcolin/ntsc.js/commit/82cfdcd27966fa3b29f9e97549817ba45038d4ba) move saved profiles button to header and remove vaporwave section

### Documentation
- [`4ffd36c`](https://github.com/cmdcolin/ntsc.js/commit/4ffd36c99ae0875385385711fc9be0e102d13b5c) jot down some future feature ideas
- [`38904bc`](https://github.com/cmdcolin/ntsc.js/commit/38904bcab7686ebf56e4b174ecaf25fd0c4977dc) how a morph shares a frame with modulation
- *(ui)* [`f725741`](https://github.com/cmdcolin/ntsc.js/commit/f725741882a5f4555814f713e736bbf0b237e803) the vote page stopped recording; say so where it says otherwise

### Other Changes
- [`abe5f37`](https://github.com/cmdcolin/ntsc.js/commit/abe5f372b7162654cdead600fe99fdcf87080541) Update docs
- [`c5ffcfc`](https://github.com/cmdcolin/ntsc.js/commit/c5ffcfcd7a6bdc0af742aa1e787eeef65e1497b9) Minor version bumps
- [`86d8bf5`](https://github.com/cmdcolin/ntsc.js/commit/86d8bf5841eb39fefb2aee89fc2bd9133b9f8845) Minor docs updates for script screenshos

## [0.22.2](https://github.com/cmdcolin/ntsc.js/compare/v0.22.1...v0.22.2) - 2026-08-08

### Features
- *(ui)* [`47d83c3`](https://github.com/cmdcolin/ntsc.js/commit/47d83c3dbd3171986ae15d9b01020f915e281346) the board can be kept under a name
- *(ui)* [`232e0f3`](https://github.com/cmdcolin/ntsc.js/commit/232e0f3799260ae1ad4845a9d7a09d1848867a2c) saved profiles move to Firestore behind a Google sign-in
- *(ui)* [`ae03515`](https://github.com/cmdcolin/ntsc.js/commit/ae0351558b1990a70651a5c8b45474567579cd81) a seek bar under each video source

### Fixes
- *(ui)* [`ed0bf0f`](https://github.com/cmdcolin/ntsc.js/commit/ed0bf0fc655efc0221037f9e6ada15e523b82be8) a refused save says so, and the rules are tested for real

### Refactor
- *(ui)* [`288188b`](https://github.com/cmdcolin/ntsc.js/commit/288188b4190a00f317e0222ab1611af65087c454) saved looks become saved profiles, and ctrl+S saves one

### Other Changes
- [`3c7a1f1`](https://github.com/cmdcolin/ntsc.js/commit/3c7a1f16c283d1694702d27f95b1edd32c11476e) ADR

## [0.22.1](https://github.com/cmdcolin/ntsc.js/compare/v0.22.0...v0.22.1) - 2026-08-07

### Features
- *(ui)* [`8a0c526`](https://github.com/cmdcolin/ntsc.js/commit/8a0c526d316c756152b37514669df3c2c9d808c6) the magnifier miniature takes a box, and its lens becomes a handle
- *(ui)* [`fbfa0f0`](https://github.com/cmdcolin/ntsc.js/commit/fbfa0f03f58cac3b06d15b688f909869f5d74ead) both inputs get a box, and the mixer stops being one of them

### Fixes
- *(gpu)* [`f0e3890`](https://github.com/cmdcolin/ntsc.js/commit/f0e3890537713585e76480b618c85e646f70108e) a device dies with the document that made it, so the counts do too

### Refactor
- *(ui)* [`08148e9`](https://github.com/cmdcolin/ntsc.js/commit/08148e988cedef68269aa7434dbb6cee924168f1) one ☰ in the corner, where a ⋮ and a ☰ used to divide the app
- *(gpu)* [`c9dfc94`](https://github.com/cmdcolin/ntsc.js/commit/c9dfc94893e57cd4d7fa019d3a73be01e53d9791) the vectorscope goes dark

### Other Changes
- [`bc5de78`](https://github.com/cmdcolin/ntsc.js/commit/bc5de7899a8f25e067ae710dbceb90fd8fb52d7d) Updates

## [0.22.0](https://github.com/cmdcolin/ntsc.js/compare/v0.21.0...v0.22.0) - 2026-08-07

### Features
- *(ui)* [`63d6191`](https://github.com/cmdcolin/ntsc.js/commit/63d6191628770da702372f6ffa43f6afbd4752e2) a frame-rate lock, because a steady 24 reads calmer than a wavering 40
- *(gpu)* [`ecd819e`](https://github.com/cmdcolin/ntsc.js/commit/ecd819e33cd5f3bcf66fe7de96494ef9384e8945) sample the decoder's own frame where the device allows it
- *(ui)* [`a63c769`](https://github.com/cmdcolin/ntsc.js/commit/a63c76974bbfd7e955a58245b7b765ee1a7a6033) an auto position on the frame lock
- *(ui)* [`5a1b385`](https://github.com/cmdcolin/ntsc.js/commit/5a1b3850c8a0c03932510a2be1ac26528b7d5922) the fps readout reports what reaches the glass, and the lock's judge gets tests

### Fixes
- *(gpu)* [`4ca48d9`](https://github.com/cmdcolin/ntsc.js/commit/4ca48d9fd224a1926028c618dbb92696948e88c1) parenthesize the arithmetic-XOR mixes Tint refuses to parse

### Documentation
- [`ceaa9a5`](https://github.com/cmdcolin/ntsc.js/commit/ceaa9a54dcb6881c065e0c143ebe89d5385d22bb) the performance findings land where the next session can find them

## [0.21.0](https://github.com/cmdcolin/ntsc.js/compare/v0.20.0...v0.21.0) - 2026-08-07

### Features
- *(gpu)* [`5accf2d`](https://github.com/cmdcolin/ntsc.js/commit/5accf2dc4a5c280d0c61981e8a582b3c7f4692e9) count the tab's WebGPU sessions, and say which freeze this is
- *(signal)* [`cb2196c`](https://github.com/cmdcolin/ntsc.js/commit/cb2196ce5f74e83f9bab599640c8dde9737130fb) a plug has two contacts, and a ground loop belongs to one cable
- *(signal)* [`736ff22`](https://github.com/cmdcolin/ntsc.js/commit/736ff2246cced10ba1eb95c9a1b0dffc961d970c) the no-signal sources become statistics, and the floor gets a colour

### Fixes
- *(ui)* [`f0c28b5`](https://github.com/cmdcolin/ntsc.js/commit/f0c28b5697debcd6527eea55b5969a5e8ac9ac7c) hold the readout column still, and stop the panel claiming edits nobody made
- *(gpu)* [`a744982`](https://github.com/cmdcolin/ntsc.js/commit/a744982fb166deb85fbd9c40cc34e1cb38020f44) the card sleeps when you tab away, so a hang rebuilds instead of ending
- *(signal)* [`db26fec`](https://github.com/cmdcolin/ntsc.js/commit/db26fecf5e1b5db61dbd6d8eeed728a34e11b226) the noise lattice gets a phase, so the grain stops standing still

### Refactor
- *(gpu)* [`7ec64bb`](https://github.com/cmdcolin/ntsc.js/commit/7ec64bbc5b1462bc6d3fc98a5549d0f6d9583020) delete the worker-hosted engine

### Documentation
- *(gpu)* [`8f6c43b`](https://github.com/cmdcolin/ntsc.js/commit/8f6c43b2693453190b55a660fed3b76d3ee5e838) the card does not sleep under a live device — tested, not assumed
- *(gpu)* [`6d21bb8`](https://github.com/cmdcolin/ntsc.js/commit/6d21bb8bb396d4cddfc8de4def98d39bd06c7482) the freeze caught live once, and three recipes ruled out
- *(gpu)* [`ce7d233`](https://github.com/cmdcolin/ntsc.js/commit/ce7d233c5c72a0c2a8144cee70a87375dd3e7d25) the freeze has a recipe — the third WebGPU session in a tab
- [`30e4ff3`](https://github.com/cmdcolin/ntsc.js/commit/30e4ff319db2294835555a5b00cc7f0f17566f0c) the per-input feeds get a section, and the A/B analysis lands in backlog
- [`871ac09`](https://github.com/cmdcolin/ntsc.js/commit/871ac09c9e4856cc0904dffbdbb3c1d06f41373c) the noise mechanisms still unmodelled, and what the last pass taught

### Other Changes
- [`d078dda`](https://github.com/cmdcolin/ntsc.js/commit/d078dda4fb7f3df892d0017ad0f5afc468c418ec) Bump deps

## [0.20.0](https://github.com/cmdcolin/ntsc.js/compare/v0.19.0...v0.20.0) - 2026-08-07

### Features
- *(ui)* [`cba887a`](https://github.com/cmdcolin/ntsc.js/commit/cba887aca819d03b4af80417eac44d3d7f60636c) the map grows a second input, and B's controls come onto the spine
- *(signal)* [`5522856`](https://github.com/cmdcolin/ntsc.js/commit/55228562db356ff9ac9bb5d9e88bf84cf3eee768) differential gain/phase, head clog, and a Y/C delay mistrim
- *(signal)* [`ac83fb8`](https://github.com/cmdcolin/ntsc.js/commit/ac83fb883d54b6075d1bb6ae0d6cd139d1e80263) FM over-deviation folds hard bright edges into boiling black streaks
- *(signal)* [`c16c207`](https://github.com/cmdcolin/ntsc.js/commit/c16c207bad6d669fbfe7044cca050033a62c8f11) sticky-shed stick-slip, the relaxation oscillator behind squealing tapes
- *(gpu)* [`bc17319`](https://github.com/cmdcolin/ntsc.js/commit/bc17319955f40992f444fe85fe2cd3d3e4666015) raise the impulse, head-count and persistence ceilings
- *(ui)* [`b828bb1`](https://github.com/cmdcolin/ntsc.js/commit/b828bb1945d91b2b0078f66add9ac2cc6c5accb7) let the sliders run past what the hardware would do
- *(ui)* [`4904171`](https://github.com/cmdcolin/ntsc.js/commit/4904171717a1c5ae990a3dc2d7810fe50d81c873) five presets past the redline
- *(gpu)* [`7f047b2`](https://github.com/cmdcolin/ntsc.js/commit/7f047b25d54983bcc65d1dcbac99f9186b0301bd) the three guns, the magnet, and the sharpness circuit

### Fixes
- *(signal)* [`2c62b2e`](https://github.com/cmdcolin/ntsc.js/commit/2c62b2eaf618034acb6c666bb8840bdb59db9386) the wipe was switching off the sync fight it exists to shape
- *(ui)* [`9b4b65c`](https://github.com/cmdcolin/ntsc.js/commit/9b4b65cf7a5a79bae3c9d905d1d1522ee63d0aea) Feed A is input A's own cable, not part of the A/B section
- *(signal)* [`de42887`](https://github.com/cmdcolin/ntsc.js/commit/de428877e43674932e107a3ee5b2c3ca4fc900aa) a held deck's damage belongs to its tape, not to the glass
- [`70fbe8c`](https://github.com/cmdcolin/ntsc.js/commit/70fbe8c190ea4c60bd6678874e8a2138e492aaab) stop the pre-commit hook rejecting whole directories

### Refactor
- *(gpu)* [`1418d1a`](https://github.com/cmdcolin/ntsc.js/commit/1418d1af69e0f88f0234ca34f138dd21fb9a5f05) the feed gates become a table, and a table can be tested
- *(ui)* [`bd53169`](https://github.com/cmdcolin/ntsc.js/commit/bd5316927d56e842f1a4ee658102a06302a4b234) the panel's chrome becomes one family, written once
- *(ui)* [`f26a14c`](https://github.com/cmdcolin/ntsc.js/commit/f26a14cf70856f3a66768ab10878275ec40c1e88) the map's touched stage names the same amber as everything else
- *(ui)* [`2abb372`](https://github.com/cmdcolin/ntsc.js/commit/2abb37292aae47a51fc19dba53718975369ed9bd) let the browser draw what it draws better, and share the rest
- *(ui)* [`919f499`](https://github.com/cmdcolin/ntsc.js/commit/919f499060b19ee6e1fe07625d50826d6b626333) three tokens for three meanings, and a guard for the next pass

### Documentation
- *(ui)* [`850e139`](https://github.com/cmdcolin/ntsc.js/commit/850e139f5cf27208bfa9055effdd08eff057ca93) replace an invented measurement, and say why the toggles stay put
- [`b789b2f`](https://github.com/cmdcolin/ntsc.js/commit/b789b2f5990451b0c8b3e32205cb74dd31a4c45f) regenerate the figures, and repair two shots that had stopped taking
- [`4b6a03f`](https://github.com/cmdcolin/ntsc.js/commit/4b6a03f823057eb54eaf0152d30233af97811aaf) catalogue the five new tape effects, and clear shipped items from the backlog
- [`13e17df`](https://github.com/cmdcolin/ntsc.js/commit/13e17df7c1cba7fd4d19cd2b212784224e62655b) catalogue the four tube faults, and clear them from the backlog

### Tests
- *(gpu)* [`755d2f8`](https://github.com/cmdcolin/ntsc.js/commit/755d2f8fb9e3590389ccada54c1bbef80371f8a9) pin the two facts that only a rendered frame can show

### Chores
- [`8248590`](https://github.com/cmdcolin/ntsc.js/commit/82485902b7a0485dd022fcc80cd4b55ef3818023) upgrade to TypeScript 7
- [`80bd543`](https://github.com/cmdcolin/ntsc.js/commit/80bd5437ff524de2e699e332fbeec939bf04a891) add husky pre-commit hook running lint-staged with oxfmt
- [`7409467`](https://github.com/cmdcolin/ntsc.js/commit/74094674e4c20bdb8c64bdaa8763e0b473ac2863) lint-fix staged files before formatting in pre-commit

### Other Changes
- [`49dd213`](https://github.com/cmdcolin/ntsc.js/commit/49dd213d18142f55f8a31dc3e650a98522bb90fc) Update architecture

## [0.19.0](https://github.com/cmdcolin/ntsc.js/compare/v0.18.0...v0.19.0) - 2026-08-06

### Features
- *(gpu)* [`0cd7042`](https://github.com/cmdcolin/ntsc.js/commit/0cd7042623a4c49a321be0896ddaa664cc537336) tell a tab that stopped painting from one that stopped being asked
- *(ui)* [`0dc7e08`](https://github.com/cmdcolin/ntsc.js/commit/0dc7e081ccd588bdcecd1dfdefa9bc7ac0a4a238) hold one wobble still without unpatching it
- *(ui)* [`67434cc`](https://github.com/cmdcolin/ntsc.js/commit/67434cca4546577144e1f9ffd9e19ea96a2abdbf) make the picture's pointer tool a switch instead of a guess
- *(signal)* [`a630273`](https://github.com/cmdcolin/ntsc.js/commit/a63027390aed220f566c26f41784d4f31ff989ca) servos that hunt, and a loop that rewrites its own timebase
- *(signal)* [`399a3ff`](https://github.com/cmdcolin/ntsc.js/commit/399a3ff084ac1569327e8b01ec026825ab0c14c0) the pause button, impulse sparks, and honest lock decay
- *(signal)* [`af397cf`](https://github.com/cmdcolin/ntsc.js/commit/af397cfd718032a5e1106c5275ef395263fbc818) impulse arcs whose duration is the shape, and a rig that flinches
- *(signal)* [`7b29768`](https://github.com/cmdcolin/ntsc.js/commit/7b297680ef0840538c5ab4e3921485c503cd991b) per-source feeds, an RF front end, Macrovision, and B as a true waveform
- *(signal)* [`2543eee`](https://github.com/cmdcolin/ntsc.js/commit/2543eeea348ea1d0734f67abc8090a7701d6d443) the mistune cliff, the beat presets, and the ledger
- *(signal)* [`db3a7dd`](https://github.com/cmdcolin/ntsc.js/commit/db3a7dd45a9494554a27a904ec3a50f7cb7b3c04) the pause button on the house deck
- *(ui)* [`cf19818`](https://github.com/cmdcolin/ntsc.js/commit/cf198187168ccd4513fdf088b924261cc8ff33a1) three presets that sell the per-source feeds
- *(signal)* [`9d5695e`](https://github.com/cmdcolin/ntsc.js/commit/9d5695eba4c3ec4dfddd7de2c13d3d42bbec9800) per-source dropouts, and damage that survives the dissolve
- *(signal)* [`af784f4`](https://github.com/cmdcolin/ntsc.js/commit/af784f43c299aa9cad0c4136709d4b681cfdbfbd) the sky, the service knob, and what the blanking was carrying

### Fixes
- *(gpu)* [`0860b92`](https://github.com/cmdcolin/ntsc.js/commit/0860b92b02aa00aaf24721708d926296873a42d7) stop the soak measuring the machine instead of the app
- *(gpu)* [`bb1f6cd`](https://github.com/cmdcolin/ntsc.js/commit/bb1f6cdca3b0c124ae045a2a6c3dab0fbea22c2c) stop the watchdog deferring to a focus the console takes away
- *(ui)* [`caac14d`](https://github.com/cmdcolin/ntsc.js/commit/caac14d0fce392d7d1b2f17c9fccfff6a3019325) keep focus, and the memoization the panel was quietly losing
- *(ui)* [`8b4cf2a`](https://github.com/cmdcolin/ntsc.js/commit/8b4cf2a2ebcb0a160bfb01fb0d3b903a395f6531) drop the chain map when a filter leaves no stage standing

### Performance
- *(ui)* [`ff00935`](https://github.com/cmdcolin/ntsc.js/commit/ff00935ee458f0c250194b908335baf0ca237945) wire the frame stats only while something is reading them

### Refactor
- *(signal)* [`48f1b3e`](https://github.com/cmdcolin/ntsc.js/commit/48f1b3e8c7454a9e6c0b817cd0f08b9e301333ac) B's pause moves to its own deck, and the stripe rides the tape

### Documentation
- [`3f4e866`](https://github.com/cmdcolin/ntsc.js/commit/3f4e8661761a2de86bb8fe0fe53847aff2841387) retire the twelve-minute limit, which two runs outlived
- [`f7c29de`](https://github.com/cmdcolin/ntsc.js/commit/f7c29de0d1896dca3baf2b92cb916b7fddbed164) name the wgpu crash upstream, and what did not reproduce it
- [`3ba97b0`](https://github.com/cmdcolin/ntsc.js/commit/3ba97b039f659c3851a6286b97f41dcfe89387aa) the impulse bullet catches up with the arc rework
- [`154eb69`](https://github.com/cmdcolin/ntsc.js/commit/154eb692ade41b0dbcad3eb19cb9bccec004767d) the per-source feeds join the pass-order story

### Style
- [`0874538`](https://github.com/cmdcolin/ntsc.js/commit/0874538549b9d6312738496b138727382eb2e26b) oxfmt reflow of harness docs and panelcheck

## [0.18.0](https://github.com/cmdcolin/ntsc.js/compare/v0.17.0...v0.18.0) - 2026-08-06

### Features
- *(gpu)* [`c482f06`](https://github.com/cmdcolin/ntsc.js/commit/c482f0667b5d98e67d000e20861254d8cd2d2d49) give the scope the persistence an instrument has, and derive its graticule

### Fixes
- *(gpu)* [`567ab9d`](https://github.com/cmdcolin/ntsc.js/commit/567ab9dd4ea54e4cf1d84cdfede03cea1362173e) soak for visible minutes, not wall-clock ones

### Refactor
- *(ui)* [`0867f69`](https://github.com/cmdcolin/ntsc.js/commit/0867f69b53b39ef9f1153503a583cf387c58d490) make the canvas sizing arithmetic something a test can see

### Documentation
- [`977a58c`](https://github.com/cmdcolin/ntsc.js/commit/977a58ca6b2eef1ed951208a64278bcdbdcaa242) answer the trigger this handoff set, as far as the box allows

## [0.17.0](https://github.com/cmdcolin/ntsc.js/compare/v0.16.0...v0.17.0) - 2026-08-05

### Features
- *(gpu)* [`a40ce11`](https://github.com/cmdcolin/ntsc.js/commit/a40ce11acfaa7d3f3f130f525a394a782ea42c79) a vectorscope, so the colour controls can be read instead of guessed

### Fixes
- *(gpu)* [`6d2a4c6`](https://github.com/cmdcolin/ntsc.js/commit/6d2a4c677eff6289d9e3da85c2072d1fc74f50dd) stop the worker path consuming a still the caller still needs
- *(gpu)* [`137ed96`](https://github.com/cmdcolin/ntsc.js/commit/137ed969382514fe735998c1c42b41716a731d9b) stop the soak harness calling its own transport a freeze

### Performance
- *(gpu)* [`17f510e`](https://github.com/cmdcolin/ntsc.js/commit/17f510e10cc6d0e37d737aa53e29bd0044075a4f) don't serialize the trace ring where there is nowhere to put it

## [0.16.0](https://github.com/cmdcolin/ntsc.js/compare/v0.15.0...v0.16.0) - 2026-08-05

### Features
- *(signal)* [`45c6f56`](https://github.com/cmdcolin/ntsc.js/commit/45c6f568eac0a6672a35909661579e1154b08080) the circuit that patches a dropout, and the half cycle it patches with

### Style
- [`367788b`](https://github.com/cmdcolin/ntsc.js/commit/367788bc2343b451c0ad1db57fb5e45fec7681c2) bring the twelve files oxfmt had drifted from back in line

### Tests
- *(gpu)* [`9a5ce34`](https://github.com/cmdcolin/ntsc.js/commit/9a5ce34d30859559e7205d64b899514eeb1ef180) cover the worker wire, which needed no GPU to test
- *(gpu)* [`1542f0f`](https://github.com/cmdcolin/ntsc.js/commit/1542f0f97875ccc1cb43406d2f83ca1544fb6c64) a soak that answers "does it still freeze"

### Chores
- [`4e7c088`](https://github.com/cmdcolin/ntsc.js/commit/4e7c088fe7109a631e7fdc17b34ca826afb3dba5) check formatting, which nothing was

## [0.15.0](https://github.com/cmdcolin/ntsc.js/compare/v0.14.0...v0.15.0) - 2026-08-05

### Features
- *(signal)* [`5d32f4b`](https://github.com/cmdcolin/ntsc.js/commit/5d32f4b32735c44640b16318b0a76f38a74e72e2) unlock the demodulator's axes, and let the sound turn them

### Fixes
- *(gpu)* [`f4e7db9`](https://github.com/cmdcolin/ntsc.js/commit/f4e7db9f411bd765bb61b8ec803fed7f651560e0) bound the queue by how long work waits, not by how many frames
- *(gpu)* [`4c0bf8b`](https://github.com/cmdcolin/ntsc.js/commit/4c0bf8b4803cacaa09be50592ef6b91cfca2035d) let a slot ask again after a decode it could not get
- *(gpu)* [`5e9b32b`](https://github.com/cmdcolin/ntsc.js/commit/5e9b32bdbcd14eadc9f5c68e0d0caea4d4e2c073) give the worker its device back before the thread goes

### Refactor
- *(gpu)* [`0d29c26`](https://github.com/cmdcolin/ntsc.js/commit/0d29c26724e7a078a5baa3aec7a2700faf8926f9) one seam both engines answer to
- *(ui)* [`c7c0da5`](https://github.com/cmdcolin/ntsc.js/commit/c7c0da536caf04c46a3942aa83c2be595e75dc38) make the give-up policy something a test can reach

### Documentation
- [`de3f371`](https://github.com/cmdcolin/ntsc.js/commit/de3f371ca60f18abd375e887315757f5ce029267) what the freeze review found, including in its own fix
- [`4159966`](https://github.com/cmdcolin/ntsc.js/commit/4159966e35558546cb5b9a8acdbe6e2c51203089) measure the two worker rAF questions instead of reasoning about them

## [0.14.0](https://github.com/cmdcolin/ntsc.js/compare/v0.13.1...v0.14.0) - 2026-08-05

### Features
- *(gpu)* [`b6e3ee5`](https://github.com/cmdcolin/ntsc.js/commit/b6e3ee5c1b07b4408bf18159ad28147d9448c1ae) ?gpu=low-power, for battery and for bisecting a driver fault
- *(gpu)* [`c02ae33`](https://github.com/cmdcolin/ntsc.js/commit/c02ae3381a4eaa535dade25ba316da4e7ffae1c3) rebuild the session on a lost device rather than ending it
- *(gpu)* [`a12c55e`](https://github.com/cmdcolin/ntsc.js/commit/a12c55ee3f622931b273dc3ad06139f79ec7c053) an engine that runs in a worker, and the wire to drive it
- *(gpu)* [`2eef17e`](https://github.com/cmdcolin/ntsc.js/commit/2eef17e2f82d52c103261977ce0030247fce790b) the page-side proxy for a worker-owned engine

### Fixes
- *(gpu)* [`95f2a85`](https://github.com/cmdcolin/ntsc.js/commit/95f2a851e66f6861db6809aee4b8980790728105) ask for the discrete GPU, not the one driving the display
- *(gpu)* [`8eb9fa0`](https://github.com/cmdcolin/ntsc.js/commit/8eb9fa027c964e0ede6c0f8847f3196574e8c154) stop rAF running ahead of a device that cannot keep up

### Performance
- *(gpu)* [`990b3d5`](https://github.com/cmdcolin/ntsc.js/commit/990b3d58303385849063757df1903d019ebdcce5) stage video frames off the main thread

### Refactor
- *(gpu)* [`c67fc3e`](https://github.com/cmdcolin/ntsc.js/commit/c67fc3ecaed49e73605f732d0c5bb5292f4a140d) read the browser through one place, so the engine can leave the main thread
- *(gpu)* [`c657b95`](https://github.com/cmdcolin/ntsc.js/commit/c657b95f596cedd7c077247444f3862b3b464f2f) split decoding a video frame from putting one on the GPU

### Documentation
- [`d8f81bd`](https://github.com/cmdcolin/ntsc.js/commit/d8f81bdd4c0376c1058bcb0c236108ff1b2adf4e) hand off the freeze investigation, and say what was left unwired

## [0.13.1](https://github.com/cmdcolin/ntsc.js/compare/v0.13.0...v0.13.1) - 2026-08-05

### Features
- *(ui)* [`7f77acb`](https://github.com/cmdcolin/ntsc.js/commit/7f77acbffd06a32f6703bec27bf16e54a17bb146) give the sidebar back to the controls
- *(ui)* [`b246196`](https://github.com/cmdcolin/ntsc.js/commit/b24619670f4502bddaec904cef4a7fe586a2c795) put a row's ∿ ☆ ↺ behind a ⋮, keep what is set in the open
- *(ui)* [`7295698`](https://github.com/cmdcolin/ntsc.js/commit/72956983ff833f45da520e0a4378d33485bb3842) make the reading the reset, and put the look on the front page

## [0.13.0](https://github.com/cmdcolin/ntsc.js/compare/v0.12.0...v0.13.0) - 2026-08-04

### Features
- *(signal)* [`844d4b0`](https://github.com/cmdcolin/ntsc.js/commit/844d4b060a15182ad54fab6f7e3f0336e6761d00) cue and pause through the loop, bars and all

## [0.12.0](https://github.com/cmdcolin/ntsc.js/compare/v0.11.0...v0.12.0) - 2026-08-04

### Features
- *(signal)* [`d4110ca`](https://github.com/cmdcolin/ntsc.js/commit/d4110cadbc6a924dbb601f7e20f51714c42c7da8) stall the drum and drag the tape, for the broken one

## [0.11.0](https://github.com/cmdcolin/ntsc.js/compare/v0.10.0...v0.11.0) - 2026-08-04

### Features
- *(signal)* [`35ef691`](https://github.com/cmdcolin/ntsc.js/commit/35ef691d50e1adb038b5f4ba4be791298b562a50) run the held loop backwards, or stop it dead

## [0.10.0](https://github.com/cmdcolin/ntsc.js/compare/v0.9.0...v0.10.0) - 2026-08-04

### Features
- *(signal)* [`893eb44`](https://github.com/cmdcolin/ntsc.js/commit/893eb44ab7157351edd15af44af12892d99f1f6e) lift the record head, and the loop becomes an instrument

## [0.9.0](https://github.com/cmdcolin/ntsc.js/compare/v0.8.0...v0.9.0) - 2026-08-04

### Features
- *(ui)* [`fbc83be`](https://github.com/cmdcolin/ntsc.js/commit/fbc83be5f0c97493d115b893e10d4cdf8c5e7c1e) fit the sidebar on one screen, and name the loop that closes each
- *(signal)* [`09c71a4`](https://github.com/cmdcolin/ntsc.js/commit/09c71a47db252435c51ed5a308324f6e4018211b) thread a loop of tape between two heads, seconds long
- *(signal)* [`4a2052f`](https://github.com/cmdcolin/ntsc.js/commit/4a2052f321b8784543afa9aaa9f4c90f45243568) put up to four heads in the loop, so a lap is a rhythm

## [0.8.0](https://github.com/cmdcolin/ntsc.js/compare/v0.7.5...v0.8.0) - 2026-08-04

### Features
- *(ui)* [`ec262c8`](https://github.com/cmdcolin/ntsc.js/commit/ec262c8ee7e64e32443ed276a4b290dccfb138f8) motion on any row, and a search you can walk back along
- *(scripts)* [`abf7b93`](https://github.com/cmdcolin/ntsc.js/commit/abf7b93b85f97c27681fba6180cf63884d0e581b) score a candidate look by how far it is from doing nothing
- *(scripts)* [`4a38b1c`](https://github.com/cmdcolin/ntsc.js/commit/4a38b1c430f748f7a5bde6785000fd6e2a551ac5) report when a candidate's patch didn't land
- *(ui)* [`7d80dcc`](https://github.com/cmdcolin/ntsc.js/commit/7d80dcc6ef7410e6c3f2d19e05114eb6cd94db3e) seven presets found by screening, including a full-board group
- *(midi)* [`cfce812`](https://github.com/cmdcolin/ntsc.js/commit/cfce8125f85e07e17ee1ecf6273c40b7eecb8a2b) bind the motion amount and preset weights to knobs
- *(sync)* [`ca037d4`](https://github.com/cmdcolin/ntsc.js/commit/ca037d418c40f746c08bf96b7785e90e5cb4bd55) the sync separator slices post-AGC video, closing the loop
- *(ui)* [`e3cd480`](https://github.com/cmdcolin/ntsc.js/commit/e3cd480a58e2f6d6bb2ac21a23a62cda49a17d03) share a screen or window straight into the chain
- *(ui)* [`837137e`](https://github.com/cmdcolin/ntsc.js/commit/837137ebc5be45cffcca92525ecfccfd2ec72559) ask the panel what is moving
- *(ui)* [`ef72c59`](https://github.com/cmdcolin/ntsc.js/commit/ef72c59f9b9f7d7e75dd39163754ba7e3fac3a77) put the signal tap on the stage, and say when one is live

### Fixes
- *(scripts)* [`295d120`](https://github.com/cmdcolin/ntsc.js/commit/295d120dbdcf88ad201fe3eec9d11e8c94e03385) keep a candidate batch's results when the run dies
- *(ui)* [`dadebe9`](https://github.com/cmdcolin/ntsc.js/commit/dadebe9aebca6c8b611b4c935ba6777f30d40ba6) patching a control while motion is frozen no longer does nothing
- *(scripts)* [`6776ae2`](https://github.com/cmdcolin/ntsc.js/commit/6776ae267bd5d979b6e846de99016dec64443613) don't flag the reference tile for being clean
- *(scripts)* [`917e368`](https://github.com/cmdcolin/ntsc.js/commit/917e368b66ae686828341c80f656ea5373f98751) calibrate the "subtle" threshold against a shipped preset

### Performance
- *(ui)* [`5b4d803`](https://github.com/cmdcolin/ntsc.js/commit/5b4d803de2db799b9c800b4105743313bb96df01) stop writing localStorage on every frame of a drag
- *(gpu)* [`5900ae2`](https://github.com/cmdcolin/ntsc.js/commit/5900ae223484be29f2ea1c4a8abdf4791a1923d2) cut the measured hot passes — B chroma precompute, crt_face tap tables
- *(gpu)* [`0d4e49b`](https://github.com/cmdcolin/ntsc.js/commit/0d4e49bb0a803298f2a20bb71784ea49bd75e7b3) upload video frames only when the video has advanced

### Documentation
- [`ebe3a1c`](https://github.com/cmdcolin/ntsc.js/commit/ebe3a1c0f95ecd090ae5aca8449bf07d3ffca2f4) split graphviz sources and images into subfolders
- [`bfbd23e`](https://github.com/cmdcolin/ntsc.js/commit/bfbd23e2542d70d472b8f69bb47dab27ea90ce7d) remove old top-level dot/svg paths superseded by graphviz/img split
- *(architecture)* [`7c8a379`](https://github.com/cmdcolin/ntsc.js/commit/7c8a37982e5b7d76ff9c00a66a3d96857a6ee145) why the panel has two contexts, and who owns the mod bay
- *(ideas)* [`307dd5c`](https://github.com/cmdcolin/ntsc.js/commit/307dd5c7326691ffeda1cd1e052a44f3e95f3b88) record what the motion pass shipped, and why macros were cut
- [`a07a3c7`](https://github.com/cmdcolin/ntsc.js/commit/a07a3c72da1106e5a98d9896b9649c3645d31f7f) hand off the motion pass — state, divergences, and the open round
- [`2ebf96b`](https://github.com/cmdcolin/ntsc.js/commit/2ebf96bb3c905f9347574ebc82fc82d4afbc5507) recapture the figures, and give motion one of its own
- [`536c089`](https://github.com/cmdcolin/ntsc.js/commit/536c089ee7f6897a06f08c04855125a08d6aac5b) delete the writeups whose work has shipped
- [`54936a0`](https://github.com/cmdcolin/ntsc.js/commit/54936a016e2c3791654c264b0b5db4a5e8ddcd27) keep the browser-harness traps where the harnesses are
- *(dev)* [`c492d23`](https://github.com/cmdcolin/ntsc.js/commit/c492d233f81ddf03aa854a949b607b182800425e) the tmpfs trap that stops the harnesses before they start

### Style
- [`8244d14`](https://github.com/cmdcolin/ntsc.js/commit/8244d1461c46b9edb63f24bf1e47cc7fbd50fe73) format five files oxfmt had never reached

## [0.7.5](https://github.com/cmdcolin/ntsc.js/compare/v0.7.4...v0.7.5) - 2026-08-03

### Features
- *(ui)* [`0a3bc9e`](https://github.com/cmdcolin/ntsc.js/commit/0a3bc9ed6d95b42a6b8f1c87642551a5bae384f6) teletype source — a text card you type, draw and roll
- *(ui)* [`8dce53e`](https://github.com/cmdcolin/ntsc.js/commit/8dce53e905833f433c9d52afc871496c79eb0a7c) draw on the teletype card, and print it as you type
- *(ui)* [`3ffbc14`](https://github.com/cmdcolin/ntsc.js/commit/3ffbc1440d6c25e4ba70a12d2a8df61104de44e8) fine-tier control curation, heroes-first auto-map
- *(ui)* [`551e76f`](https://github.com/cmdcolin/ntsc.js/commit/551e76f17b6c20dbf72153e37e1db9360eb557cd) wide bench mode for the panel and popout

### Fixes
- *(ui)* [`50edbe2`](https://github.com/cmdcolin/ntsc.js/commit/50edbe2df8b4c416fb5578450a3454befc538632) let a textarea swallow global shortcuts
- *(ui)* [`367192e`](https://github.com/cmdcolin/ntsc.js/commit/367192e8a99cc3f26e71bdfd935b425413a22c2a) stop the panel scrolling sideways
- *(ui)* [`6e24fa0`](https://github.com/cmdcolin/ntsc.js/commit/6e24fa09cac3bff51e7ca0569a4b608d8d4f3a66) stop a drawn page walking down the card as you draw

### Other Changes
- [`0a54ef3`](https://github.com/cmdcolin/ntsc.js/commit/0a54ef3cdb1f7af1adc768a9356d16204e3a2d82) More idea docs

## [0.7.4](https://github.com/cmdcolin/ntsc.js/compare/v0.7.3...v0.7.4) - 2026-08-02

### Features
- *(ui)* [`0d8729d`](https://github.com/cmdcolin/ntsc.js/commit/0d8729d669fa441e24575e0ce6f146168900aab4) bundled example clips for source A and B

### Fixes
- *(ui)* [`5489d83`](https://github.com/cmdcolin/ntsc.js/commit/5489d839e7e75a30cb01ffc65ded4a626ac594c3) don't hijack ctrl/cmd+r as the record shortcut

### Other Changes
- [`3a2ff6a`](https://github.com/cmdcolin/ntsc.js/commit/3a2ff6a82c79b73dd8aee068b70eb455eed9d2b6) Shorthand

## [0.7.3](https://github.com/cmdcolin/ntsc.js/compare/v0.7.2...v0.7.3) - 2026-08-02

### Fixes
- *(docs)* [`fcfbdb5`](https://github.com/cmdcolin/ntsc.js/commit/fcfbdb51aa2a9a6c22b68b6a850870b3301a9669) restore valid syntax in the docshots localStorage seed

### Performance
- *(gpu)* [`20d4f14`](https://github.com/cmdcolin/ntsc.js/commit/20d4f1447d209cfff7862082ba23dc469dda408e) stop paying for arithmetic the signal path throws away

### Documentation
- [`ce43af8`](https://github.com/cmdcolin/ntsc.js/commit/ce43af82e13c9f311f0fc62e18d22e5e73167cfd) make the pipeline diagrams teach the invariants, and keep them honest
- [`5961fb4`](https://github.com/cmdcolin/ntsc.js/commit/5961fb4f11cd2cc2f2f774aa71673f61315d7b3e) full-window doc shots, drop inversion from the base look, new gallery

### Tests
- *(gpu)* [`1999380`](https://github.com/cmdcolin/ntsc.js/commit/19993801c4ece10fe46a8c86427099a022ead403) hold the pass-order docs to the arrays, not just the pass set

### Chores
- *(gpu)* [`a9bf95f`](https://github.com/cmdcolin/ntsc.js/commit/a9bf95fe65832e74a80e3e947239dfdee6fdcac6) drop the ?prof per-pass profiler

### Other Changes
- [`a5fd0b7`](https://github.com/cmdcolin/ntsc.js/commit/a5fd0b795123ad2cfe2e5e36c316509102dbaa16) Consolidate ideas docs

## [0.7.2](https://github.com/cmdcolin/ntsc.js/compare/v0.7.1...v0.7.2) - 2026-08-02

### Features
- *(gpu)* [`41a519f`](https://github.com/cmdcolin/ntsc.js/commit/41a519f7ae73937d318954edd1a2475a1c241831) a second rAF chain, so a stall says which side broke

### Fixes
- *(gpu)* [`3275486`](https://github.com/cmdcolin/ntsc.js/commit/3275486aa270b56250d39fde8ebbda536913913a) say so when the browser stops painting the tab
- *(gpu)* [`0a85dc7`](https://github.com/cmdcolin/ntsc.js/commit/0a85dc7e5c31df107b9e74d950a713d2618f0be5) stop rebuilding the swapchain for a size it already has
- *(gpu)* [`72c351e`](https://github.com/cmdcolin/ntsc.js/commit/72c351e3cde964f8f2d9b35fb74364616e4f6dab) never cancel the rAF chain, supersede it instead

### Refactor
- *(gpu)* [`93d6d5e`](https://github.com/cmdcolin/ntsc.js/commit/93d6d5e8d68c9c56bce54bb4a34458b6533d0ad1) one rAF chain mechanism instead of two copies

## [0.7.1](https://github.com/cmdcolin/ntsc.js/compare/v0.7.0...v0.7.1) - 2026-08-02

### Other Changes
- [`63f728d`](https://github.com/cmdcolin/ntsc.js/commit/63f728d85013cc08a9fcbb2a0115e401a1c72d06) Rename ntsc.js

## [0.7.0](https://github.com/cmdcolin/ntsc.js/compare/v0.6.2...v0.7.0) - 2026-08-02

### Features
- *(midi)* [`7ca81d4`](https://github.com/cmdcolin/ntsc.js/commit/7ca81d447423fd675ffe00ea6858fe67a03c1f71) show where an uncaught knob sits, and reconnect on load
- *(ui)* [`000f28d`](https://github.com/cmdcolin/ntsc.js/commit/000f28da2e73b8e1b7a1d05f482739bb85e34fbc) roll a look from a link with ?surprise, and keep the view out of it
- *(ui)* [`1b1f1db`](https://github.com/cmdcolin/ntsc.js/commit/1b1f1db9ab417a40dc09f17fb284a8e486323eb7) the signal chain as a small map at the head of the sidebar
- *(ui)* [`6131ef4`](https://github.com/cmdcolin/ntsc.js/commit/6131ef4428f5260cb423f5783855934d9708449e) a layout that works on a phone, and a stylesheet that can be found in
- *(ui)* [`c1a6608`](https://github.com/cmdcolin/ntsc.js/commit/c1a66089a327c3593d023ea9999d28a852e538ee) give the icon the ends of the line, not just the bars
- *(ui)* [`2318c3f`](https://github.com/cmdcolin/ntsc.js/commit/2318c3f350754ce2eb7f10d7e7f07beac98e60be) the fps readout starts out of the way, with two ways back to it

### Fixes
- *(ui)* [`aa29b1e`](https://github.com/cmdcolin/ntsc.js/commit/aa29b1ea2a477b7c719b012ee5e2fc8865fbe1f3) gate below-1x magnifier to the "across the room" preset
- *(ui)* [`1a15346`](https://github.com/cmdcolin/ntsc.js/commit/1a15346e853228ccb54975141bf571892a04707f) tighten WebGPU-unavailable screen, link the repo
- *(ui)* [`c291acd`](https://github.com/cmdcolin/ntsc.js/commit/c291acd4958c4f7503857d8210a0750b58e84af4) keep the capture mirror sized to the canvas
- *(ui)* [`80dda72`](https://github.com/cmdcolin/ntsc.js/commit/80dda725f989faeaf50f4d39a84b4319b5bebefe) snap the bent detailer preset onto its step grid
- *(ui)* [`e480e85`](https://github.com/cmdcolin/ntsc.js/commit/e480e8582f6f3116c8c72031c2488662de4d3212) keep the picture centered when the canvas outgrows the stage

### Refactor
- *(ui)* [`f2eb191`](https://github.com/cmdcolin/ntsc.js/commit/f2eb1919a5fb8f3bfddcb0d8dd5eb16ac2dc8c8a) the stage menu is a native popover, and the fps readout moves off the picture

### Documentation
- [`3d1176c`](https://github.com/cmdcolin/ntsc.js/commit/3d1176c90c347cc6e1eb1d7ab41fd0e7037f19b1) add features list and YouTube setup notes
- [`a7edd7c`](https://github.com/cmdcolin/ntsc.js/commit/a7edd7c5e518117c0a4772407fc9bb43641ca17d) split README into HOW-IT-WORKS, DEVELOPMENT; simplify feature list
- [`709a78a`](https://github.com/cmdcolin/ntsc.js/commit/709a78a1a781048c0d5f14c7eb63a67afc898b8c) point demo link at refreshed clip
- [`4756f5c`](https://github.com/cmdcolin/ntsc.js/commit/4756f5cabccc6007fbdb60cbec02160421e3081d) cache-bust demo asset names (demo-v2.mp4)
- [`78d9e18`](https://github.com/cmdcolin/ntsc.js/commit/78d9e18572d6c1fb3012a4bc1f331398d749ac06) rewrite feature bullets in plain voice, link to EFFECTS.md
- [`dc6328f`](https://github.com/cmdcolin/ntsc.js/commit/dc6328fbfd47f00e212b89b5c166a8fda094bde6) one EFFECTS.md link, YouTube + OBS notes; feat(ui): raise recording bitrate
- *(midi)* [`9a733ef`](https://github.com/cmdcolin/ntsc.js/commit/9a733ef24f72c62b98732e46f9a917debc6985b6) add a beginner guide for controller setup
- [`3e9be9a`](https://github.com/cmdcolin/ntsc.js/commit/3e9be9a6648d3ba49868e64a6ed48bbb09f3b8db) correct the control count (132 in 18 groups)
- [`8d01e52`](https://github.com/cmdcolin/ntsc.js/commit/8d01e52f1d8670d6044aecd885e375e59ff86f5b) move ARCHITECTURE.md into docs/, fix stale pass-order and React Compiler facts
- [`5639415`](https://github.com/cmdcolin/ntsc.js/commit/5639415364d411b40e81002d65bf46cbb4db5549) remove old agent-docs/ARCHITECTURE.md path
- [`dc3ea94`](https://github.com/cmdcolin/ntsc.js/commit/dc3ea94b3181f95ddf21bbb87877db0f6a6cab03) shrink the README screenshot, fix its alt text
- *(guide)* [`359a2e7`](https://github.com/cmdcolin/ntsc.js/commit/359a2e7b36e31e5c392824699adc0399c99d47c7) a user guide whose figures are captured from the running app
- *(guide)* [`701a63c`](https://github.com/cmdcolin/ntsc.js/commit/701a63c8af916225b9b0fbf1f1feeef9e6f7ab6b) a wilder gallery, and clips that keep the frame still
- [`a960fbd`](https://github.com/cmdcolin/ntsc.js/commit/a960fbd7ea1a5662b61e5ebd821a56f1e7dec474) fix broken EFFECTS.md relative links
- *(guide)* [`2c1bf9e`](https://github.com/cmdcolin/ntsc.js/commit/2c1bf9ead3d679b221cf1d7c069b4d55d2fa4b07) subtler camera-feedback clip, and a clip guard that can't be fooled
- *(guide)* [`ef53df6`](https://github.com/cmdcolin/ntsc.js/commit/ef53df67333abe1d1a13a1ff5016506af1f5781f) follow the chain into the sidebar
- *(guide)* [`05a018a`](https://github.com/cmdcolin/ntsc.js/commit/05a018a8a4b7359f5f5675e036a546a4795460f2) stop a clip losing its frame rate to the window manager
- [`e3ad3a4`](https://github.com/cmdcolin/ntsc.js/commit/e3ad3a461d6105f2928c67f95e105ead4026f426) surface the docs site, and give each cross-link a reason to follow it
- [`a55b867`](https://github.com/cmdcolin/ntsc.js/commit/a55b8672a9a48a66dddd3e8e67d60b87374f3346) note that it works on a phone

### Other Changes
- [`c704e2f`](https://github.com/cmdcolin/ntsc.js/commit/c704e2f4f77839c89569ca373df97036614d2c15) Rename to ntscenery

## [0.6.2](https://github.com/cmdcolin/ntsc.js/compare/v0.6.1...v0.6.2) - 2026-08-02

### Other Changes
- [`a44802c`](https://github.com/cmdcolin/ntsc.js/commit/a44802c52b246111ebfd6bb853da4f0af11ec16e) Rm gallery
- [`bb9a815`](https://github.com/cmdcolin/ntsc.js/commit/bb9a815c8760b273c5bdc31eadc35593fa3c9122) Bump demo video

## [0.6.1](https://github.com/cmdcolin/ntsc.js/compare/v0.6.0...v0.6.1) - 2026-08-02

### Features
- [`b601c46`](https://github.com/cmdcolin/ntsc.js/commit/b601c464fab7ce4020092de46a2eeb157edb7d9a) Suppress sync at the head-end, and noise the color-under carrier

### Refactor
- [`644e526`](https://github.com/cmdcolin/ntsc.js/commit/644e526a221f04bc1b54bfd56d64fdc6bef4072b) Group changelog by type, keep messages verbatim
- [`665c610`](https://github.com/cmdcolin/ntsc.js/commit/665c610544628d6281350abe1af8a75ad63178c9) simplify changelog config now that history uses real type prefixes

### Documentation
- [`89b28fd`](https://github.com/cmdcolin/ntsc.js/commit/89b28fd855733b1b1135d8e674e9d5c26cf846a8) note commit-scope convention

### Chores
- [`788ccbb`](https://github.com/cmdcolin/ntsc.js/commit/788ccbba2913246cc3b7c183075d447bdac6640a) Set up git-cliff and backfill CHANGELOG.md
- [`73a42b9`](https://github.com/cmdcolin/ntsc.js/commit/73a42b9ed1a1a3fc982acb654daca970c6663b02) Convert linting and formatting to oxlint and oxfmt

### Other Changes
- [`6dd105b`](https://github.com/cmdcolin/ntsc.js/commit/6dd105b0bfd1cd5c28af217b68e585b06e30f5c1) Record the remaining effect ideas, and the free-run gap behind them

## [0.6.0](https://github.com/cmdcolin/ntsc.js/compare/v0.5.0...v0.6.0) - 2026-08-01

### Features
- [`8e586a4`](https://github.com/cmdcolin/ntsc.js/commit/8e586a48a179e4b4ce2a025e1a84daf6d642915e) Bend the enhancer's other three stages, not just its peaking coil

### Refactor
- [`f9fd196`](https://github.com/cmdcolin/ntsc.js/commit/f9fd1962926ecf875b2272daad64af408c66533f) Fold the signal-path FIRs on their own symmetry

### Style
- [`0c08584`](https://github.com/cmdcolin/ntsc.js/commit/0c08584ed4781eb3446464983f40fc64321e34a2) Format and remove signal path note

## [0.5.0](https://github.com/cmdcolin/ntsc.js/compare/v0.4.0...v0.5.0) - 2026-08-01

### Features
- [`eafa87b`](https://github.com/cmdcolin/ntsc.js/commit/eafa87b4d99e9e6282c48a4f5c392e09830605ab) Audio in from a file, picked alongside the other sources
- [`0b71687`](https://github.com/cmdcolin/ntsc.js/commit/0b716874fb3b2eb039845557a9137488c4787380) Bleed the beam spot into the phosphor, and let the tail scatter
- [`b2065ac`](https://github.com/cmdcolin/ntsc.js/commit/b2065ac4c9e3090bccad1901361b6b2695c7f1a8) Draw the signal chain as a block diagram
- [`8898b48`](https://github.com/cmdcolin/ntsc.js/commit/8898b48fc5ca574f3c9b8d7e3b66d58190d8ea7a) Stack the three input pickers, and scrub a loaded audio file
- [`99481b2`](https://github.com/cmdcolin/ntsc.js/commit/99481b2cfa4e7a9f11a1fbf2e062806b4929f6cf) Let the panel breathe, and make a preset drag mean one thing
- [`94ce579`](https://github.com/cmdcolin/ntsc.js/commit/94ce5798472199a4a6cf928655336cd13b541bdd) Let the eye move: magnify the glass, or pull back off the set
- [`d4f77bd`](https://github.com/cmdcolin/ntsc.js/commit/d4f77bd900bc79cb3920b1cbec3fc5b4b463815d) Let a debug view watch the decoder without interrupting it
- [`16e0998`](https://github.com/cmdcolin/ntsc.js/commit/16e0998074da79f65ac3bf9208c5815c9df188c9) Give useEngine two collaborators instead of two copies of everything
- [`13267d2`](https://github.com/cmdcolin/ntsc.js/commit/13267d20de8b694813b62b5bb238289da30dd17e) Let the audio meter keep up with the kick it is showing
- [`981e909`](https://github.com/cmdcolin/ntsc.js/commit/981e909befc12b279957f3d2251b2912b6693f98) Bring back the file a source slot held last session

### Fixes
- [`6e370a7`](https://github.com/cmdcolin/ntsc.js/commit/6e370a79c64f369c79014174cb545204eb648e52) Keep the landing look out of the clean baseline
- [`50beca1`](https://github.com/cmdcolin/ntsc.js/commit/50beca1925ab61fe3cdcc8504f415dd792cf6ec6) Keep the tube-face feather off the picture at 1x
- [`676d2ba`](https://github.com/cmdcolin/ntsc.js/commit/676d2baee98196d17d274f860ae55286d034cd3b) Stop making the reader lean in: one type scale, four brighter grays
- [`4b5b114`](https://github.com/cmdcolin/ntsc.js/commit/4b5b1149884eabe5bc3dc0bc9f599b9cfb95a7b3) Stop dispatching source B for a fader the genlocked path never reads
- [`de90a91`](https://github.com/cmdcolin/ntsc.js/commit/de90a91d46e60f96416f54feca7bb40e725b01d8) Patch the chain like a rack, and put its door where it will be found
- [`993bacd`](https://github.com/cmdcolin/ntsc.js/commit/993bacdacc7205beba128893b31d510816f616aa) Run the tape wow clock on frames, not on dub generations
- [`6ae1ea0`](https://github.com/cmdcolin/ntsc.js/commit/6ae1ea093a9098b2fe030cfe9f31b17df9172121) Keep one audio context, so the mic stops stranding the video slots
- [`c289099`](https://github.com/cmdcolin/ntsc.js/commit/c28909963df9e4065c0c4f82011b969a942c9d69) Push only the clock-locked rates to the engine
- [`bd8def3`](https://github.com/cmdcolin/ntsc.js/commit/bd8def3bcfab00dd77fcb415bd0043418a008533) End hold-to-compare when the window loses focus
- [`0b4c573`](https://github.com/cmdcolin/ntsc.js/commit/0b4c57363a831c1e833a561f5558624304001c72) Report each GPU fault once
- [`8b0deea`](https://github.com/cmdcolin/ntsc.js/commit/8b0deea6dfdb091deac130823ba723c39a54fc61) Correct the architecture note on what keeps writeControl stable
- [`6f05223`](https://github.com/cmdcolin/ntsc.js/commit/6f052230bc22968443732475e41c08c2b099d8a1) Bound the rAF fallback and record why the tab froze
- [`f910646`](https://github.com/cmdcolin/ntsc.js/commit/f910646faf33327eec2e6685c0ee7246c4435bb7) Correct the signal-path diagrams against the actual pass graph
- [`f53ee7a`](https://github.com/cmdcolin/ntsc.js/commit/f53ee7ae0585efee768999977473acf7f0355aad) Keep a preset drag's pointer from running ahead of its weight
- [`833bdcc`](https://github.com/cmdcolin/ntsc.js/commit/833bdcce03867bd2ebc6afcd5029e89abc1bda09) Cap the decode at the same edge the texture is capped to
- [`7e4d705`](https://github.com/cmdcolin/ntsc.js/commit/7e4d70591bd8d5a2f990278d2d9e4cba211aa1a8) Keep bridging a stall through a blur, and rebuild the surface before giving up
- [`e51f25b`](https://github.com/cmdcolin/ntsc.js/commit/e51f25ba77692683d4af28971a39a5f8438b1bec) Keep mutate off the magnifier's zoom and pan
- [`701b4a8`](https://github.com/cmdcolin/ntsc.js/commit/701b4a83f3d74725c2e281508d3e0695b138b5ab) Hanged state

### Refactor
- [`54bb307`](https://github.com/cmdcolin/ntsc.js/commit/54bb307cbc503e820263f8c9d4b461d15570d24d) Rank a section by where it sits, and name the audio one for what it does
- [`8eb60eb`](https://github.com/cmdcolin/ntsc.js/commit/8eb60eb949dc935c7a3ea3e5ee429b88a47256cf) Fold the stage controls into one menu, and hold the bar level
- [`41578da`](https://github.com/cmdcolin/ntsc.js/commit/41578dab529b729b587fee7d3480d687a527ed94) Build the six rows you can see, not all 121 every time
- [`51b8d28`](https://github.com/cmdcolin/ntsc.js/commit/51b8d28b0d84ef4d798ae7ece8010b1696954d17) Compute the subcarrier lattice instead of looking it up
- [`151758c`](https://github.com/cmdcolin/ntsc.js/commit/151758c3aab8bd542e3f4d6a013e075688dc9d76) Drop the glyph rule the chain diagram's old bar button left behind
- [`c257d82`](https://github.com/cmdcolin/ntsc.js/commit/c257d82f1b96cfde5880c32a7d7b0bee2ccdeb14) Remove scroll-to-zoom from the stage
- [`1b35c73`](https://github.com/cmdcolin/ntsc.js/commit/1b35c734601485a687e8f8994b14bc1880210d76) Make the clean preset a plain reset, not a fader
- [`888391e`](https://github.com/cmdcolin/ntsc.js/commit/888391e63bb05fa17c7443c4183d88696e726a1d) Snap values onto a control's grid in one place, not four
- [`c977966`](https://github.com/cmdcolin/ntsc.js/commit/c9779663dec3e75c6d53e15ad16fb902ef08df61) Round-trip source B's generated modes through the query string
- [`d430f71`](https://github.com/cmdcolin/ntsc.js/commit/d430f71f0fe30726cfc7cd88d441d9f315d3481c) Hand back two things the engine was holding onto
- [`55e5704`](https://github.com/cmdcolin/ntsc.js/commit/55e57048b07c1609e1081aabfc671a680c8ab476) Put the link writer beside the reader, and pin the round trip

### Chores
- [`fe587bd`](https://github.com/cmdcolin/ntsc.js/commit/fe587bdd0d0ff219314fb9239d02db3fad3d52a2) Rename
- [`76e7895`](https://github.com/cmdcolin/ntsc.js/commit/76e7895295497fdbf8c55a32fbf262db3301bcb2) App rename to ntscythe

## [0.4.0](https://github.com/cmdcolin/ntsc.js/compare/v0.3.0...v0.4.0) - 2026-08-01

### Features
- [`3fa9950`](https://github.com/cmdcolin/ntsc.js/commit/3fa995045f8a093435b550609a2ec784c1e5b102) Add .ts extension to vite plugin import for native config loader

### Fixes
- [`b974dcb`](https://github.com/cmdcolin/ntsc.js/commit/b974dcbdd15017ac53261cb38e1a6ec5435ac222) Fix silent-failure gaps in shader validation, storage, and clock sync

### Refactor
- [`3cfe107`](https://github.com/cmdcolin/ntsc.js/commit/3cfe107aad13b1fceff4bf6e8672cf67f4caa387) Lead the panel with presets; draw the signal path as a chain
- [`f2d05e7`](https://github.com/cmdcolin/ntsc.js/commit/f2d05e791162a7db1f7736f08546faea84042d46) Key mod state by slot, guard stored shapes, cover the per-line state
- [`4401647`](https://github.com/cmdcolin/ntsc.js/commit/44016474e2d042e71a030064935039114563aa33) Extract source-texture management out of the engine

### Chores
- [`b7854ed`](https://github.com/cmdcolin/ntsc.js/commit/b7854ed75aaa40fd142e68638621c71707b432b0) Re-title app
- [`cb698a2`](https://github.com/cmdcolin/ntsc.js/commit/cb698a23325959e0274483e7aca5f507a9aea724) Small audio tweak

## [0.3.0](https://github.com/cmdcolin/ntsc.js/compare/v0.2.1...v0.3.0) - 2026-08-01

### Features
- [`5a9fc45`](https://github.com/cmdcolin/ntsc.js/commit/5a9fc4595f77672479d27a0b93db2976ca80a3e4) NTSC signal-path simulator: dirty mixing, mixer-loop feedback, camera model, RF/AGC
- [`abe72cb`](https://github.com/cmdcolin/ntsc.js/commit/abe72cbd419c711c6fb4915cc6282691a40a54be) Mixer wipes, B-bus proc amp, frame-store strobe/trails
- [`a9e13ba`](https://github.com/cmdcolin/ntsc.js/commit/a9e13bad3e85ac263e529b790b25f4025302e008) WebGPU-unavailable error screen, resource cleanup, GitHub Pages deploy
- [`3ba3382`](https://github.com/cmdcolin/ntsc.js/commit/3ba3382854c75be652d8f5b20ff64d1ea021fc74) Collapsible panel sections, fullscreen toggle, Camera Feedback rename
- [`f1c3817`](https://github.com/cmdcolin/ntsc.js/commit/f1c381776b515b35392e21456aa27b82672d8fec) Add prettier dependency, drop obsolete package.json pnpm field
- [`9a3830f`](https://github.com/cmdcolin/ntsc.js/commit/9a3830fdb70bff6a930e9828a96933648b513fa8) Device-loss recovery UI, shareable copy-link, adjustable render scale
- [`0d7c845`](https://github.com/cmdcolin/ntsc.js/commit/0d7c845b0c1ce79556826aa5f1526a5c7dcad348) Add GitHub link to panel header
- [`15edcb6`](https://github.com/cmdcolin/ntsc.js/commit/15edcb6afb24f158d2d412dcdbb73d3be91f38d1) Favicon + advanced-settings dialog for render scale
- [`a83f566`](https://github.com/cmdcolin/ntsc.js/commit/a83f566c2383e9e8e0ba416c2777073458911231) Add typescript-eslint (strict-type-checked) + lint scripts
- [`786d046`](https://github.com/cmdcolin/ntsc.js/commit/786d046e3d35cfee6fc72e6747e0c80777b76040) Add FIR filter unit tests; gate deploy on lint + test
- [`71f778b`](https://github.com/cmdcolin/ntsc.js/commit/71f778bfda0f951f7143c7e7ee2e7af686891bee) Presets: grouped picker with descriptions, active state, hover-diff, hold-to-compare
- [`2ed84dd`](https://github.com/cmdcolin/ntsc.js/commit/2ed84dd07c5181ac99ed56dcf9faac91f24a43d2) Wire MIDI + clock-sync controls into the panel
- [`b640bd6`](https://github.com/cmdcolin/ntsc.js/commit/b640bd6030d4b981159361cea6f8895d15376b5a) Surface A/B mix controls next to the Input row when source B is on
- [`b395402`](https://github.com/cmdcolin/ntsc.js/commit/b395402522c801d6e3b01c8c7b2964e3530491a9) Add composite polarity-flip (color invert) on source A
- [`91360f6`](https://github.com/cmdcolin/ntsc.js/commit/91360f6be5182b3edb1e74344ccf50e80fa1d770) Add S-video Y/C miswire (cross-wire) decoder effect
- [`1026e87`](https://github.com/cmdcolin/ntsc.js/commit/1026e87dc1825e3de5605bcf4f80bc2611417827) Add cable wiring faults: hard polarity flip + termination
- [`f448d64`](https://github.com/cmdcolin/ntsc.js/commit/f448d64b6e025eb61855cbc3777b148d145e8920) Add chroma-pin-only feed and loose-connector faults
- [`41ace12`](https://github.com/cmdcolin/ntsc.js/commit/41ace1269eeaaa8d5425a4e41fa4befdd124eb39) Add TV-static and VHS-static noise sources
- [`e011ab7`](https://github.com/cmdcolin/ntsc.js/commit/e011ab720949aa3d6b9f7798daaade4ed2f9871b) Add positionable picture-in-picture inset for source B
- [`d44f31b`](https://github.com/cmdcolin/ntsc.js/commit/d44f31b2f9e21df4cb2bc55a5f9b47af03fa6b10) Add VHS tracking-error band and luma-keyed PiP inset
- [`556bc78`](https://github.com/cmdcolin/ntsc.js/commit/556bc787b4e27c1969d0fee70f2aeba83451975a) Add CRT-faceplate pass for a real camera-at-monitor feedback path
- [`7927a2b`](https://github.com/cmdcolin/ntsc.js/commit/7927a2bc0192d4c5048306cb12fbc2eb45cb000d) Add USB/RCA capture-device input and source deinterlace
- [`a11d809`](https://github.com/cmdcolin/ntsc.js/commit/a11d8093e53e81b526ac90181575c504fe8971b0) Add eslint-react (recommended-typescript) to the lint config
- [`0df1c4b`](https://github.com/cmdcolin/ntsc.js/commit/0df1c4bab279ba7f75b941d44646ababc92389c9) Add popout controls, scene slots, control filter, anchored slider fill, frame-stats monitor
- [`c951c69`](https://github.com/cmdcolin/ntsc.js/commit/c951c69ec48719534451b946d55ac13a80756067) Add package metadata and descriptive gallery alt text
- [`7cf0c5b`](https://github.com/cmdcolin/ntsc.js/commit/7cf0c5b763d511850339aa43cd46e2177a1ea081) Add motion demo: cat hero, and a clip on the no-WebGPU screen
- [`9c40a8c`](https://github.com/cmdcolin/ntsc.js/commit/9c40a8c4be62d85ddb3755a4913d71bdebc57559) Add declarative URL loading (?iurl/?iurlb/?preset) + sample images
- [`cbf6a2f`](https://github.com/cmdcolin/ntsc.js/commit/cbf6a2f6aff2ca3f25639c37261b0effb7f8cabb) Model the hold oscillators, deflection geometry, and audio drive
- [`79916db`](https://github.com/cmdcolin/ntsc.js/commit/79916db98fe14eb1fab0eb2f211cd798c79d3184) Add CRT beam transfer and hue-preserving gamut fit (phosphor plan phase 1)
- [`4cfebf5`](https://github.com/cmdcolin/ntsc.js/commit/4cfebf5f4bc0e4bc2df532260f89e29dc6051444) Phosphor identity (plan phase 2), deflection glide, and circuit-bent controls
- [`3dceb78`](https://github.com/cmdcolin/ntsc.js/commit/3dceb78027238f0006669ed00a9b4f03379b59fe) Add capture (still/clip), mutate, and single-level undo to the UI
- [`4fa1b2b`](https://github.com/cmdcolin/ntsc.js/commit/4fa1b2bd77d546a4a450c3810118c4e6941b92db) Let the dev server fall back to another port instead of failing
- [`cebc4df`](https://github.com/cmdcolin/ntsc.js/commit/cebc4dfb98fbec1dd0825edac033d3b11c893563) Enable React Compiler
- [`5e8842b`](https://github.com/cmdcolin/ntsc.js/commit/5e8842b4dc1396331dc467a1ef3c5c6e4e0bcc22) Mirror app state to the URL continuously
- [`1c6ebc4`](https://github.com/cmdcolin/ntsc.js/commit/1c6ebc4c5a43a86d0e1eed7eabb4077b800d679c) Let the brand name stand alone, explain it behind a ? icon
- [`feefad5`](https://github.com/cmdcolin/ntsc.js/commit/feefad58566f321d817e6db90f941d2e6bb6f68c) Add a clean genlocked A/B mixer alongside the dirty sum
- [`61e2093`](https://github.com/cmdcolin/ntsc.js/commit/61e209389ea2147ae59a1e8636f0f2196c1597f8) Feedback control
- [`dd1bafd`](https://github.com/cmdcolin/ntsc.js/commit/dd1bafd7f8847941e71d854e2b1799c8e335882d) feat: useEngine.ts — added sourceName / sourceBName state, set alongside the existing sourceMode/sourceBMode:
- [`1dee106`](https://github.com/cmdcolin/ntsc.js/commit/1dee106d5c50697b017f0f5d568b305912533f27) Add agent-docs/IDEAS.md — modulation backlog
- [`b466828`](https://github.com/cmdcolin/ntsc.js/commit/b466828b6dbcf39593ccfe3bdce7d519f17c180c) Load YouTube clips in dev via a yt-dlp Vite middleware
- [`9555052`](https://github.com/cmdcolin/ntsc.js/commit/955505208fd29fd1872750e9de3fea3e4fb5b02a) Add TV/VHS static as a source B option
- [`b97c6dd`](https://github.com/cmdcolin/ntsc.js/commit/b97c6dd6b7e7f119960aa07667cdec5f2d714b6c) Add a vaporwave playback panel: slow video + pitch-dropped audio
- [`2104b23`](https://github.com/cmdcolin/ntsc.js/commit/2104b233cf1a38c587b10fcf1e9d8394be1beaa3) Add MIDI auto-map and learn-in-order bulk binding
- [`4a5c875`](https://github.com/cmdcolin/ntsc.js/commit/4a5c875dec78050ac4f4fa48bc152259a129a270) Add Favorites pinning and place-based panel groups; wire vaporwave meter
- [`edb9e85`](https://github.com/cmdcolin/ntsc.js/commit/edb9e85bfe53d5247f078ff5f113ac55a7930ae4) Add build-stamped version and a color-bars sidebar logo
- [`1d2f36f`](https://github.com/cmdcolin/ntsc.js/commit/1d2f36fa3874bd03876813596617faf927f26eb3) Add a lightbulb icon to the presets hint
- [`0681be2`](https://github.com/cmdcolin/ntsc.js/commit/0681be2c8111466d454f3f18f95205ebece761ce) Add signed A-gain fader to the A/B summing bus
- [`30f4b10`](https://github.com/cmdcolin/ntsc.js/commit/30f4b10c5bfbc7983c708dfa43eb03d1cfb7cdcc) Surface gated controls, artifact search, and preset blurbs
- [`aedbe30`](https://github.com/cmdcolin/ntsc.js/commit/aedbe30ea0b01027ab03eae50d0d0a8f70e3f553) VHS shuttle picture search, slow-motion time scale, effects listing
- [`001cfec`](https://github.com/cmdcolin/ntsc.js/commit/001cfec9e9b8b04564178c53fcbce45a855dd468) Direct-manipulation miniatures for the PiP inset and A/B wipe
- [`fe47b88`](https://github.com/cmdcolin/ntsc.js/commit/fe47b88d15c202401fba585156974c918bcc18c3) Miniature follow-ups: shared math with tests, soft edges, slider toggle
- [`1fbd75f`](https://github.com/cmdcolin/ntsc.js/commit/1fbd75f7a841d8ca983c54a120bebcc2bcd9569a) Dramatic s-video miswire, stuck tape preset, slow-mo URL example
- [`9d022f0`](https://github.com/cmdcolin/ntsc.js/commit/9d022f09f9b1855ff1b97c9c81d24ab26f48dd19) Re-pick a loaded source by clicking its filename caption

### Fixes
- [`78c67f2`](https://github.com/cmdcolin/ntsc.js/commit/78c67f2fb9060ba807f3273689fa476ad85acc92) Fix source-select UI bugs; parse dbg param once
- [`d7ed424`](https://github.com/cmdcolin/ntsc.js/commit/d7ed424544e764dd5944031a26c2ad50996cb52f) Escape closes the advanced-settings dialog
- [`5218192`](https://github.com/cmdcolin/ntsc.js/commit/521819202acc8cd79b954243afaf7a8398a9d37c) Keep render loop alive when a frame throws
- [`acfd425`](https://github.com/cmdcolin/ntsc.js/commit/acfd425059af36bdd641372cb35456c5f46fc6ba) Fix sticky error banner and slider swallowing f/c shortcuts
- [`fa79a8c`](https://github.com/cmdcolin/ntsc.js/commit/fa79a8c40d24ac33920f4061d341059b7cebe50b) Fix broken README gallery and boost discoverability
- [`28881ff`](https://github.com/cmdcolin/ntsc.js/commit/28881ffecf7f8c6f8c33bd79812636f4aa80491e) Harden the render loop against post-transition freezes
- [`761eae5`](https://github.com/cmdcolin/ntsc.js/commit/761eae56bc1f7f43e3279bc73d3d14d3010c27d5) Keep the render loop alive across rAF suspension, GPU hangs, and reloads
- [`b866f5a`](https://github.com/cmdcolin/ntsc.js/commit/b866f5a25cfe9d3071d8894dd01c86f3fc03ab64) Correct what the compiler bail-outs actually risk
- [`201911d`](https://github.com/cmdcolin/ntsc.js/commit/201911d3b7fd40dbe5eecbd2cd68eba267b74170) Keep useCallback on the MIDI write path
- [`272be4b`](https://github.com/cmdcolin/ntsc.js/commit/272be4b07f234633f4961a0c19da57f5fe3675d1) Match letter shortcuts case-insensitively
- [`3d2a20a`](https://github.com/cmdcolin/ntsc.js/commit/3d2a20ada2be1861cd9ec03835443b46ce80c842) Grab the still inside a frame so Chrome captures pixels
- [`f990f3a`](https://github.com/cmdcolin/ntsc.js/commit/f990f3ae27d60938f75c07fcb763d4043bdb93e6) Harden localStorage reads and scope Popover to its own document
- [`1558f33`](https://github.com/cmdcolin/ntsc.js/commit/1558f33cd6755e37ffc866aa68c0a7f1329af6ae) Cap custom source resolution so large pictures/videos don't freeze

### Performance
- [`6fc572b`](https://github.com/cmdcolin/ntsc.js/commit/6fc572b702fc83bb45963bd765dc9566342e248d) Const-fold FIR tap counts; shared-memory tiling for convolution passes

### Refactor
- [`4f48c2b`](https://github.com/cmdcolin/ntsc.js/commit/4f48c2b434da2c80eeca919c2c319a8aa85e62d0) Inject exact DOWN_PER_SAMPLE; dedupe compose bind group
- [`49226bd`](https://github.com/cmdcolin/ntsc.js/commit/49226bdefb0836b580c169d0a22195a1734d5559) Sidebar redesign: sans font, source dropdowns, CSS modules
- [`eb96f79`](https://github.com/cmdcolin/ntsc.js/commit/eb96f79d179567e53007147e04ab8d010c667da9) Simplify presets: drop hidden slots, hover-diff, and redundant reset
- [`a9c392c`](https://github.com/cmdcolin/ntsc.js/commit/a9c392ceafec8a2a985236383517f8b393c58b84) Default source B to off
- [`8e806a7`](https://github.com/cmdcolin/ntsc.js/commit/8e806a78f514be1ce4eb164effb43118579c4bf6) Type packParams to require every uniform at compile time
- [`4d9f7ba`](https://github.com/cmdcolin/ntsc.js/commit/4d9f7bacc1b222c092be0b56edfc340f79534de2) Simplify sidebar: fix copy-link encoding, dedup omit, hoist preset groups
- [`6a2f6d5`](https://github.com/cmdcolin/ntsc.js/commit/6a2f6d522e43043e8f8334bc19925d178ed5fed3) DRY up error-banner clearing to the two source entry points
- [`0c552a5`](https://github.com/cmdcolin/ntsc.js/commit/0c552a5fc6f3f3f0f7ffb6c6c4b74f7bdf31bbfb) Collapse the alternative B compositors by default
- [`625c879`](https://github.com/cmdcolin/ntsc.js/commit/625c879d71eccb2c764ed0d79cf5d2300a25cb54) Split app.tsx into per-component files and engine/MIDI hooks
- [`78fde86`](https://github.com/cmdcolin/ntsc.js/commit/78fde86179cee7e884bc7c3ba5928bf0c9e82845) Make the fps monitor an always-on rolling histogram
- [`9986fe5`](https://github.com/cmdcolin/ntsc.js/commit/9986fe52b32fb188d7c319ea0a105e5a735d6eca) Make the fps monitor update faster and take less width
- [`92f0aea`](https://github.com/cmdcolin/ntsc.js/commit/92f0aea841da899dd0a5ae320de9d961d6f1655d) Simplify the modulation panel
- [`321e678`](https://github.com/cmdcolin/ntsc.js/commit/321e6784852b67ddee876e6bf6d84e15653b7f67) Make the fps monitor minimal and let both overlays be dismissed
- [`472e881`](https://github.com/cmdcolin/ntsc.js/commit/472e8817ba9afa234ff55307acd2be3e6f497a16) Drop manual memoization now that the compiler does it
- [`30ca70b`](https://github.com/cmdcolin/ntsc.js/commit/30ca70bf688092b9c905c2a21b844e505a7fa914) Drop preset-mix fills to zero once the look diverges
- [`9289344`](https://github.com/cmdcolin/ntsc.js/commit/928934434a64191b6d9a443215255e84b57c11cb) Make preset mixing an explicit slider per preset
- [`b96f3f4`](https://github.com/cmdcolin/ntsc.js/commit/b96f3f43710b7cd3a27effa027a71a6b22222673) Return presets to compact chips, with one section explainer
- [`eb0b63a`](https://github.com/cmdcolin/ntsc.js/commit/eb0b63a2516e156ff7cfe6d4e15a29e6b0c07ec1) Move the preset hint above the chips
- [`16a7de7`](https://github.com/cmdcolin/ntsc.js/commit/16a7de7a51768f05b72b309149f4ca232ef8c387) Make clicking a preset layer in at full, not reset the mix
- [`c96fced`](https://github.com/cmdcolin/ntsc.js/commit/c96fced7baf4f7c3bd15fba076bde2dacc9f7310) Organize controls into signal-path phases with single-open browsing
- [`0700e26`](https://github.com/cmdcolin/ntsc.js/commit/0700e2636bcc0dfc584abca6f1ce51883d7be3fe) Replace periodic modulators with bounded-aperiodic sources
- [`99b8602`](https://github.com/cmdcolin/ntsc.js/commit/99b86028c302ec69441f99631876c31eea861d6f) Make YouTube a source-mode selector with a URL dialog for A and B
- [`a6811fb`](https://github.com/cmdcolin/ntsc.js/commit/a6811fbb1ee453888e706cec1aac9afe6ba78c57) Reclaim panel vertical space; make the spine a status map
- [`d0f2206`](https://github.com/cmdcolin/ntsc.js/commit/d0f2206956af5a8b51f976138cfdd1803eeb75c3) Dedupe NTSC composite assembly into shared prelude helpers
- [`3f22d7d`](https://github.com/cmdcolin/ntsc.js/commit/3f22d7d3aa348789f04995f52d37958b40606c2f) Drop version-number guesses from WebGPU-unavailable copy
- [`dc68e19`](https://github.com/cmdcolin/ntsc.js/commit/dc68e19374397c01c9544a9d9452f238dd531296) Extract shared UI primitives, move to CSS var theming, add capture popover
- [`ccfd307`](https://github.com/cmdcolin/ntsc.js/commit/ccfd307d61cf9cd16cb529d47470376b8b30f5ce) Decompose App into focused hooks; add Dialog a11y and helper tests
- [`0ed4f47`](https://github.com/cmdcolin/ntsc.js/commit/0ed4f47532ba026465318c441f3d246fa2ecabc5) Render discrete controls as toggle groups, not sliders
- [`63be364`](https://github.com/cmdcolin/ntsc.js/commit/63be364d7cab2df8c006fa76db603da5657971e7) Rebuild Dialog on the native <dialog> element
- [`2b326a9`](https://github.com/cmdcolin/ntsc.js/commit/2b326a90dfdc9f33f6708fcfa25aad8b1fbd3929) Group inert banners, hover help, surprise me, live signal taps
- [`0453eb9`](https://github.com/cmdcolin/ntsc.js/commit/0453eb983de3955691689766ad2cd84200bf0ed2) Rename to ntscsynth; add a waveform logo, mark, and favicon
- [`31ce519`](https://github.com/cmdcolin/ntsc.js/commit/31ce5199ea3e0d140efcb015f12739385f1c1451) Default to bGain 0.16 with source B on bars

### Documentation
- [`a787853`](https://github.com/cmdcolin/ntsc.js/commit/a787853f1b326a9fdeb2a380ddf9dfa75cb04905) Trim README, note it was written with Fable
- [`6b8055e`](https://github.com/cmdcolin/ntsc.js/commit/6b8055eae2839fff4bbc988dfe5027179a7823f1) Update README.md
- [`e4008ed`](https://github.com/cmdcolin/ntsc.js/commit/e4008ed977d5a86626a7cb2b91b1b2db86ebcad1) README: add deploy status badge
- [`f1dab28`](https://github.com/cmdcolin/ntsc.js/commit/f1dab28c55dcb2006bdd8c89e3d612474f4631a3) README: document the signal path with Graphviz diagrams
- [`8366036`](https://github.com/cmdcolin/ntsc.js/commit/8366036bf850f229062c966f8e76eaa6ac362bd4) Rewrite README how-it-works for a plainer voice
- [`a208d61`](https://github.com/cmdcolin/ntsc.js/commit/a208d61771409c3b09d4419228d31455ed041065) Gallery
- [`d7146e4`](https://github.com/cmdcolin/ntsc.js/commit/d7146e43a4ce01fcb9f9b04d2bd0e8ba8630fa05) Gallery: real photos through the pipeline instead of just test bars
- [`59a6cb0`](https://github.com/cmdcolin/ntsc.js/commit/59a6cb07a6d48a8de1e6091203ac6084daef4803) Gallery: add a third row (negative, faded dub, strobe trails)
- [`8e61a20`](https://github.com/cmdcolin/ntsc.js/commit/8e61a202e36b9ff02813dccd5e7e56f08e9a5cc9) CLAUDE.md: point at the architecture doc
- [`c94300b`](https://github.com/cmdcolin/ntsc.js/commit/c94300bbeedcc16d3300dd9f88a7659da9f15c0b) mark phosphor plan phase 1 done, add phase 2 handoff
- [`3339e1d`](https://github.com/cmdcolin/ntsc.js/commit/3339e1de9e9401d5d04e1865f9707f7883409e94) Explain every slider with a ? icon and a dialog
- [`61587a6`](https://github.com/cmdcolin/ntsc.js/commit/61587a68bc36d2eecc5f0795cf9f4561dc59b061) Document the React layer and the compiler's sharp edge
- [`01a87ed`](https://github.com/cmdcolin/ntsc.js/commit/01a87ed9aaf036559eb7527e869a4444d806d2bb) Summary
- [`941dcd6`](https://github.com/cmdcolin/ntsc.js/commit/941dcd640fb888dc10a9b808469d26ad0ea7afa2) Record that the preset-mix recipe is deliberately not persisted
- [`e61324d`](https://github.com/cmdcolin/ntsc.js/commit/e61324de0541d3379d303ceb4b2f9b33183f7088) Spell out the drag-to-partially-apply gesture in the preset hint
- [`3c13cf3`](https://github.com/cmdcolin/ntsc.js/commit/3c13cf36a00f9a808680392227f178af94c97adc) Clarify WebGPU processing in README for JS readers
- [`f179170`](https://github.com/cmdcolin/ntsc.js/commit/f179170fea242eecc18a276ef4cf30b1969f0e2e) Document the miniature pattern; drop the swept-wipe pulse animation

### Style
- [`b05fa95`](https://github.com/cmdcolin/ntsc.js/commit/b05fa955fa453414125681f91b863487637f5020) Box sidebar section headers so the collapse caret is clearly associated
- [`7b3b585`](https://github.com/cmdcolin/ntsc.js/commit/7b3b585a9bae037359ff26488416665c00053abe) Format
- [`b489508`](https://github.com/cmdcolin/ntsc.js/commit/b4895083acd0b9d9abacb1fc66aad9b5832762c6) Lowercase the about dialog's section heads

### Tests
- [`8f730b4`](https://github.com/cmdcolin/ntsc.js/commit/8f730b4ceee9f9909326e4ce1b2ef4b75a758ec1) Validate WGSL shaders with naga in CI
- [`11106db`](https://github.com/cmdcolin/ntsc.js/commit/11106dba317bb61afe9a7ed90580ad4468185840) Fail shot.mjs on dead frames and page errors

### Chores
- [`6c19578`](https://github.com/cmdcolin/ntsc.js/commit/6c19578f401a95c27696a1e56c2a25fba55bb1e4) Name the app "Phosphene"
- [`468a010`](https://github.com/cmdcolin/ntsc.js/commit/468a0103abba46cc1938a84f83c33124186d7f18) Relative build base; update URLs for phosphene repo rename
- [`8c42930`](https://github.com/cmdcolin/ntsc.js/commit/8c4293037db5f2337797606caaade08bb14d6abf) CI: auto-deploy to GitHub Pages on push to main
- [`8897212`](https://github.com/cmdcolin/ntsc.js/commit/88972122218fbae187fea1e461dab87fc62ba91a) CI: pin pnpm 11 to match repo workspace config
- [`664ff97`](https://github.com/cmdcolin/ntsc.js/commit/664ff973366507faaaf43e28276e6f519a2dedf6) Ignore .eslintcache
- [`19c4b76`](https://github.com/cmdcolin/ntsc.js/commit/19c4b764dfd16e5a8c0bf14b92ca75ae07fe7bb2) Rm silly philosophy :)
- [`6816d78`](https://github.com/cmdcolin/ntsc.js/commit/6816d78eede0a13c81627f85459987b59ba08115) Use fb-bloom for OG and add GitHub social-preview image
- [`8accd40`](https://github.com/cmdcolin/ntsc.js/commit/8accd409ecf0d3721a9de1317783a626d5795c87) clips.mjs: output mp4 directly for review
- [`77cf3bb`](https://github.com/cmdcolin/ntsc.js/commit/77cf3bba77d7c91eaae48b99e2aa3afce59f6a94) Prettier config
- [`7d66d64`](https://github.com/cmdcolin/ntsc.js/commit/7d66d64ce1b42b0d9923a8b2d386fc23683505b3) Bump deps
- [`c4d7e1f`](https://github.com/cmdcolin/ntsc.js/commit/c4d7e1fbae4007d878930cd110526470058f1706) Bump deps

