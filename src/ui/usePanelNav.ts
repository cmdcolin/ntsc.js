import { PHASES } from './controls'
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
    // Opening a stage opens its first group too, so reaching a knob stays one
    // click deep rather than two.
    togglePhase: (name: string) => {
      const first = PHASES.find(p => p.name === name)?.groups[0]
      if (openPhase === name) setOpenPhase(null)
      else if (first === undefined) setOpenPhase(name)
      else openAt(name, first.name)
    },
  }
}
