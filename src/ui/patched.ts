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
export const slotPatched = (slot: AnySlotView): string | undefined =>
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
