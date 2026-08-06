import { stageGroups } from './controls'
import { usePersistedString } from './storage'

// Which stage, and which group inside it, are unfolded — one of each, so the
// chain map stays on screen instead of scrolling past as a flat list of sixteen
// headers. Persisted; null is the map alone, where exploration starts.
const OPEN_GROUP_STORE = 'video_feedback_open_group'
const OPEN_PHASE_STORE = 'video_feedback_open_phase'

export function usePanelNav() {
  const [openGroup, setOpenGroup] = usePersistedString(OPEN_GROUP_STORE)
  const [openPhase, setOpenPhase] = usePersistedString(OPEN_PHASE_STORE)

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
