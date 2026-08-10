import { CAMERA_LOOP_STAGE, stageGroups } from './controls'
import { usePersistedString } from './storage'

// Which stage, and which group inside it, are unfolded — one of each, so the
// chain map stays on screen instead of scrolling past as a flat list of sixteen
// headers. Persisted; null is the map alone, and closing the open stage is how
// you get back to it.
const OPEN_GROUP_STORE = 'video_feedback_open_group'
const OPEN_PHASE_STORE = 'video_feedback_open_phase'

// Which stage is open, read out of what was stored.
//
// Nothing stored is a first session, and it rests on the map alone. A first run
// did open on the head of the chain, on the argument that source A's picker
// lives there and a diagram of a rig with no way to put a picture into it is a
// dead end — but the map's SOURCE A box is pressable with nothing patched in
// (see `stageTop` in app.tsx, which is what decides that), so the picker is one
// click from the resting state and does not need a panel unfolded over it to be
// reachable. A sidebar that opens itself is the more expensive default: every
// new session, and every browser without the key — a fresh profile, a private
// window, another port in dev — starts with a stage in the way.
//
// This is why the empty string, which used to mean "closed on purpose" as
// distinct from "never chosen", is now just another way of spelling closed: both
// answers are the same, and the pair exists only to keep reading what older
// sessions wrote.
//
// A stage that no longer exists is the case that still needs translating, and it
// is stored state from before the split: 'Feedback' was one stage over three
// loops, and it is now three. Left alone it comes back as a name nothing renders
// and no box on the map opens — a session that returns to a panel showing
// nothing, with no way to tell that from having closed it. The camera loop is
// where it lands because it held the group 'Feedback' opened at first.
const GONE: Readonly<Record<string, string>> = { Feedback: CAMERA_LOOP_STAGE }

export const openStageFrom = (stored: string | null): string | null =>
  stored === null || stored === '' ? null : (GONE[stored] ?? stored)

export function usePanelNav() {
  const [openGroup, setOpenGroup] = usePersistedString(OPEN_GROUP_STORE)
  const [stored, setOpenPhase] = usePersistedString(OPEN_PHASE_STORE)
  const openPhase = openStageFrom(stored)

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
