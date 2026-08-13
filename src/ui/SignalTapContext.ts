import { createContext, use } from 'react'

// The signal tap's value and setter, read from context rather than threaded as
// a prop: the row that shows it lives inside ControlGroup, several components
// below app.tsx, where eng.tap/eng.changeTap actually sit. A separate context
// from ControlsContext for the same reason ModSlotsContext is one — dbgView
// lives on the engine, not in Controls, since it isn't part of the look a
// preset or mutate should ever touch.
interface SignalTapApi {
  tap: number
  onTap: (v: number) => void
}

export const SignalTapContext = createContext<SignalTapApi | null>(null)

export function useSignalTapApi(): SignalTapApi {
  const api = use(SignalTapContext)
  if (api === null) throw new Error('signal tap read outside the panel')
  return api
}
