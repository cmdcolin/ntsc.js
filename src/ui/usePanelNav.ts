import { SOURCE_A_STAGE, stageGroups } from './controls'
import { usePersistedString } from './storage'

// Which stage, and which group inside it, are unfolded — one of each, so the
// chain map stays on screen instead of scrolling past as a flat list of sixteen
// headers. Persisted; null is the map alone, and closing the open stage is how
// you get back to it.
const OPEN_GROUP_STORE = 'video_feedback_open_group'
const OPEN_PHASE_STORE = 'video_feedback_open_phase'

// Which stage is open, read out of what was stored, and what to store for it.
//
// Nothing stored is a first session, and it opens on the head of the chain,
// because that is where source A's picker is now. The map alone was the right
// resting state while the pickers had a section of their own; with them inside
// the stages it is a first run that draws a diagram of a rig and offers no way
// to put a picture into it.
//
// Which is why "never chosen" and "closed on purpose" have to be two different
// stored values, and the empty string is the second one. Let them both come back
// as null and closing the stage re-opens it on the next load, forever — the
// round trip below is the whole point of the pair, and the pair is the whole
// reason these are functions worth naming.
export const openStageFrom = (stored: string | null): string | null =>
  stored === null ? SOURCE_A_STAGE : stored === '' ? null : stored
export const storeOpenStage = (name: string | null): string => name ?? ''

export function usePanelNav() {
  const [openGroup, setOpenGroup] = usePersistedString(OPEN_GROUP_STORE)
  const [stored, setStored] = usePersistedString(OPEN_PHASE_STORE)
  const openPhase = openStageFrom(stored)
  const setOpenPhase = (name: string | null) => setStored(storeOpenStage(name))

  const openAt = (phase: string, group: string) => {
    setOpenPhase(phase)
    setOpenGroup(group)
  }
  return {
    openGroup,
    openPhase,
    openAt,
    toggleGroup: (name: string) =>
      setOpenGroup(openGroup === name ? null : name),
    // Back to the map alone — what the × on the open stage's heading does, and
    // what Escape falls through to once it has nothing else to back out of.
    closePhase: () => setOpenPhase(null),
    // On the bench every stage is already on screen, so the map is an index
    // rather than a fold: a click marks where you are (and the bench scrolls
    // there) instead of unfolding one stage and closing another.
    jumpPhase: (name: string) => setOpenPhase(name),
    // Opening a stage opens its first group too, so reaching a knob stays one
    // click deep rather than two. Through stageGroups rather than PHASES: the B
    // branch is opened by the same click and is not one of them.
    togglePhase: (name: string) => {
      const first = stageGroups(name)[0]
      if (openPhase === name) setOpenPhase(null)
      else if (first === undefined) setOpenPhase(name)
      else openAt(name, first.name)
    },
  }
}
