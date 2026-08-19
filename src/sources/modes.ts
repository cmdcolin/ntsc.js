import { CLIP_IDS, CLIPS } from './clips'
import { POOL_MODES } from './pools'

export const SOURCE_MODES = [
  'bars',
  'sweep',
  'tv static',
  'vhs static',
  'synth',
  'cat',
  ...CLIP_IDS,
  ...POOL_MODES,
  'browse',
  'teletype',
  'file',
  'library',
  'youtube',
  'webcam',
  'screen',
] as const
export const SOURCE_B_MODES = [
  'none',
  'bars',
  'sweep',
  'tv static',
  'vhs static',
  'synth',
  'cat',
  ...CLIP_IDS,
  ...POOL_MODES,
  'browse',
  'teletype',
  'file',
  'library',
  'youtube',
  'screen',
] as const
export type SourceMode = (typeof SOURCE_MODES)[number]
export type SourceBMode = (typeof SOURCE_B_MODES)[number]

// A mode both decks offer: everything except A's `webcam` and B's `none`. The
// two lists above stay the source of truth — this is their intersection, so
// moving an entry into or out of one of them moves this with it rather than
// leaving a third list to keep in step.
//
// It is what lets a source path take the deck as an argument instead of being
// written out twice. A path that names a mode only one deck has cannot use it,
// which is the right answer: those two really are per-deck.
export type SharedMode = SourceMode & SourceBMode

// Full labels shown inside the dropdowns so each option explains what it is.
export const SOURCE_DESC: Record<SourceMode | SourceBMode, string> = {
  none: 'Off — no second source',
  bars: 'Color bars — SMPTE test pattern',
  sweep: 'Sweep — frequency zone plate',
  'tv static': 'TV static — no-signal broadcast snow',
  'vhs static': 'VHS static — blank-tape noise',
  synth: 'Video synth — oscillators patched into the input',
  cat: 'Tama station master — bundled photo, no file to pick',
  'clip-test': CLIPS['clip-test'].label,
  'clip-haunted-house': CLIPS['clip-haunted-house'].label,
  'clip-minnie-moocher': CLIPS['clip-minnie-moocher'].label,
  'wiki-random':
    'Random Commons — found photos, statuary, time-lapse; a new one each pick',
  'ia-random':
    'Random archive.org — tape idents, ads, industrial film; downloads first',
  browse: 'Browse… — search both, and see the results before you take one',
  teletype: 'Teletype… — type your own text card',
  file: 'File… — open an image or video',
  library: 'Clips… — your own shelf, kept between sessions',
  youtube: 'YouTube… — fetch a URL via yt-dlp',
  webcam: 'Webcam / USB device — camera or RCA capture',
  screen: 'Screen / window… — share a window or a tab',
}

// What kind of thing a source is, which is the fact the picker was not saying.
// Fourteen options in one flat list ran four unrelated kinds together: signal
// generators that switch instantly, media that ships with the app, four entries
// that open a file dialog or a URL box before anything happens, and two that ask
// the browser for a device. Scanning for "the cat photo" or "popeye" meant
// reading fourteen lines of "Name — what it is" with nothing to skip by.
//
// A Record rather than a parallel list of arrays: every mode must name its kind
// or this fails to compile, so a source added to SOURCE_MODES cannot quietly
// land in whichever band happened to be last (controls.test.ts holds the same
// line for a control's `place`).
export type SourceKind =
  | 'off'
  | 'pattern'
  | 'bundled'
  | 'pool'
  | 'yours'
  | 'live'

export const SOURCE_KIND: Record<SourceMode | SourceBMode, SourceKind> = {
  none: 'off',
  bars: 'pattern',
  sweep: 'pattern',
  'tv static': 'pattern',
  'vhs static': 'pattern',
  synth: 'pattern',
  cat: 'bundled',
  'clip-test': 'bundled',
  'clip-haunted-house': 'bundled',
  'clip-minnie-moocher': 'bundled',
  'wiki-random': 'pool',
  'ia-random': 'pool',
  browse: 'pool',
  teletype: 'yours',
  file: 'yours',
  library: 'yours',
  youtube: 'yours',
  webcam: 'live',
  screen: 'live',
}

// The band headings, in the order a picker offers them. 'off' is deliberately
// unlabelled: B's "Off" is one entry and a heading over it would be a row of
// chrome introducing a single word. The rest say what the band *costs* as much as
// what it holds — "opens a picker" is the distinction the `…` suffix was carrying
// alone, one option at a time, where it could only be noticed by someone already
// reading that line.
export const SOURCE_KIND_LABEL: Record<SourceKind, string | null> = {
  off: null,
  pattern: 'Generated — switches instantly',
  bundled: 'Bundled with the app',
  // The one band whose entries are not a *thing*: two of them roll a file out of
  // a public archive and hand back something different every pick, and the third
  // is the way to look before you leap. The heading says the band is fetched
  // because nothing else can — an option that quietly changes what it means
  // between two picks is worth warning about, and re-picking is the feature.
  //
  // This was two bands of eleven entries, one per curated pool. The pools are
  // still there and are better placed: they are the preset buttons in the
  // browser, where their names lead somewhere you can see rather than naming a
  // gamble. What used to close the Commons band — "Favorites…", the rolls you
  // starred — is now the ★ beside the caption, which puts a roll on the clip
  // shelf alongside your own footage, because "the ones I keep" belongs with the
  // other things you keep.
  pool: 'Public archives — fetched live, and never the same twice',
  yours: 'Your own — opens a picker',
  live: 'Live — asks the browser',
}

export const SOURCE_KIND_ORDER: readonly SourceKind[] = [
  'off',
  'pattern',
  'bundled',
  'pool',
  'yours',
  'live',
]

// Options for a picker, banded by kind. Built from the mode list the caller is
// allowed to offer (A and B differ, and the production build drops YouTube), so
// a band with nothing left in it simply does not appear — which is how B's "Live"
// band comes out holding only the screen share, saying in passing that a webcam
// is an A-only input.
export function sourceOptions<T extends SourceMode | SourceBMode>(
  modes: readonly T[],
): { value: T; label: string; group: string | null }[] {
  return SOURCE_KIND_ORDER.flatMap(kind =>
    modes
      .filter(m => SOURCE_KIND[m] === kind)
      .map(m => ({
        value: m,
        label: SOURCE_DESC[m],
        group: SOURCE_KIND_LABEL[kind],
      })),
  )
}

// The two pickers' option lists, built once. Here rather than beside the
// component that draws them because they are a fact about the mode lists above
// — including the one build-time subtraction: the YouTube option is backed by
// the dev-only yt-dlp bridge, so a production build has no /yt endpoint to
// offer it against.
// The same two lists minus that subtraction: what a production build actually
// offers. Named and exported because two things want it and neither is a
// picker — the docs generator, which describes what ships rather than what a
// dev server happens to have, and the test that holds the two in step.
export const SHIPPED_MODES = SOURCE_MODES.filter(m => m !== 'youtube')
export const SHIPPED_B_MODES = SOURCE_B_MODES.filter(m => m !== 'youtube')

const A_MODES = import.meta.env.DEV ? SOURCE_MODES : SHIPPED_MODES
const B_MODES = import.meta.env.DEV ? SOURCE_B_MODES : SHIPPED_B_MODES
export const A_OPTIONS = sourceOptions(A_MODES)
export const B_OPTIONS = sourceOptions(B_MODES)
