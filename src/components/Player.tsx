import { useEffect, useMemo, useRef, useState } from 'react'
import type { Clip, CutRange, EditorSettings, FaceTrack } from '../pipeline/types'
import { fmtTime } from '../pipeline/types'
import { buildPhrases } from '../pipeline/captions'
import { drawClipFrame, OUT_W, OUT_H } from '../pipeline/renderer'

interface Props {
  videoUrl: string
  clip: Clip
  settings: EditorSettings
  track: FaceTrack | null | undefined
  cuts: CutRange[]
}

export default function Player({ videoUrl, clip, settings, track, cuts }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sliderRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const [playing, setPlaying] = useState(false)

  const live = useRef({ trimStart: 0, trimEnd: 0, cuts: [] as CutRange[], track: null as FaceTrack | null, useFaceTrack: true })
  live.current = {
    trimStart: settings.trimStart,
    trimEnd: settings.trimEnd,
    cuts,
    track: track ?? null,
    useFaceTrack: settings.faceTrack,
  }

  const phrases = useMemo(
    () =>
      buildPhrases(
        clip.words.filter((w) => w.end > settings.trimStart && w.start < settings.trimEnd),
      ),
    [clip, settings.trimStart, settings.trimEnd],
  )

  // Jump to the clip start whenever the selected clip changes.
  useEffect(() => {
    const v = videoRef.current
    if (v) {
      try {
        v.currentTime = settings.trimStart
      } catch {
        /* noop */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, videoUrl])

  // Render loop: draws every video frame to the 9:16 canvas.
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const v = videoRef.current
      const canvas = canvasRef.current
      if (v && canvas) {
        const ctx = canvas.getContext('2d')
        const s = live.current
        let t = v.currentTime
        if (!v.paused && !v.seeking) {
          for (const cut of s.cuts) {
            if (t >= cut.start && t < cut.end) {
              v.currentTime = cut.end + 0.02
              t = v.currentTime
              break
            }
          }
          if (t >= s.trimEnd - 0.05) v.currentTime = s.trimStart
          else if (t < s.trimStart - 0.5) v.currentTime = s.trimStart
        }
        if (ctx && v.videoWidth > 0) {
          const span = Math.max(0.001, s.trimEnd - s.trimStart)
          const prog = Math.min(1, Math.max(0, (t - s.trimStart) / span))
          drawClipFrame({
            video: v,
            ctx,
            t,
            track: s.track,
            useFaceTrack: s.useFaceTrack,
            phrases,
            style: settings.captionStyle,
            score: clip.score,
            progress: prog,
            zoom: 1 + 0.07 * prog,
          })
        }
        if (sliderRef.current) {
          sliderRef.current.value = String(Math.min(s.trimEnd, Math.max(s.trimStart, t)))
        }
        if (timeRef.current) {
          timeRef.current.textContent = `${fmtTime(Math.max(0, t - s.trimStart))} / ${fmtTime(s.trimEnd - s.trimStart)}`
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phrases, clip.score, settings.captionStyle])

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      if (v.currentTime >= live.current.trimEnd - 0.1 || v.currentTime < live.current.trimStart) {
        v.currentTime = live.current.trimStart
      }
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  const trackingNote =
    track === undefined && settings.faceTrack
      ? 'Tracking speaker…'
      : track === null && settings.faceTrack
        ? 'No face found — center crop'
        : ''

  return (
    <div>
      <video
        ref={videoRef}
        src={videoUrl}
        playsInline
        preload="auto"
        style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none' }}
      />
      <div className="player-wrap">
        <canvas ref={canvasRef} width={OUT_W} height={OUT_H} />
      </div>
      <div className="player-bar">
        <button className="play-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          ref={sliderRef}
          className="scrub"
          type="range"
          min={settings.trimStart}
          max={settings.trimEnd}
          step={0.1}
          defaultValue={settings.trimStart}
          onChange={(e) => {
            const v = videoRef.current
            if (v) v.currentTime = parseFloat(e.target.value)
          }}
        />
        <span className="time" ref={timeRef}>0:00 / 0:00</span>
      </div>
      <div className="tracking-note">{trackingNote}</div>
    </div>
  )
}
