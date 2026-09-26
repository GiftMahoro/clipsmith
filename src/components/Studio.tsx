import { useMemo, useRef, useState } from 'react'
import { decodeToMono16k, detectSilences, mergeCuts } from '../pipeline/audio'
import { transcribeAudio } from '../pipeline/transcribe'
import { wordsToSentences, scoreSentences, findClips, findFillerCuts } from '../pipeline/highlights'
import { computeFaceTrack } from '../pipeline/reframe'
import { exportClip } from '../pipeline/exporter'
import type { AnalysisResult, Clip, EditorSettings, FaceTrack } from '../pipeline/types'
import { defaultSettings, fmtTime } from '../pipeline/types'
import ClipList from './ClipList'
import Player from './Player'
import Editor from './Editor'

type Stage = 'idle' | 'analyzing' | 'ready' | 'error'
type PhaseState = 'wait' | 'now' | 'done'

const PHASE_NAMES = [
  'Decoding audio',
  'Loading speech model',
  'Transcribing speech',
  'Scoring highlights',
  'Preparing previews',
]

async function getDuration(url: string): Promise<number> {
  const v = document.createElement('video')
  v.src = url
  v.preload = 'metadata'
  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve()
    v.onerror = () => reject(new Error('Could not read that video file'))
  })
  return v.duration || 0
}

async function captureThumb(videoUrl: string, t: number): Promise<string> {
  const v = document.createElement('video')
  v.src = videoUrl
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve()
    v.onerror = () => reject(new Error('thumb failed'))
  })
  await new Promise<void>((resolve) => {
    let done = false
    const fin = () => {
      if (done) return
      done = true
      v.removeEventListener('seeked', fin)
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(fin, 1500)
    v.addEventListener('seeked', fin)
    try {
      v.currentTime = Math.min(t, v.duration - 0.1)
    } catch {
      fin()
    }
  })
  const c = document.createElement('canvas')
  c.width = 108
  c.height = 192
  const ctx = c.getContext('2d')
  if (!ctx || !v.videoWidth) throw new Error('thumb failed')
  const vw = v.videoWidth
  const vh = v.videoHeight
  const cw = (vh * 9) / 16
  ctx.drawImage(v, (vw - cw) / 2, 0, cw, vh, 0, 0, 108, 192)
  return c.toDataURL('image/jpeg', 0.72)
}

export default function Studio() {
  const [stage, setStage] = useState<Stage>('idle')
  const [fileName, setFileName] = useState('')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [prog, setProg] = useState({ pct: 0, label: '', phases: PHASE_NAMES.map(() => 'wait' as PhaseState) })
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settingsMap, setSettingsMap] = useState<Record<string, EditorSettings>>({})
  const [tracks, setTracks] = useState<Record<string, FaceTrack | null>>({})
  const [trackLoading, setTrackLoading] = useState<Record<string, boolean>>({})
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const analyzingRef = useRef(false)
  const [linkInput, setLinkInput] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkStatus, setLinkStatus] = useState('')

  const setP = (pct: number, label: string, phases: PhaseState[]) =>
    setProg({ pct: Math.min(100, Math.max(0, pct)), label, phases })

  const selected: Clip | null = useMemo(
    () => result?.clips.find((c) => c.id === selectedId) ?? result?.clips[0] ?? null,
    [result, selectedId],
  )
  const settings: EditorSettings | null = useMemo(
    () => (selected ? (settingsMap[selected.id] ?? defaultSettings(selected)) : null),
    [selected, settingsMap],
  )

  const cuts = useMemo(() => {
    if (!selected || !result || !settings) return []
    return mergeCuts([
      ...(settings.removeSilence ? result.silences : []),
      ...(settings.removeFiller ? result.filler : []),
    ]).filter((c) => c.end > settings.trimStart && c.start < settings.trimEnd)
  }, [selected, result, settings])

  const startTrack = (clip: Clip, url: string) => {
    if (tracks[clip.id] !== undefined || trackLoading[clip.id]) return
    setTrackLoading((m) => ({ ...m, [clip.id]: true }))
    computeFaceTrack(url, clip.start, clip.end)
      .then((tr) => setTracks((m) => ({ ...m, [clip.id]: tr })))
      .catch(() => setTracks((m) => ({ ...m, [clip.id]: null })))
      .finally(() =>
        setTrackLoading((m) => {
          const n = { ...m }
          delete n[clip.id]
          return n
        }),
      )
  }

  const selectClip = (id: string) => {
    setSelectedId(id)
    setDownloadUrl(null)
    const clip = result?.clips.find((c) => c.id === id)
    if (clip) {
      setSettingsMap((m) => (m[id] ? m : { ...m, [id]: defaultSettings(clip) }))
      if (videoUrl && (settingsMap[id] ?? defaultSettings(clip)).faceTrack) startTrack(clip, videoUrl)
    }
  }

  const runAnalysis = async (file: File, url: string) => {
    if (analyzingRef.current) return
    analyzingRef.current = true
    setStage('analyzing')
    setError('')
    setResult(null)
    setSelectedId(null)
    setSettingsMap({})
    setTracks({})
    setThumbs({})
    setDownloadUrl(null)
    try {
      const dur = await getDuration(url)
      if (!dur || !Number.isFinite(dur)) throw new Error('Could not read that video file.')
      setP(3, 'Decoding audio…', ['now', 'wait', 'wait', 'wait', 'wait'])
      const { samples, duration } = await decodeToMono16k(file)
      setP(10, 'Audio decoded', ['done', 'now', 'wait', 'wait', 'wait'])
      const words = await transcribeAudio(samples, duration, (p) => {
        if (p.phase === 'loading-model') {
          setP(10 + p.fraction * 8, p.detail, ['done', 'now', 'wait', 'wait', 'wait'])
        } else {
          setP(18 + p.fraction * 52, p.detail, ['done', 'done', 'now', 'wait', 'wait'])
        }
      })
      if (words.length < 15) {
        throw new Error('No speech detected in this video — Clipsmith needs talking to find clips.')
      }
      setP(72, 'Scoring highlight moments…', ['done', 'done', 'done', 'now', 'wait'])
      // Let the UI breathe before the heavy synchronous scoring.
      await new Promise((r) => setTimeout(r, 30))
      const sentences = scoreSentences(wordsToSentences(words))
      const clips = findClips(sentences, 10)
      if (clips.length === 0) {
        throw new Error('Could not find clip-worthy moments — try a video with more talking.')
      }
      const silences = detectSilences(samples)
      const filler = findFillerCuts(words)
      setP(82, 'Preparing clip previews…', ['done', 'done', 'done', 'done', 'now'])
      const th: Record<string, string> = {}
      for (let i = 0; i < clips.length; i++) {
        try {
          th[clips[i].id] = await captureThumb(url, clips[i].start + 1.5)
        } catch {
          th[clips[i].id] = ''
        }
        setP(82 + ((i + 1) / clips.length) * 16, `Preparing clip ${i + 1} of ${clips.length}…`, [
          'done',
          'done',
          'done',
          'done',
          'now',
        ])
      }
      setThumbs(th)
      setResult({ words, sentences, clips, silences, filler, duration })
      setP(100, 'Done', ['done', 'done', 'done', 'done', 'done'])
      const first = clips[0]
      setSelectedId(first.id)
      setSettingsMap({ [first.id]: defaultSettings(first) })
      startTrack(first, url)
      setStage('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed. Try another file.')
      setStage('error')
    } finally {
      analyzingRef.current = false
    }
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setError('Please choose a video file (MP4 works best).')
      setStage('error')
      return
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    const url = URL.createObjectURL(file)
    setFileName(file.name)
    setVideoUrl(url)
    void runAnalysis(file, url)
  }

  /** Fetch a video from a direct link, then run it through the normal pipeline. */
  const onLink = async () => {
    const raw = linkInput.trim()
    if (!raw || linkBusy) return
    let parsed: URL
    try {
      parsed = new URL(raw)
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol')
    } catch {
      setError("That doesn't look like a valid web link — it needs to start with http(s)://.")
      setStage('error')
      return
    }
    setLinkBusy(true)
    setLinkStatus('Connecting…')
    try {
      const res = await fetch(parsed.toString())
      if (!res.ok) throw new Error(`The link returned HTTP ${res.status}.`)
      const ct = res.headers.get('content-type') || ''
      if (!ct.startsWith('video/')) {
        if (ct.includes('text/html')) {
          throw new Error(
            "That link opened a web page, not a video file. YouTube, TikTok and Instagram links can't be fetched directly — download the video first, then upload the file (or send me the link and I'll pull it for you).",
          )
        }
        throw new Error(
          `That link returned "${ct || 'an unknown file type'}", not a video file. It needs to be a direct link to a video file (MP4 works best).`,
        )
      }
      if (!res.body) throw new Error('Download failed (empty response).')
      const total = Number(res.headers.get('content-length') || 0)
      const reader = res.body.getReader()
      const chunks: BlobPart[] = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.byteLength
        if (received > 2 * 1024 * 1024 * 1024) {
          throw new Error('That file is over 2 GB — too large to process in the browser.')
        }
        const mb = (received / 1048576).toFixed(1)
        setLinkStatus(
          total > 0 ? `Downloading… ${mb} MB of ${(total / 1048576).toFixed(0)} MB` : `Downloading… ${mb} MB`,
        )
      }
      const type = ct.split(';')[0]
      const base = parsed.pathname.split('/').pop() || 'video'
      const name = /\.\w{2,5}$/.test(base) ? base : `${base}.mp4`
      const file = new File(chunks, name, { type })
      setLinkInput('')
      setLinkBusy(false)
      setLinkStatus('')
      onFile(file)
    } catch (e) {
      setLinkBusy(false)
      setLinkStatus('')
      const msg = e instanceof Error ? e.message : 'Download failed.'
      if (/failed to fetch|networkerror|load failed/i.test(msg)) {
        setError(
          "Couldn't download from that link — the host is blocking cross-site downloads. Try a different host, or upload the file instead.",
        )
      } else {
        setError(msg)
      }
      setStage('error')
    }
  }

  const handleExport = async () => {
    if (!selected || !videoUrl || !result || !settings) return
    setExporting(true)
    setExportPct(0)
    setDownloadUrl(null)
    try {
      const blob = await exportClip({
        videoUrl,
        clip: selected,
        settings,
        track: tracks[selected.id] ?? null,
        silences: result.silences,
        filler: result.filler,
        onProgress: (p) => setExportPct(p.fraction),
      })
      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)
      const a = document.createElement('a')
      a.href = url
      a.download = `clipsmith-${selected.id}.webm`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  const reset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl(null)
    setResult(null)
    setStage('idle')
    setError('')
    setFileName('')
  }

  return (
    <div className="studio">
      {stage === 'idle' && (
        <>
        <div
          className={`drop ${dragOver ? 'over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            onFile(e.dataTransfer.files?.[0])
          }}
        >
          <h2>Drop in a long video</h2>
          <p>MP4 up to a few hours. Transcription runs on-device with Whisper — your footage never uploads anywhere.</p>
          <p className="fine">First run downloads the speech model (~150 MB, cached after). Long videos take a few minutes to analyze.</p>
          <input
            ref={inputRef}
            className="hidden-input"
            type="file"
            accept="video/*"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
        <div className="link-row">
          <div className="link-div">or paste a video link</div>
          <div className="link-input-row">
            <input
              type="url"
              inputMode="url"
              placeholder="https://… direct link to a video file"
              value={linkInput}
              disabled={linkBusy}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onLink()
              }}
            />
            <button className="btn-primary" disabled={linkBusy || !linkInput.trim()} onClick={() => void onLink()}>
              {linkBusy ? 'Fetching…' : 'Fetch video'}
            </button>
          </div>
          {linkBusy && linkStatus && <p className="fine">{linkStatus}</p>}
          <p className="fine">Direct file links work (MP4). YouTube / TikTok / Instagram links can't be fetched directly — download those first, then upload.</p>
        </div>
        </>
      )}

      {(stage === 'analyzing' || stage === 'ready') && videoUrl && (
        <div className="file-row">
          <span className="dot" />
          <span style={{ fontWeight: 600 }}>{fileName}</span>
          {result && <span style={{ color: 'var(--dim)', fontSize: 13 }}>{result.clips.length} clips · {fmtTime(result.duration)} source</span>}
          <span style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={reset} style={{ padding: '8px 18px' }}>
            New video
          </button>
        </div>
      )}

      {stage === 'analyzing' && (
        <div className="progress-wrap">
          <h3>Finding your viral moments</h3>
          <p className="detail">{prog.label}</p>
          <div className="bar">
            <div style={{ width: `${prog.pct}%` }} />
          </div>
          <div className="pct">{Math.round(prog.pct)}%</div>
          <div className="phase-list">
            {PHASE_NAMES.map((n, i) => (
              <div key={n} className={`phase ${prog.phases[i] === 'done' ? 'done' : ''} ${prog.phases[i] === 'now' ? 'now' : ''}`}>
                <span className="st">{prog.phases[i] === 'done' ? '✓' : prog.phases[i] === 'now' ? '●' : '○'}</span>
                {n}
              </div>
            ))}
          </div>
        </div>
      )}

      {stage === 'error' && (
        <div>
          <div className="notice">
            <b>Something went wrong.</b> {error}
          </div>
          <button className="btn-ghost" onClick={reset}>
            Try another video
          </button>
        </div>
      )}

      {stage === 'ready' && result && selected && settings && (
        <div>
          <div className="notice">
            <b>{result.clips.length} clips ranked.</b> Scores come from hook strength, emotional
            intensity, and curiosity gap — the reasoning is under each title. Trim, restyle, and
            export any clip.
          </div>
          <div className="workbench">
            <ClipList clips={result.clips} selectedId={selected.id} onSelect={selectClip} thumbs={thumbs} />
            <div className="stage">
              <div className="stage-head">
                <div>
                  <h3>{selected.title}</h3>
                  <div className="reasons">
                    {selected.reasons.map((r) => (
                      <span className="reason" key={r.label}>
                        {r.label} <b>+{r.points}</b>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <Player
                videoUrl={videoUrl!}
                clip={selected}
                settings={settings}
                track={tracks[selected.id]}
                cuts={cuts}
              />
              <Editor
                clip={selected}
                settings={settings}
                onChange={(s) => {
                  setSettingsMap((m) => ({ ...m, [selected.id]: s }))
                  if (s.faceTrack && videoUrl) startTrack(selected, videoUrl)
                }}
                onExport={handleExport}
                exporting={exporting}
                exportPct={exportPct}
                downloadUrl={downloadUrl}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
