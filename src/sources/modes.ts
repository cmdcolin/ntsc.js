import { CLIP_IDS, CLIPS } from './clips'

export const SOURCE_MODES = [
  'bars',
  'sweep',
  'tv static',
  'vhs static',
  'cat',
  ...CLIP_IDS,
  'teletype',
  'file',
  'youtube',
  'webcam',
] as const
export const SOURCE_B_MODES = [
  'none',
  'bars',
  'sweep',
  'tv static',
  'vhs static',
  'cat',
  ...CLIP_IDS,
  'teletype',
  'file',
  'youtube',
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
  cat: 'Tama station master — bundled photo, no file to pick',
  'clip-test': CLIPS['clip-test'].label,
  'clip-popeye': CLIPS['clip-popeye'].label,
  'clip-haunted-house': CLIPS['clip-haunted-house'].label,
  'clip-minnie-moocher': CLIPS['clip-minnie-moocher'].label,
  teletype: 'Teletype… — type your own text card',
  file: 'File… — open an image or video',
  youtube: 'YouTube… — fetch a URL via yt-dlp',
  webcam: 'Webcam / USB device — camera or RCA capture',
}
