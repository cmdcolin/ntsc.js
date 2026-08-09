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
import { commonsCaption } from './sources/commons'
import { AdvancedDialog } from './ui/AdvancedDialog'
import { AppMenu, ShowMenuButton } from './ui/AppMenu'
import { AudioHint, AudioInput } from './ui/AudioInput'
import { ClipLibraryDialog } from './ui/ClipLibraryDialog'
import { ClipPicker } from './ui/ClipPicker'
import { CommandPalette } from './ui/CommandPalette'
import { ControlRows } from './ui/ControlGroup'
import {
  ALL_SLIDERS,
  AUDIO_GROUPS,
  B_GROUPS,
  FEEDBACK_STAGE,
  MIX_STAGE,
  PHASES,
  SOUND_BLURB,
  SOUND_JOIN,
  SOUND_STAGE,
  SOURCE_B_BLURB,
  SOURCE_B_STAGE,
  VIEW_BLURB,
  VIEW_GROUPS,
  VIEW_STAGE,
} from './ui/controls'
import {
  ControlsContext,
  ControlStoreContext,
  NO_CONTROL_STORE,
} from './ui/ControlsContext'
import { cx } from './ui/cx'
import { DeckSection } from './ui/DeckSection'
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
import { parseMorph } from './ui/morph'
import { MotionStrip } from './ui/MotionStrip'
import { matchPreset, presetControls } from './ui/presets'
import { PresetsSection } from './ui/PresetsSection'
import { sameList } from './ui/sameList'
import { SavedProfiles } from './ui/SavedProfiles'
import { profileAtSlot, suggestProfileName } from './ui/savedProfiles'
import { Section } from './ui/Section'
import { SignalPath } from './ui/SignalPath'
import { SignalPathDialog } from './ui/SignalPathDialog'
import { SignalTapContext } from './ui/SignalTapContext'
import { Rack } from './ui/Slider'
import { Stage } from './ui/Stage'
import { usePersistedFlag, usePersistedString } from './ui/storage'
import { TagsPopover } from './ui/TagsPopover'
import { TeletypeDialog } from './ui/TeletypeDialog'
import ui from './ui/ui.module.css'
import { parseSessionParams } from './ui/urlParams'
import { useAudio } from './ui/useAudio'
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
import { useSavedProfiles } from './ui/useSavedProfiles'
import { useScrollAnchor } from './ui/useScrollAnchor'
import { useShortcuts } from './ui/useShortcuts'
import { useTempo } from './ui/useTempo'
import { useUrlState } from './ui/useUrlState'
import { useWikiFavorites } from './ui/useWikiFavorites'
import { WebcamDialog } from './ui/WebcamDialog'
import { WikiFavoritesDialog } from './ui/WikiFavoritesDialog'
import { YouTubeDialog } from './ui/YouTubeDialog'
import { gitSha, versionLabel } from './version'

import type { ControlKey, Controls } from './controls'
import type { GlidePlan } from './signal/glide'
import type { PaletteAction } from './ui/CommandPalette'
import type { Group } from './ui/controls'
import type { ControlsApi, ControlStore } from './ui/ControlsContext'
import type { Cue } from './ui/cue'
import type { WikiSlot } from './ui/InputSection'
import type { Lens } from './ui/lens'
import type { SavedProfile } from './ui/savedProfiles'
import type { BranchNode, PathNode } from './ui/SignalPath'
import type { WikiOnSlot } from './ui/useEngine'
import type { LookContext } from './ui/useLookLabels'

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
  ])
const OPEN_STAGES = [
  [stageSet(false, false), stageSet(false, true)],
  [stageSet(true, false), stageSet(true, true)],
]

// The cue verbs for one slot. Both are already on the row under that slot's seek
// bar and both have a key, and they are in the palette as well for the reason the
// Commons verbs in the same list are: that row lives inside a section which starts
// folded, and these are pressed while looking at the picture rather than at the
// panel.
//
// The name tracks the state, the way the star's does. A press means something
// different depending on what is marked, and a row that read "cue" while the next
// press would close a loop would be lying about what it does.
const cueVerbs = (
  tag: string,
  duration: number,
  cue: Cue | null,
  tap: () => void,
  back: () => void,
): PaletteAction[] => {
  const noClip = duration === 0
  const cueArmed = cue !== null && cue.out === null
  return [
    {
      name: cueArmed
        ? `close the loop on source ${tag}`
        : cue !== null
          ? `re-cue source ${tag}`
          : `cue source ${tag}`,
      blurb: noClip
        ? `nothing with a timeline on source ${tag} — a clip or a file first`
        : cueArmed
          ? 'the stretch since the cue starts repeating at once'
          : cue !== null
            ? 'drop this loop and mark a fresh cue at the playhead'
            : 'mark the playhead — press again to loop from there',
      run: tap,
    },
    {
      name: `back to the cue on source ${tag}`,
      blurb:
        cue === null
          ? `nothing cued on source ${tag} yet`
          : 'jump back and keep playing — stab it in time for a stutter',
      run: back,
    },
  ]
}

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
    sourceBOn: eng.sourceBMode !== 'none',
    mod: modApi,
  })

  // The three bindable things the engine doesn't own. Registered from an effect
  // rather than passed into useMidi, which is built before any of them
  // exists — useMix needs the write path that hook owns. No dep array: all
  // close over this render's state, and re-registering is one assignment.
  useEffect(() => {
    setSinks({
      setMotion: modApi.setMaster,
      setPresetWeight: mix.midiPresetWeight,
      // Any note fires the bay's one-shots, at the velocity it was struck with.
      // The bay is React's, so this is the only route a note has to it.
      fire: v => {
        modApi.fire(undefined, v)
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
  const capture = useCapture(eng.canvasRef, lookName ?? 'edit')

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
    eng.askLibrary !== null ||
      eng.sourceMode === 'library' ||
      eng.sourceBMode === 'library',
    eng.loadClip,
  )

  // The starred Commons rolls, on the same footing as the shelf: a list the
  // engine has no stake in beyond the pick that comes back off it.
  const wiki = useWikiFavorites()

  // The ★ and the credit link under a source picker, for whichever slot has a
  // Commons pick on it. Assembled here because it takes one fact from the engine
  // (what is on the slot) and one from the favourites list (whether that title is
  // starred), and neither hook can see the other.
  // Which pick the palette's two Commons rows act on: A's if it has one, else
  // B's, the same precedence `rollAgain` uses — A is the picture.
  const wikiPick = eng.wikiA ?? eng.wikiB
  const wikiStarred = wikiPick !== null && wiki.starred(wikiPick.pick.title)

  const wikiCaption = (on: WikiOnSlot | null): WikiSlot =>
    on === null
      ? null
      : {
          page: on.pick.page,
          starred: wiki.starred(on.pick.title),
          onStar: () => wiki.star(on.pick, on.channel),
        }

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
    cueA: eng.cueA,
    cueB: eng.cueB,
  })

  // The saved-profile library, which is the query string above kept under a name.
  // Recall snapshots for undo, lands the controls, re-cables the bay — and stops
  // there: the query carries the source urls so a copied *link* opens on the
  // right clip, but yanking the live input out from under a running session to
  // put a still back is not what "bring that look back" means. A look whose
  // stored mod is missing (hand-edited storage; no saved look this app wrote
  // lacks one) leaves the bay alone rather than silencing it, the same rule a
  // link without ?mod= follows.
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
    provenance:
      mix.lastPreset !== null
        ? 'preset'
        : mix.weights.size > 0
          ? 'surprise'
          : 'hand',
    source: eng.sourceMode,
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
    onEscape: () => {
      const mode =
        filter !== '' || searchOpen || armed !== null || learn !== null
      setFilter('')
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
    onTapCue: slot => (slot === 'a' ? eng.tapCueA() : eng.tapCueB()),
    onRetrigger: slot => (slot === 'a' ? eng.retriggerA() : eng.retriggerB()),
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
  }

  // The picker owns where sound comes from, including the clips' own tracks —
  // which the engine is the one that can route, so it hands the switch over.
  const audio = useAudio(engine, eng.setVideoAudio)

  // Everything the palette can run that isn't a preset or a control. Hold-to-
  // compare is deliberately absent: it's a gesture, not a command.
  const paletteActions: PaletteAction[] = [
    // Named as the bar names them, with the words they used to carry kept in
    // the blurbs: the palette matches on both, so anyone who learnt "surprise"
    // or "mutate" still types it and still lands on the right row.
    {
      name: 'random look',
      blurb: 'a surprise — stack a few random presets',
      run: mix.surprise,
    },
    {
      name: 'random nudge',
      blurb: 'mutate: jitter every control around the current look',
      run: () => mix.mutateLook('normal'),
    },
    {
      name: 'random nudge, gentle',
      blurb:
        'a small mutation, for creeping around a look that is nearly right',
      run: () => mix.mutateLook('gentle'),
    },
    {
      name: 'random nudge, wild',
      blurb: 'a big mutation, for getting out of a corner',
      run: () => mix.mutateLook('wild'),
    },
    // The heavy one. It has always been on the button under ctrl (or cmd), and
    // nothing said so anywhere you could read without hovering — a wreck you
    // can only reach by holding a key you were never told about may as well not
    // ship. Named for what it does rather than for its amount: nobody searches
    // the palette for "turbo".
    {
      name: 'randomize everything, hard',
      blurb:
        'turbo: throw most controls past anything a real set would do — the wreck, not a variation',
      run: () => mix.mutateLook('turbo'),
    },
    {
      // The last of the Vaporwave section: three settings applied at once, which
      // is a command and not a surface. Its parts each went to the thing they
      // belong to — the rate to each deck's own transport, the tail to the audio
      // picker — and a button that only sets all three at their preset values is
      // exactly what the palette is for. It reaches across two hooks, which is
      // why it is assembled here: the engine cannot move the picker's state.
      name: 'vaporwave',
      blurb: 'slow both clips, dial in the tail, and let their sound drive it',
      run: () => {
        eng.applyVaporwave()
        audio.select('video')
      },
    },
    // The two verbs a Commons channel needs from the keys rather than from the
    // sidebar. Both are in the caption row already, and the caption row is inside
    // a section that starts folded and is 141px of the panel when it is not —
    // which is exactly the wrong place for the one control in this app you press
    // repeatedly while looking at the picture rather than at the panel.
    {
      name: 'roll another Commons file',
      blurb: !eng.wikiRollable
        ? 'pick one of the Commons channels as a source first'
        : wikiPick === null
          ? 'another out of the same pool'
          : `another out of the same pool — ${commonsCaption(wikiPick.pick.title)} is up now`,
      run: eng.rollAgain,
    },
    {
      // Deliberately not gated on there being a pick: a row that vanishes is a
      // row nobody learns is there, and its blurb says what it would do.
      name: wikiStarred ? 'unstar this Commons file' : 'star this Commons file',
      blurb:
        wikiPick === null
          ? 'keeps the Commons roll that is on screen — nothing is up now'
          : wikiStarred
            ? 'drop it from your favorites shelf'
            : 'keep it: the next roll replaces the picture, the star does not',
      run: () => {
        if (wikiPick !== null) wiki.star(wikiPick.pick, wikiPick.channel)
      },
    },
    ...cueVerbs('A', eng.durationA, eng.cueA, eng.tapCueA, eng.retriggerA),
    ...cueVerbs('B', eng.durationB, eng.cueB, eng.tapCueB, eng.retriggerB),
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
  // see. Folded it doesn't grow at all (see LookSection), so what is left for
  // the anchor is the section you unfolded yourself and then scrolled past —
  // a preset applied from the palette, say, while you are eight stages down.
  // The wrapper is a block formatting context (`lookAnchor`, app.module.css):
  // the section's outer margins collapse straight through a bare div, and the
  // anchor would then compensate 9px short of what actually grew.
  const lookRef = useRef<HTMLDivElement>(null)
  useScrollAnchor(lookRef)
  // The contextual groups, dropped when the filter leaves them nothing: a
  // section header over an empty body is a dead end in a result list.
  const bGroups = B_GROUPS.filter(g => groupMatches(g, query, isRouted))
  const audioGroups = AUDIO_GROUPS.filter(g => groupMatches(g, query, isRouted))
  const viewGroups = VIEW_GROUPS.filter(g => groupMatches(g, query, isRouted))

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
  // The sound answers the same question B does, one stage further down: with
  // nothing coming down the wire, every routing in the group is patched to
  // silence. Same treatment, so the map has one answer for "this branch has no
  // input" rather than two.
  //
  // One switch decides this, which is the point of the ♪ picker owning the
  // clips' sound tracks too: while Vaporwave had a "play audio out loud" button
  // of its own, a clip could be driving the receiver with the picker on 'off',
  // and this branch would have called itself dead while it was working.
  const soundOn = audio.active
  // Which of the three returns is actually carrying signal. Read off each
  // loop's own mix rather than the whole group: a loop with its mix at zero is
  // patched but silent, and both drawings are answering "is it running". The
  // same three predicates gate the passes that close them (compose, fbComposite
  // and tapePlay in gpu/pipeline.ts), so a lit run and a dispatched pass mean
  // the same thing.
  const loopsLive = {
    camera: controls.fbMix > 0,
    mixer: controls.cfbMix > 0,
    tape: controls.tapeMix > 0,
  }
  const SOUND_OFF_HINT =
    'no sound reaching it — pick a mic, a track, or the clip’s own audio under Input, and it drives the receiver'
  const unheard = (node: PathNode): PathNode =>
    soundOn ? node : { ...node, touched: 0, off: true, offHint: SOUND_OFF_HINT }
  // The two branches, drawn under the trunk. Unlike a trunk stage each survives
  // having nothing patched into it — a drawn, inert box is the one thing on
  // screen saying that input exists at all — so one is dropped only when a live
  // filter has left it nothing.
  const branches: BranchNode[] = [
    ...(filtering && bGroups.length === 0
      ? []
      : [
          {
            ...unpatched(pathNode(SOURCE_B_STAGE, SOURCE_B_BLURB, bGroups)),
            join: MIX_STAGE,
            under: 'head' as const,
          },
        ]),
    ...(filtering && audioGroups.length === 0
      ? []
      : [
          {
            ...unheard(pathNode(SOUND_STAGE, SOUND_BLURB, audioGroups)),
            join: SOUND_JOIN,
            under: 'join' as const,
          },
        ]),
    // The view, which is the one box on the map that is not the rig. It hangs
    // off Screen rather than joining it — the arrow points out of the chain
    // into it, because the picture is what feeds it. Never `off`: unlike the
    // two inputs there is nothing to patch in, you are always watching.
    ...(viewGroups.length === 0
      ? []
      : [
          {
            ...pathNode(VIEW_STAGE, VIEW_BLURB, viewGroups),
            join: 'Screen',
            under: 'join' as const,
            dir: 'out' as const,
          },
        ]),
  ]
  // Which stages something outside the map can jump to. Not read off pathNodes:
  // a live filter drops stages from the map, and a caption in "This look" is
  // still a way back to the module it came from.
  const openStages = OPEN_STAGES[bOn ? 1 : 0][soundOn ? 1 : 0]

  // Whether the query reached anything at all, across every place a result can
  // land — not the trunk alone. A routed mixer control lives on B's branch and a
  // routed pin lives in Favorites, so keying "nothing matches" off the trunk
  // would deny a result the panel is showing right above the message. Mirrors
  // each section's own render condition rather than restating it.
  const anyResult =
    pathNodes.length > 0 ||
    pinned.length > 0 ||
    edited.some(s => sliderMatches(s, query, isRouted(s.key))) ||
    (soundOn && audioGroups.length > 0) ||
    (bOn && bGroups.length > 0) ||
    // No gate on this one: the view has no input to be missing, so a query that
    // reaches "magnifier" always has a live box to land on.
    viewGroups.length > 0

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
            store={eng.statsStore}
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
          clipPickerA={
            <ClipPicker
              slot="a"
              name={eng.sourceName}
              lib={clips.lib}
              access={clips.access}
              note={clips.note}
              onPlay={clips.play}
              onOpenShelf={() => eng.setAskLibrary('a')}
            />
          }
          clipPickerB={
            <ClipPicker
              slot="b"
              name={eng.sourceBName}
              lib={clips.lib}
              access={clips.access}
              note={clips.note}
              onPlay={clips.play}
              onOpenShelf={() => eng.setAskLibrary('b')}
            />
          }
          timeA={eng.timeA}
          durationA={eng.durationA}
          timeB={eng.timeB}
          durationB={eng.durationB}
          onSeekA={eng.seekA}
          onSeekB={eng.seekB}
          cueA={eng.cueA}
          cueB={eng.cueB}
          onTapCueA={eng.tapCueA}
          onTapCueB={eng.tapCueB}
          onRetriggerA={eng.retriggerA}
          onRetriggerB={eng.retriggerB}
          onClearCueA={eng.clearCueA}
          onClearCueB={eng.clearCueB}
          wrapCostA={eng.wrapCostA}
          wrapCostB={eng.wrapCostB}
          speedA={eng.speedA}
          speedB={eng.speedB}
          onSpeedA={eng.changeSpeedA}
          onSpeedB={eng.changeSpeedB}
          wikiA={wikiCaption(eng.wikiA)}
          wikiB={wikiCaption(eng.wikiB)}
          audioInput={
            <AudioInput
              mode={audio.mode}
              name={audio.name}
              audioState={audio.audioState}
              time={audio.time}
              duration={audio.duration}
              reverb={eng.reverb}
              onReverb={eng.changeReverb}
              fileInputRef={audio.fileInputRef}
              onSelect={audio.select}
              onFile={audio.onFile}
              onSeek={audio.seek}
            />
          }
          audioHint={
            <AudioHint
              mode={audio.mode}
              hasClip={eng.videoA === 'clip' || eng.videoB === 'clip'}
              error={audio.error}
            />
          }
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

      {/* The other index into the same controls: the map below files them by
          where a fault happens in the signal path, the deck by the gesture that
          moves them. It sits immediately above the map because the two are a
          pair, and it is folded by default because most sessions are one person
          dialling a look in rather than performing one.

          Out under a filter, like Modulation: it holds three real
          control rows, but it is a fixed surface rather than a result set, and
          the rows it borrows are reachable in their own stages. */}
      {filtering ? null : <DeckSection />}

      {/* The signal-path map is the panel's trunk, so it sits high — right under
          the source and preset front door — and the filter that acts on it heads
          it. Mod and midi are occasional tools and drop below it. The audio
          routings used to be down there with them, in a section of their own,
          because the map had no vocabulary for a second thing joining the trunk
          — they are the Sound branch now, under the receiver they feed. */}
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
        branches={branches}
        open={nav.openPhase}
        expandAll={filtering}
        bench={bench}
        onShowDiagram={() => setShowDiagram(true)}
        live={loopsLive}
        // On the bench nothing is folded, so the map marks a stage and scrolls
        // to it rather than unfolding one and closing another.
        onOpen={bench ? nav.jumpPhase : nav.togglePhase}
        onOpenLoop={group => nav.openAt(FEEDBACK_STAGE, group)}
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

      {/* An occasional tool holding no filterable control — while a filter is
          live the panel below the box is the result set. */}
      {filtering ? null : <ModSection tempo={tempo} />}

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
      {eng.askLibrary !== null ? (
        <ClipLibraryDialog
          slot={eng.askLibrary}
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
          onForgetClip={clips.forgetClip}
          onForgetFolder={clips.forgetFolder}
          onClose={() => eng.setAskLibrary(null)}
        />
      ) : null}
      {eng.askWiki !== null ? (
        <WikiFavoritesDialog
          slot={eng.askWiki}
          faves={wiki.faves}
          onPlay={(fave, slot) => eng.showFavorite(slot, fave)}
          onForget={wiki.forget}
          onClose={() => eng.setAskWiki(null)}
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
          live={loopsLive}
          bOn={eng.sourceBMode !== 'none'}
          soundOn={soundOn}
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
