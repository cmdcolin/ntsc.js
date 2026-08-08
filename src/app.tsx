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
import { DEFAULT_CONTROLS, atRest } from './controls'
import { AdvancedDialog } from './ui/AdvancedDialog'
import { AppMenu, ShowMenuButton } from './ui/AppMenu'
import { AudioHint, AudioInput } from './ui/AudioInput'
import { AudioSection } from './ui/AudioSection'
import { CommandPalette } from './ui/CommandPalette'
import { ControlGroup, ControlRows } from './ui/ControlGroup'
import {
  ALL_SLIDERS,
  AUDIO_GROUPS,
  B_GROUPS,
  MIX_STAGE,
  PHASES,
  SOURCE_B_BLURB,
  SOURCE_B_STAGE,
} from './ui/controls'
import {
  ControlsContext,
  ControlStoreContext,
  NO_CONTROL_STORE,
} from './ui/ControlsContext'
import { cx } from './ui/cx'
import { FatalScreen } from './ui/FatalScreen'
import {
  FilterContext,
  MOVING_QUERY,
  groupMatches,
  isMovingQuery,
  sliderMatches,
} from './ui/filter'
import { FpsMonitor } from './ui/FpsMonitor'
import { HelpDialog } from './ui/HelpDialog'
import { CrosshairIcon } from './ui/icons'
import { InputSection } from './ui/InputSection'
import { LookBar } from './ui/LookBar'
import { LookSection } from './ui/LookSection'
import { MidiSection } from './ui/MidiSection'
import { ModSection } from './ui/ModSection'
import { slotsToRoutings } from './ui/modSlots'
import { ModSlotsContext } from './ui/ModSlotsContext'
import { nextMorph, parseMorph } from './ui/morph'
import { MotionStrip } from './ui/MotionStrip'
import { matchPreset, presetControls } from './ui/presets'
import { PresetsSection } from './ui/PresetsSection'
import { sameList } from './ui/sameList'
import { SavedProfiles } from './ui/SavedProfiles'
import { suggestProfileName } from './ui/savedProfiles'
import { ScenesSection } from './ui/ScenesSection'
import { Section } from './ui/Section'
import { SignalPath } from './ui/SignalPath'
import { SignalPathDialog } from './ui/SignalPathDialog'
import { SignalTapContext } from './ui/SignalTapContext'
import { Rack } from './ui/Slider'
import { Stage } from './ui/Stage'
import { usePersistedFlag, usePersistedString } from './ui/storage'
import { TeletypeDialog } from './ui/TeletypeDialog'
import ui from './ui/ui.module.css'
import { parseSessionParams } from './ui/urlParams'
import { useAudio } from './ui/useAudio'
import { useCapture } from './ui/useCapture'
import { useClockSync } from './ui/useClockSync'
import { useEngine } from './ui/useEngine'
import { useFavorites } from './ui/useFavorites'
import { useMediaQuery } from './ui/useMediaQuery'
import { useMidi } from './ui/useMidi'
import { useMix } from './ui/useMix'
import { useModSlots } from './ui/useModSlots'
import { usePageLifecycle } from './ui/usePageLifecycle'
import { usePanelNav } from './ui/usePanelNav'
import { usePopout } from './ui/usePopout'
import { useSavedProfiles } from './ui/useSavedProfiles'
import { useScenes } from './ui/useScenes'
import { useScrollAnchor } from './ui/useScrollAnchor'
import { useShortcuts } from './ui/useShortcuts'
import { useTempo } from './ui/useTempo'
import { useUrlState } from './ui/useUrlState'
import { VaporwaveSection } from './ui/VaporwaveSection'
import { WebcamDialog } from './ui/WebcamDialog'
import { YouTubeDialog } from './ui/YouTubeDialog'
import { gitSha, versionLabel } from './version'

import type { ControlKey, Controls } from './controls'
import type { GlidePlan } from './signal/glide'
import type { PaletteAction } from './ui/CommandPalette'
import type { Group } from './ui/controls'
import type { ControlsApi, ControlStore } from './ui/ControlsContext'
import type { Lens } from './ui/lens'
import type { SavedProfile } from './ui/savedProfiles'
import type { PathNode } from './ui/SignalPath'

// Whether the menu over the picture has been dismissed. Persisted across
// reloads so a collapse sticks — it only ever applies where the masthead is off
// screen (fullscreen, the popout), which is where somebody clearing the picture
// off for a projector is likely to be.
const BAR_HIDDEN_STORE = 'ntsc.js_overlay_bar_hidden'

// useSyncExternalStore fallbacks for the window before the async engine exists.
const subscribeNever = () => () => {}
const getDefaultControls = (): Controls => DEFAULT_CONTROLS

// Which stages are open to a jump, in the only two arrangements there are: with
// a second source patched in, and without. Built once rather than per render
// because it is a prop on "This look" — a fresh Set each render rebuilds every
// row in that section, and the answer only ever changes when source B does.
const TRUNK_STAGES = PHASES.map(p => p.name)
const OPEN_STAGES_B: ReadonlySet<string> = new Set([
  ...TRUNK_STAGES,
  SOURCE_B_STAGE,
])
const OPEN_STAGES_NO_B: ReadonlySet<string> = new Set(
  TRUNK_STAGES.filter(name => name !== MIX_STAGE),
)

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
  // either of them. Declared ahead of the engine because it is also what decides
  // whether the loop's frame stats are wired up at all: reported four times a
  // second, each one a fresh object, they re-render this component (and so the
  // whole panel) at that rate for a readout almost no session ever opens.
  const [showFps, setShowFps] = useState(false)
  const eng = useEngine(showFps)
  // Both pulled off in one destructure, and `engine` is read through the local
  // rather than as `eng.engine` for the rest of the render. Reading a ref out of
  // an object marks the whole object as ref-ish to the React Compiler, so a
  // later `eng.engine` read during render trips "cannot access refs during
  // render" — one error, and the compiler drops *all* memoization for this
  // component, which is the one that builds the entire panel.
  const { engine, engineRef } = eng
  const {
    status: midiStatus,
    bindings: midiBindings,
    armed,
    bpm,
    pickups,
    writeControl,
    writeControls,
    setSinks,
    enable: enableMidi,
    toggleArm,
    disarm,
    autoMap,
    learn,
    learnSequence,
    stopLearn,
    clearBinding,
    clearAll,
  } = useMidi(engineRef)
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
  const { popout, openPopout } = usePopout()
  // The bench: every stage of the chain at once, two columns wide. Persisted,
  // but inert unless there is room for it — the docked panel needs a wide
  // screen, while the popout is the user's own window to size, so there the
  // panel's container query has the last word.
  const [benchOn, setBenchOn] = usePersistedFlag('ntsc.js_panel_bench')
  const roomy = useMediaQuery('(min-width: 1280px)')
  const bench = benchOn && (popout !== null || roomy)
  const [fullscreen, setFullscreen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showDiagram, setShowDiagram] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
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
  // Whether the masthead is showing the filter box rather than the wordmark.
  // Held open by a live query as well as by the ⌕, so the box can't disappear
  // out from under a filter that is still narrowing the panel — which is what
  // a bare `searchOpen` did the moment anything else took focus.
  const [searchOpen, setSearchOpen] = useState(false)
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
  const startGlide = useCallback(
    (plan: GlidePlan) => {
      engineRef.current?.startGlide(plan)
    },
    [engineRef],
  )
  const [morphStored, setMorphStored] = usePersistedString('ntsc.js_morph')
  const morphSeconds = parseMorph(morphStored)
  const mix = useMix({
    controls,
    getControls: controlStore.get,
    writeControls,
    startGlide,
    morphSeconds,
    sourceBOn: eng.sourceBMode !== 'none',
    mod: modApi,
  })

  // The two bindable things the engine doesn't own. Registered from an effect
  // rather than passed into useMidi, which is built before either of them
  // exists — useMix needs the write path that hook owns. No dep array: both
  // close over this render's state, and re-registering is one assignment.
  useEffect(() => {
    setSinks({
      setMotion: modApi.setMaster,
      setPresetWeight: mix.midiPresetWeight,
    })
  })

  const { scenes, saveScene, recallScene, clearScene } = useScenes(
    engineRef,
    mix.landLook,
    mix.snapshotForUndo,
    modApi,
  )

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
  const capture = useCapture(eng.canvasRef, lookName ?? 'edit')

  // `copied` (the flash on the old copy-link button) went with that button; the
  // ⌘K entry below is the only caller left, and a palette row closes on run.
  const { copyLink, profileQuery, copyQuery } = useUrlState({
    controls,
    mod: slotsToRoutings(modApi.slots),
    engineReady: engine !== null,
    sourceMode: eng.sourceMode,
    sourceBMode: eng.sourceBMode,
    ytUrlA: eng.ytUrlA,
    ytUrlB: eng.ytUrlB,
    teletypeA: eng.teletypeA,
    teletypeB: eng.teletypeB,
    speedA: eng.speedA,
    speedB: eng.speedB,
    reverb: eng.reverb,
  })

  // The saved-profile library, which is the query string above kept under a name.
  // Recall is the same move a scene recall makes — snapshot for undo, write the
  // controls, re-cable the bay — and stops there: the query carries the source
  // urls so a copied *link* opens on the right clip, but yanking the live input
  // out from under a running session to put a still back is not what "bring that
  // look back" means. A look whose stored mod is missing (hand-edited storage; no
  // saved look this app wrote lacks one) leaves the bay alone rather than
  // silencing it, the same rule a link without ?mod= follows.
  const profiles = useSavedProfiles()
  const recallProfile = (profile: SavedProfile) => {
    const session = parseSessionParams(`?${profile.query}`)
    mix.snapshotForUndo()
    writeControls(presetControls(session.controls))
    if (session.mod !== null) modApi.setRoutings(session.mod)
    profiles.markRecalled(profile.name)
  }
  // The name to save under, offered by all three ways in. The profile you are
  // working in wins over the preset the controls still match: one knob past a
  // recall they match nothing, and "my look" is a worse offer than "my rig 2".
  const suggestedProfileName = suggestProfileName(
    profiles.profiles,
    profiles.lastName ?? lookName ?? '',
  )

  useShortcuts(popout, {
    // Dialogs close themselves (each Dialog binds Escape to its own document);
    // here Escape just backs out of the panel's own modes.
    onEscape: () => {
      setFilter('')
      setSearchOpen(false)
      disarm()
      stopLearn()
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
    onSaveScene: saveScene,
    onRecallScene: recallScene,
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
  }

  const audio = useAudio(engine)

  // Everything the palette can run that isn't a preset or a control. Hold-to-
  // compare is deliberately absent: it's a gesture, not a command.
  const paletteActions: PaletteAction[] = [
    {
      name: 'surprise me',
      blurb: 'stack a few random presets',
      run: mix.surprise,
    },
    {
      name: 'mutate',
      blurb: 'jitter every control around the current look',
      run: () => mix.mutateLook('normal'),
    },
    {
      name: 'mutate gently',
      blurb: 'a small jitter, for creeping around a look that is nearly right',
      run: () => mix.mutateLook('gentle'),
    },
    {
      name: 'mutate hard',
      blurb: 'a wild jitter, for getting out of a corner',
      run: () => mix.mutateLook('wild'),
    },
    {
      name: 'undo',
      blurb: 'step back through the looks you have been through',
      run: mix.undo,
    },
    {
      name: 'redo',
      blurb: 'step forward again after an undo',
      run: mix.redo,
    },
    {
      // The palette indexes controls by their static definition, so it can no
      // more see a routing than the filter could. This is the one entry that
      // knows, and it answers by handing the question to the filter.
      name: 'show what is moving',
      blurb: 'filter the panel down to the controls the bay is driving',
      run: () => setFilter(MOVING_QUERY),
    },
    {
      name: 'copy link',
      blurb: 'put this look on the clipboard as a URL',
      run: copyLink,
    },
    {
      // The one way in that needs no name typed: it takes the same suggestion
      // the save box offers as a placeholder. A palette row cannot prompt for
      // text, and refusing to save from here over that would be the wrong half
      // of the feature to withhold — the row is for hands already on the keys,
      // and a look saved as "vhs 3" is one × in the menu away from gone if that
      // was not the name you wanted.
      name: 'save this look',
      blurb: profiles.canSave
        ? `keep the board as “${suggestedProfileName}” under saved`
        : 'sign in first — saved looks live on your account',
      run: () => profiles.saveProfile(suggestedProfileName, profileQuery()),
    },
    {
      name: 'record clip',
      blurb: 'start or stop recording the stage',
      run: capture.toggleRecord,
    },
    {
      name: 'save still',
      blurb: 'download the current frame as a png',
      run: capture.grabStill,
    },
    {
      name: 'fullscreen',
      blurb: 'give the picture the whole screen',
      run: toggleFullscreen,
    },
    {
      name: 'wide bench',
      blurb: 'spread the controls over two columns',
      run: () => setBenchOn(!benchOn),
    },
    {
      name: 'pop out controls',
      blurb: 'move this panel into its own window',
      run: () => openPopout(benchOn),
    },
    {
      name: 'signal path',
      blurb:
        'the whole chain as a diagram — both inputs, the mixer, both loops',
      run: () => setShowDiagram(true),
    },
    {
      name: 'advanced settings',
      blurb: 'render scale and MIDI setup',
      run: () => setShowAdvanced(true),
    },
    {
      name: 'help',
      blurb: 'what this is, and the keys',
      run: () => setShowHelp(true),
    },
  ]

  const query = filter.trim().toLowerCase()
  const filtering = query !== ''
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
  // see. The wrapper it hangs off is always in the tree — the section itself
  // comes and goes with the first edit, and an element that mounts at its full
  // height has no growth to observe.
  const lookRef = useRef<HTMLDivElement>(null)
  useScrollAnchor(lookRef)
  // The contextual groups, dropped when the filter leaves them nothing: a
  // section header over an empty body is a dead end in a result list.
  const bGroups = B_GROUPS.filter(g => groupMatches(g, query, isRouted))
  const audioGroups = AUDIO_GROUPS.filter(g => groupMatches(g, query, isRouted))

  // Roll the per-group touched state up to the stage, so the chain reads as a
  // status map — you see which stages you're in without opening any. The count
  // is a button: it jumps into the first touched group, which is the path from
  // "this preset looks cool" to the knobs that made it. Data only: the open
  // stage builds its own sections.
  const pathNode = (name: string, blurb: string, groups: Group[]): PathNode => {
    // What the stage can do to the picture, group by group — the counts the
    // map colours a stage by, and the jump target behind its count.
    const parts = groups.map(group => ({
      touched: group.sliders.filter(s => !atRest(controls[s.key], s.key))
        .length,
      onOpen: () => nav.openAt(name, group.name),
    }))
    return {
      name,
      blurb,
      groups,
      touched: parts.reduce((n, p) => n + p.touched, 0),
      onJumpTouched: () => {
        const first = parts.find(p => p.touched > 0)
        if (first !== undefined) first.onOpen()
      },
    }
  }
  // Nothing patched into B leaves two stages with nothing to act on: B itself,
  // and the mixer beside it, whose every control needs a second signal. Both
  // are still drawn — together they are the one thing on screen saying a second
  // input exists — but neither opens, and neither wears the amber that says
  // "you changed something in here": nothing in them is reaching the picture.
  const bOn = eng.sourceBMode !== 'none'
  const B_OFF_HINT = 'no source B — pick one in Input to mix a second signal in'
  const unpatched = (node: PathNode): PathNode =>
    bOn ? node : { ...node, touched: 0, off: true, offHint: B_OFF_HINT }
  const pathNodes = PHASES.flatMap((phase): PathNode[] => {
    const groups = phase.groups.filter(g => groupMatches(g, query, isRouted))
    const node = pathNode(phase.name, phase.blurb, groups)
    return groups.length === 0
      ? []
      : [phase.name === MIX_STAGE ? unpatched(node) : node]
  })
  // Input B, drawn under the head of the trunk. Unlike a trunk stage it
  // survives having nothing patched into it, so it is dropped only when a live
  // filter has left it nothing.
  const branch: PathNode | null =
    filtering && bGroups.length === 0
      ? null
      : unpatched(pathNode(SOURCE_B_STAGE, SOURCE_B_BLURB, bGroups))
  // Which stages something outside the map can jump to. Not read off pathNodes:
  // a live filter drops stages from the map, and a caption in "This look" is
  // still a way back to the module it came from.
  const openStages = bOn ? OPEN_STAGES_B : OPEN_STAGES_NO_B

  // Whether the query reached anything at all, across every place a result can
  // land — not the trunk alone. A routed mixer control lives on B's branch and a
  // routed pin lives in Favorites, so keying "nothing matches" off the trunk
  // would deny a result the panel is showing right above the message. Mirrors
  // each section's own render condition rather than restating it.
  const anyResult =
    pathNodes.length > 0 ||
    pinned.length > 0 ||
    edited.some(s => sliderMatches(s, query, isRouted(s.key))) ||
    audioGroups.length > 0 ||
    (bOn && bGroups.length > 0)

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
    onToggleBench: () => setBenchOn(!benchOn),
    onPopout: () => openPopout(benchOn),
    showFps,
    onToggleFps: () => setShowFps(!showFps),
    onShowPalette: () => setShowPalette(true),
    onShowAdvanced: () => setShowAdvanced(true),
    onShowHelp: () => setShowHelp(true),
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
            onClick={() => setShowHelp(true)}
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
            stats={eng.stats}
            res={eng.res}
            onHide={() => setShowFps(false)}
          />
        ) : null}
        {searching ? (
          <div className={styles.filterBox}>
            <input
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
              title="matches names and descriptions, so artifact words work: rainbow, ghost, dot crawl, tear, roll… — and “moving” (or ∿) for whatever the bay is driving"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <button
              className={styles.filterClear}
              title="clear the filter (esc)"
              aria-label="clear the filter"
              onClick={() => {
                setFilter('')
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
              title="filter the controls — artifact words work: rainbow, ghost, tear, roll (⌘K jumps to one by name)"
              aria-label="filter the controls"
              onClick={() => setSearchOpen(true)}
            >
              ⌕
            </button>
          )}
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
        morphSeconds={morphSeconds}
        onCycleMorph={() => setMorphStored(String(nextMorph(morphSeconds)))}
        saved={
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
        }
        canUndo={mix.canUndo}
        onUndo={mix.undo}
        canRedo={mix.canRedo}
        onRedo={mix.redo}
      />

      {/* The front door goes first: a look is one click, and everything below
          is for adjusting the look you picked. Input is a set-once control and
          reads fine in second place.

          Both drop out under a live filter, for the same reason Scenes and
          Modulation below already do: neither holds a control the query can
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
      <div ref={lookRef}>
        {edited.length === 0 ? null : (
          <LookSection
            sliders={edited}
            openStages={openStages}
            onOpenGroup={nav.openAt}
          />
        )}
      </div>

      {filtering ? null : (
        <InputSection
          sourceMode={eng.sourceMode}
          sourceName={eng.sourceName}
          onSelectSource={eng.selectSource}
          sourceBMode={eng.sourceBMode}
          sourceBName={eng.sourceBName}
          onSelectSourceB={eng.selectSourceB}
          teletypeA={eng.teletypeA}
          teletypeB={eng.teletypeB}
          onTeletypeA={text => eng.retypeTeletype({ text })}
          onTeletypeB={text => eng.retypeTeletypeB({ text })}
          webcamDeviceId={eng.webcamDeviceId}
          videoDevices={eng.videoDevices}
          onStartWebcam={eng.startWebcam}
          fileInputRef={eng.fileInputRef}
          fileInputBRef={eng.fileInputBRef}
          onFile={eng.onFile}
          onFileB={eng.onFileB}
          pendingFileA={eng.pendingFileA}
          pendingFileB={eng.pendingFileB}
          onReopenFileA={() => eng.reopenFileA()}
          onReopenFileB={() => eng.reopenFileB()}
          timeA={eng.timeA}
          durationA={eng.durationA}
          timeB={eng.timeB}
          durationB={eng.durationB}
          onSeekA={eng.seekA}
          onSeekB={eng.seekB}
          audioInput={
            <AudioInput
              mode={audio.mode}
              name={audio.name}
              audioState={audio.audioState}
              time={audio.time}
              duration={audio.duration}
              fileInputRef={audio.fileInputRef}
              onSelect={audio.select}
              onFile={audio.onFile}
              onSeek={audio.seek}
            />
          }
          audioHint={<AudioHint mode={audio.mode} error={audio.error} />}
        />
      )}

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

      {/* The signal-path map is the panel's trunk, so it sits high — right under
          the source and preset front door — and the filter that acts on it heads
          it. Scenes/mod/audio/midi are occasional tools and drop below it. */}
      {/* Outside the filter gate, unlike the Modulation section it belongs to:
          while a query is live everything below the box is the result set, and
          this fader is a live-set control (it has a MIDI bind of its own) that
          has to stay reachable from anywhere. It stays here for that reason and
          not because it deserves the position — it is a trim on a feature most
          sessions never open, so it now draws itself as a row rather than as
          the green card that outranked the whole spine below it. */}
      <MotionStrip onReveal={() => setFilter(MOVING_QUERY)} />
      <SignalPath
        nodes={pathNodes}
        branch={branch}
        open={nav.openPhase}
        expandAll={filtering}
        bench={bench}
        onShowDiagram={() => setShowDiagram(true)}
        // Which of the two returns is actually carrying signal. Read off the
        // two loop mixes rather than the whole group: a loop with its mix at
        // zero is patched but silent, and the map is answering "is it running".
        live={{ camera: controls.fbMix > 0, mixer: controls.cfbMix > 0 }}
        // On the bench nothing is folded, so the map marks a stage and scrolls
        // to it rather than unfolding one and closing another.
        onOpen={bench ? nav.jumpPhase : nav.togglePhase}
        openGroup={nav.openGroup}
        onOpenGroup={nav.toggleGroup}
      />
      {!filtering || anyResult ? null : (
        <div className={ui.hint}>
          {isMovingQuery(query)
            ? 'nothing is moving — press ∿ on any control row to set it wobbling'
            : `nothing matches “${filter.trim()}” — try an artifact: rainbow, ghost, tear`}
        </div>
      )}

      {/* Occasional tools, none of them holding a filterable control — while a
          filter is live the panel below the box is the result set. */}
      {filtering ? null : (
        <>
          <ScenesSection
            controls={controls}
            scenes={scenes}
            onSave={saveScene}
            onRecall={recallScene}
            onClear={clearScene}
          />

          <ModSection tempo={tempo} />

          {/* Only for a clip, not for any live <video>: everything this
              section offers — the rate, the pitch that falls with it, the audio
              it routes out — belongs to a source with a timeline and a sound
              track. A webcam or a screen share has neither, so the whole
              section was a set of controls that could not move. */}
          {eng.videoA === 'clip' || eng.videoB === 'clip' ? (
            <VaporwaveSection
              videoA={eng.videoA}
              videoB={eng.videoB}
              speedA={eng.speedA}
              speedB={eng.speedB}
              reverb={eng.reverb}
              playAudio={eng.playAudio}
              audioState={engine === null ? null : engine.audioState}
              onSpeedA={eng.changeSpeedA}
              onSpeedB={eng.changeSpeedB}
              onReverb={eng.changeReverb}
              onTogglePlayAudio={eng.toggleAudio}
              onApplyPreset={eng.applyVaporwave}
            />
          ) : null}
        </>
      )}

      {audioGroups.length === 0 ? null : (
        <AudioSection active={audio.active}>
          {audioGroups.map(group => (
            <ControlGroup key={group.name} group={group} defaultOpen />
          ))}
        </AudioSection>
      )}

      {/* MIDI only appears once enabled (from Advanced) — 99% of users never
          wire up a controller, so it stays out of the default panel. */}
      {filtering || midiStatus !== 'ready' ? null : (
        <MidiSection
          armed={armed}
          learn={learn}
          midiBindings={midiBindings}
          bpm={bpm}
          onAutoMap={autoMap}
          onLearnSequence={learnSequence}
          onStopLearn={stopLearn}
          onArm={toggleArm}
          onClearBinding={clearBinding}
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
      {fullscreen || popout !== null ? null : (
        <div className={cx(styles.panel, benchOn && styles.panelWide)}>
          {panel}
        </div>
      )}
      {popout === null
        ? null
        : createPortal(
            <div className={styles.app}>
              <div
                className={cx(
                  styles.panel,
                  styles.panelPop,
                  benchOn && styles.panelPopWide,
                )}
              >
                {panel}
              </div>
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
      {eng.askWebcam ? (
        <WebcamDialog
          onContinue={() => eng.startWebcam('')}
          onClose={() => eng.setAskWebcam(false)}
        />
      ) : null}
      {eng.askYouTube !== null ? (
        <YouTubeDialog
          slot={eng.askYouTube}
          onSubmit={url => {
            if (eng.askYouTube === 'b') eng.loadYouTubeB(url)
            else eng.loadYouTube(url)
            eng.setAskYouTube(null)
          }}
          onClose={() => eng.setAskYouTube(null)}
        />
      ) : null}
      {eng.askTeletype !== null ? (
        <TeletypeDialog
          slot={eng.askTeletype}
          initial={eng.askTeletype === 'b' ? eng.teletypeB : eng.teletypeA}
          onLive={card => {
            if (eng.askTeletype === 'b') eng.retypeTeletypeB(card)
            else eng.retypeTeletype(card)
          }}
          onSubmit={card => {
            if (eng.askTeletype === 'b') eng.loadTeletypeB(card)
            else eng.loadTeletype(card)
            eng.setAskTeletype(null)
          }}
          onClose={() => eng.setAskTeletype(null)}
        />
      ) : null}
      {showDiagram ? (
        <SignalPathDialog
          controls={controls}
          live={{ camera: controls.fbMix > 0, mixer: controls.cfbMix > 0 }}
          bOn={eng.sourceBMode !== 'none'}
          onOpen={nav.openAt}
          onClose={() => setShowDiagram(false)}
        />
      ) : null}
      {showHelp ? <HelpDialog onClose={() => setShowHelp(false)} /> : null}
      {showPalette ? (
        <CommandPalette
          controls={controls}
          actions={paletteActions}
          onApplyPreset={mix.applyPreset}
          onMixStart={mix.startMix}
          onWriteControl={writeControl}
          onRevealControl={setFilter}
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
