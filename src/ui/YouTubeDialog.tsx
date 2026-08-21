import { useState } from 'react'

import { CLIP_RANGES, WHOLE_CLIP } from '../sources/ytdlp'
import { cx } from './cx'
import { Dialog } from './Dialog'
import dlg from './dialog.module.css'
import ui from './ui.module.css'

export function YouTubeDialog(props: {
  slot: 'a' | 'b'
  onSubmit: (url: string, secs: number) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState('')
  const [secs, setSecs] = useState(WHOLE_CLIP)
  return (
    <Dialog
      title={`Fetch a video URL into source ${props.slot.toUpperCase()}`}
      size="prose"
      onClose={props.onClose}
    >
      <p className={ui.helpText}>
        Paste a video URL — YouTube, Vimeo, archive.org, a direct link, or
        anything else yt-dlp handles. It’s fetched locally with yt-dlp (dev
        only) and fed through the signal path like any other video. The whole
        clip comes down before it plays, so the first load takes as long as the
        download; once it’s up it goes onto the clip shelf under{' '}
        <strong>Clips…</strong>, and clicking it there brings it back without
        fetching again.
      </p>
      <form
        className={dlg.cardRow}
        onSubmit={e => {
          e.preventDefault()
          props.onSubmit(url, secs)
        }}
      >
        <input
          className={ui.select}
          type="text"
          placeholder="https://…"
          value={url}
          onChange={e => setUrl(e.target.value)}
          data-autofocus
        />
        <select
          className={ui.select}
          title="how much of the clip to fetch"
          value={secs}
          onChange={e => setSecs(Number(e.target.value))}
        >
          {CLIP_RANGES.map(range => (
            <option key={range.secs} value={range.secs}>
              {range.label}
            </option>
          ))}
        </select>
        <button className={cx(ui.btn, ui.btnFlush)} type="submit">
          Fetch
        </button>
      </form>
      {/* Said here rather than left to be discovered, because the obvious guess
          about a range is the wrong way round: a range is cut with ffmpeg over
          the site's streaming ladder instead of pulling the format straight, so
          it costs *more* per second than the whole file does. */}
      <p className={ui.helpText}>
        {secs === WHOLE_CLIP
          ? 'Fetching part of a clip is slower per second than fetching all of it — worth it only for something long.'
          : 'Trimming is done with ffmpeg while it downloads, which is slower per second than fetching the whole clip. It pays off on a long film and costs on a short one.'}
      </p>
    </Dialog>
  )
}
