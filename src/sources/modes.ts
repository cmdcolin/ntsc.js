import { CLIP_IDS, CLIPS } from './clips'
import { COMMONS, COMMONS_IDS } from './commons'

export const SOURCE_MODES = [
  'bars',
  'sweep',
  'tv static',
  'vhs static',
  'synth',
  'cat',
  ...CLIP_IDS,
  ...COMMONS_IDS,
  'wiki-faves',
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
  ...COMMONS_IDS,
  'wiki-faves',
  'teletype',
  'file',
  'library',
  'youtube',
  'screen',
] as const
export type SourceMode = (typeof SOURCE_MODES)[number]
export type SourceBMode = (typeof SOURCE_B_MODES)[number]

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
  'clip-popeye': CLIPS['clip-popeye'].label,
  'clip-haunted-house': CLIPS['clip-haunted-house'].label,
  'clip-minnie-moocher': CLIPS['clip-minnie-moocher'].label,
  'wiki-retro': COMMONS['wiki-retro'].label,
  'wiki-vapor': COMMONS['wiki-vapor'].label,
  'wiki-nature': COMMONS['wiki-nature'].label,
  'wiki-people': COMMONS['wiki-people'].label,
  'wiki-timelapse': COMMONS['wiki-timelapse'].label,
  'wiki-vapor-video': COMMONS['wiki-vapor-video'].label,
  'wiki-nature-video': COMMONS['wiki-nature-video'].label,
  'wiki-faves': 'Favorites… — the Commons rolls you starred',
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
  | 'commons'
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
  'clip-popeye': 'bundled',
  'clip-haunted-house': 'bundled',
  'clip-minnie-moocher': 'bundled',
  'wiki-retro': 'commons',
  'wiki-vapor': 'commons',
  'wiki-nature': 'commons',
  'wiki-people': 'commons',
  'wiki-timelapse': 'commons',
  'wiki-vapor-video': 'commons',
  'wiki-nature-video': 'commons',
  // Starred rolls are Commons files too, so they band with the channels they
  // came out of rather than with 'yours' — what is yours about them is the
  // choosing, and the band above says where the pictures live.
  'wiki-faves': 'commons',
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
  // The one band whose entries are not a *thing* but a pool: picking one rolls
  // a file, and picking it again rolls a different one. The heading says so
  // because nothing else can — an option that quietly changes what it means
  // between two picks is worth warning about, and re-picking is the feature.
  // The last entry in the band is the answer to it: the rolls you starred, which
  // are the only ones that come back the same.
  commons: 'Wikimedia Commons — a channel rolls a new one each pick',
  yours: 'Your own — opens a picker',
  live: 'Live — asks the browser',
}

export const SOURCE_KIND_ORDER: readonly SourceKind[] = [
  'off',
  'pattern',
  'bundled',
  'commons',
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
