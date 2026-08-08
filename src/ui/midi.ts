import { CONTROL_KEYS } from '../controls'
import { AUTOMAP_KEYS, SLIDER_BY_KEY, sliderFor, snapToStep } from './controls'
import { PRESETS, presetLabel } from './presets'
import { readRecord } from './storage'
import { fromTravel } from './travel'

import type { ControlKey } from '../controls'
import type { SliderDef } from './controls'

// One CC source = a (channel, controller) pair. Channel is kept so two knobs
// that share a controller number on different channels stay distinct.
export interface MidiBinding {
  channel: number
  controller: number
}

// What a knob can drive. Most of it is controls, but the two levers worth a
// knob most in a set are not in `Controls` at all: the motion amount, which
// scales every routing at once, and a preset's weight, which is already a macro
// over everything that preset touches. So a binding names something *bindable*
// rather than something in the control store, and the string is the storage key.
export type BindTarget = ControlKey | 'motion' | `preset:${string}`

export const MOTION: BindTarget = 'motion'
const PRESET_PREFIX = 'preset:'

// Taking a target apart again, without a cast anywhere: `find` narrows to
// ControlKey on its own, and the template literal builds its own type.
export const presetTarget = (name: string): BindTarget =>
  `${PRESET_PREFIX}${name}`

export const presetOf = (t: BindTarget): string | null =>
  t.startsWith(PRESET_PREFIX) ? t.slice(PRESET_PREFIX.length) : null

export const controlOf = (t: BindTarget): ControlKey | null =>
  CONTROL_KEYS.find(k => k === t) ?? null

// A stored key read back. Anything that no longer names something bindable — a
// control renamed between versions, a preset retitled or dropped from the table
// — comes back null and is discarded, rather than sitting in the map as a
// binding that fires into nothing: the panel lists bound targets by walking the
// preset and control tables, so a key neither table knows could never be shown,
// and its knob could only be freed by clearing every binding.
export function parseTarget(s: string): BindTarget | null {
  if (s === MOTION) return MOTION
  if (!s.startsWith(PRESET_PREFIX))
    return CONTROL_KEYS.find(k => k === s) ?? null
  const name = s.slice(PRESET_PREFIX.length)
  return PRESETS.some(p => p.name === name) ? presetTarget(name) : null
}

export type BindingMap = Partial<Record<BindTarget, MidiBinding>>

// Knob positions for controls waiting to be caught, in control units. Keyed by
// control, not target: soft takeover applies to controls alone (see `drive`).
export type PickupMap = Partial<Record<ControlKey, number>>

// What a knob needs to know about its target: the span it sweeps and the grid
// it lands on. A control carries that on its SliderDef; motion and preset
// weights are plain unit faders, 0..1 in hundredths — the motion strip's own
// step, and fine enough that a weight reads as continuous.
type BindSpan = Pick<SliderDef, 'min' | 'max' | 'step' | 'curve'>

const UNIT_SPAN: BindSpan = { min: 0, max: 1, step: 0.01 }

export function spanFor(t: BindTarget): BindSpan | null {
  const key = controlOf(t)
  return key === null ? UNIT_SPAN : (SLIDER_BY_KEY.get(key) ?? null)
}

// How a bound target is named in the MIDI panel.
export function targetLabel(t: BindTarget): string {
  const key = controlOf(t)
  if (key !== null) return sliderFor(key).label
  const preset = presetOf(t)
  if (preset === null) return 'motion amount'
  const def = PRESETS.find(p => p.name === preset)
  return `${def === undefined ? preset : presetLabel(def)} · preset`
}

// A controller's factory layout, as the CC number each physical knob sends, in
// the order they should take controls. `ccs` is explicit (not a base+count)
// because real layouts stripe knobs across non-contiguous CC ranges. A device
// that banks knobs on-hardware (e.g. the MIDI Fighter Twister's 4 banks) just
// lists every bank's CC — the app sees banks as more distinct knobs, no
// bank-switch logic needed here.
export interface DeviceProfile {
  name: string
  channel: number
  ccs: number[]
}

// One entry per knob (16 encoders × 4 on-device banks), factory-default CC 0..63
// on channel 1. Turning any bank on the box just changes which of these a knob
// sends, so the app maps a control to every slot up front.
const twisterCcs: number[] = []
for (let i = 0; i < 64; i++) twisterCcs.push(i)

export const DEVICE_PROFILES: DeviceProfile[] = [
  { name: 'MIDI Fighter Twister', channel: 0, ccs: twisterCcs },
]

// The auto-map spine, with the motion amount ahead of every control: it is the
// one fader that scales a whole patch at once, and on a device whose low CCs are
// the front row of knobs that is where it belongs.
export const AUTOMAP_TARGETS: BindTarget[] = [MOTION, ...AUTOMAP_KEYS]

export interface AutoMapResult {
  mapped: number
  total: number
}

// Live progress of a "learn in order" sweep: bind each target down the spine
// to whichever knob the user moves next. `nextTarget` is the one still waiting
// for a knob, or null once every slot is filled.
export interface LearnState {
  done: number
  total: number
  nextTarget: BindTarget | null
}

export type MidiStatus =
  | 'unsupported'
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'denied'

const STORE_KEY = 'video_feedback_midi'
// Set once a grant succeeds, so a reload reconnects without another trip
// through the Advanced dialog. Cleared on denial, so a revoked permission
// doesn't leave every load reporting an error the user didn't ask for.
const ENABLED_KEY = 'video_feedback_midi_on'

// Through readRecord, not a bare JSON.parse: this runs inside useMidi's mount
// effect, so a corrupt or stale-schema value would throw out of it and take the
// whole app down with no way back but clearing storage by hand. Keys go through
// parseTarget on the way in, so a map written by an older version keeps every
// binding it still has a target for and quietly drops the rest.
function loadBindings(): BindingMap {
  const stored = readRecord<Partial<Record<string, MidiBinding>>>(STORE_KEY, {})
  const out: BindingMap = {}
  for (const [k, b] of Object.entries(stored)) {
    const target = parseTarget(k)
    if (target !== null && b !== undefined) out[target] = b
  }
  return out
}

function bindingId(b: MidiBinding): string {
  return `${b.channel}:${b.controller}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

// Copy of a partial map without one key. Generic over the key type as well as
// the value, so the binding map here (keyed by target), the pickup map (keyed by
// control) and the sync map in useClockSync all share it. Spread-then-delete
// rather than a rebuild: `delete` on an optional property needs no cast, and
// Object.entries would widen every key back to string.
export function omit<K extends string, V>(
  map: Partial<Record<K, V>>,
  key: K,
): Partial<Record<K, V>> {
  const out = { ...map }
  delete out[key]
  return out
}

// A 0..127 CC value → a stepped value in the target's range. A curved control
// maps through its own travel, so a knob feels like its on-screen slider rather
// than racing through the useful end of the scale.
function ccToValue(span: BindSpan, cc: number): number {
  return snapToStep(span, fromTravel(span, cc / 127))
}

// Half a control's full span per MIDI step — the pickup tolerance for the very
// first message of a binding, where there's no previous value to cross.
function epsilon(span: BindSpan): number {
  return (span.max - span.min) / 64
}

// Soft takeover: has the knob earned the right to drive this control yet?
// Three cases — nothing on screen to catch; a first message with no earlier
// knob position to have crossed from, so accept when it lands close enough;
// otherwise the knob must have swept through the live value.
export function hasCaught(
  span: BindSpan,
  onScreen: number | undefined,
  knobWas: number | undefined,
  knobNow: number,
): boolean {
  return onScreen === undefined
    ? true
    : knobWas === undefined
      ? Math.abs(knobNow - onScreen) <= epsilon(span)
      : (knobWas - onScreen) * (knobNow - onScreen) <= 0
}

// Rate controls (Hz) that can lock to the incoming clock. `beats` is the cycle
// length: 1/4 means one full cycle per quarter note.
export const SYNC_DIVISIONS: { label: string; beats: number }[] = [
  { label: '1/1', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
]

// `strobeHz` belongs here rather than being a rate you dial by eye: the whole
// reason its gate reads the wall clock instead of a frame count (signal/
// strobe.ts) is so that a rate asked for in Hz — or in beats — is that rate
// under a frame lock and on a 144 Hz panel. A strobe is the one fault in here
// you count along with.
export const SYNCABLE_KEYS: ControlKey[] = ['wipeRate', 'bLineHz', 'strobeHz']

// Tempo-locked value for a rate control, clamped to its slider range.
export function syncedValue(
  key: ControlKey,
  bpm: number,
  beats: number,
): number {
  const raw = bpm / 60 / beats
  const def = SLIDER_BY_KEY.get(key)
  return def ? clamp(raw, def.min, def.max) : raw
}

export interface MidiManager {
  enable: () => void
  arm: (target: BindTarget | null) => void
  // Replace all bindings with a device's factory layout: each knob CC takes the
  // next target along the auto-map spine. Returns how many got a knob.
  autoMap: (profile: DeviceProfile) => AutoMapResult
  // Device-agnostic bulk bind: start from a clean slate, then bind the next
  // target down the spine to each fresh knob the user moves. Works for any
  // controller regardless of its CC layout.
  learnSequence: () => void
  stopLearn: () => void
  clearBinding: (target: BindTarget) => void
  clearAll: () => void
  // Report a value set from outside MIDI (slider drag, preset, slot). Drops
  // soft-takeover engagement so the physical knob must re-catch the new value.
  // Controls only — the other targets don't take over softly (see `drive`).
  setExternal: (key: ControlKey, value: number) => void
  destroy: () => void
}

export interface MidiCallbacks {
  onControl: (target: BindTarget, value: number) => void
  onStatus: (status: MidiStatus) => void
  onBindings: (bindings: BindingMap) => void
  onArmed: (target: BindTarget | null) => void
  // Where each physical knob sits for controls it hasn't caught yet, in control
  // units. Soft takeover makes those knobs inert, and without this the panel
  // gives no sign of it — the control just looks broken.
  onPickup: (pickups: PickupMap) => void
  // A note struck, with its velocity as 0..1. Deliberately not a BindTarget:
  // every other thing MIDI drives here is a value you set, and this is the one
  // that is an event you cause — there is nothing for soft takeover to catch
  // and nothing to hold between messages. Any note fires the whole bay, which
  // is the gesture the ⚡ button is; per-slot notes want a binding family of
  // their own and are noted in IDEAS.
  onFire: (velocity: number) => void
  // Progress of a learn-in-order sweep, or null when none is running.
  onLearn: (state: LearnState | null) => void
  // Detected clock tempo, or null when no clock is running.
  onTempo: (bpm: number | null) => void
}

export function createMidi(cb: MidiCallbacks): MidiManager {
  let bindings = loadBindings()
  let armed: BindTarget | null = null
  let access: MIDIAccess | null = null
  let onStateChange: (() => void) | null = null
  // Active learn-in-order sweep: the spine of targets to fill, how far along we
  // are, and the knob sources already claimed (so one knob's stream of messages
  // binds a single target, not the whole row).
  let learn: {
    targets: BindTarget[]
    index: number
    seen: Set<string>
  } | null = null
  const targetByBinding = new Map<string, BindTarget>()

  // Soft-takeover bookkeeping, keyed by control.
  const current = new Map<ControlKey, number>()
  const lastCc = new Map<ControlKey, number>()
  const engaged = new Set<ControlKey>()
  let pickups: PickupMap = {}

  // A knob's position while it is still inert. Reported as a whole map so the
  // panel holds one piece of state rather than one per control.
  const setPickup = (key: ControlKey, value: number | null) => {
    if (value === null) {
      if (pickups[key] !== undefined) {
        pickups = omit(pickups, key)
        cb.onPickup({ ...pickups })
      }
    } else if (pickups[key] !== value) {
      pickups = { ...pickups, [key]: value }
      cb.onPickup({ ...pickups })
    }
  }

  const clearPickups = () => {
    if (Object.keys(pickups).length > 0) {
      pickups = {}
      cb.onPickup({})
    }
  }

  // Clock: 24 pulses per quarter note. BPM is averaged over a window of pulse
  // arrivals and only reported when the rounded value changes.
  let pulses: number[] = []
  let lastPulse = 0
  let reportedBpm: number | null = null
  let tempoTimer: ReturnType<typeof setInterval> | null = null

  const stopClock = () => {
    pulses = []
    if (reportedBpm !== null) {
      reportedBpm = null
      cb.onTempo(null)
    }
  }

  const onPulse = () => {
    const now = performance.now()
    pulses.push(now)
    if (pulses.length > 25) pulses.shift() // ~one beat of history
    lastPulse = now
    if (pulses.length >= 7) {
      const perPulse =
        (pulses[pulses.length - 1] - pulses[0]) / (pulses.length - 1)
      const bpm = Math.round((60000 / (perPulse * 24)) * 2) / 2
      if (Number.isFinite(bpm) && bpm !== reportedBpm) {
        reportedBpm = bpm
        cb.onTempo(bpm)
      }
    }
  }

  const reindex = () => {
    targetByBinding.clear()
    for (const [k, b] of Object.entries(bindings)) {
      const target = parseTarget(k)
      if (target !== null && b !== undefined)
        targetByBinding.set(bindingId(b), target)
    }
  }
  reindex()

  const persist = () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(bindings))
    cb.onBindings({ ...bindings })
  }

  const reportLearn = () => {
    cb.onLearn(
      learn === null
        ? null
        : {
            done: learn.index,
            total: learn.targets.length,
            nextTarget: learn.targets[learn.index] ?? null,
          },
    )
  }

  // Forget a control's takeover state, so the knob has to earn it again.
  const release = (t: BindTarget) => {
    const key = controlOf(t)
    if (key !== null) {
      engaged.delete(key)
      lastCc.delete(key)
      setPickup(key, null)
    }
  }

  const bind = (t: BindTarget, b: MidiBinding) => {
    // A CC drives one target at a time: drop whoever held this source before.
    const prev = targetByBinding.get(bindingId(b))
    const next: BindingMap =
      prev === undefined ? { ...bindings } : omit(bindings, prev)
    next[t] = b
    bindings = next
    release(t)
    if (prev !== undefined) release(prev)
    reindex()
    persist()
  }

  const drive = (t: BindTarget, cc: number) => {
    const span = spanFor(t)
    if (span === null) return
    const mapped = ccToValue(span, cc)
    const key = controlOf(t)
    // Soft takeover is a control's rule, and it works only because the row can
    // draw an amber mark showing where the knob is waiting. The motion strip
    // and a preset chip have nowhere to put that mark, so an inert knob there
    // would read as broken with nothing on screen to explain it — those take
    // over on the first message instead, which is what a performance fader
    // should do anyway.
    if (key === null) {
      cb.onControl(t, mapped)
      return
    }
    if (hasCaught(span, current.get(key), lastCc.get(key), mapped))
      engaged.add(key)
    lastCc.set(key, mapped)
    if (engaged.has(key)) {
      setPickup(key, null)
      current.set(key, mapped)
      cb.onControl(t, mapped)
    } else {
      setPickup(key, mapped)
    }
  }

  const onMessage = (e: MIDIMessageEvent) => {
    const data = e.data
    // System real-time is a single status byte: 0xF8 clock tick, 0xFC stop.
    if (data?.length === 1) {
      if (data[0] === 0xf8) onPulse()
      else if (data[0] === 0xfc) stopClock()
    }
    // Note On is status 0x90..0x9F; three bytes: status, note, velocity. Note
    // Off (0x80) and the running-status zero-velocity Note On that stands in
    // for it are both ignored on purpose: a one-shot is struck and then decays
    // on its own clock, so a key lift has nothing to say to it. That is also
    // why nothing here tracks which notes are held.
    if (data?.length === 3 && (data[0] & 0xf0) === 0x90 && data[2] > 0) {
      cb.onFire(data[2] / 127)
    }
    // Control Change is status 0xB0..0xBF; three bytes: status, controller, value.
    if (data?.length === 3 && (data[0] & 0xf0) === 0xb0) {
      const b = { channel: data[0] & 0x0f, controller: data[1] }
      const id = bindingId(b)
      if (learn !== null) {
        // A knob already claimed this sweep keeps streaming as it turns — only a
        // fresh source advances to the next target.
        if (!learn.seen.has(id)) {
          learn.seen.add(id)
          bind(learn.targets[learn.index], b)
          learn.index += 1
          if (learn.index >= learn.targets.length) learn = null
          reportLearn()
        }
      } else if (armed !== null) {
        bind(armed, b)
        armed = null
        cb.onArmed(null)
      } else {
        const target = targetByBinding.get(id)
        if (target !== undefined) drive(target, data[2])
      }
    }
  }

  const listen = (m: MIDIAccess) => {
    for (const input of m.inputs.values()) input.onmidimessage = onMessage
  }

  const manager: MidiManager = {
    enable: () => {
      if (!('requestMIDIAccess' in navigator)) {
        cb.onStatus('unsupported')
      } else {
        cb.onStatus('requesting')
        navigator.requestMIDIAccess().then(
          m => {
            access = m
            localStorage.setItem(ENABLED_KEY, '1')
            cb.onStatus('ready')
            cb.onBindings({ ...bindings })
            listen(m)
            // New devices plugged in after grant still get wired up.
            onStateChange = () => listen(m)
            m.addEventListener('statechange', onStateChange)
            // A source that stops sending clock ticks (or is unplugged) never
            // sends 0xFC; drop the tempo once ticks go quiet.
            tempoTimer = setInterval(() => {
              if (reportedBpm !== null && performance.now() - lastPulse > 1000)
                stopClock()
            }, 500)
          },
          () => {
            localStorage.removeItem(ENABLED_KEY)
            cb.onStatus('denied')
          },
        )
      }
    },
    arm: target => {
      armed = target
      cb.onArmed(target)
    },
    autoMap: profile => {
      const n = Math.min(profile.ccs.length, AUTOMAP_TARGETS.length)
      const next: BindingMap = {}
      for (let i = 0; i < n; i++)
        next[AUTOMAP_TARGETS[i]] = {
          channel: profile.channel,
          controller: profile.ccs[i],
        }
      bindings = next
      engaged.clear()
      lastCc.clear()
      clearPickups()
      reindex()
      persist()
      return { mapped: n, total: AUTOMAP_TARGETS.length }
    },
    learnSequence: () => {
      armed = null
      cb.onArmed(null)
      learn = { targets: AUTOMAP_TARGETS, index: 0, seen: new Set() }
      bindings = {}
      engaged.clear()
      lastCc.clear()
      clearPickups()
      reindex()
      persist()
      reportLearn()
    },
    stopLearn: () => {
      if (learn !== null) {
        learn = null
        reportLearn()
      }
    },
    clearBinding: target => {
      bindings = omit(bindings, target)
      release(target)
      reindex()
      persist()
    },
    clearAll: () => {
      bindings = {}
      clearPickups()
      reindex()
      persist()
    },
    setExternal: (key, value) => {
      current.set(key, value)
      // Losing the catch is the moment the knob's position starts mattering
      // again, so surface where it is left sitting — a preset load strands
      // every knob at once, and this is what says so.
      const knob = lastCc.get(key)
      if (engaged.delete(key) && knob !== undefined) setPickup(key, knob)
    },
    destroy: () => {
      if (tempoTimer !== null) clearInterval(tempoTimer)
      if (access) {
        for (const input of access.inputs.values()) input.onmidimessage = null
        if (onStateChange)
          access.removeEventListener('statechange', onStateChange)
      }
    },
  }

  // Already opted in on a previous visit, so reconnect rather than making the
  // user find the Advanced dialog again every reload. The browser has the
  // permission; nothing new is prompted.
  if (localStorage.getItem(ENABLED_KEY) === '1') manager.enable()
  return manager
}
