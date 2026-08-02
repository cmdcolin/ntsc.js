import { useState } from 'react'

import { cx } from './cx'
import { Dialog } from './Dialog'
import dlg from './dialog.module.css'
import ui from './ui.module.css'

export function YouTubeDialog(props: {
  slot: 'a' | 'b'
  onSubmit: (url: string) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState('')
  return (
    <Dialog
      title={`Load a YouTube video into source ${props.slot.toUpperCase()}`}
      size="prose"
      onClose={props.onClose}
    >
      <p className={ui.helpText}>
        Paste a YouTube URL. It’s fetched locally with yt-dlp (dev only) and fed
        through the signal path like any other video. The first load downloads
        the clip, so it may take a moment.
      </p>
      <form
        className={dlg.cardRow}
        onSubmit={e => {
          e.preventDefault()
          props.onSubmit(url)
        }}
      >
        <input
          className={ui.select}
          type="text"
          placeholder="https://youtube.com/watch?v=…"
          value={url}
          onChange={e => setUrl(e.target.value)}
          data-autofocus
        />
        <button className={cx(ui.btn, ui.btnFlush)} type="submit">
          Load
        </button>
      </form>
    </Dialog>
  )
}
