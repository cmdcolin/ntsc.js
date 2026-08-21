import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'

import styles from './app.module.css'
import { DEFAULT_CONTROLS, atRest } from './core/controls'
import { A_OPTIONS, B_OPTIONS } from './sources/modes'
import { poolCaption } from './sources/pools'
import { AboutDialog } from './ui/AboutDialog'
import { AdvancedDialog } from './ui/AdvancedDialog'
import { AppMenu, ShowMenuButton } from './ui/AppMenu'
import { AudioHint, AudioInput } from './ui/AudioInput'
import { ClipLibraryDialog } from './ui/ClipLibraryDialog'
import { ClipPicker } from './ui/ClipPicker'
import { CommandPalette } from './ui/CommandPalette'
import { ControlRows } from './ui/ControlGroup'
import {
  ALL_SLIDERS,
  MUTATE_SLIDERS,
  DECK_BLURB,
  DECK_STAGE,
  LOOP_STAGE_NAMES,
  MIX_STAGE,
  MOD_BLURB,
  MOD_KEYWORDS,
  MOD_STAGE,
  PHASES,
  SOUND_STAGE,
  SOURCE_A_STAGE,
  SOURCE_B_STAGE,
  VIEW_STAGE,
} from './ui/controls'
import {
  ControlsContext,
  ControlStoreContext,
  NO_CONTROL_STORE,
} from './ui/ControlsContext'
import { cx } from './ui/cx'
import { Deck } from './ui/Deck'
import { barCut, deckLoad } from './ui/deckModel'
import { FatalScreen } from './ui/FatalScreen'
import {
  FilterContext,
  filterActive,
  isMovingMark,
  readFilter,
  sliderMatches,
} from './ui/filter'
import { FpsMonitor } from './ui/FpsMonitor'
import { CrosshairIcon } from './ui/icons'
import { LookBar } from './ui/LookBar'
import { LookSection } from './ui/LookSection'
import { MediaBrowserDialog } from './ui/MediaBrowserDialog'
import { MenuRow } from './ui/MenuRow'
import { MidiSection } from './ui/MidiSection'
import { ModBay } from './ui/ModBay'
import { bayLoad, slotsToRoutings } from './ui/modSlots'
import { ModSlotsContext } from './ui/ModSlotsContext'
import { parseMorph } from './ui/morph'
import { MotionStrip } from './ui/MotionStrip'
import { paletteActions } from './ui/paletteActions'
import { panelChain } from './ui/panelChain'
import { slotPatched, soundPatched } from './ui/patched'
import { matchPreset, presetControls, presetLabelFor } from './ui/presets'
import { PresetsSection } from './ui/PresetsSection'
import { profileAtSlot, suggestProfileName } from './ui/profileModel'
import { sameList } from './ui/sameList'
import { SavedProfiles } from './ui/SavedProfiles'
import { Section } from './ui/Section'
import { SignalPath } from './ui/SignalPath'
import { SignalPathDialog } from './ui/SignalPathDialog'
import { SignalTapContext } from './ui/SignalTapContext'
import { Rack } from './ui/Slider'
import { HiddenFilePicker, SourceSlot } from './ui/SourceSlot'
import { Stage } from './ui/Stage'
import { usePersistedFlag, usePersistedString } from './ui/storage'
import { StripContext } from './ui/StripContext'
import { StripTray } from './ui/StripTray'
import { TagsPopover } from './ui/TagsPopover'
import { TeletypeDialog } from './ui/TeletypeDialog'
import { faultPlan, transitionOf } from './ui/transitions'
import ui from './ui/ui.module.css'
import { parseSessionParams } from './ui/urlParams'
import { useAudio } from './ui/useAudio'
import { useAutomation } from './ui/useAutomation'
import { useCapture } from './ui/useCapture'
import { useClipLibrary } from './ui/useClipLibrary'
import { useClockSync } from './ui/useClockSync'
import { useEngine } from './ui/useEngine'
import { useFavorites } from './ui/useFavorites'
import { useLookLabels } from './ui/useLookLabels'
import { useMediaQuery } from './ui/useMediaQuery'
import { useMidi } from './ui/useMidi'
import { useMix } from './ui/useMix'
import { useModSlots } from './ui/useModSlots'
import { usePageLifecycle } from './ui/usePageLifecycle'
import { usePanelNav } from './ui/usePanelNav'
import { usePopout } from './ui/usePopout'
import { useRender } from './ui/useRender'
import { useSavedProfiles } from './ui/useSavedProfiles'
import { useScrollAnchor } from './ui/useScrollAnchor'
import { useShortcuts } from './ui/useShortcuts'
import { useStrip } from './ui/useStrip'
import { useTempo } from './ui/useTempo'
import { useUrlState } from './ui/useUrlState'
import { WebcamDialog } from './ui/WebcamDialog'
import { YouTubeDialog } from './ui/YouTubeDialog'
import { gitSha, versionLabel } from './version'

import type { ControlKey, Controls } from './core/controls'
import type { FaultPlan } from './core/signal/fault'
import type { GlidePlan } from './core/signal/glide'
import type { PickerStage } from './ui/controls'
import type { ControlsApi, ControlStore } from './ui/ControlsContext'
import type { StashSlot } from './ui/fileStash'
import type { Lens } from './ui/lens'
import type { SavedProfile } from './ui/profileModel'
import type { AnySlotView } from './ui/slotView'
import type { PickSlot } from './ui/SourceSlot'
import type { RenderFrom } from './ui/StripTray'
import type { LookContext } from './ui/useLookLabels'
import type { SourcePrompt } from './ui/useSourcePrompt'
import type { ReactNode } from 'react'

// Whether the menu over the picture has been dismissed. Persisted across
// reloads so a collapse sticks — it only ever applies where the masthead is off
// screen (fullscreen, the popout), which is where somebody clearing the picture
// off for a projector is likely to be.
const BAR_HIDDEN_STORE = 'ntsc.js_overlay_bar_hidden'

// useSyncExternalStore fallbacks for the window before the async engine exists.
const subscribeNever = () => () => {}
const getDefaultControls = (): Controls => DEFAULT_CONTROLS
const getNoMorph = (): number | null => null

// Which stages are open to a jump, in the only four arrangements there are: a
// second source patched in or not, an audio input picked or not. Built once
// rather than per render because it is a prop on "This look" — a fresh Set each
// render rebuilds every row in that section, and the answer only ever changes
// when one of those two inputs does.
const TRUNK_STAGES = PHASES.map(p => p.name)
const stageSet = (b: boolean, sound: boolean): ReadonlySet<string> =>
  new Set([
    // Mix needs a second signal for any of its controls to reach the picture.
    ...TRUNK_STAGES.filter(name => b || name !== MIX_STAGE),
    ...(b ? [SOURCE_B_STAGE] : []),
    ...(sound ? [SOUND_STAGE] : []),
    // Always: there is no input to patch into the view, so it never goes inert.
    VIEW_STAGE,
    // Nor into a loop — a loop *is* a patch, across a chain that is always
    // carrying A. So all three are open to a jump in every arrangement, which
    // is what a caption in "This look" needs to know before it offers the way
    // back to the knob that made the look.
    ...LOOP_STAGE_NAMES,
  ])
const OPEN_STAGES = [
  [stageSet(false, false), stageSet(false, true)],
  [stageSet(true, false), stageSet(true, true)],
]

const toggleFullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
  } else {
    document.documentElement.requestFullscreen().catch(() => {})
  }
}

export function App() {
  // Off every session, and not persisted: a counter that moves every frame pulls
  // the eye, and you want it only while chasing a stall. Two switches reach it —
  // the × on the readout and the app menu — so it lives here rather than in
  // either of them. It used to be handed to `useEngine` as well, to gate whether
  // the frame rate was wired to React at all; the readout subscribes to the
  // engine's own store now, which costs nothing while it is closed, so this says
  // only whether the thing is on screen.
  const [showFps, setShowFps] = useState(false)
  const eng = useEngine()
  // Both pulled off in one destructure, and `engine` is read through the local
  // rather than as `eng.engine` for the rest of the render. Reading a ref out of
  // an object marks the whole object as ref-ish to the React Compiler, so a
  // later `eng.engine` read during render trips "cannot access refs during
  // render" — one error, and the compiler drops *all* memoization for this
  // component, which is the one that builds the entire panel.
  const { engine, engineRef } = eng
  // The automation tape, built before the write path because the write path
  // taps it (docs/EDITOR.md › _Live input has no offline meaning_). It is inert
  // until ● is pressed: every verb on the tap checks whether anything is
  // rolling first, so the app's ordinary write path costs one null test.
  const auto = useAutomation(engineRef)
  // Pulled off once, because it is the half of `auto` that keeps its identity
  // and the half that ends up in dependency arrays.
  const autoTap = auto.tap
  const {
    status: midiStatus,
    bindings: midiBindings,
    notes: midiNotes,
    armed,
    armedNote,
    bpm,
    pickups,
    writeControl,
    writeControls,
    setSinks,
    enable: enableMidi,
    toggleArm,
    toggleArmNote,
    disarm,
    autoMap,
    learn,
    learnSequence,
    stopLearn,
    clearBinding,
    clearNote,
    clearAll,
  } = useMidi(engineRef, auto.tap)
  // The engine IS the store: React reads controls straight from it via
  // useSyncExternalStore, so there's no separate `values` copy to keep in sync.
  const controls = useSyncExternalStore(
    engine === null ? subscribeNever : engine.subscribeControls,
    engine === null ? getDefaultControls : engine.getControls,
  )
  // The same store, handed to the rows so each can subscribe to its own key
  // instead of taking the whole object off this render. Hand-memoized, and this
  // is the one case where that is correctness rather than tuning: the object
  // goes into a context, so a fresh identity per render re-renders every row
  // that reads it, which is precisely what this exists to stop. The React
  // Compiler would very likely get it right, and "very likely" is not the bar
  // for the thing the panel's whole render budget rests on.
  const controlStore = useMemo<ControlStore>(
    () =>
      engine === null
        ? NO_CONTROL_STORE
        : { subscribe: engine.subscribeControls, get: engine.getControls },
    [engine],
  )
  // MIDI clock when there is one, the hand-set tempo under it when there isn't.
  // Every ♩ in the panel — the rate control rows, and a modulation slot's rate —
  // reads this one number.
  const tempo = useTempo(bpm)
  const { cycleSync, syncLabel, lockedValue } = useClockSync({
    bpm: tempo.bpm,
    ensureTempo: tempo.ensure,
    writeControl,
  })
  const { popout, openPopout, widenPopout } = usePopout()
  // The bench: every stage of the chain at once, two columns wide. Persisted,
  // but inert unless there is room for it — the docked panel needs a wide
  // screen, while the popout is the user's own window to size, so there the
  // panel's container query has the last word.
  const [benchOn, setBenchOn] = usePersistedFlag('ntsc.js_panel_bench')
  const roomy = useMediaQuery('(min-width: 1280px)')
  const bench = benchOn && (popout !== null || roomy)
  // Switching it on asks the popout for the room the two columns need; the
  // docked panel widens itself in CSS and has nothing to ask for.
  const toggleBench = () => {
    if (!benchOn) widenPopout()
    setBenchOn(!benchOn)
  }
  const [fullscreen, setFullscreen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showDiagram, setShowDiagram] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [comparing, setComparing] = useState(false)
  // Which tool a drag on the picture is. It used to be neither — the mode was
  // inferred from the magnification, so one gesture meant two things depending
  // on a number elsewhere on screen, and the only way to ask for the other one
  // was to already know shift did that. Armed by default: at 1× there is nothing
  // to pan, so the crosshair is the only tool a fresh session has a use for, and
  // it is what says the magnifier exists at all. Not persisted — a pointer tool
  // is a thing you pick up for a minute, not a setting.
  const [boxZoom, setBoxZoom] = useState(true)
  const [barHidden, setBarHidden] = usePersistedFlag(BAR_HIDDEN_STORE)
  const [filter, setFilter] = useState('')
  // The other half of the filter, and a mode rather than a word: which controls
  // the bay is driving is a question the box cannot hold, because a routing
  // leaves the resting value alone and there is nothing to type. It rode in the
  // box as `∿` until now, which made the two alternatives — you could ask for
  // moving rows or for "ghost", never both — and left the ✕ clearing a mode it
  // could not tell from a search.
  const [movingOnly, setMovingOnly] = useState(false)
  // Whether the masthead is showing the filter box rather than the wordmark.
  // Held open by a live query as well as by the ⌕, so the box can't disappear
  // out from under a filter that is still narrowing the panel — which is what
  // a bare `searchOpen` did the moment anything else took focus.
  const [searchOpen, setSearchOpen] = useState(false)
  // `/` has to reach a box that is already standing — `autoFocus` fires on mount
  // and nowhere else, so a filter left up while you dragged a slider would take
  // the key and do nothing visible with it.
  const filterBox = useRef<HTMLInputElement>(null)
  const openSearch = () => {
    setSearchOpen(true)
    filterBox.current?.focus()
  }
  // The three ways the filter moves from outside the box. Together here because
  // each has to speak for both halves of it: a mode the ✕ leaves standing is a
  // panel still narrowed by something with nothing on screen explaining it.
  const clearFilter = () => {
    setFilter('')
    setMovingOnly(false)
  }
  // A jump — the palette revealing a control, a door into a free box — asks for
  // one named thing, so it drops the mode rather than intersecting with it.
  // Landing on "nothing matches" because the bay happens not to be driving what
  // you looked up is not an answer to what was asked.
  const revealText = (text: string) => {
    setFilter(text)
    setMovingOnly(false)
  }
  // One switch wherever it is pressed, and taking a pasted ∿ back out of the box
  // is part of switching off: with the mark still in it the mode reads straight
  // back off the text, and the button that just released it looks broken.
  const toggleMoving = () => {
    const marked = isMovingMark(filter.trim())
    if (marked) setFilter('')
    setMovingOnly(!(movingOnly || marked))
  }
  const nav = usePanelNav()
  const { favorites, toggleFavorite } = useFavorites()
  // The modulation bay, owned here so the panel, the rows and the mix all see
  // one copy. The engine is written to and never read from — it applies the
  // routings inside its own frame and restores, so React has to be the store.
  const modApi = useModSlots(engine, tempo)
  // How long a new look takes to arrive. Through the ref rather than `engine` so
  // the identity is stable: it ends up inside the verbs useMix hands to every
  // control row, and a fresh one per render would put all 202 rows back on the
  // write path.
  //
  // Tapped, and this is the one write the tape takes that is not a value: a
  // morph is a gesture with a duration, and recording the frames it passes
  // through would be sixty events a second saying what the destination and the
  // span already say. A row's own arrival does *not* come through here — it
  // reaches the engine from `useEngine.showSession` — which is what keeps the
  // walk's morphs off a tape the walk is going to replay beside.
  const startGlide = useCallback(
    (plan: GlidePlan) => {
      engineRef.current?.startGlide(plan)
      autoTap.glide(plan.to, plan.seconds)
    },
    // `autoTap` rather than `auto`: the hook's return is a fresh object each
    // render and the tap inside it is not, and this callback's identity is the
    // thing every control row's write path hangs off (see above).
    [engineRef, autoTap],
  )
  // Where a morph in flight is heading, for the undo walk — the engine is asked
  // because it is the only one that knows a morph was cancelled.
  const getGlideTarget = () => engineRef.current?.glideTarget() ?? null
  // Whether a morph is running, and how far along, is deliberately *not* state
  // here. It changes every frame, and this component builds the entire panel —
  // holding it would reconcile ~200 control rows sixty times a second for a
  // readout the width of one button. Instead the engine publishes it as its own
  // store and the button subscribes, the same shape `useControlValue` uses to
  // put one slider on one key. App never re-renders for a morph at all.
  const morphStore = {
    subscribe: engine === null ? subscribeNever : engine.subscribeGlide,
    get: engine === null ? getNoMorph : engine.getGlide,
  }
  // Stop where it stands: the half-way look is a look. Nothing to reset here —
  // the store is the engine's, so the readout goes down when the engine says a
  // morph is over, however it ended.
  const stopMorph = () => engineRef.current?.stopGlide()
  const [morphStored, setMorphStored] = usePersistedString('ntsc.js_morph')
  const morphSeconds = parseMorph(morphStored)
  const mix = useMix({
    controls,
    getControls: controlStore.get,
    writeControls,
    startGlide,
    getGlideTarget,
    morphSeconds,
    sourceBOn: eng.b.mode !== 'none',
    mod: modApi,
  })

  // Either slot, by the key something outside handed over. Five surfaces are
  // told which slot to act on rather than choosing — the keyboard, a bound MIDI
  // pad, and the three dialogs, each of which was opened *for* a slot — and
  // every one of them used to spell out its own `key === 'a' ? …A : …B`, once
  // per verb. One lookup, and what follows it is the verb on a slot.
  //
  // Declared here rather than beside the dialogs it also serves, because the
  // sink registration below closes over it: read from an effect it would be
  // fine at runtime, but the React Compiler declines to memoize a component
  // that reads a binding declared later in the body, and it drops *all* of this
  // component's memoization when it does (scripts/compilercheck.mjs).
  const slotFor = (key: StashSlot): AnySlotView => (key === 'a' ? eng.a : eng.b)

  // Everything MIDI drives that the engine doesn't own. Registered from an
  // effect rather than passed into useMidi, which is built before any of it
  // exists — useMix needs the write path that hook owns. No dep array: all
  // close over this render's state, and re-registering is one assignment.
  useEffect(() => {
    setSinks({
      setMotion: modApi.setMaster,
      setPresetWeight: mix.midiPresetWeight,
      // The bay is React's, so this is the only route a note has to it.
      fire: (slot, v) => {
        modApi.fire(slot, v)
      },
      // The same two verbs `i` and `o` reach from the keyboard, through the same
      // slot lookup — a pad and a key striking one deck's cue must not be able
      // to disagree about which deck that is.
      tapCue: deck => slotFor(deck).tapCue(),
      retrigger: deck => slotFor(deck).retrigger(),
      // The same transition the shelf's button runs, down to the frame count
      // and the cut — the entry carries both, so a pad and a click cannot mean
      // two different things (ui/transitions.ts).
      runFault: name => {
        const t = transitionOf(name)
        if (t !== undefined) {
          engineRef.current?.startFault(
            faultPlan(t, () => {
              writeControls(barCut(controlStore.get()))
            }),
          )
        }
      },
    })
  })

  // Hold-to-compare: preview the clean defaults on the render path without
  // touching the store (sliders stay put), then restore from it on release.
  const startCompare = () => {
    engineRef.current?.preview({ ...DEFAULT_CONTROLS })
    setComparing(true)
  }
  const endCompare = () => {
    engineRef.current?.preview(null)
    setComparing(false)
  }

  // What the board is called: the preset it matches, or the last one it was
  // built from and has since been edited. Null when neither — a look dialed in
  // from stock has no name until someone gives it one, and the two things that
  // ask (a capture's filename, the save box's placeholder) fill that blank
  // differently. matchPreset returns undefined for "matches nothing authored".
  const activePreset = matchPreset(controls)
  const lookName = activePreset ? activePreset.name : mix.lastPreset
  const capture = useCapture(eng.canvasRef, lookName ?? 'edit', eng.setError)
  // The same look, spelled for a human rather than for a query string. `?preset=`
  // and MIDI keys want the identifier `lookName` carries; anything a person
  // reads wants the words — a strip row called "neonTube" beside a chip that
  // says "neon tube" is the app disagreeing with itself in public.
  const lookLabel = lookName === null ? '' : presetLabelFor(lookName)

  // The clip shelf. It hangs off the app rather than off useEngine because the
  // engine's only stake in it is the File a clicked row hands back — everything
  // else is a list, a picker and a permission, and none of that is the signal
  // path's business.
  //
  // The gate is "is the shelf reachable from the panel", not "is the dialog
  // open": a slot sitting on `library` carries the caption menu, and that menu
  // needs to know what can be opened before it is clicked, since resolving a
  // grant is an await and the click's transient activation does not survive
  // one. Nothing here prompts — `hasRead` only asks what the answer already is.
  const clips = useClipLibrary(
    eng.prompt.slotFor('library') !== null ||
      eng.a.mode === 'library' ||
      eng.b.mode === 'library',
    eng.loadClip,
    (slot, ref) => eng.showRef(slot, ref, 'library'),
    (slot, url, secs) => eng.loadYtUrl(slot, url, secs),
  )

  // The slot each of the two editing dialogs was opened for, resolved once here
  // rather than re-derived inside every callback. Those callbacks used to branch
  // on `eng.askTeletype === 'b'` at the moment they fired, three times in one
  // dialog — which is correct only because nothing can move that state while the
  // dialog is up, and reads as though something might. Resolved at the open, the
  // dialog holds the slot it belongs to and its verbs are that slot's.
  const asked = (kind: SourcePrompt): AnySlotView | null => {
    const key = eng.prompt.slotFor(kind)
    return key === null ? null : slotFor(key)
  }
  const teletypeSlot = asked('teletype')
  const youTubeSlot = asked('youtube')
  // The other two take a key rather than a slot view: the shelf and the browser
  // are lists of media, not verbs on a deck, and what they need to know is which
  // deck a plain click plays into.
  const libraryFor = eng.prompt.slotFor('library')
  const browseFor = eng.prompt.slotFor('browse')

  // Which pick the palette's two rows act on: A's if it has one, else B's, the
  // same precedence `rollAgain` uses — A is the picture.
  const shown = eng.a.pick ?? eng.b.pick
  const shownKept = shown !== null && clips.kept(shown)

  // The ★ and the credit link under a source picker, for a slot with something
  // off one of the public archives on it. Assembled here because it takes one
  // fact from the engine (what is on the slot) and one from the shelf (whether
  // that file is on it), and neither hook can see the other — but it takes the
  // *slot* rather than the pick already dug out of one, so a source slot can ask
  // it per slot and the answer cannot arrive under the wrong picker.
  const pickCaption = (slot: AnySlotView): PickSlot => {
    const on = slot.pick
    return on === null
      ? null
      : {
          page: on.page,
          origin: on.origin,
          kept: clips.kept(on),
          onKeep: () => clips.keep(on, poolCaption(on)),
        }
  }

  // The link still takes its per-slot values flat, because the query string is a
  // flat thing and urlParams.ts names these keys on the wire (?cueA=, ?vapor=).
  // Unpacked here, next to each other, rather than left as thirty fields on the
  // engine for everything else to unpack too.
  const { copyLink, profileQuery, copyQuery } = useUrlState({
    controls,
    mod: slotsToRoutings(modApi.slots),
    engineReady: engine !== null,
    sourceMode: eng.a.mode,
    sourceBMode: eng.b.mode,
    ytUrlA: eng.a.ytUrl,
    ytUrlB: eng.b.ytUrl,
    teletypeA: eng.a.teletype,
    teletypeB: eng.b.teletype,
    speedA: eng.a.speed,
    speedB: eng.b.speed,
    reverb: eng.reverb,
    dry: eng.dry,
    cueA: eng.a.cue,
    cueB: eng.b.cue,
    getGlideTarget,
    onError: eng.setError,
  })

  // The saved-profile library, which is the query string above kept under a name.
  // Recall snapshots for undo, lands the controls, re-cables the bay — and stops
  // there: the query carries the source urls so a copied *link* opens on the
  // right clip, but yanking the live input out from under a running session to
  // put a still back is not what "bring that look back" means. A look whose
  // stored mod is missing (hand-edited storage; no saved look this app wrote
  // lacks one) leaves the bay alone rather than silencing it, the same rule a
  // link without ?mod= follows.
  // The rundown. Everything it needs from the app is a value or a verb that
  // already existed — the engine's session apply, the same mutate list the
  // panel's own shake uses, the tempo — which is the point of a row being a
  // query string rather than a shape of its own.
  // The picker owns where sound comes from, including the clips' own tracks —
  // which the engine is the one that can route, so it hands the switch over.
  //
  // Above the strip rather than beside the panel rows that draw it, because the
  // strip takes its transport: ▶ on a rundown starts the picked track from the
  // top so the two are locked at frame zero.
  const audio = useAudio(engine, eng.setVideoAudio)

  // The offline render, which is the recorder's opposite number: `capture`
  // follows the picture in real time, this takes the frames away from the
  // screen and writes what the simulation did.
  const render = useRender(
    engine,
    eng.canvasRef,
    lookLabel || 'take',
    eng.setError,
  )

  const strip = useStrip({
    showSession: eng.showSession,
    faultTo: eng.faultTo,
    clipOn: eng.clipOn,
    rollOn: eng.rollOn,
    prerollOn: eng.prerollOn,
    prerollClipOn: eng.prerollClipOn,
    dropPreroll: eng.dropPrerollOn,
    settleSources: eng.settleSources,
    getControls: controlStore.get,
    writeControls,
    mutateSliders: MUTATE_SLIDERS,
    bpm: tempo.bpm,
    ensureTempo: tempo.ensure,
    // Through the ref, like startGlide above: the strip's tick reads this once
    // per frame, and a fresh closure per render would rebuild the loop.
    frameNo: useCallback(() => engineRef.current?.frameNo() ?? 0, [engineRef]),
    track: audio.track,
  })

  // How long ⎙ renders for, in priority order and each entry for its own
  // reason.
  //
  // A recorded take wins outright: it is a performance that happened, of a
  // length somebody chose by pressing ● and then ■, and replaying thirty
  // seconds of it into a three-minute render would be two and a half minutes of
  // a board nobody is touching. Then the song, because a piece cut to one is as
  // long as it.
  //
  // **Then the rundown itself**, which is where a ten-second default used to
  // be, and the gap it leaves is the one that made ⎙ look broken on the thing
  // the tray is for: eight clips laid out back to back, no music picked and
  // nothing recorded, rendered ten seconds — two rows of a three-minute piece,
  // and no way to tell from the button that it was going to.
  //
  // Below the song rather than above it, deliberately. A rundown cut to a track
  // is as long as the track: the walk's holds are bars, the song is what they
  // are bars *of*, and where the two disagree the piece is the one somebody
  // chose. Above it only when there is no song at all — which is exactly when
  // the rundown is the only statement of length in the room.
  //
  // Ten seconds is still the floor, for the board with no rundown, no song and
  // no tape behind it: long enough to be a take, short enough to be a try. A
  // rundown answers 0 when it holds a row that waits for a hand, so an
  // open-ended piece lands here too rather than on a guess (`strip.stripSeconds`).
  // One value rather than a length and a flag: the button has to say which of
  // the four it is showing, and two fields is two chances for the number and
  // the sentence under it to disagree.
  const take: { seconds: number; from: RenderFrom } =
    auto.seconds > 0
      ? { seconds: auto.seconds, from: 'take' }
      : audio.track.loaded && audio.duration > 0
        ? { seconds: audio.duration, from: 'track' }
        : strip.seconds > 0
          ? { seconds: strip.seconds, from: 'rundown' }
          : { seconds: 10, from: 'default' }

  const profiles = useSavedProfiles()

  // Labelling the live look — the tags menu in the look bar. Nothing leaves the
  // browser until somebody signs in, so this is opt-in by construction.
  const labels = useLookLabels(profiles.user?.uid ?? null)

  // Read at the instant a rating is clicked rather than held in the popover: the
  // board can move under an open menu (a slider, a knob, an LFO), and the row has
  // to describe what was on screen when the button went down.
  //
  // `provenance` is a best-effort hint, and deliberately not the thing analysis
  // should trust for the question that matters. The one that matters is "was this
  // an untouched roll", because `surprise` samples the same distribution the
  // labelling page does and that subset is an unbiased sample inside a biased
  // collection. The exact test for it is offline and needs nothing from here:
  // `weights` and `query` are both stored, so a row whose query is what those
  // weights serialize to *is* an untouched recipe, whatever this string says.
  const readLook = (): LookContext => ({
    query: profileQuery(),
    weights: Object.fromEntries(mix.weights),
    preset: mix.lastPreset,
    // Read off the gesture that put this look on the board rather than inferred
    // from what it left behind — see useMix. The inference here filed every
    // roll that clears the recipe (the nudge, the fault, the cross) as `hand`.
    provenance: mix.provenance,
    source: eng.a.mode,
  })
  // `landLook` rather than a plain write: a recall is the same gesture as a
  // preset click — a whole board at once — so it arrives however the look bar
  // says looks arrive, cut or morph. It used to cut unconditionally while the
  // numbered scene slots this replaced morphed — an accident of the two having
  // been written apart, not anything either meant.
  const recallProfile = (profile: SavedProfile) => {
    const session = parseSessionParams(`?${profile.query}`)
    mix.snapshotForUndo()
    mix.landLook(presetControls(session.controls))
    if (session.mod !== null) modApi.setRoutings(session.mod)
    profiles.markRecalled(profile.name)
  }

  // The 1–9 keys, over the library rather than a separate bank of nine. Recall
  // on a slot the library has not reached yet does nothing, deliberately: an
  // empty slot has no look to offer, and a keystroke that invented one would be
  // worse than a keystroke that misses.
  const recallSlot = (n: number) => {
    const profile = profileAtSlot(profiles.profiles, n)
    if (profile !== undefined) recallProfile(profile)
  }

  // The name to save under, offered by all four ways in. The profile you are
  // working in wins over the preset the controls still match: one knob past a
  // recall they match nothing, and "my look" is a worse offer than "my rig 2".
  const suggestedProfileName = suggestProfileName(
    profiles.profiles,
    profiles.lastName ?? lookName ?? '',
  )

  // shift+N keeps the board over that slot's profile, under its name. Past the
  // end of the library it is an ordinary save under the offered name, which
  // appends — so it lands on the next free slot rather than the one pressed.
  // Naming nothing is the point of the gesture, so it does not ask.
  const saveSlot = (n: number) => {
    const profile = profileAtSlot(profiles.profiles, n)
    profiles.saveProfile(profile?.name ?? suggestedProfileName, profileQuery())
  }

  useShortcuts(popout, {
    // Dialogs close themselves (each Dialog binds Escape to its own document);
    // here Escape just backs out of the panel's own modes.
    //
    // The open stage is the last of them and only gets the press none of the
    // others wanted: it is where you are rather than a mode you are in, so
    // escaping a search has no business also losing your place in the chain.
    // Not on the bench, where every stage is mounted and the open one is a mark
    // on the map rather than a thing on screen to back out of.
    onSearch: openSearch,
    onEscape: () => {
      const mode =
        filter !== '' ||
        movingOnly ||
        searchOpen ||
        armed !== null ||
        armedNote !== null ||
        learn !== null
      clearFilter()
      setSearchOpen(false)
      disarm()
      stopLearn()
      if (!mode && !bench) nav.closePhase()
    },
    onPalette: () => setShowPalette(true),
    onUndo: mix.undo,
    canUndo: mix.canUndo,
    onRedo: mix.redo,
    canRedo: mix.canRedo,
    onToggleFullscreen: toggleFullscreen,
    onStartCompare: startCompare,
    onEndCompare: endCompare,
    onToggleRecord: capture.toggleRecord,
    onGrabStill: capture.grabStill,
    onTapCue: key => slotFor(key).tapCue(),
    onRetrigger: key => slotFor(key).retrigger(),
    // No velocity, exactly as the ⚡ button strikes it: a key is on or off, and
    // inventing a level for it would make the same gesture mean two things
    // depending on which surface it came from. A pad has one and passes it.
    onFire: () => modApi.fire(),
    onSaveSlot: saveSlot,
    onRecallSlot: recallSlot,
    // ctrl+S keeps the board under the name the menu would have offered. The
    // library sits above this call for that reason: a handler here is read
    // through a ref every render, but the object it lives in is built now.
    //
    // Signed out there is nowhere for it to go, and a keystroke that silently
    // does nothing is worse than one that refuses: saveProfile declines, and the
    // button in the row goes amber saying `sign in` (see SavedProfiles).
    onSaveProfile: () =>
      profiles.saveProfile(suggestedProfileName, profileQuery()),
  })
  usePageLifecycle(engineRef, setFullscreen)

  // Everything a control row needs, in one place, read from context by the rows
  // themselves rather than threaded down through each group.
  const controlsApi: ControlsApi = {
    lockedValue,
    writeControl,
    writeControls,
    favorites,
    toggleFavorite,
    midiReady: midiStatus === 'ready',
    bindLabel: target => {
      const b = midiBindings[target]
      return b === undefined ? null : String(b.controller)
    },
    armed,
    toggleArm,
    pickup: key => pickups[key],
    clockLive: tempo.bpm !== null,
    syncLabel,
    cycleSync,
    mutateGroup: mix.mutateGroup,
    resetGroup: mix.resetGroup,
    // Through the ref, like every other engine verb here: the deck holds this
    // across a render, and the engine object is a different one after a
    // device-loss rebuild.
    startFault: useCallback(
      (plan: FaultPlan) => engineRef.current?.startFault(plan),
      [engineRef],
    ),
  }

  // Everything ⌘K can run that is not a preset or a control, assembled in
  // paletteActions.ts — the list is a list, and what App is the authority on is
  // which handler each row is wired to.
  const palette = paletteActions({
    onSurprise: mix.surprise,
    onSurpriseOne: mix.surpriseOne,
    onMutate: mix.mutateLook,
    onSpike: mix.spikeLook,
    onCross: mix.crossLook,
    onRollMotion: amount => mix.rollMotion(amount, { audioLive: audio.active }),
    onReset: mix.reset,
    onUndo: mix.undo,
    onRedo: mix.redo,
    slots: [eng.a, eng.b],
    onVaporwave: () => {
      eng.applyVaporwave()
      audio.select('video')
    },
    roll: {
      can: eng.rollable,
      up: shown === null ? null : poolCaption(shown),
      kept: shownKept,
      again: eng.rollAgain,
      keep: () => {
        if (shown !== null) clips.keep(shown, poolCaption(shown))
      },
    },
    save: {
      can: profiles.canSave,
      as: suggestedProfileName,
      run: () => profiles.saveProfile(suggestedProfileName, profileQuery()),
    },
    onCopyLink: copyLink,
    onRecord: capture.toggleRecord,
    onStill: capture.grabStill,
    onFullscreen: toggleFullscreen,
    onBench: toggleBench,
    onPopout: () => openPopout(benchOn),
    onFilter: revealText,
    onShowMoving: () => setMovingOnly(true),
    onOpenStage: nav.jumpPhase,
    onDiagram: () => setShowDiagram(true),
    onAdvanced: () => setShowAdvanced(true),
    onAbout: () => setShowAbout(true),
  })

  const query = readFilter(filter, movingOnly)
  const filtering = filterActive(query)
  // A query set from anywhere else — the ∿ reveal, a palette jump — opens the
  // box too, so the panel is never filtered by something with nothing on screen
  // saying so and no way to clear it.
  const searching = searchOpen || filtering
  // What the filter needs from the bay: which controls are being driven. `∿`
  // asks exactly this and nothing else, so the whole panel — pinned rows,
  // contextual sections, the spine — has to be able to answer it.
  const isRouted = (key: ControlKey) => modApi.modFor(key) !== null
  const pinned = sameList(
    ALL_SLIDERS.filter(
      s =>
        favorites.has(s.key) &&
        (!filtering || sliderMatches(s, query, isRouted(s.key))),
    ),
  )
  // Everything the current look actually moves, gathered out of the six stages
  // it is scattered across. The same walk the chain map's `• N` does, kept as
  // rows rather than reduced to a count — see LookSection, which does its own
  // filtering because its membership has to be decided before a query narrows
  // it, not after.
  const edited = ALL_SLIDERS.filter(s => !atRest(controls[s.key], s.key))
  // "This look" grows as you work, and it sits above everything you work *on*:
  // move a control eight stages down and a row for it appears up here, pushing
  // the row still under your pointer 44px down the screen for no reason you can
  // see. Folded it doesn't grow at all (see LookSection), so what is left for
  // the anchor is the section you unfolded yourself and then scrolled past —
  // a preset applied from the palette, say, while you are eight stages down.
  // The wrapper is a block formatting context (`lookAnchor`, app.module.css):
  // the section's outer margins collapse straight through a bare div, and the
  // anchor would then compensate 9px short of what actually grew.
  const lookRef = useRef<HTMLDivElement>(null)
  useScrollAnchor(lookRef)
  // Nothing patched into B leaves two stages with nothing to act on: B itself,
  // and the mixer beside it, whose every control needs a second signal. Both
  // are still drawn — together they are the one thing on screen saying a second
  // input exists — and neither wears the amber that says "you changed something
  // in here": nothing in them is reaching the picture.
  const bOn = eng.b.mode !== 'none'
  // The sound answers the same question one stage further down: with nothing
  // coming down the wire, every routing in the group is patched to silence.
  //
  // One switch decides it, which is the point of the ♪ picker owning the clips'
  // sound tracks too: while Vaporwave had a "play audio out loud" button of its
  // own, a clip could be driving the receiver with the picker on 'off', and this
  // branch would have called itself dead while it was working.
  const soundOn = audio.active
  // What the modulation bay is holding, for the two drawings that mark it: the
  // map's floating box and the full diagram's. Read once, so the miniature and
  // the card cannot disagree about a bay neither of them can count for itself.
  const bay = bayLoad(modApi.slots, modApi.stab)
  // And what the deck is holding, for the same two drawings and the same reason.
  const deck = deckLoad(controls)
  // Which of the three returns is actually carrying signal. Read off each
  // loop's own mix rather than the whole stage: a loop with its mix at zero is
  // patched but silent, and both drawings are answering "is it running". The
  // same three predicates gate the passes that close them (compose, fbComposite
  // and tapePlay in gpu/pipeline.ts), so a lit run and a dispatched pass mean
  // the same thing.
  const loopsLive = {
    camera: controls.fbMix > 0,
    mixer: controls.cfbMix > 0,
    tape: controls.tapeMix > 0,
  }
  // What is standing in each of the three boxes with a picker, for the caption
  // under its name on the map (patched.ts). Keyed by `PickerStage`, the same
  // list `stageTop` below is keyed by: a fourth picker added to one and not the
  // other is a compile error rather than a box whose caption is a guess.
  const patched: Partial<Record<PickerStage, string>> = {
    [SOURCE_A_STAGE]: slotPatched(eng.a),
    [SOURCE_B_STAGE]: slotPatched(eng.b),
    [SOUND_STAGE]: soundPatched(audio.mode, audio.name),
  }
  // Which stages something outside the map can jump to. Not read off the chain
  // below: a live filter drops stages from the map, and a caption in "This look"
  // is still a way back to the module it came from.
  const openStages = OPEN_STAGES[bOn ? 1 : 0][soundOn ? 1 : 0]
  // Every box on the map, and whether the query reached one that will draw
  // anything — the whole of the sidebar's structure, worked out in one place
  // over the control tables (panelChain.ts). The two free boxes are the only
  // part App has to supply, because their bodies are components rather than
  // control groups.
  const chain = panelChain({
    controls,
    filter: query,
    isRouted,
    bOn,
    soundOn,
    patched,
    onOpenGroup: nav.openAt,
    free: [
      {
        name: MOD_STAGE,
        blurb: MOD_BLURB,
        // The one free box a query can reach, because it is the one holding
        // controls that live nowhere else — the deck's are all borrowed from
        // stages already in the results. See `freeMatches`.
        keywords: MOD_KEYWORDS,
        load: bay,
        body: () => (
          <ModBay
            tempo={tempo}
            // A patched slot names the control it drives and opens the module
            // that control lives in — the same jump "This look"'s captions
            // make, and the reason the bay no longer needs a picker listing
            // every slider in the app.
            openStages={openStages}
            onOpenGroup={nav.openAt}
          />
        ),
      },
      { name: DECK_STAGE, blurb: DECK_BLURB, load: deck, body: () => <Deck /> },
    ],
  })

  // This slot's clip menu. Asked for one slot at a time, so the name on the menu
  // and the slot the shelf opens for both come off the same object. As a `…A`/
  // `…B` pair this was two four-line copies whose only difference was three
  // letters, which is the shape that ends up opening the shelf for A while
  // captioning it with B's clip.
  const clipPicker =
    (slot: AnySlotView) =>
    (extra: ReactNode): ReactNode => (
      <ClipPicker
        slot={slot.key}
        name={slot.name}
        lib={clips.lib}
        access={clips.access}
        note={clips.note}
        extra={extra}
        onPlay={clips.play}
        onOpenShelf={() => eng.prompt.ask('library', slot.key)}
      />
    )

  // What heads a stage, above the groups that shape what it brings in: the
  // picker that decides what feeds it. Exactly three stages have one, and they
  // are the three the map already draws boxes for — which is the whole reason
  // these moved here. They used to be a section called "Input" sitting 60px
  // above a map whose SOURCE A box opened A's *signal* groups rather than the
  // picker that decides what A is: two surfaces naming the same three things,
  // and the one carrying the name was the wrong one.
  //
  // Thunks rather than nodes, for the reason `groups` is handed over as data:
  // only the stages on screen call theirs, so a folded map builds no pickers at
  // all.
  //
  // Which stages are keyed here is also the answer to which boxes stay pressable
  // while nothing is patched into them — SignalPath reads both off this one
  // record, so a picker cannot end up behind a box that will not open. `Partial<
  // Record<PickerStage, …>>` is what holds the *other* drawing to it: the full
  // diagram has no `stageTop` to read and decides off `PICKER_STAGES` instead, so
  // the keys are typed to that same list and a fourth picker added here without
  // being added there is a compile error rather than a silent disagreement
  // between two pictures of the same chain.
  const stageTop: Partial<Record<PickerStage, () => ReactNode>> = {
    [SOURCE_A_STAGE]: () => (
      <SourceSlot
        slot={eng.a}
        title="main source"
        options={A_OPTIONS}
        clipPicker={clipPicker(eng.a)}
        pick={pickCaption(eng.a)}
      >
        {eng.a.mode === 'webcam' && eng.videoDevices.length > 1 ? (
          <MenuRow
            tag="◉"
            title="capture device"
            value={eng.webcamDeviceId}
            options={eng.videoDevices.map((d, i) => ({
              value: d.deviceId,
              label: d.label === '' ? `Device ${i + 1}` : d.label,
            }))}
            onChange={eng.startWebcam}
          />
        ) : null}
      </SourceSlot>
    ),
    [SOURCE_B_STAGE]: () => (
      <SourceSlot
        slot={eng.b}
        title="second source, mixed in dirty"
        options={B_OPTIONS}
        clipPicker={clipPicker(eng.b)}
        pick={pickCaption(eng.b)}
      />
    ),
    [SOUND_STAGE]: () => (
      <>
        <AudioInput
          mode={audio.mode}
          name={audio.name}
          audioState={audio.audioState}
          time={audio.time}
          duration={audio.duration}
          reverb={eng.reverb}
          onReverb={eng.changeReverb}
          dry={eng.dry}
          onDry={eng.changeDry}
          onSelect={audio.select}
          onSeek={audio.seek}
        />
        <AudioHint
          mode={audio.mode}
          hasClip={eng.a.live === 'clip' || eng.b.live === 'clip'}
          error={audio.error}
        />
      </>
    ),
  }

  // Whether the query reached anything at all, across every place a result can
  // land — not the trunk alone. A routed mixer control lives on B's branch, a
  // routed pin lives in Favorites and 37 of the app's controls live in a loop,
  // so keying "nothing matches" off the trunk denied results the panel was
  // showing right above the message. `anyStage` is the map's own answer, off the
  // same nodes it draws, rather than a second list of render conditions kept
  // agreeing with them by hand.
  const anyResult =
    chain.anyStage ||
    pinned.length > 0 ||
    edited.some(s => sliderMatches(s, query, isRouted(s.key)))

  // The magnifier, as the stage's gestures and the menu's zoom row both see it.
  // One write for all three, so a gesture notifies the engine once.
  const lens: Lens = {
    zoom: controls.crtZoom,
    x: controls.crtZoomX,
    y: controls.crtZoomY,
  }
  const setLens = (next: Lens) =>
    writeControls({
      ...controls,
      crtZoom: next.zoom,
      crtZoomX: next.x,
      crtZoomY: next.y,
    })

  // Everything behind the ☰ — one menu, and the two places it can be shown are
  // given the same rows from here. It normally lives at the far top right of the
  // window, which is the masthead's end; fullscreen and the popout take the
  // panel off this window's screen, and the stage's copy is what is left.
  const menuProps = {
    recording: capture.recording,
    fullscreen,
    poppedOut: popout !== null,
    lens,
    onLens: setLens,
    tap: eng.tap,
    frameLock: controls.frameLock,
    onFrameLock: (v: number) => writeControl('frameLock', v),
    onGrabStill: capture.grabStill,
    onToggleRecord: capture.toggleRecord,
    onToggleFullscreen: toggleFullscreen,
    bench: benchOn,
    canBench: popout !== null || roomy,
    onToggleBench: toggleBench,
    onPopout: () => openPopout(benchOn),
    showFps,
    onToggleFps: () => setShowFps(!showFps),
    onShowPalette: () => setShowPalette(true),
    onShowAdvanced: () => setShowAdvanced(true),
    onShowAbout: () => setShowAbout(true),
  }

  const panelBody = (
    <>
      {/* The masthead carries the app's chrome — the brand, the filter and
          the ☰ — and while a query is live it carries the filter alone: the
          wordmark is the one thing on screen nobody needs to read twice, so it
          is what gives up its width. */}
      <div className={styles.titleRow}>
        {searching ? null : (
          <button
            className={styles.brand}
            onClick={() => setShowAbout(true)}
            title={`ntsc.js ${versionLabel} (${gitSha}) — what is this?`}
            aria-label="ntsc.js — what is this?"
          >
            <img
              className={styles.brandMark}
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt=""
            />
            <span className={styles.wordmark}>ntsc.js</span>
            <span className={styles.version}>{versionLabel}</span>
          </button>
        )}
        {/* Sits in the masthead rather than over the bottom-left of the
            picture, which is the one surface meant to stay clear. */}
        {showFps ? (
          <FpsMonitor
            store={eng.statsStore}
            res={eng.res}
            onHide={() => setShowFps(false)}
          />
        ) : null}
        {searching ? (
          <div className={styles.filterBox}>
            {/* The mode, standing in the box beside the words rather than
                pretending to be one of them. It is where a filter you did not
                type has to appear: pressing ∿ on the strip narrows the whole
                panel, and before this the only trace of it was a glyph in the
                text — which said something had happened without saying that the
                button was what said it, and could not be taken off without
                clearing a search you had also typed. */}
            {query.moving ? (
              <button
                className={styles.filterChip}
                title="showing only what the bay is driving — click to drop it"
                onClick={toggleMoving}
              >
                ∿ moving ×
              </button>
            ) : null}
            <input
              ref={filterBox}
              className={styles.filter}
              type="search"
              // Mounted by the ⌕, so the press that opened it is also the press
              // that should have landed in the box. On mount and only there: an
              // inline `ref={el => el?.focus()}` is a new function every render,
              // which React reattaches — and the fps counter re-renders this
              // component four times a second, so the box took focus back off
              // whatever you had just clicked, four times a second.
              autoFocus
              placeholder="rainbow, ghost, tear…"
              title="matches names and descriptions, so artifact words work: rainbow, ghost, dot crawl, tear, roll… — the ∿ on the modulation row narrows whatever is up here to the controls the bay is driving"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <button
              className={styles.filterClear}
              title="clear the filter (esc)"
              aria-label="clear the filter"
              onClick={() => {
                clearFilter()
                setSearchOpen(false)
              }}
            >
              ×
            </button>
          </div>
        ) : null}
        <div className={styles.chrome}>
          {/* Stays through a live query, unlike the ⌕ beside it: the filter box
              takes the wordmark's width, and this is not the thing that has
              gone redundant. Lit while it is the crosshair — the cursor over
              the picture is the other half of the readout, and this is the half
              that is still on screen when the pointer is somewhere else. */}
          <button
            className={cx(ui.chromeBtn, boxZoom && ui.chromeBtnOn)}
            aria-pressed={boxZoom}
            aria-label="pointer tool over the picture"
            title={
              boxZoom
                ? 'crosshair: drag the picture to box a region and zoom into it (shift-drag moves the glass instead)'
                : 'hand: drag the picture to move around the glass (shift-drag boxes a region to zoom into)'
            }
            onClick={() => setBoxZoom(!boxZoom)}
          >
            <CrosshairIcon />
          </button>
          {searching ? null : (
            <button
              className={ui.chromeBtn}
              title="filter the controls (/) — artifact words work: rainbow, ghost, tear, roll (⌘K jumps to one by name)"
              aria-label="filter the controls"
              onClick={openSearch}
            >
              ⌕
            </button>
          )}
          {/* The account, at the true corner — beside the ⋮ rather than a verb
              among compare/mutate/undo below. Those act on the look that is on
              screen; this says whose looks they are, which is a fact about the
              session, not a move it makes. */}
          <SavedProfiles
            profiles={profiles.profiles}
            suggestedName={suggestedProfileName}
            flash={profiles.flash}
            status={profiles.status}
            user={profiles.user}
            error={profiles.error}
            onSignIn={profiles.signIn}
            onSignOut={profiles.signOut}
            onSave={name => profiles.saveProfile(name, profileQuery())}
            onRecall={recallProfile}
            onDelete={profiles.deleteProfile}
            onCopyLink={profile => copyQuery(profile.query)}
          />
          <AppMenu variant="masthead" {...menuProps} />
        </div>
      </div>

      {/* Acts on the whole board, so it sits above the sections rather than
          inside any one of them — and stays reachable with Presets folded. */}
      <LookBar
        comparing={comparing}
        onStartCompare={startCompare}
        onEndCompare={endCompare}
        onSurprise={mix.surprise}
        onMutate={mix.mutateLook}
        onSurpriseOne={mix.surpriseOne}
        onSpike={mix.spikeLook}
        onCross={mix.crossLook}
        // Whether the two audio followers are worth rolling: with nothing on
        // the wire they are slots that will never move, which is the one way a
        // roll can look like it did nothing. App is where that is known — the
        // picker owns it, and the bay cannot see it.
        onRollMotion={amount =>
          mix.rollMotion(amount, { audioLive: audio.active })
        }
        morphSeconds={morphSeconds}
        onSetMorph={s => setMorphStored(String(s))}
        morphStore={morphStore}
        onStopMorph={stopMorph}
        tags={
          <TagsPopover
            tags={labels.tags}
            vocabulary={labels.vocabulary}
            onToggle={labels.toggle}
            onOpen={labels.reset}
            onRate={labels.rate}
            readLook={readLook}
            saved={labels.saved}
            pending={labels.pending}
            status={profiles.status}
            error={profiles.error}
            onSignIn={profiles.signIn}
          />
        }
        onReset={mix.reset}
        canUndo={mix.canUndo}
        onUndo={mix.undo}
        canRedo={mix.canRedo}
        onRedo={mix.redo}
      />

      {/* The front door goes first: a look is one click, and everything below
          is for adjusting the look you picked. Input is a set-once control and
          reads fine in second place.

          Both drop out under a live filter, for the same reason Modulation
          below already does: neither holds a control the query can
          match, and the panel below the box is meant to be the result set. They
          are the two largest things in it — the catalog alone is 180px of chips
          and caption — and with them up the first row that actually matched
          landed halfway down the panel. */}
      {filtering ? null : (
        <PresetsSection
          controls={controls}
          lastPreset={mix.lastPreset}
          weights={mix.weights}
          onApplyPreset={mix.applyPreset}
          onMixStart={mix.startMix}
          onMix={mix.setPresetWeight}
        />
      )}

      {/* Directly under the chips, because it is the answer to them: click a
          preset and the controls it moved are right there to drag, rather than
          five folds down the chain map. Unlike them it stays under a filter:
          its rows are real control rows, so the query narrows them like any
          other result. */}
      <div ref={lookRef} className={styles.lookAnchor}>
        <LookSection
          sliders={edited}
          openStages={openStages}
          onOpenGroup={nav.openAt}
        />
      </div>

      {/* The three source pickers used to be a section here, under "This look"
          and above the map — which drew a box for each of the same three
          sources. They head their own stages now (see `stageTop`), so the box
          that carries the name is the one that opens the picker.

          Their hidden <input type=file>s stay out here, outside every fold. All
          three are fired programmatically — picking 'file' calls .click() on the
          ref — and a stage folded away has unmounted its subtree, which would
          leave the ref null and the choice silently doing nothing. A and B's
          were already parked outside the old section for exactly this; the
          sound's used to sit inside AudioInput, which was safe only because
          nothing could reach its picker while it was folded. */}
      <HiddenFilePicker
        inputRef={eng.fileInputRef}
        accept="video/*,image/*"
        onFile={eng.a.onFile}
      />
      <HiddenFilePicker
        inputRef={eng.fileInputBRef}
        accept="video/*,image/*"
        onFile={eng.b.onFile}
      />
      <HiddenFilePicker
        inputRef={audio.fileInputRef}
        accept="audio/*,video/*"
        onFile={audio.onFile}
      />

      {/* Pinned controls, gathered from wherever they live in the chain into one
          spot near the front door. Shown only once something is starred, so it
          costs nothing until used; ordered by the signal path, not pin order, so
          the set stays stable as pins come and go. */}
      {pinned.length === 0 ? null : (
        <Section title="Favorites" defaultOpen openOnFilter>
          <Rack sliders={pinned}>
            <ControlRows sliders={pinned} />
          </Rack>
        </Section>
      )}

      {/* The deck used to be a section here, immediately above the map: the
          other index into the same controls, folded shut by default, which put
          the performance surface behind a fold in the one part of the panel a
          performance never scrolls to. It is a box on the map now, beside the
          modulation bay on the row of things nothing is wired to — see
          DECK_STAGE for why those two belong together. */}

      {/* The signal-path map is the panel's trunk, so it sits high — right under
          the source and preset front door — and the filter that acts on it heads
          it. MIDI is an occasional tool and drops below it. The audio routings
          used to be down there with it, in a section of their own, because the
          map had no vocabulary for a second thing joining the trunk — they are
          the Sound branch now, under the receiver they feed, and modulation is
          a box on the same map for the same kind of reason. */}
      {/* Outside the filter gate, unlike the modulation bay it belongs to:
          while a query is live everything below the box is the result set, and
          this fader is a live-set control (it has a MIDI bind of its own) that
          has to stay reachable from anywhere. It stays here for that reason and
          not because it deserves the position — it is a trim on a feature most
          sessions never open, so it now draws itself as a row rather than as
          the green card that outranked the whole spine below it. */}
      <MotionStrip moving={query.moving} onToggleMoving={toggleMoving} />
      <SignalPath
        nodes={chain.nodes}
        branches={chain.branches}
        loops={chain.loops}
        open={nav.openPhase}
        expandAll={filtering}
        bench={bench}
        onShowDiagram={() => setShowDiagram(true)}
        live={loopsLive}
        // On the bench nothing is folded, so the map marks a stage and scrolls
        // to it rather than unfolding one and closing another.
        onOpen={bench ? nav.jumpPhase : nav.togglePhase}
        openGroup={nav.openGroup}
        onOpenGroup={nav.toggleGroup}
        stageTop={stageTop}
      />
      {!filtering || anyResult ? null : (
        <div className={ui.hint}>
          {query.moving
            ? query.text === ''
              ? 'nothing is moving — press ∿ on any control row to set it wobbling'
              : `nothing moving matches “${query.text}” — drop the ∿ to search the whole panel`
            : // A query can land on controls that exist and cannot act, which is
              // not the same answer as no match at all: "bass" is seven routings
              // in Sound, and what is missing is the input, not the control.
              // Saying so is the difference between a dead end and one press.
              chain.blocked.length > 0
              ? `“${filter.trim()}” is in ${chain.blocked.join(' and ')}, with nothing patched in — clear the filter and press that box on the map`
              : `nothing matches “${filter.trim()}” — try an artifact: rainbow, ghost, tear`}
        </div>
      )}

      {/* Modulation used to be a section here, between the map and MIDI: on
          screen in every session, folded shut in most of them, and found by
          scrolling past the map rather than by looking at it. It is a box on
          the map now — floating, wired to nothing, because what it is patched
          into is the controls — so it costs the resting panel nothing and is
          where you go looking for something to open. See MOD_STAGE. */}

      {/* MIDI only appears once enabled (from Advanced) — 99% of users never
          wire up a controller, so it stays out of the default panel. */}
      {filtering || midiStatus !== 'ready' ? null : (
        <MidiSection
          armed={armed}
          armedNote={armedNote}
          learn={learn}
          midiBindings={midiBindings}
          midiNotes={midiNotes}
          bpm={bpm}
          onAutoMap={autoMap}
          onLearnSequence={learnSequence}
          onStopLearn={stopLearn}
          onArm={toggleArm}
          onArmNote={toggleArmNote}
          onClearBinding={clearBinding}
          onClearNote={clearNote}
          onClearAll={clearAll}
        />
      )}
    </>
  )
  // The filter and the control API reach the rows through the tree, so a group
  // renders the same whether the panel is docked or in the popout window.
  const panel = (
    <FilterContext value={query}>
      {/* The store the rows read their own value out of, one key each. Separate
          from the verbs below because the two change on opposite schedules: the
          store's identity never changes while an engine lives, and that is what
          lets a write re-render the row it moved and no other. */}
      <ControlStoreContext value={controlStore}>
        <ControlsContext value={controlsApi}>
          {/* Its own context beside the controls one: a slider drag rewrites
              controls every pointer move, and rebuilding the bay's consumers on
              each of those frames would cost more than the bay ever does. */}
          <ModSlotsContext value={modApi}>
            {/* And a third beside those two: dbgView lives on the engine, not in
                Controls, so the View group's tap row needs its own way down to
                eng.tap/eng.changeTap. */}
            <SignalTapContext value={{ tap: eng.tap, onTap: eng.changeTap }}>
              {panelBody}
            </SignalTapContext>
          </ModSlotsContext>
        </ControlsContext>
      </ControlStoreContext>
    </FilterContext>
  )

  return eng.fatal !== null ? (
    <FatalScreen fatal={eng.fatal} />
  ) : (
    <div className={styles.app}>
      {/* The stage and the strip share a column, so the tray sits under the
          picture rather than beside it; the panel is untouched either way. */}
      <div className={styles.left}>
        <Stage
          canvasRef={eng.canvasRef}
          error={eng.error}
          frozen={eng.frozen}
          rebuilding={eng.rebuilding}
          budget={eng.budget}
          lens={lens}
          onLens={setLens}
          boxZoom={boxZoom}
          // Nothing over the picture while the masthead is on screen beside it —
          // one ☰ per window, and in the ordinary layout the panel's is already at
          // the top right of it. Fullscreen and the popout are the two states that
          // take the panel away, and there the picture keeps its own copy (which
          // is the only one that can be dismissed, since it is the only one
          // sitting on top of what you are watching).
          chrome={
            !fullscreen && popout === null ? null : barHidden ? (
              <ShowMenuButton onClick={() => setBarHidden(false)} />
            ) : (
              <AppMenu
                variant="stage"
                {...menuProps}
                onHideBar={() => setBarHidden(true)}
              />
            )
          }
        />
        {/* Not in fullscreen: that state is the picture and nothing else, and a
            shelf of cards over a projector feed is the one place this must not
            appear. */}
        {fullscreen ? null : (
          <StripContext value={strip}>
            {/* The same name the save box offers, for the same reason: the
                preset the controls still match is the best short answer to
                "what is this board", and a row that arrives already called
                "vhs" is a rundown you can read. It is a suggestion — the moment
                someone edits it, it is theirs. */}
            <StripTray
              onCapture={jitter =>
                strip.addRow(profileQuery(), {
                  jitter,
                  // The clip on deck A, which the session string cannot carry:
                  // `writeProfileParams` drops every source mode a URL cannot
                  // name, and a shelf clip is one of them. Without this a row
                  // captured over a clip recorded the look and nothing about
                  // the picture, which is why a rundown could not be a sequence
                  // of clips (docs/EDITOR.md › _A row names its clip_).
                  clip: eng.deckClipA,
                  // A shake row departs from whatever is live rather than
                  // landing on the board it was captured from, so the look's
                  // name would be a lie on it. `derivedLabel` says "shake ·
                  // normal", which is what it does.
                  //
                  // A row carrying a clip is left unnamed too, and for the
                  // reason the name field already gives about staleness: what
                  // identifies it is the picture, `derivedLabel` reads that off
                  // the clip, and a name frozen at capture would go on claiming
                  // a clip the shelf has since renamed. The look's name is the
                  // right answer only for the rundown of look changes over one
                  // source that this used to be the only kind of.
                  name:
                    jitter !== undefined || eng.deckClipA !== null
                      ? ''
                      : lookLabel,
                })
              }
              track={{
                name: audio.track.loaded ? audio.name : '',
                onPick: () => audio.select('file'),
              }}
              record={{
                rolling: auto.rolling,
                seconds: auto.seconds,
                // ● is ▶ with the tape rolling, which is why it starts the walk
                // rather than sitting beside it: the tape stamps from the frame
                // recording began and the offline walk counts from its own zero,
                // so the two agree about what frame 300 is only if they started
                // together. The same one-sentence rule the music already
                // follows, with a third thing on the end of it — the track, the
                // walk and the tape all run while the walk runs.
                start: () => {
                  auto.start()
                  strip.start()
                },
                stop: () => {
                  auto.stop()
                  strip.stop()
                },
                clear: auto.clear,
              }}
              render={{
                progress: render.progress,
                seconds: take.seconds,
                from: take.from,
                start: () => {
                  // **A render is not a performance**, so it takes the walk
                  // away from the tray rather than running beside it. The live
                  // one ticks on rAF off the engine's counter, which a take
                  // rewinds to zero underneath it; leaving it running would be
                  // two walks over one rundown disagreeing about where the
                  // piece is, and stopping it is also what a hand would do.
                  strip.stop()
                  // And the tape with it, for a sharper reason than symmetry: a
                  // recording still rolling would write down the replay's own
                  // writes and hand back a take with everything on it twice.
                  // The tap declines them anyway — a replay goes straight to the
                  // engine — and this is the half of that guard a reader can see.
                  auto.stop()
                  const walk = strip.offlineWalk()
                  const play = auto.replay()
                  render.render(
                    take.seconds,
                    // The rundown's seed, so ⟳ reseed gives a different take of
                    // the same piece and rendering twice without it gives the
                    // same one.
                    strip.strip.seed,
                    // The rundown a frame at a time, and then the tape. An empty
                    // tray hands over a walk that finds nothing to start and the
                    // render is a take of whatever is on the board, which is
                    // what ⎙ meant before there was a rundown to render; an
                    // empty tape is the same, one line down.
                    //
                    // **The walk first, the hand second**, and the order is the
                    // rule rather than a detail: a row puts a look up and a hand
                    // moves a knob on top of it, so replaying them the other way
                    // round would have the row overwrite the gesture that was
                    // made against it. It is also what makes the overlap
                    // harmless where the two do touch the same frame — the
                    // tape's copy is the later word, and it is the word that
                    // was performed.
                    // **The walk's promise is handed back, and dropping it is
                    // the whole of what this line is for.** `offlineWalk`
                    // resolves when the row's source is actually on the deck,
                    // and `renderTake` awaits it before stepping — so a
                    // composition that called it for effect and returned
                    // nothing would silently put the render back to landing
                    // rows whenever their fetch happened to finish. It is
                    // invisible in a rundown of look changes and wrong in every
                    // rundown of clips, which is the half nothing would have
                    // caught until the file came out.
                    frame => {
                      const settled = walk(frame)
                      play(frame)
                      return settled
                    },
                  )
                },
                cancel: render.cancel,
              }}
            />
          </StripContext>
        )}
      </div>
      {fullscreen || popout !== null ? null : (
        <div className={cx(styles.panel, benchOn && styles.panelWide)}>
          {panel}
        </div>
      )}
      {popout === null
        ? null
        : createPortal(
            <div className={styles.appPop}>
              <div className={cx(styles.panel, styles.panelPop)}>{panel}</div>
            </div>,
            popout.document.body,
          )}
      {showAdvanced ? (
        <AdvancedDialog
          renderScale={eng.renderScale}
          onScaleChange={eng.setScale}
          res={eng.res}
          tap={eng.tap}
          onTapChange={eng.changeTap}
          frameLock={controls.frameLock}
          onFrameLockChange={v => writeControl('frameLock', v)}
          midiStatus={midiStatus}
          onEnableMidi={enableMidi}
          onClose={() => setShowAdvanced(false)}
        />
      ) : null}
      {/* None of these five closes itself on a successful pick: committing a
          source is what dismisses the question, from `beginLoad` in useEngine
          (useSourcePrompt.ts says why that is the only place it can go). What
          is left here is Escape and the × — the ways out that pick nothing. */}
      {eng.prompt.slotFor('webcam') === null ? null : (
        <WebcamDialog
          onContinue={() => eng.startWebcam('')}
          onClose={eng.prompt.dismiss}
        />
      )}
      {youTubeSlot === null ? null : (
        <YouTubeDialog
          slot={youTubeSlot.key}
          onSubmit={(url, secs) =>
            youTubeSlot.loadYouTube(url, secs, () => clips.fetched(url, secs))
          }
          onClose={eng.prompt.dismiss}
        />
      )}
      {libraryFor === null ? null : (
        <ClipLibraryDialog
          slot={libraryFor}
          lib={clips.lib}
          access={clips.access}
          note={clips.note}
          canRemember={clips.canRemember}
          filesRef={clips.filesRef}
          folderRef={clips.folderRef}
          onAddFiles={clips.addFiles}
          onAddFolder={clips.addFolder}
          onAdopt={clips.adopt}
          onRescan={clips.rescan}
          onPlay={clips.play}
          // Into the rundown rather than onto a deck. The look it lands with is
          // whatever is on the board now, the same snapshot `+ row` takes —
          // building a rundown of clips is picking the look once and then
          // choosing the pictures, and a row that arrived with a stock board
          // would throw that away.
          //
          // Left off in fullscreen, where the tray is not drawn: a ＋ that
          // silently appends to a list nobody can see is worse than no ＋.
          onAddRow={
            fullscreen
              ? undefined
              : clip => {
                  strip.addRow(profileQuery(), {
                    clip: {
                      id: clip.id,
                      name: clip.name,
                      // Whatever the shelf knows, which is the answer outright
                      // for a clip that has been auditioned or added before.
                      seconds: clip.seconds,
                    },
                  })
                  // And otherwise measure it, which is a header read rather
                  // than a load — the row is already in the tray by the time
                  // this is asked, and gains its length a moment later.
                  //
                  // The row is not what gets patched: `learnClipSeconds` keys
                  // on the shelf id, so pressing ＋ twice on one clip teaches
                  // both rows from one measurement. A clip the shelf cannot
                  // open, and every kept roll, answers 0 and keeps the bar
                  // count — see `useClipLibrary.measure`.
                  if (clip.seconds === 0) {
                    void clips
                      .measure(clip)
                      .then(seconds => strip.learnClipSeconds(clip.id, seconds))
                  }
                }
          }
          onForgetClip={clips.forgetClip}
          onForgetFolder={clips.forgetFolder}
          onClose={eng.prompt.dismiss}
        />
      )}
      {browseFor === null ? null : (
        <MediaBrowserDialog
          slot={browseFor}
          kept={clips.kept}
          onPlay={(ref, slot) => eng.showRef(slot, ref, 'browse')}
          onKeep={clips.keep}
          onClose={eng.prompt.dismiss}
        />
      )}
      {teletypeSlot === null ? null : (
        <TeletypeDialog
          slot={teletypeSlot.key}
          initial={teletypeSlot.teletype}
          onLive={teletypeSlot.retype}
          onSubmit={teletypeSlot.loadTeletype}
          onClose={eng.prompt.dismiss}
        />
      )}
      {showDiagram ? (
        <SignalPathDialog
          controls={controls}
          live={loopsLive}
          bOn={bOn}
          soundOn={soundOn}
          patched={patched}
          mod={bay}
          deck={deck}
          onOpen={nav.openAt}
          onClose={() => setShowDiagram(false)}
        />
      ) : null}
      {showAbout ? <AboutDialog onClose={() => setShowAbout(false)} /> : null}
      {showPalette ? (
        <CommandPalette
          controls={controls}
          actions={palette}
          onApplyPreset={mix.applyPreset}
          onMixStart={mix.startMix}
          onWriteControl={writeControl}
          onRevealControl={revealText}
          onClose={() => setShowPalette(false)}
        />
      ) : null}
    </div>
  )
}

// The engine is a singleton owning a GPUDevice + rAF loop. Fast Refresh won't
// reliably run the mount effect's cleanup on a hot swap (an empty-dep effect
// isn't re-run), so old engines leak and stack up. Destroy the engine
// deterministically before Vite replaces this module; the fresh module then
// builds a new one on remount.
//
// `keepDevice`, because the device is the scarce half and a hot update is not its
// fault. A tab is worth about two devices; without this, three edits to `src/gpu/`
// spent the lot and left a tab the browser would never paint again — which is the
// freeze this whole line of work started from, arriving during development rather
// than in front of a user. The successor engine adopts the device (see the stash
// in gpu/context.ts), so an editing session costs one session, not one per save.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.vf?.destroy({ keepDevice: true })
    window.vf = undefined
  })
}
