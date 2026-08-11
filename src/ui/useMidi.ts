import { useCallback, useEffect, useRef, useState } from 'react'

import { CONTROL_KEYS } from '../controls'
import {
  controlOf,
  createMidi,
  cueDeckOf,
  faultOf,
  fireSlotOf,
  jumpDeckOf,
  presetOf,
} from './midi'

import type { ControlKey, Controls } from '../controls'
import type { EngineApi } from '../gpu/engineapi'
import type {
  ActionTarget,
  BindingMap,
  BindTarget,
  DeckTag,
  DeviceProfile,
  LearnState,
  MidiManager,
  MidiStatus,
  NoteMap,
  PickupMap,
} from './midi'
import type { TransitionName } from './transitions'
import type { RefObject } from 'react'

// Everything MIDI drives that isn't a control, and so isn't the engine's to
// write. All of it lives in hooks built *after* this one — useMix needs the
// write path this hook owns — so they are registered rather than passed in, and
// a knob or a pad that arrives before they are is dropped rather than queued.
export interface MidiSinks {
  setMotion: (v: number) => void
  setPresetWeight: (name: string, w: number) => void
  // The three verbs a pad can fire, split by verb rather than handed over as an
  // action id: this hook owns the decoding, the same way it decodes a knob
  // target into setMotion or setPresetWeight, so the App registers what it can
  // do and never has to know how a binding spells it.
  //
  // `slot` is the bay index, or undefined for the whole bay — the argument
  // `ModSlotsApi.fire` already takes.
  fire: (slot: number | undefined, velocity: number) => void
  tapCue: (deck: DeckTag) => void
  retrigger: (deck: DeckTag) => void
  // Run a named transition off the shelf (ui/transitions.ts). No velocity: the
  // entry carries its own depth and its own duration, and a pad struck softly
  // wanting a shallower fault is a different feature — half a fault does not
  // hide a cut, which is the one thing a transition has to do.
  runFault: (name: TransitionName) => void
}

const NO_SINKS: MidiSinks = {
  setMotion: () => {},
  setPresetWeight: () => {},
  fire: () => {},
  tapCue: () => {},
  retrigger: () => {},
  runFault: () => {},
}

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
  const [notes, setNotes] = useState<NoteMap>({})
  const [armedNote, setArmedNote] = useState<ActionTarget | null>(null)
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
      // The action families in the order they narrow. A bay slot arrives
      // 1-based, as the panel numbers it, and goes to the sink 0-based, as the
      // engine indexes it — the one conversion, in the one place that knows
      // both spellings.
      onAction: (target, velocity) => {
        const sinks = sinksRef.current
        const slot = fireSlotOf(target)
        if (slot !== null) {
          sinks.fire(slot - 1, velocity)
          return
        }
        const cue = cueDeckOf(target)
        if (cue !== null) {
          sinks.tapCue(cue)
          return
        }
        const jump = jumpDeckOf(target)
        if (jump !== null) {
          sinks.retrigger(jump)
          return
        }
        const fault = faultOf(target)
        if (fault !== null) sinks.runFault(fault)
        // Everything left is the whole bay: `fire` is the only action that
        // narrows to none of the four, and it is what an unbound note sends.
        else sinks.fire(undefined, velocity)
      },
      onStatus: setStatus,
      onBindings: setBindings,
      onArmed: setArmed,
      onNotes: setNotes,
      onArmedNote: setArmedNote,
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
    notes,
    armedNote,
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
    toggleArmNote: (target: ActionTarget) =>
      midiRef.current?.armNote(armedNote === target ? null : target),
    // Escape means both: whichever arm is up is the one the user is backing out
    // of, and calling the arm that was already null costs one callback.
    disarm: () => {
      midiRef.current?.arm(null)
      midiRef.current?.armNote(null)
    },
    autoMap: (profile: DeviceProfile) => midiRef.current?.autoMap(profile),
    learnSequence: () => midiRef.current?.learnSequence(),
    stopLearn: () => midiRef.current?.stopLearn(),
    clearBinding: (target: BindTarget) => midiRef.current?.clearBinding(target),
    clearNote: (target: ActionTarget) => midiRef.current?.clearNote(target),
    clearAll: () => midiRef.current?.clearAll(),
  }
}
