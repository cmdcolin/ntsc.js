import { SOURCE_DESC } from '../sources/modes'
import { AUDIO_DESC } from './useAudio'

import type { AnySlotView } from './slotView'
import type { AudioMode } from './useAudio'

// What is patched into a box that has a picker, in the few characters a box on
// the map has room for.
//
// The three boxes that carry a picker are the three that can answer "where does
// my own video go" — and until they did, the map answered it nowhere: SOURCE A
// named a stage of the rig, and nothing on screen said the stage was also the
// door to the file dialog. The name is the stage and the caption is what is
// standing in it.
//
// Both option tables are written "Name — what it is", so the caption is the half
// before the dash. One split rather than a third table of short names, which
// would be a second spelling of every source to keep in step with the picker's.
const head = (desc: string): string => desc.split(' — ')[0] ?? desc

// A slot says what came through the picker rather than which picker it was: a
// loaded file, clip or roll has a name, and that name is the answer. Everything
// else — the patterns, the webcam, the share — is the option itself.
//
// Nothing at all comes back empty rather than as "off". A box with nothing in it
// is already drawn dashed and already carries OFF_HINT, and a caption repeating
// that is ink spent on the one state the drawing says loudest.
// Takes the two fields it reads rather than the slot whole, which is the one
// place that is the safer shape: a formatter handed one slot cannot pair A's
// mode with B's name, and `Pick` lets a test name a source without building
// thirty fields of engine around it.
export const slotPatched = (
  slot: Pick<AnySlotView, 'mode' | 'name'>,
): string | undefined =>
  slot.mode === 'none'
    ? undefined
    : slot.name === ''
      ? head(SOURCE_DESC[slot.mode])
      : slot.name

// The sound, which is the same question against its own table. Not folded into
// the above: an audio mode is not a source mode, and the two unions meet
// nowhere.
export const soundPatched = (
  mode: AudioMode,
  name: string,
): string | undefined =>
  mode === 'off' ? undefined : name === '' ? head(AUDIO_DESC[mode]) : name

// A caption cut to the box it goes in. **It never widens one**: both drawings
// lay their rows out off the stage names, so a source called
// `sunset-final-final2.mp4` would otherwise walk the head of the chain across
// the picture every time someone loaded one. The box is the budget and the
// caption is what fits, with an ellipsis where the rest went.
//
// The rule lives here and the numbers come from the caller, which is the split
// MapBox makes for a press: what the two drawings must agree on is one copy,
// and the geometry stays with each drawing. The miniature is 7px text in a
// 50-unit box and the card is 8.5px in 92, so neither `room` nor `perChar` is a
// fact this file could know.
//
// `perChar` carries a doubling of m and w on top, for the reason a run's label
// does: a caption is a filename as often as it is a word, so the spread between
// 'iiii' and 'wwww' is real rather than theoretical.
//
// Returns undefined rather than a bare '…' when not one character will go —
// a box too narrow to be captioned at all, where nothing is a better answer
// than a dot that reads as a fault in the rig.
const WIDE = /[mw]/g
export function fitCaption(
  text: string,
  room: number,
  perChar: number,
): string | undefined {
  const width = (s: string) =>
    (s.length + (s.toLowerCase().match(WIDE)?.length ?? 0)) * perChar
  if (width(text) <= room) return text
  const ell = width('…')
  let cut = text.length - 1
  while (cut > 0 && width(text.slice(0, cut)) + ell > room) cut -= 1
  return cut === 0 ? undefined : `${text.slice(0, cut).trimEnd()}…`
}
