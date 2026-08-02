# Changelog

All notable changes to ntscythe are documented here.

## [0.6.1](https://github.com/cmdcolin/ntscythe/compare/v0.6.0...v0.6.1) - 2026-08-02

### Features
- [`b601c46`](https://github.com/cmdcolin/ntscythe/commit/b601c464fab7ce4020092de46a2eeb157edb7d9a) Suppress sync at the head-end, and noise the color-under carrier

### Refactor
- [`644e526`](https://github.com/cmdcolin/ntscythe/commit/644e526a221f04bc1b54bfd56d64fdc6bef4072b) Group changelog by type, keep messages verbatim
- [`665c610`](https://github.com/cmdcolin/ntscythe/commit/665c610544628d6281350abe1af8a75ad63178c9) simplify changelog config now that history uses real type prefixes

### Documentation
- [`89b28fd`](https://github.com/cmdcolin/ntscythe/commit/89b28fd855733b1b1135d8e674e9d5c26cf846a8) note commit-scope convention

### Chores
- [`788ccbb`](https://github.com/cmdcolin/ntscythe/commit/788ccbba2913246cc3b7c183075d447bdac6640a) Set up git-cliff and backfill CHANGELOG.md
- [`73a42b9`](https://github.com/cmdcolin/ntscythe/commit/73a42b9ed1a1a3fc982acb654daca970c6663b02) Convert linting and formatting to oxlint and oxfmt

### Other Changes
- [`6dd105b`](https://github.com/cmdcolin/ntscythe/commit/6dd105b0bfd1cd5c28af217b68e585b06e30f5c1) Record the remaining effect ideas, and the free-run gap behind them

## [0.6.0](https://github.com/cmdcolin/ntscythe/compare/v0.5.0...v0.6.0) - 2026-08-01

### Features
- [`8e586a4`](https://github.com/cmdcolin/ntscythe/commit/8e586a48a179e4b4ce2a025e1a84daf6d642915e) Bend the enhancer's other three stages, not just its peaking coil

### Refactor
- [`f9fd196`](https://github.com/cmdcolin/ntscythe/commit/f9fd1962926ecf875b2272daad64af408c66533f) Fold the signal-path FIRs on their own symmetry

### Style
- [`0c08584`](https://github.com/cmdcolin/ntscythe/commit/0c08584ed4781eb3446464983f40fc64321e34a2) Format and remove signal path note

## [0.5.0](https://github.com/cmdcolin/ntscythe/compare/v0.4.0...v0.5.0) - 2026-08-01

### Features
- [`eafa87b`](https://github.com/cmdcolin/ntscythe/commit/eafa87b4d99e9e6282c48a4f5c392e09830605ab) Audio in from a file, picked alongside the other sources
- [`0b71687`](https://github.com/cmdcolin/ntscythe/commit/0b716874fb3b2eb039845557a9137488c4787380) Bleed the beam spot into the phosphor, and let the tail scatter
- [`b2065ac`](https://github.com/cmdcolin/ntscythe/commit/b2065ac4c9e3090bccad1901361b6b2695c7f1a8) Draw the signal chain as a block diagram
- [`8898b48`](https://github.com/cmdcolin/ntscythe/commit/8898b48fc5ca574f3c9b8d7e3b66d58190d8ea7a) Stack the three input pickers, and scrub a loaded audio file
- [`99481b2`](https://github.com/cmdcolin/ntscythe/commit/99481b2cfa4e7a9f11a1fbf2e062806b4929f6cf) Let the panel breathe, and make a preset drag mean one thing
- [`94ce579`](https://github.com/cmdcolin/ntscythe/commit/94ce5798472199a4a6cf928655336cd13b541bdd) Let the eye move: magnify the glass, or pull back off the set
- [`d4f77bd`](https://github.com/cmdcolin/ntscythe/commit/d4f77bd900bc79cb3920b1cbec3fc5b4b463815d) Let a debug view watch the decoder without interrupting it
- [`16e0998`](https://github.com/cmdcolin/ntscythe/commit/16e0998074da79f65ac3bf9208c5815c9df188c9) Give useEngine two collaborators instead of two copies of everything
- [`13267d2`](https://github.com/cmdcolin/ntscythe/commit/13267d20de8b694813b62b5bb238289da30dd17e) Let the audio meter keep up with the kick it is showing
- [`981e909`](https://github.com/cmdcolin/ntscythe/commit/981e909befc12b279957f3d2251b2912b6693f98) Bring back the file a source slot held last session

### Fixes
- [`6e370a7`](https://github.com/cmdcolin/ntscythe/commit/6e370a79c64f369c79014174cb545204eb648e52) Keep the landing look out of the clean baseline
- [`50beca1`](https://github.com/cmdcolin/ntscythe/commit/50beca1925ab61fe3cdcc8504f415dd792cf6ec6) Keep the tube-face feather off the picture at 1x
- [`676d2ba`](https://github.com/cmdcolin/ntscythe/commit/676d2baee98196d17d274f860ae55286d034cd3b) Stop making the reader lean in: one type scale, four brighter grays
- [`4b5b114`](https://github.com/cmdcolin/ntscythe/commit/4b5b1149884eabe5bc3dc0bc9f599b9cfb95a7b3) Stop dispatching source B for a fader the genlocked path never reads
- [`de90a91`](https://github.com/cmdcolin/ntscythe/commit/de90a91d46e60f96416f54feca7bb40e725b01d8) Patch the chain like a rack, and put its door where it will be found
- [`993bacd`](https://github.com/cmdcolin/ntscythe/commit/993bacdacc7205beba128893b31d510816f616aa) Run the tape wow clock on frames, not on dub generations
- [`6ae1ea0`](https://github.com/cmdcolin/ntscythe/commit/6ae1ea093a9098b2fe030cfe9f31b17df9172121) Keep one audio context, so the mic stops stranding the video slots
- [`c289099`](https://github.com/cmdcolin/ntscythe/commit/c28909963df9e4065c0c4f82011b969a942c9d69) Push only the clock-locked rates to the engine
- [`bd8def3`](https://github.com/cmdcolin/ntscythe/commit/bd8def3bcfab00dd77fcb415bd0043418a008533) End hold-to-compare when the window loses focus
- [`0b4c573`](https://github.com/cmdcolin/ntscythe/commit/0b4c57363a831c1e833a561f5558624304001c72) Report each GPU fault once
- [`8b0deea`](https://github.com/cmdcolin/ntscythe/commit/8b0deea6dfdb091deac130823ba723c39a54fc61) Correct the architecture note on what keeps writeControl stable
- [`6f05223`](https://github.com/cmdcolin/ntscythe/commit/6f052230bc22968443732475e41c08c2b099d8a1) Bound the rAF fallback and record why the tab froze
- [`f910646`](https://github.com/cmdcolin/ntscythe/commit/f910646faf33327eec2e6685c0ee7246c4435bb7) Correct the signal-path diagrams against the actual pass graph
- [`f53ee7a`](https://github.com/cmdcolin/ntscythe/commit/f53ee7ae0585efee768999977473acf7f0355aad) Keep a preset drag's pointer from running ahead of its weight
- [`833bdcc`](https://github.com/cmdcolin/ntscythe/commit/833bdcce03867bd2ebc6afcd5029e89abc1bda09) Cap the decode at the same edge the texture is capped to
- [`7e4d705`](https://github.com/cmdcolin/ntscythe/commit/7e4d70591bd8d5a2f990278d2d9e4cba211aa1a8) Keep bridging a stall through a blur, and rebuild the surface before giving up
- [`e51f25b`](https://github.com/cmdcolin/ntscythe/commit/e51f25ba77692683d4af28971a39a5f8438b1bec) Keep mutate off the magnifier's zoom and pan
- [`701b4a8`](https://github.com/cmdcolin/ntscythe/commit/701b4a83f3d74725c2e281508d3e0695b138b5ab) Hanged state

### Refactor
- [`54bb307`](https://github.com/cmdcolin/ntscythe/commit/54bb307cbc503e820263f8c9d4b461d15570d24d) Rank a section by where it sits, and name the audio one for what it does
- [`8eb60eb`](https://github.com/cmdcolin/ntscythe/commit/8eb60eb949dc935c7a3ea3e5ee429b88a47256cf) Fold the stage controls into one menu, and hold the bar level
- [`41578da`](https://github.com/cmdcolin/ntscythe/commit/41578dab529b729b587fee7d3480d687a527ed94) Build the six rows you can see, not all 121 every time
- [`51b8d28`](https://github.com/cmdcolin/ntscythe/commit/51b8d28b0d84ef4d798ae7ece8010b1696954d17) Compute the subcarrier lattice instead of looking it up
- [`151758c`](https://github.com/cmdcolin/ntscythe/commit/151758c3aab8bd542e3f4d6a013e075688dc9d76) Drop the glyph rule the chain diagram's old bar button left behind
- [`c257d82`](https://github.com/cmdcolin/ntscythe/commit/c257d82f1b96cfde5880c32a7d7b0bee2ccdeb14) Remove scroll-to-zoom from the stage
- [`1b35c73`](https://github.com/cmdcolin/ntscythe/commit/1b35c734601485a687e8f8994b14bc1880210d76) Make the clean preset a plain reset, not a fader
- [`888391e`](https://github.com/cmdcolin/ntscythe/commit/888391e63bb05fa17c7443c4183d88696e726a1d) Snap values onto a control's grid in one place, not four
- [`c977966`](https://github.com/cmdcolin/ntscythe/commit/c9779663dec3e75c6d53e15ad16fb902ef08df61) Round-trip source B's generated modes through the query string
- [`d430f71`](https://github.com/cmdcolin/ntscythe/commit/d430f71f0fe30726cfc7cd88d441d9f315d3481c) Hand back two things the engine was holding onto
- [`55e5704`](https://github.com/cmdcolin/ntscythe/commit/55e57048b07c1609e1081aabfc671a680c8ab476) Put the link writer beside the reader, and pin the round trip

### Chores
- [`fe587bd`](https://github.com/cmdcolin/ntscythe/commit/fe587bdd0d0ff219314fb9239d02db3fad3d52a2) Rename
- [`76e7895`](https://github.com/cmdcolin/ntscythe/commit/76e7895295497fdbf8c55a32fbf262db3301bcb2) App rename to ntscythe

## [0.4.0](https://github.com/cmdcolin/ntscythe/compare/v0.3.0...v0.4.0) - 2026-08-01

### Features
- [`3fa9950`](https://github.com/cmdcolin/ntscythe/commit/3fa995045f8a093435b550609a2ec784c1e5b102) Add .ts extension to vite plugin import for native config loader

### Fixes
- [`b974dcb`](https://github.com/cmdcolin/ntscythe/commit/b974dcbdd15017ac53261cb38e1a6ec5435ac222) Fix silent-failure gaps in shader validation, storage, and clock sync

### Refactor
- [`3cfe107`](https://github.com/cmdcolin/ntscythe/commit/3cfe107aad13b1fceff4bf6e8672cf67f4caa387) Lead the panel with presets; draw the signal path as a chain
- [`f2d05e7`](https://github.com/cmdcolin/ntscythe/commit/f2d05e791162a7db1f7736f08546faea84042d46) Key mod state by slot, guard stored shapes, cover the per-line state
- [`4401647`](https://github.com/cmdcolin/ntscythe/commit/44016474e2d042e71a030064935039114563aa33) Extract source-texture management out of the engine

### Chores
- [`b7854ed`](https://github.com/cmdcolin/ntscythe/commit/b7854ed75aaa40fd142e68638621c71707b432b0) Re-title app
- [`cb698a2`](https://github.com/cmdcolin/ntscythe/commit/cb698a23325959e0274483e7aca5f507a9aea724) Small audio tweak

## [0.3.0](https://github.com/cmdcolin/ntscythe/compare/v0.2.1...v0.3.0) - 2026-08-01

### Features
- [`9d022f0`](https://github.com/cmdcolin/ntscythe/commit/9d022f09f9b1855ff1b97c9c81d24ab26f48dd19) Re-pick a loaded source by clicking its filename caption

### Fixes
- [`1558f33`](https://github.com/cmdcolin/ntscythe/commit/1558f33cd6755e37ffc866aa68c0a7f1329af6ae) Cap custom source resolution so large pictures/videos don't freeze

### Refactor
- [`0453eb9`](https://github.com/cmdcolin/ntscythe/commit/0453eb983de3955691689766ad2cd84200bf0ed2) Rename to ntscsynth; add a waveform logo, mark, and favicon
- [`31ce519`](https://github.com/cmdcolin/ntscythe/commit/31ce5199ea3e0d140efcb015f12739385f1c1451) Default to bGain 0.16 with source B on bars

### Documentation
- [`f179170`](https://github.com/cmdcolin/ntscythe/commit/f179170fea242eecc18a276ef4cf30b1969f0e2e) Document the miniature pattern; drop the swept-wipe pulse animation

### Chores
- [`c4d7e1f`](https://github.com/cmdcolin/ntscythe/commit/c4d7e1fbae4007d878930cd110526470058f1706) Bump deps

## [0.2.1](https://github.com/cmdcolin/ntscythe/compare/v0.2.0...v0.2.1) - 2026-07-22

### Features
- [`001cfec`](https://github.com/cmdcolin/ntscythe/commit/001cfec9e9b8b04564178c53fcbce45a855dd468) Direct-manipulation miniatures for the PiP inset and A/B wipe
- [`fe47b88`](https://github.com/cmdcolin/ntscythe/commit/fe47b88d15c202401fba585156974c918bcc18c3) Miniature follow-ups: shared math with tests, soft edges, slider toggle
- [`1fbd75f`](https://github.com/cmdcolin/ntscythe/commit/1fbd75f7a841d8ca983c54a120bebcc2bcd9569a) Dramatic s-video miswire, stuck tape preset, slow-mo URL example

## [0.2.0](https://github.com/cmdcolin/ntscythe/compare/v0.1.2...v0.2.0) - 2026-07-22

### Features
- [`0681be2`](https://github.com/cmdcolin/ntscythe/commit/0681be2c8111466d454f3f18f95205ebece761ce) Add signed A-gain fader to the A/B summing bus
- [`30f4b10`](https://github.com/cmdcolin/ntscythe/commit/30f4b10c5bfbc7983c708dfa43eb03d1cfb7cdcc) Surface gated controls, artifact search, and preset blurbs
- [`aedbe30`](https://github.com/cmdcolin/ntscythe/commit/aedbe30ea0b01027ab03eae50d0d0a8f70e3f553) VHS shuttle picture search, slow-motion time scale, effects listing

### Fixes
- [`3d2a20a`](https://github.com/cmdcolin/ntscythe/commit/3d2a20ada2be1861cd9ec03835443b46ce80c842) Grab the still inside a frame so Chrome captures pixels
- [`f990f3a`](https://github.com/cmdcolin/ntscythe/commit/f990f3ae27d60938f75c07fcb763d4043bdb93e6) Harden localStorage reads and scope Popover to its own document

### Refactor
- [`3f22d7d`](https://github.com/cmdcolin/ntscythe/commit/3f22d7d3aa348789f04995f52d37958b40606c2f) Drop version-number guesses from WebGPU-unavailable copy
- [`dc68e19`](https://github.com/cmdcolin/ntscythe/commit/dc68e19374397c01c9544a9d9452f238dd531296) Extract shared UI primitives, move to CSS var theming, add capture popover
- [`ccfd307`](https://github.com/cmdcolin/ntscythe/commit/ccfd307d61cf9cd16cb529d47470376b8b30f5ce) Decompose App into focused hooks; add Dialog a11y and helper tests
- [`0ed4f47`](https://github.com/cmdcolin/ntscythe/commit/0ed4f47532ba026465318c441f3d246fa2ecabc5) Render discrete controls as toggle groups, not sliders
- [`63be364`](https://github.com/cmdcolin/ntscythe/commit/63be364d7cab2df8c006fa76db603da5657971e7) Rebuild Dialog on the native <dialog> element
- [`2b326a9`](https://github.com/cmdcolin/ntscythe/commit/2b326a90dfdc9f33f6708fcfa25aad8b1fbd3929) Group inert banners, hover help, surprise me, live signal taps

### Documentation
- [`3c13cf3`](https://github.com/cmdcolin/ntscythe/commit/3c13cf36a00f9a808680392227f178af94c97adc) Clarify WebGPU processing in README for JS readers

### Chores
- [`77cf3bb`](https://github.com/cmdcolin/ntscythe/commit/77cf3bba77d7c91eaae48b99e2aa3afce59f6a94) Prettier config
- [`7d66d64`](https://github.com/cmdcolin/ntscythe/commit/7d66d64ce1b42b0d9923a8b2d386fc23683505b3) Bump deps

## [0.1.2](https://github.com/cmdcolin/ntscythe/compare/v0.1.1...v0.1.2) - 2026-07-21

### Features
- [`1d2f36f`](https://github.com/cmdcolin/ntscythe/commit/1d2f36fa3874bd03876813596617faf927f26eb3) Add a lightbulb icon to the presets hint

### Fixes
- [`272be4b`](https://github.com/cmdcolin/ntscythe/commit/272be4b07f234633f4961a0c19da57f5fe3675d1) Match letter shortcuts case-insensitively

## [0.1.1](https://github.com/cmdcolin/ntscythe/releases/tag/v0.1.1) - 2026-07-21

### Features
- [`5a9fc45`](https://github.com/cmdcolin/ntscythe/commit/5a9fc4595f77672479d27a0b93db2976ca80a3e4) NTSC signal-path simulator: dirty mixing, mixer-loop feedback, camera model, RF/AGC
- [`abe72cb`](https://github.com/cmdcolin/ntscythe/commit/abe72cbd419c711c6fb4915cc6282691a40a54be) Mixer wipes, B-bus proc amp, frame-store strobe/trails
- [`a9e13ba`](https://github.com/cmdcolin/ntscythe/commit/a9e13bad3e85ac263e529b790b25f4025302e008) WebGPU-unavailable error screen, resource cleanup, GitHub Pages deploy
- [`3ba3382`](https://github.com/cmdcolin/ntscythe/commit/3ba3382854c75be652d8f5b20ff64d1ea021fc74) Collapsible panel sections, fullscreen toggle, Camera Feedback rename
- [`f1c3817`](https://github.com/cmdcolin/ntscythe/commit/f1c381776b515b35392e21456aa27b82672d8fec) Add prettier dependency, drop obsolete package.json pnpm field
- [`9a3830f`](https://github.com/cmdcolin/ntscythe/commit/9a3830fdb70bff6a930e9828a96933648b513fa8) Device-loss recovery UI, shareable copy-link, adjustable render scale
- [`0d7c845`](https://github.com/cmdcolin/ntscythe/commit/0d7c845b0c1ce79556826aa5f1526a5c7dcad348) Add GitHub link to panel header
- [`15edcb6`](https://github.com/cmdcolin/ntscythe/commit/15edcb6afb24f158d2d412dcdbb73d3be91f38d1) Favicon + advanced-settings dialog for render scale
- [`a83f566`](https://github.com/cmdcolin/ntscythe/commit/a83f566c2383e9e8e0ba416c2777073458911231) Add typescript-eslint (strict-type-checked) + lint scripts
- [`786d046`](https://github.com/cmdcolin/ntscythe/commit/786d046e3d35cfee6fc72e6747e0c80777b76040) Add FIR filter unit tests; gate deploy on lint + test
- [`71f778b`](https://github.com/cmdcolin/ntscythe/commit/71f778bfda0f951f7143c7e7ee2e7af686891bee) Presets: grouped picker with descriptions, active state, hover-diff, hold-to-compare
- [`2ed84dd`](https://github.com/cmdcolin/ntscythe/commit/2ed84dd07c5181ac99ed56dcf9faac91f24a43d2) Wire MIDI + clock-sync controls into the panel
- [`b640bd6`](https://github.com/cmdcolin/ntscythe/commit/b640bd6030d4b981159361cea6f8895d15376b5a) Surface A/B mix controls next to the Input row when source B is on
- [`b395402`](https://github.com/cmdcolin/ntscythe/commit/b395402522c801d6e3b01c8c7b2964e3530491a9) Add composite polarity-flip (color invert) on source A
- [`91360f6`](https://github.com/cmdcolin/ntscythe/commit/91360f6be5182b3edb1e74344ccf50e80fa1d770) Add S-video Y/C miswire (cross-wire) decoder effect
- [`1026e87`](https://github.com/cmdcolin/ntscythe/commit/1026e87dc1825e3de5605bcf4f80bc2611417827) Add cable wiring faults: hard polarity flip + termination
- [`f448d64`](https://github.com/cmdcolin/ntscythe/commit/f448d64b6e025eb61855cbc3777b148d145e8920) Add chroma-pin-only feed and loose-connector faults
- [`41ace12`](https://github.com/cmdcolin/ntscythe/commit/41ace1269eeaaa8d5425a4e41fa4befdd124eb39) Add TV-static and VHS-static noise sources
- [`e011ab7`](https://github.com/cmdcolin/ntscythe/commit/e011ab720949aa3d6b9f7798daaade4ed2f9871b) Add positionable picture-in-picture inset for source B
- [`d44f31b`](https://github.com/cmdcolin/ntscythe/commit/d44f31b2f9e21df4cb2bc55a5f9b47af03fa6b10) Add VHS tracking-error band and luma-keyed PiP inset
- [`556bc78`](https://github.com/cmdcolin/ntscythe/commit/556bc787b4e27c1969d0fee70f2aeba83451975a) Add CRT-faceplate pass for a real camera-at-monitor feedback path
- [`7927a2b`](https://github.com/cmdcolin/ntscythe/commit/7927a2bc0192d4c5048306cb12fbc2eb45cb000d) Add USB/RCA capture-device input and source deinterlace
- [`a11d809`](https://github.com/cmdcolin/ntscythe/commit/a11d8093e53e81b526ac90181575c504fe8971b0) Add eslint-react (recommended-typescript) to the lint config
- [`0df1c4b`](https://github.com/cmdcolin/ntscythe/commit/0df1c4bab279ba7f75b941d44646ababc92389c9) Add popout controls, scene slots, control filter, anchored slider fill, frame-stats monitor
- [`c951c69`](https://github.com/cmdcolin/ntscythe/commit/c951c69ec48719534451b946d55ac13a80756067) Add package metadata and descriptive gallery alt text
- [`7cf0c5b`](https://github.com/cmdcolin/ntscythe/commit/7cf0c5b763d511850339aa43cd46e2177a1ea081) Add motion demo: cat hero, and a clip on the no-WebGPU screen
- [`9c40a8c`](https://github.com/cmdcolin/ntscythe/commit/9c40a8c4be62d85ddb3755a4913d71bdebc57559) Add declarative URL loading (?iurl/?iurlb/?preset) + sample images
- [`cbf6a2f`](https://github.com/cmdcolin/ntscythe/commit/cbf6a2f6aff2ca3f25639c37261b0effb7f8cabb) Model the hold oscillators, deflection geometry, and audio drive
- [`79916db`](https://github.com/cmdcolin/ntscythe/commit/79916db98fe14eb1fab0eb2f211cd798c79d3184) Add CRT beam transfer and hue-preserving gamut fit (phosphor plan phase 1)
- [`4cfebf5`](https://github.com/cmdcolin/ntscythe/commit/4cfebf5f4bc0e4bc2df532260f89e29dc6051444) Phosphor identity (plan phase 2), deflection glide, and circuit-bent controls
- [`3dceb78`](https://github.com/cmdcolin/ntscythe/commit/3dceb78027238f0006669ed00a9b4f03379b59fe) Add capture (still/clip), mutate, and single-level undo to the UI
- [`4fa1b2b`](https://github.com/cmdcolin/ntscythe/commit/4fa1b2bd77d546a4a450c3810118c4e6941b92db) Let the dev server fall back to another port instead of failing
- [`cebc4df`](https://github.com/cmdcolin/ntscythe/commit/cebc4dfb98fbec1dd0825edac033d3b11c893563) Enable React Compiler
- [`5e8842b`](https://github.com/cmdcolin/ntscythe/commit/5e8842b4dc1396331dc467a1ef3c5c6e4e0bcc22) Mirror app state to the URL continuously
- [`1c6ebc4`](https://github.com/cmdcolin/ntscythe/commit/1c6ebc4c5a43a86d0e1eed7eabb4077b800d679c) Let the brand name stand alone, explain it behind a ? icon
- [`feefad5`](https://github.com/cmdcolin/ntscythe/commit/feefad58566f321d817e6db90f941d2e6bb6f68c) Add a clean genlocked A/B mixer alongside the dirty sum
- [`61e2093`](https://github.com/cmdcolin/ntscythe/commit/61e209389ea2147ae59a1e8636f0f2196c1597f8) Feedback control
- [`dd1bafd`](https://github.com/cmdcolin/ntscythe/commit/dd1bafd7f8847941e71d854e2b1799c8e335882d) feat: useEngine.ts — added sourceName / sourceBName state, set alongside the existing sourceMode/sourceBMode:
- [`1dee106`](https://github.com/cmdcolin/ntscythe/commit/1dee106d5c50697b017f0f5d568b305912533f27) Add agent-docs/IDEAS.md — modulation backlog
- [`b466828`](https://github.com/cmdcolin/ntscythe/commit/b466828b6dbcf39593ccfe3bdce7d519f17c180c) Load YouTube clips in dev via a yt-dlp Vite middleware
- [`9555052`](https://github.com/cmdcolin/ntscythe/commit/955505208fd29fd1872750e9de3fea3e4fb5b02a) Add TV/VHS static as a source B option
- [`b97c6dd`](https://github.com/cmdcolin/ntscythe/commit/b97c6dd6b7e7f119960aa07667cdec5f2d714b6c) Add a vaporwave playback panel: slow video + pitch-dropped audio
- [`2104b23`](https://github.com/cmdcolin/ntscythe/commit/2104b233cf1a38c587b10fcf1e9d8394be1beaa3) Add MIDI auto-map and learn-in-order bulk binding
- [`4a5c875`](https://github.com/cmdcolin/ntscythe/commit/4a5c875dec78050ac4f4fa48bc152259a129a270) Add Favorites pinning and place-based panel groups; wire vaporwave meter
- [`edb9e85`](https://github.com/cmdcolin/ntscythe/commit/edb9e85bfe53d5247f078ff5f113ac55a7930ae4) Add build-stamped version and a color-bars sidebar logo

### Fixes
- [`78c67f2`](https://github.com/cmdcolin/ntscythe/commit/78c67f2fb9060ba807f3273689fa476ad85acc92) Fix source-select UI bugs; parse dbg param once
- [`d7ed424`](https://github.com/cmdcolin/ntscythe/commit/d7ed424544e764dd5944031a26c2ad50996cb52f) Escape closes the advanced-settings dialog
- [`5218192`](https://github.com/cmdcolin/ntscythe/commit/521819202acc8cd79b954243afaf7a8398a9d37c) Keep render loop alive when a frame throws
- [`acfd425`](https://github.com/cmdcolin/ntscythe/commit/acfd425059af36bdd641372cb35456c5f46fc6ba) Fix sticky error banner and slider swallowing f/c shortcuts
- [`fa79a8c`](https://github.com/cmdcolin/ntscythe/commit/fa79a8c40d24ac33920f4061d341059b7cebe50b) Fix broken README gallery and boost discoverability
- [`28881ff`](https://github.com/cmdcolin/ntscythe/commit/28881ffecf7f8c6f8c33bd79812636f4aa80491e) Harden the render loop against post-transition freezes
- [`761eae5`](https://github.com/cmdcolin/ntscythe/commit/761eae56bc1f7f43e3279bc73d3d14d3010c27d5) Keep the render loop alive across rAF suspension, GPU hangs, and reloads
- [`b866f5a`](https://github.com/cmdcolin/ntscythe/commit/b866f5a25cfe9d3071d8894dd01c86f3fc03ab64) Correct what the compiler bail-outs actually risk
- [`201911d`](https://github.com/cmdcolin/ntscythe/commit/201911d3b7fd40dbe5eecbd2cd68eba267b74170) Keep useCallback on the MIDI write path

### Performance
- [`6fc572b`](https://github.com/cmdcolin/ntscythe/commit/6fc572b702fc83bb45963bd765dc9566342e248d) Const-fold FIR tap counts; shared-memory tiling for convolution passes

### Refactor
- [`4f48c2b`](https://github.com/cmdcolin/ntscythe/commit/4f48c2b434da2c80eeca919c2c319a8aa85e62d0) Inject exact DOWN_PER_SAMPLE; dedupe compose bind group
- [`49226bd`](https://github.com/cmdcolin/ntscythe/commit/49226bdefb0836b580c169d0a22195a1734d5559) Sidebar redesign: sans font, source dropdowns, CSS modules
- [`eb96f79`](https://github.com/cmdcolin/ntscythe/commit/eb96f79d179567e53007147e04ab8d010c667da9) Simplify presets: drop hidden slots, hover-diff, and redundant reset
- [`a9c392c`](https://github.com/cmdcolin/ntscythe/commit/a9c392ceafec8a2a985236383517f8b393c58b84) Default source B to off
- [`8e806a7`](https://github.com/cmdcolin/ntscythe/commit/8e806a78f514be1ce4eb164effb43118579c4bf6) Type packParams to require every uniform at compile time
- [`4d9f7ba`](https://github.com/cmdcolin/ntscythe/commit/4d9f7bacc1b222c092be0b56edfc340f79534de2) Simplify sidebar: fix copy-link encoding, dedup omit, hoist preset groups
- [`6a2f6d5`](https://github.com/cmdcolin/ntscythe/commit/6a2f6d522e43043e8f8334bc19925d178ed5fed3) DRY up error-banner clearing to the two source entry points
- [`0c552a5`](https://github.com/cmdcolin/ntscythe/commit/0c552a5fc6f3f3f0f7ffb6c6c4b74f7bdf31bbfb) Collapse the alternative B compositors by default
- [`625c879`](https://github.com/cmdcolin/ntscythe/commit/625c879d71eccb2c764ed0d79cf5d2300a25cb54) Split app.tsx into per-component files and engine/MIDI hooks
- [`78fde86`](https://github.com/cmdcolin/ntscythe/commit/78fde86179cee7e884bc7c3ba5928bf0c9e82845) Make the fps monitor an always-on rolling histogram
- [`9986fe5`](https://github.com/cmdcolin/ntscythe/commit/9986fe52b32fb188d7c319ea0a105e5a735d6eca) Make the fps monitor update faster and take less width
- [`92f0aea`](https://github.com/cmdcolin/ntscythe/commit/92f0aea841da899dd0a5ae320de9d961d6f1655d) Simplify the modulation panel
- [`321e678`](https://github.com/cmdcolin/ntscythe/commit/321e6784852b67ddee876e6bf6d84e15653b7f67) Make the fps monitor minimal and let both overlays be dismissed
- [`472e881`](https://github.com/cmdcolin/ntscythe/commit/472e8817ba9afa234ff55307acd2be3e6f497a16) Drop manual memoization now that the compiler does it
- [`30ca70b`](https://github.com/cmdcolin/ntscythe/commit/30ca70bf688092b9c905c2a21b844e505a7fa914) Drop preset-mix fills to zero once the look diverges
- [`9289344`](https://github.com/cmdcolin/ntscythe/commit/928934434a64191b6d9a443215255e84b57c11cb) Make preset mixing an explicit slider per preset
- [`b96f3f4`](https://github.com/cmdcolin/ntscythe/commit/b96f3f43710b7cd3a27effa027a71a6b22222673) Return presets to compact chips, with one section explainer
- [`eb0b63a`](https://github.com/cmdcolin/ntscythe/commit/eb0b63a2516e156ff7cfe6d4e15a29e6b0c07ec1) Move the preset hint above the chips
- [`16a7de7`](https://github.com/cmdcolin/ntscythe/commit/16a7de7a51768f05b72b309149f4ca232ef8c387) Make clicking a preset layer in at full, not reset the mix
- [`c96fced`](https://github.com/cmdcolin/ntscythe/commit/c96fced7baf4f7c3bd15fba076bde2dacc9f7310) Organize controls into signal-path phases with single-open browsing
- [`0700e26`](https://github.com/cmdcolin/ntscythe/commit/0700e2636bcc0dfc584abca6f1ce51883d7be3fe) Replace periodic modulators with bounded-aperiodic sources
- [`99b8602`](https://github.com/cmdcolin/ntscythe/commit/99b86028c302ec69441f99631876c31eea861d6f) Make YouTube a source-mode selector with a URL dialog for A and B
- [`a6811fb`](https://github.com/cmdcolin/ntscythe/commit/a6811fbb1ee453888e706cec1aac9afe6ba78c57) Reclaim panel vertical space; make the spine a status map
- [`d0f2206`](https://github.com/cmdcolin/ntscythe/commit/d0f2206956af5a8b51f976138cfdd1803eeb75c3) Dedupe NTSC composite assembly into shared prelude helpers

### Documentation
- [`a787853`](https://github.com/cmdcolin/ntscythe/commit/a787853f1b326a9fdeb2a380ddf9dfa75cb04905) Trim README, note it was written with Fable
- [`6b8055e`](https://github.com/cmdcolin/ntscythe/commit/6b8055eae2839fff4bbc988dfe5027179a7823f1) Update README.md
- [`e4008ed`](https://github.com/cmdcolin/ntscythe/commit/e4008ed977d5a86626a7cb2b91b1b2db86ebcad1) README: add deploy status badge
- [`f1dab28`](https://github.com/cmdcolin/ntscythe/commit/f1dab28c55dcb2006bdd8c89e3d612474f4631a3) README: document the signal path with Graphviz diagrams
- [`8366036`](https://github.com/cmdcolin/ntscythe/commit/8366036bf850f229062c966f8e76eaa6ac362bd4) Rewrite README how-it-works for a plainer voice
- [`a208d61`](https://github.com/cmdcolin/ntscythe/commit/a208d61771409c3b09d4419228d31455ed041065) Gallery
- [`d7146e4`](https://github.com/cmdcolin/ntscythe/commit/d7146e43a4ce01fcb9f9b04d2bd0e8ba8630fa05) Gallery: real photos through the pipeline instead of just test bars
- [`59a6cb0`](https://github.com/cmdcolin/ntscythe/commit/59a6cb07a6d48a8de1e6091203ac6084daef4803) Gallery: add a third row (negative, faded dub, strobe trails)
- [`8e61a20`](https://github.com/cmdcolin/ntscythe/commit/8e61a202e36b9ff02813dccd5e7e56f08e9a5cc9) CLAUDE.md: point at the architecture doc
- [`c94300b`](https://github.com/cmdcolin/ntscythe/commit/c94300bbeedcc16d3300dd9f88a7659da9f15c0b) mark phosphor plan phase 1 done, add phase 2 handoff
- [`3339e1d`](https://github.com/cmdcolin/ntscythe/commit/3339e1de9e9401d5d04e1865f9707f7883409e94) Explain every slider with a ? icon and a dialog
- [`61587a6`](https://github.com/cmdcolin/ntscythe/commit/61587a68bc36d2eecc5f0795cf9f4561dc59b061) Document the React layer and the compiler's sharp edge
- [`01a87ed`](https://github.com/cmdcolin/ntscythe/commit/01a87ed9aaf036559eb7527e869a4444d806d2bb) Summary
- [`941dcd6`](https://github.com/cmdcolin/ntscythe/commit/941dcd640fb888dc10a9b808469d26ad0ea7afa2) Record that the preset-mix recipe is deliberately not persisted
- [`e61324d`](https://github.com/cmdcolin/ntscythe/commit/e61324de0541d3379d303ceb4b2f9b33183f7088) Spell out the drag-to-partially-apply gesture in the preset hint

### Style
- [`b05fa95`](https://github.com/cmdcolin/ntscythe/commit/b05fa955fa453414125681f91b863487637f5020) Box sidebar section headers so the collapse caret is clearly associated
- [`7b3b585`](https://github.com/cmdcolin/ntscythe/commit/7b3b585a9bae037359ff26488416665c00053abe) Format
- [`b489508`](https://github.com/cmdcolin/ntscythe/commit/b4895083acd0b9d9abacb1fc66aad9b5832762c6) Lowercase the about dialog's section heads

### Tests
- [`8f730b4`](https://github.com/cmdcolin/ntscythe/commit/8f730b4ceee9f9909326e4ce1b2ef4b75a758ec1) Validate WGSL shaders with naga in CI
- [`11106db`](https://github.com/cmdcolin/ntscythe/commit/11106dba317bb61afe9a7ed90580ad4468185840) Fail shot.mjs on dead frames and page errors

### Chores
- [`6c19578`](https://github.com/cmdcolin/ntscythe/commit/6c19578f401a95c27696a1e56c2a25fba55bb1e4) Name the app "Phosphene"
- [`468a010`](https://github.com/cmdcolin/ntscythe/commit/468a0103abba46cc1938a84f83c33124186d7f18) Relative build base; update URLs for phosphene repo rename
- [`8c42930`](https://github.com/cmdcolin/ntscythe/commit/8c4293037db5f2337797606caaade08bb14d6abf) CI: auto-deploy to GitHub Pages on push to main
- [`8897212`](https://github.com/cmdcolin/ntscythe/commit/88972122218fbae187fea1e461dab87fc62ba91a) CI: pin pnpm 11 to match repo workspace config
- [`664ff97`](https://github.com/cmdcolin/ntscythe/commit/664ff973366507faaaf43e28276e6f519a2dedf6) Ignore .eslintcache
- [`19c4b76`](https://github.com/cmdcolin/ntscythe/commit/19c4b764dfd16e5a8c0bf14b92ca75ae07fe7bb2) Rm silly philosophy :)
- [`6816d78`](https://github.com/cmdcolin/ntscythe/commit/6816d78eede0a13c81627f85459987b59ba08115) Use fb-bloom for OG and add GitHub social-preview image
- [`8accd40`](https://github.com/cmdcolin/ntscythe/commit/8accd409ecf0d3721a9de1317783a626d5795c87) clips.mjs: output mp4 directly for review

