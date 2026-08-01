import { useState, useSyncExternalStore } from 'react'

import { createPortal } from 'react-dom'

import markUrl from '../docs/mark.svg'
import styles from './app.module.css'
import { DEFAULT_CONTROLS } from './controls'
import { AdvancedDialog } from './ui/AdvancedDialog'
import { AudioHint, AudioInput } from './ui/AudioInput'
import { AudioSection } from './ui/AudioSection'
import { ChainDialog } from './ui/ChainDialog'
import { CommandPalette } from './ui/CommandPalette'
import { ControlGroup, ControlSlider } from './ui/ControlGroup'
import { ControlsContext } from './ui/ControlsContext'
import { FatalScreen } from './ui/FatalScreen'
import { HelpDialog } from './ui/HelpDialog'
import { InputSection } from './ui/InputSection'
import { MidiSection } from './ui/MidiSection'
import { ModSection } from './ui/ModSection'
import { PresetsSection } from './ui/PresetsSection'
import { ScenesSection } from './ui/ScenesSection'
import { Section } from './ui/Section'
import { SignalPath } from './ui/SignalPath'
import { Stage } from './ui/Stage'
import { VaporwaveSection } from './ui/VaporwaveSection'
import { WebcamDialog } from './ui/WebcamDialog'
import { YouTubeDialog } from './ui/YouTubeDialog'
import { AB_GROUPS, ALL_SLIDERS, AUDIO_GROUPS, PHASES } from './ui/controls'
import { cx } from './ui/cx'
import { FilterContext, groupMatches, sliderMatches } from './ui/filter'
import { matchPreset } from './ui/presets'
import { useAudio } from './ui/useAudio'
import { useCapture } from './ui/useCapture'
import { useClockSync } from './ui/useClockSync'
import { useEngine } from './ui/useEngine'
import { useFavorites } from './ui/useFavorites'
import { useMidi } from './ui/useMidi'
import { useMix } from './ui/useMix'
import { usePageLifecycle } from './ui/usePageLifecycle'
import { usePanelNav } from './ui/usePanelNav'
import { usePopout } from './ui/usePopout'
import { useScenes } from './ui/useScenes'
import { useShortcuts } from './ui/useShortcuts'
import { useUrlState } from './ui/useUrlState'
import { gitSha, versionLabel } from './version'

import type { Controls } from './controls'
import type { PaletteAction } from './ui/CommandPalette'
import type { PathNode } from './ui/SignalPath'
import type { ControlsApi } from './ui/ControlsContext'

// useSyncExternalStore fallbacks for the window before the async engine exists.
const subscribeNever = () => () => {}
const getDefaultControls = (): Controls => DEFAULT_CONTROLS

export function App() {
  const eng = useEngine()
  const engineRef = eng.engineRef
  const {
    status: midiStatus,
    bindings: midiBindings,
    armedKey,
    bpm,
    writeControl,
    writeControls,
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
    eng.engine === null ? subscribeNever : eng.engine.subscribeControls,
    eng.engine === null ? getDefaultControls : eng.engine.getControls,
  )
  const { cycleSync, syncLabel, displayValue } = useClockSync({
    controls,
    bpm,
    writeControl,
  })
  const { popout, openPopout } = usePopout()
  const [fullscreen, setFullscreen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  // The chain diagram is reachable from the panel and from the stage menu, so
  // its open state sits here rather than inside either one.
  const [showChain, setShowChain] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [filter, setFilter] = useState('')
  const nav = usePanelNav()
  const { favorites, toggleFavorite } = useFavorites()
  const mix = useMix({
    controls,
    writeControls,
    sourceBOn: eng.sourceBMode !== 'none',
  })

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  const { scenes, saveScene, recallScene, clearScene } = useScenes(
    engineRef,
    writeControls,
    mix.snapshotForUndo,
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
      disarm()
      stopLearn()
    },
    onPalette: () => setShowPalette(true),
    onUndo: mix.undo,
    canUndo: mix.canUndo,
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
    bindLabel: key => {
      const b = midiBindings[key]
      return b === undefined ? null : String(b.controller)
    },
    armedKey,
    toggleArm,
    clockLive: bpm !== null,
    syncLabel,
    cycleSync,
  }

  const { copyLink, copied } = useUrlState({
    controls,
    engineReady: eng.engine !== null,
    sourceMode: eng.sourceMode,
    sourceBMode: eng.sourceBMode,
    ytUrlA: eng.ytUrlA,
    ytUrlB: eng.ytUrlB,
    speedA: eng.speedA,
    speedB: eng.speedB,
    reverb: eng.reverb,
  })

  const audio = useAudio(eng.engine)

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
      run: mix.mutateLook,
    },
    {
      name: 'undo',
      blurb: 'restore the look from before the last preset, scene, or mutate',
      run: mix.undo,
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
      name: 'pop out controls',
      blurb: 'move this panel into its own window',
      run: openPopout,
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
  const pinned = ALL_SLIDERS.filter(
    s => favorites.has(s.key) && (!filtering || sliderMatches(s, query)),
  )
  // The contextual groups, dropped when the filter leaves them nothing: a
  // section header over an empty body is a dead end in a result list.
  const abGroups = AB_GROUPS.filter(g => groupMatches(g, query))
  const audioGroups = AUDIO_GROUPS.filter(g => groupMatches(g, query))

  // Roll the per-group touched state up to the phase, so the chain reads as a
  // status map — you see which stages you're in without opening any. The count
  // is a button: it jumps into the first touched group, which is the path from
  // "this preset looks cool" to the knobs that made it. Data only: the open
  // stage builds its own sections.
  const pathNodes = PHASES.flatMap((phase): PathNode[] => {
    const groups = phase.groups.filter(g => groupMatches(g, query))
    // What the stage can do to the picture, group by group — the diagram lists
    // these under the stage's box, and each one opens there.
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
            parts,
            groups,
            touched: parts.reduce((n, p) => n + p.touched, 0),
            onJumpTouched: () => {
              const first = parts.find(p => p.touched > 0)
              if (first !== undefined) first.onOpen()
            },
          },
        ]
  })

  const panelBody = (
    <>
      <div className={styles.titleRow}>
        <button
          className={styles.brand}
          onClick={() => setShowHelp(true)}
          title={`ntscythe ${versionLabel} (${gitSha}) — what is this?`}
          aria-label="ntscythe — what is this?"
        >
          <img className={styles.brandMark} src={markUrl} alt="" />
          <span className={styles.wordmark}>ntscythe</span>
          <span className={styles.version}>{versionLabel}</span>
        </button>
        <a
          className={styles.link}
          href="https://github.com/cmdcolin/ntscythe"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
      </div>

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
        comparing={comparing}
        onStartCompare={startCompare}
        onEndCompare={endCompare}
        onCopyLink={copyLink}
        copied={copied}
        onMutate={mix.mutateLook}
        onSurprise={mix.surprise}
        canUndo={mix.canUndo}
        onUndo={mix.undo}
      />

      <InputSection
        sourceMode={eng.sourceMode}
        sourceName={eng.sourceName}
        onSelectSource={eng.selectSource}
        sourceBMode={eng.sourceBMode}
        sourceBName={eng.sourceBName}
        onSelectSourceB={eng.selectSourceB}
        webcamDeviceId={eng.webcamDeviceId}
        videoDevices={eng.videoDevices}
        onStartWebcam={eng.startWebcam}
        fileInputRef={eng.fileInputRef}
        fileInputBRef={eng.fileInputBRef}
        onFile={eng.onFile}
        onFileB={eng.onFileB}
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
            <ControlGroup key={group.name} group={group} defaultOpen={i === 0} />
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
      <div className={styles.filterRow}>
        <input
          className={styles.filter}
          type="search"
          placeholder="filter controls — try “rainbow” or “ghost”…"
          title="matches names and descriptions, so artifact words work: rainbow, ghost, dot crawl, tear, roll…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button
          className={styles.paletteKey}
          title="jump to any preset, control, or action by name"
          onClick={() => setShowPalette(true)}
        >
          ⌘K
        </button>
      </div>
      <SignalPath
        nodes={pathNodes}
        open={nav.openPhase}
        expandAll={filtering}
        onOpen={nav.togglePhase}
        openGroup={nav.openGroup}
        onOpenGroup={nav.toggleGroup}
        onShowChain={() => setShowChain(true)}
      />
      {!filtering || pathNodes.length > 0 ? null : (
        <div className={styles.hint}>
          nothing matches “{filter.trim()}” — try an artifact: rainbow, ghost,
          tear
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

          <ModSection engine={eng.engine} />

          {eng.videoA || eng.videoB ? (
            <VaporwaveSection
              videoA={eng.videoA}
              videoB={eng.videoB}
              speedA={eng.speedA}
              speedB={eng.speedB}
              reverb={eng.reverb}
              playAudio={eng.playAudio}
              audioState={eng.engine === null ? null : eng.engine.audioState}
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
          armedKey={armedKey}
          learn={learn}
          midiBindings={midiBindings}
          bpm={bpm}
          onAutoMap={autoMap}
          onLearnSequence={learnSequence}
          onStopLearn={stopLearn}
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
      <ControlsContext value={controlsApi}>{panelBody}</ControlsContext>
    </FilterContext>
  )

  return eng.fatal !== null ? (
    <FatalScreen fatal={eng.fatal} />
  ) : (
    <div className={styles.app}>
      <Stage
        canvasRef={eng.canvasRef}
        error={eng.error}
        stats={eng.stats}
        res={eng.res}
        fullscreen={fullscreen}
        poppedOut={popout !== null}
        recording={capture.recording}
        lens={{
          zoom: controls.crtZoom,
          x: controls.crtZoomX,
          y: controls.crtZoomY,
        }}
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
        onPopout={openPopout}
        onShowHelp={() => setShowHelp(true)}
        onShowAdvanced={() => setShowAdvanced(true)}
        onShowChain={() => setShowChain(true)}
      />
      {fullscreen || popout !== null ? null : (
        <div className={styles.panel}>{panel}</div>
      )}
      {popout === null
        ? null
        : createPortal(
            <div className={styles.app}>
              <div className={cx(styles.panel, styles.panelPop)}>{panel}</div>
            </div>,
            popout.document.body,
          )}
      {showAdvanced ? (
        <AdvancedDialog
          renderScale={eng.renderScale}
          onScaleChange={eng.setScale}
          res={eng.res}
          midiStatus={midiStatus}
          onEnableMidi={enableMidi}
          engine={eng.engine}
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
      {showHelp ? <HelpDialog onClose={() => setShowHelp(false)} /> : null}
      {showChain ? (
        <ChainDialog
          stages={pathNodes}
          open={nav.openPhase}
          onOpen={nav.togglePhase}
          onClose={() => setShowChain(false)}
        />
      ) : null}
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
