import { useCallback, useEffect, useRef, useState } from 'react'

import { CONTROL_KEYS } from '../controls'
import { controlOf, createMidi, presetOf } from './midi'

import type { ControlKey, Controls } from '../controls'
import type { EngineApi } from '../gpu/engineapi'
import type {
  BindingMap,
  BindTarget,
  DeviceProfile,
  LearnState,
  MidiManager,
  MidiStatus,
  PickupMap,
} from './midi'
import type { RefObject } from 'react'

// The two bindable things that aren't controls, and so aren't the engine's to
// write. Both live in hooks built *after* this one — useMix needs the write path
// this hook owns — so they are registered rather than passed in, and a knob that
// arrives before they are is dropped rather than queued.
export interface MidiSinks {
  setMotion: (v: number) => void
  setPresetWeight: (name: string, w: number) => void
}

const NO_SINKS: MidiSinks = { setMotion: () => {}, setPresetWeight: () => {} }

// Owns the MIDI manager (an imperative Web MIDI subsystem living outside React)
// and the single control-write path. Every store-origin change must reach two
// sinks — the render engine and MIDI's soft-takeover bookkeeping — so callers
// go through writeControl/writeControls rather than poking each by hand.
export function useMidi(engineRef: RefObject<EngineApi | null>) {
  const midiRef = useRef<MidiManager | null>(null)
  const sinksRef = useRef<MidiSinks>(NO_SINKS)
  const [status, setStatus] = useState<MidiStatus>('idle')
  const [bindings, setBindings] = useState<BindingMap>({})
  const [armed, setArmed] = useState<BindTarget | null>(null)
  const [learn, setLearn] = useState<LearnState | null>(null)
  const [bpm, setBpm] = useState<number | null>(null)
  const [pickups, setPickups] = useState<PickupMap>({})

  useEffect(() => {
    // A MIDI-origin change drives the engine only: the physical knob move IS
    // the takeover, so it must not reset its own soft-takeover state.
    const midi = createMidi({
      onControl: (target, v) => {
        const key = controlOf(target)
        if (key !== null) {
          engineRef.current?.setControl(key, v)
          return
        }
        const preset = presetOf(target)
        if (preset === null) sinksRef.current.setMotion(v)
        else sinksRef.current.setPresetWeight(preset, v)
      },
      onStatus: setStatus,
      onBindings: setBindings,
      onArmed: setArmed,
      onLearn: setLearn,
      onTempo: setBpm,
      onPickup: setPickups,
    })
    midiRef.current = midi
    return () => {
      midi.destroy()
      midiRef.current = null
    }
  }, [engineRef])

  // The one write path for store-origin changes (slider, preset, clock sync):
  // engine renders it, MIDI drops takeover so the knob must re-catch the value.
  //
  // Deliberately still useCallback, even though React Compiler would memoize
  // these: App keeps writeControl in an effect dep array, and a fresh identity
  // per render would re-fire that effect and reset soft-takeover every frame —
  // a physical knob could never hold its catch. Correctness, not performance,
  // so the invariant is stated here rather than inferred from compiler output.
  const writeControl = useCallback(
    (key: ControlKey, v: number) => {
      engineRef.current?.setControl(key, v)
      midiRef.current?.setExternal(key, v)
    },
    [engineRef],
  )

  const writeControls = useCallback(
    (next: Controls) => {
      engineRef.current?.applyControls(next)
      const midi = midiRef.current
      if (midi) for (const k of CONTROL_KEYS) midi.setExternal(k, next[k])
    },
    [engineRef],
  )

  return {
    status,
    bindings,
    armed,
    learn,
    bpm,
    pickups,
    writeControl,
    writeControls,
    // Where a knob's turn lands for the targets the engine doesn't own. Held in
    // a ref and re-registered after each render, so the handlers close over the
    // latest state without the manager (built once, on mount) being rebuilt.
    setSinks: (s: MidiSinks) => {
      sinksRef.current = s
    },
    enable: () => midiRef.current?.enable(),
    // Toggle: arming the already-armed target disarms it.
    toggleArm: (target: BindTarget) =>
      midiRef.current?.arm(armed === target ? null : target),
    disarm: () => midiRef.current?.arm(null),
    autoMap: (profile: DeviceProfile) => midiRef.current?.autoMap(profile),
    learnSequence: () => midiRef.current?.learnSequence(),
    stopLearn: () => midiRef.current?.stopLearn(),
    clearBinding: (target: BindTarget) => midiRef.current?.clearBinding(target),
    clearAll: () => midiRef.current?.clearAll(),
  }
}
