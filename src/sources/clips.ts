// Bundled video sources: played through the same <video> path as a picked
// file (videoSlot.ts's playUrl) — the video counterpart to CAT_URL's bundled
// photo. `clip-test` ships in `public/` same-origin; the rest are full
// quality (stream-copied, not re-encoded) excerpts of cartoons that fell
// into the public domain, hosted on the same S3 bucket the docshot clips
// use (see docs/DEVELOPMENT.md). copyExternalImageToTexture (gpu/sources.ts)
// needs the video element to be CORS-clean, so the bucket carries a GET-only
// CORS rule and videoSlot.ts sets `crossOrigin = 'anonymous'` on every
// element — harmless for same-origin/blob sources, required for these.
//
// - "The Haunted House" (Disney, 1929) — public domain since its 95-year
//   term expired Jan 1 2025.
// - "Minnie the Moocher" (Fleischer Studios, 1932) — public domain via
//   non-renewal.

const S3_BASE = 'https://cmdcolinphotos.s3.amazonaws.com/phosphene/sources/'

export const CLIP_IDS = [
  'clip-test',
  'clip-haunted-house',
  'clip-minnie-moocher',
] as const
type ClipId = (typeof CLIP_IDS)[number]

interface BundledClip {
  label: string
  url: string
}

export const CLIPS: Record<ClipId, BundledClip> = {
  'clip-test': {
    label: 'Test pattern — bars, timecode, motion',
    url: `${import.meta.env.BASE_URL}test.mp4`,
  },
  'clip-haunted-house': {
    label: 'The Haunted House (1929, public domain)',
    url: `${S3_BASE}example-haunted-house.mp4`,
  },
  'clip-minnie-moocher': {
    label: 'Minnie the Moocher (1932, public domain)',
    url: `${S3_BASE}example-minnie-moocher.mp4`,
  },
}

const CLIP_ID_SET: ReadonlySet<string> = new Set(CLIP_IDS)
export const isClipId = (mode: string): mode is ClipId => CLIP_ID_SET.has(mode)

export const clipUrl = (id: ClipId): string => CLIPS[id].url
