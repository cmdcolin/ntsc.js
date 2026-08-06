import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import styles from './app.module.css'
import { DEFAULT_CONTROLS } from './controls'
import { AdvancedDialog } from './ui/AdvancedDialog'
import { AudioHint, AudioInput } from './ui/AudioInput'
import { AudioSection } from './ui/AudioSection'
import { CommandPalette } from './ui/CommandPalette'
import { ControlGroup, ControlSlider } from './ui/ControlGroup'
import { AB_GROUPS, ALL_SLIDERS, AUDIO_GROUPS, PHASES } from './ui/controls'
import { ControlsContext } from './ui/ControlsContext'
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
import { InputSection } from './ui/InputSection'
import { LookBar } from './ui/LookBar'
import { LookSection } from './ui/LookSection'
import { MidiSection } from './ui/MidiSection'
import { ModSection } from './ui/ModSection'
import { slotsToRoutings } from './ui/modSlots'
import { ModSlotsContext } from './ui/ModSlotsContext'
import { MotionStrip } from './ui/MotionStrip'
import { PanelMenu } from './ui/PanelMenu'
import { matchPreset } from './ui/presets'
import { PresetsSection } from './ui/PresetsSection'
import { ScenesSection } from './ui/ScenesSection'
import { Section } from './ui/Section'
import { SignalPath } from './ui/SignalPath'
import { Stage } from './ui/Stage'
import { usePersistedFlag } from './ui/storage'
import { TeletypeDialog } from './ui/TeletypeDialog'
import ui from './ui/ui.module.css'
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
import { useScenes } from './ui/useScenes'
import { useShortcuts } from './ui/useShortcuts'
import { useUrlState } from './ui/useUrlState'
import { VaporwaveSection } from './ui/VaporwaveSection'
import { WebcamDialog } from './ui/WebcamDialog'
import { YouTubeDialog } from './ui/YouTubeDialog'
import { gitSha, versionLabel } from './version'

import type { ControlKey, Controls } from './controls'
import type { PaletteAction } from './ui/CommandPalette'
import type { ControlsApi } from './ui/ControlsContext'
import type { PathNode } from './ui/SignalPath'

// useSyncExternalStore fallbacks for the window before the async engine exists.
const subscribeNever = () => () => {}
const getDefaultControls = (): Controls => DEFAULT_CONTROLS

const toggleFullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
  } else {
    document.documentElement.requestFullscreen().catch(() => {})
  }
}

export function App() {
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
  const { cycleSync, syncLabel, displayValue } = useClockSync({
    controls,
    bpm,
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
  const [showHelp, setShowHelp] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [comparing, setComparing] = useState(false)
  // Off every session, and not persisted: a counter that moves every frame
  // pulls the eye, and you want it only while chasing a stall. Two switches
  // reach it — the × on the readout and the stage menu — so it lives here
  // rather than in either of them.
  const [showFps, setShowFps] = useState(false)
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
  const modApi = useModSlots(engine)
  const mix = useMix({
    controls,
    writeControls,
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
    writeControls,
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

  // Name captures after the active preset (or the last one, edited), so a saved
  // file says what it is. matchPreset falls through to a plain label otherwise.
  const activePreset = matchPreset(controls)
  const captureName = activePreset
    ? activePreset.name
    : (mix.lastPreset ?? 'edit')
  const capture = useCapture(eng.canvasRef, captureName)

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
  })
  usePageLifecycle(engineRef, setFullscreen)

  // Everything a control row needs, in one place, read from context by the rows
  // themselves rather than threaded down through each group.
  const controlsApi: ControlsApi = {
    controls,
    displayValue,
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
    clockLive: bpm !== null,
    syncLabel,
    cycleSync,
    mutateGroup: mix.mutateGroup,
    resetGroup: mix.resetGroup,
  }

  const { copyLink, copied } = useUrlState({
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
  const pinned = ALL_SLIDERS.filter(
    s =>
      favorites.has(s.key) &&
      (!filtering || sliderMatches(s, query, isRouted(s.key))),
  )
  // Everything the current look actually moves, gathered out of the five stages
  // it is scattered across. The same walk the chain map's `• N` does, kept as
  // rows rather than reduced to a count — see LookSection, which does its own
  // filtering because its membership has to be decided before a query narrows
  // it, not after.
  const edited = ALL_SLIDERS.filter(
    s => controls[s.key] !== DEFAULT_CONTROLS[s.key],
  )
  // The contextual groups, dropped when the filter leaves them nothing: a
  // section header over an empty body is a dead end in a result list.
  const abGroups = AB_GROUPS.filter(g => groupMatches(g, query, isRouted))
  const audioGroups = AUDIO_GROUPS.filter(g => groupMatches(g, query, isRouted))

  // Roll the per-group touched state up to the phase, so the chain reads as a
  // status map — you see which stages you're in without opening any. The count
  // is a button: it jumps into the first touched group, which is the path from
  // "this preset looks cool" to the knobs that made it. Data only: the open
  // stage builds its own sections.
  const pathNodes = PHASES.flatMap((phase): PathNode[] => {
    const groups = phase.groups.filter(g => groupMatches(g, query, isRouted))
    // What the stage can do to the picture, group by group — the counts the
    // map colours a stage by, and the jump target behind its count.
    const parts = groups.map(group => ({
      name: group.name,
      touched: group.sliders.filter(
        s => controls[s.key] !== DEFAULT_CONTROLS[s.key],
      ).length,
      onOpen: () => nav.openAt(phase.name, group.name),
    }))
    return groups.length === 0
      ? []
      : [
          {
            name: phase.name,
            blurb: phase.blurb,
            groups,
            touched: parts.reduce((n, p) => n + p.touched, 0),
            onJumpTouched: () => {
              const first = parts.find(p => p.touched > 0)
              if (first !== undefined) first.onOpen()
            },
          },
        ]
  })

  // Whether the query reached anything at all, across every place a result can
  // land — not the spine alone. A routed mixer control lives in A/B and a routed
  // pin lives in Favorites, so keying "nothing matches" off the spine would deny
  // a result the panel is showing right above the message. Mirrors each
  // section's own render condition rather than restating it.
  const anyResult =
    pathNodes.length > 0 ||
    pinned.length > 0 ||
    edited.some(s => sliderMatches(s, query, isRouted(s.key))) ||
    audioGroups.length > 0 ||
    (eng.sourceBMode !== 'none' && abGroups.length > 0)

  const panelBody = (
    <>
      {/* The masthead carries the panel's chrome — the brand, the filter and
          the ⋮ — and while a query is live it carries the filter alone: the
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
          {searching ? null : (
            <button
              className={styles.searchBtn}
              title="filter the controls — artifact words work: rainbow, ghost, tear, roll (⌘K jumps to one by name)"
              aria-label="filter the controls"
              onClick={() => setSearchOpen(true)}
            >
              ⌕
            </button>
          )}
          <PanelMenu
            bench={benchOn}
            canBench={popout !== null || roomy}
            onToggleBench={() => setBenchOn(!benchOn)}
            onPopout={() => openPopout(benchOn)}
            onShowPalette={() => setShowPalette(true)}
            onShowAdvanced={() => setShowAdvanced(true)}
            onShowHelp={() => setShowHelp(true)}
          />
        </div>
      </div>

      {/* Acts on the whole board, so it sits above the sections rather than
          inside any one of them — and stays reachable with Presets folded. */}
      <LookBar
        comparing={comparing}
        onStartCompare={startCompare}
        onEndCompare={endCompare}
        copied={copied}
        onCopyLink={copyLink}
        onSurprise={mix.surprise}
        onMutate={mix.mutateLook}
        canUndo={mix.canUndo}
        onUndo={mix.undo}
        canRedo={mix.canRedo}
        onRedo={mix.redo}
      />

      {/* The front door goes first: a look is one click, and everything below
          is for adjusting the look you picked. Input is a set-once control and
          reads fine in second place. */}
      <PresetsSection
        controls={controls}
        lastPreset={mix.lastPreset}
        weights={mix.weights}
        onApplyPreset={mix.applyPreset}
        onMixStart={mix.startMix}
        onMix={mix.setPresetWeight}
      />

      {/* Directly under the chips, because it is the answer to them: click a
          preset and the controls it moved are right there to drag, rather than
          five folds down the chain map. */}
      {edited.length === 0 ? null : (
        <LookSection sliders={edited} onOpenGroup={nav.openAt} />
      )}

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

      {/* Collapsed by default: source B is on out of the box, and ten mixer
          sliders unfurled here is what used to push the presets off screen. */}
      {eng.sourceBMode === 'none' || abGroups.length === 0 ? null : (
        <Section title="A/B Mix" defaultOpen={false} openOnFilter>
          {abGroups.map((group, i) => (
            <ControlGroup
              key={group.name}
              group={group}
              defaultOpen={i === 0}
            />
          ))}
        </Section>
      )}

      {/* Pinned controls, gathered from wherever they live in the chain into one
          spot near the front door. Shown only once something is starred, so it
          costs nothing until used; ordered by the signal path, not pin order, so
          the set stays stable as pins come and go. */}
      {pinned.length === 0 ? null : (
        <Section title="Favorites" defaultOpen openOnFilter>
          {pinned.map(s => (
            <ControlSlider key={s.key} slider={s} />
          ))}
        </Section>
      )}

      {/* The signal-path map is the panel's trunk, so it sits high — right under
          the source and preset front door — and the filter that acts on it heads
          it. Scenes/mod/audio/midi are occasional tools and drop below it. */}
      {/* Above the filter box, not inside Modulation: while a filter is live
          everything below the box is the result set, and the motion amount is
          a live-set control that has to stay reachable from anywhere. */}
      <MotionStrip onReveal={() => setFilter(MOVING_QUERY)} />
      <SignalPath
        nodes={pathNodes}
        open={nav.openPhase}
        expandAll={filtering}
        bench={bench}
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

          <ModSection />

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
      <ControlsContext value={controlsApi}>
        {/* Its own context beside the controls one: a slider drag rewrites
            controls every pointer move, and rebuilding the bay's consumers on
            each of those frames would cost more than the bay ever does. */}
        <ModSlotsContext value={modApi}>{panelBody}</ModSlotsContext>
      </ControlsContext>
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
        fullscreen={fullscreen}
        poppedOut={popout !== null}
        recording={capture.recording}
        lens={{
          zoom: controls.crtZoom,
          x: controls.crtZoomX,
          y: controls.crtZoomY,
        }}
        tap={eng.tap}
        onTap={eng.changeTap}
        // One write for all three, so a gesture notifies the engine once.
        onLens={lens =>
          writeControls({
            ...controls,
            crtZoom: lens.zoom,
            crtZoomX: lens.x,
            crtZoomY: lens.y,
          })
        }
        onToggleRecord={capture.toggleRecord}
        onGrabStill={capture.grabStill}
        onToggleFullscreen={toggleFullscreen}
        onPopout={() => openPopout(benchOn)}
        showFps={showFps}
        onToggleFps={() => setShowFps(!showFps)}
        onShowHelp={() => setShowHelp(true)}
        onShowAdvanced={() => setShowAdvanced(true)}
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
// isn't re-run), so old devices leak and stack up until Firefox Nightly's
// WebGPU hangs the tab. Destroy the engine deterministically before Vite
// replaces this module; the fresh module then builds a new one on remount.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.vf?.destroy()
    window.vf = undefined
  })
}
