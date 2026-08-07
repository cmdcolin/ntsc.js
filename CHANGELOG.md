# Changelog

All notable changes to ntsc.js are documented here.

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
- [`9d022f0`](https://github.com/cmdcolin/ntsc.js/commit/9d022f09f9b1855ff1b97c9c81d24ab26f48dd19) Re-pick a loaded source by clicking its filename caption

### Fixes
- [`1558f33`](https://github.com/cmdcolin/ntsc.js/commit/1558f33cd6755e37ffc866aa68c0a7f1329af6ae) Cap custom source resolution so large pictures/videos don't freeze

### Refactor
- [`0453eb9`](https://github.com/cmdcolin/ntsc.js/commit/0453eb983de3955691689766ad2cd84200bf0ed2) Rename to ntscsynth; add a waveform logo, mark, and favicon
- [`31ce519`](https://github.com/cmdcolin/ntsc.js/commit/31ce5199ea3e0d140efcb015f12739385f1c1451) Default to bGain 0.16 with source B on bars

### Documentation
- [`f179170`](https://github.com/cmdcolin/ntsc.js/commit/f179170fea242eecc18a276ef4cf30b1969f0e2e) Document the miniature pattern; drop the swept-wipe pulse animation

### Chores
- [`c4d7e1f`](https://github.com/cmdcolin/ntsc.js/commit/c4d7e1fbae4007d878930cd110526470058f1706) Bump deps

## [0.2.1](https://github.com/cmdcolin/ntsc.js/compare/v0.2.0...v0.2.1) - 2026-07-22

### Features
- [`001cfec`](https://github.com/cmdcolin/ntsc.js/commit/001cfec9e9b8b04564178c53fcbce45a855dd468) Direct-manipulation miniatures for the PiP inset and A/B wipe
- [`fe47b88`](https://github.com/cmdcolin/ntsc.js/commit/fe47b88d15c202401fba585156974c918bcc18c3) Miniature follow-ups: shared math with tests, soft edges, slider toggle
- [`1fbd75f`](https://github.com/cmdcolin/ntsc.js/commit/1fbd75f7a841d8ca983c54a120bebcc2bcd9569a) Dramatic s-video miswire, stuck tape preset, slow-mo URL example

## [0.2.0](https://github.com/cmdcolin/ntsc.js/compare/v0.1.2...v0.2.0) - 2026-07-22

### Features
- [`0681be2`](https://github.com/cmdcolin/ntsc.js/commit/0681be2c8111466d454f3f18f95205ebece761ce) Add signed A-gain fader to the A/B summing bus
- [`30f4b10`](https://github.com/cmdcolin/ntsc.js/commit/30f4b10c5bfbc7983c708dfa43eb03d1cfb7cdcc) Surface gated controls, artifact search, and preset blurbs
- [`aedbe30`](https://github.com/cmdcolin/ntsc.js/commit/aedbe30ea0b01027ab03eae50d0d0a8f70e3f553) VHS shuttle picture search, slow-motion time scale, effects listing

### Fixes
- [`3d2a20a`](https://github.com/cmdcolin/ntsc.js/commit/3d2a20ada2be1861cd9ec03835443b46ce80c842) Grab the still inside a frame so Chrome captures pixels
- [`f990f3a`](https://github.com/cmdcolin/ntsc.js/commit/f990f3ae27d60938f75c07fcb763d4043bdb93e6) Harden localStorage reads and scope Popover to its own document

### Refactor
- [`3f22d7d`](https://github.com/cmdcolin/ntsc.js/commit/3f22d7d3aa348789f04995f52d37958b40606c2f) Drop version-number guesses from WebGPU-unavailable copy
- [`dc68e19`](https://github.com/cmdcolin/ntsc.js/commit/dc68e19374397c01c9544a9d9452f238dd531296) Extract shared UI primitives, move to CSS var theming, add capture popover
- [`ccfd307`](https://github.com/cmdcolin/ntsc.js/commit/ccfd307d61cf9cd16cb529d47470376b8b30f5ce) Decompose App into focused hooks; add Dialog a11y and helper tests
- [`0ed4f47`](https://github.com/cmdcolin/ntsc.js/commit/0ed4f47532ba026465318c441f3d246fa2ecabc5) Render discrete controls as toggle groups, not sliders
- [`63be364`](https://github.com/cmdcolin/ntsc.js/commit/63be364d7cab2df8c006fa76db603da5657971e7) Rebuild Dialog on the native <dialog> element
- [`2b326a9`](https://github.com/cmdcolin/ntsc.js/commit/2b326a90dfdc9f33f6708fcfa25aad8b1fbd3929) Group inert banners, hover help, surprise me, live signal taps

### Documentation
- [`3c13cf3`](https://github.com/cmdcolin/ntsc.js/commit/3c13cf36a00f9a808680392227f178af94c97adc) Clarify WebGPU processing in README for JS readers

### Chores
- [`77cf3bb`](https://github.com/cmdcolin/ntsc.js/commit/77cf3bba77d7c91eaae48b99e2aa3afce59f6a94) Prettier config
- [`7d66d64`](https://github.com/cmdcolin/ntsc.js/commit/7d66d64ce1b42b0d9923a8b2d386fc23683505b3) Bump deps

## [0.1.2](https://github.com/cmdcolin/ntsc.js/compare/v0.1.1...v0.1.2) - 2026-07-21

### Features
- [`1d2f36f`](https://github.com/cmdcolin/ntsc.js/commit/1d2f36fa3874bd03876813596617faf927f26eb3) Add a lightbulb icon to the presets hint

### Fixes
- [`272be4b`](https://github.com/cmdcolin/ntsc.js/commit/272be4b07f234633f4961a0c19da57f5fe3675d1) Match letter shortcuts case-insensitively

## [0.1.1](https://github.com/cmdcolin/ntsc.js/releases/tag/v0.1.1) - 2026-07-21

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

