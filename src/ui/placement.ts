import {
  CAMERA_LOOP_STAGE,
  GROUPS,
  LOOP_BIN_STAGE,
  MIXER_LOOP_STAGE,
  SOUND_STAGE,
  SOURCE_B_STAGE,
  VIEW_STAGE,
} from './controls'

import type { ControlKey } from '../controls'
import type { Group } from './controls'

// Where a control lives, for the surfaces that gather rows *out* of the chain
// and then have to say where each one came from. "This look" needs it for the
// captions over its runs of rows; the modulation bay needs it to name what a
// slot is driving, now that a slot's target is picked at the control rather
// than out of a list of every slider in the app.
//
// Shared rather than copied because the two answers have to agree: a caption
// and a slot naming the same control disagreeing about which stage opens it
// would be two different claims about one placement, and `Group.place` is
// supposed to be the single source of that truth.

// Built once at module load off the same table the panel's own headers are
// built from.
const GROUP_OF = new Map<ControlKey, Group>()
for (const g of GROUPS) for (const s of g.sliders) GROUP_OF.set(s.key, g)

export function groupOf(key: ControlKey): Group | undefined {
  return GROUP_OF.get(key)
}

// The placements that are not a stage name. Every other `place` is a Phase and
// is already the name of the stage that opens it, so this is the whole
// translation — a table rather than a chain of ternaries, because there are six
// of them now and a chain would have kept growing.
//
// `Partial<Record<Group['place'], …>>` is what holds it to the placements that
// actually exist: a seventh added to the union without a row here is a control
// whose caption in "This look" points at a stage nobody can open.
const OFF_SPINE_STAGE: Partial<Record<Group['place'], string>> = {
  b: SOURCE_B_STAGE,
  audio: SOUND_STAGE,
  view: VIEW_STAGE,
  camera: CAMERA_LOOP_STAGE,
  mixer: MIXER_LOOP_STAGE,
  tape: LOOP_BIN_STAGE,
}

// The off-spine placements are named for what they hold; the stage each opens
// is named for what it is.
export function stageOf(group: Group): string {
  return OFF_SPINE_STAGE[group.place] ?? group.place
}
