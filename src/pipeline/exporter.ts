import type { Clip, CutRange, EditorSettings, FaceTrack } from './types'
import { buildPhrases } from './captions'
import { drawClipFrame, OUT_W, OUT_H } from './renderer'
import { invertCuts, mergeCuts } from './audio'

export interface ExportProgress {
  fraction: number
}

function pickMime(): string {
  const cands = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  for (const c of cands) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}

/**
 * Render a clip to a downloadable WebM: 9:16 canvas + burned-in captions,
 * with silence/filler cuts stitched out.
 */
export async function exportClip(opts: {
  videoUrl: string
  clip: Clip
  settings: EditorSettings
  track: FaceTrack | null
  silences: CutRange[]
  filler: CutRange[]
  onProgress: (p: ExportProgress) => void
}): Promise<Blob> {
  const { videoUrl, clip, settings, track, silences, filler, onProgress } = opts
  await document.fonts.ready.catch(() => undefined)

  const cuts = mergeCuts([
    ...(settings.removeSilence ? silences : []),
    ...(settings.removeFiller ? filler : []),
  ]).filter((c) => c.end > settings.trimStart && c.start < settings.trimEnd)
  const keep = invertCuts(cuts, settings.trimStart, settings.trimEnd)
  if (keep.length === 0) throw new Error('Trim settings removed the entire clip.')

  const video = document.createElement('video')
  video.src = videoUrl
  video.playsInline = true
  video.preload = 'auto'
  await new Promise<void>((resolve, reject) => {
    video.oncanplay = () => resolve()
    video.onerror = () => reject(new Error('Could not load video for export'))
  })

  const canvas = document.createElement('canvas')
  canvas.width = OUT_W
  canvas.height = OUT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')

  const mime = pickMime()
  if (!mime) throw new Error('This browser cannot record video (MediaRecorder unsupported)')

  const stream = canvas.captureStream(30)
  const actx = new AudioContext()
  await actx.resume().catch(() => undefined)
  try {
    const src = actx.createMediaElementSource(video)
    const dest = actx.createMediaStreamDestination()
    src.connect(dest)
    for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr)
  } catch {
    /* video has no audio track or already captured — video-only export */
  }

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  const chunks: BlobPart[] = []
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve()
  })
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }

  const words = clip.words.filter((w) => w.end > settings.trimStart && w.start < settings.trimEnd)
  const phrases = buildPhrases(words)
  const totalKeep = keep.reduce((a, r) => a + (r.end - r.start), 0)

  const seekDone = (v: HTMLVideoElement, t: number) =>
    new Promise<void>((resolve) => {
      let done = false
      const fin = () => {
        if (done) return
        done = true
        v.removeEventListener('seeked', fin)
        window.clearTimeout(timer)
        resolve()
      }
      const timer = window.setTimeout(fin, 1200)
      v.addEventListener('seeked', fin)
      try {
        v.currentTime = t
      } catch {
        fin()
      }
    })

  video.currentTime = keep[0].start
  await seekDone(video, keep[0].start)
  rec.start(250)
  await video.play().catch(() => undefined)

  let ri = 0
  let finished = false
  await new Promise<void>((resolve) => {
    const step = () => {
      if (finished) return
      const t = video.currentTime
      const range = keep[ri]
      if (t >= range.end - 0.04 || t < range.start - 0.4) {
        ri++
        if (ri >= keep.length) {
          finished = true
          resolve()
          return
        }
        void seekDone(video, keep[ri].start)
      }
      const span = Math.max(0.001, settings.trimEnd - settings.trimStart)
      drawClipFrame({
        video,
        ctx,
        t,
        track,
        useFaceTrack: settings.faceTrack,
        phrases,
        style: settings.captionStyle,
        score: clip.score,
        progress: Math.min(1, Math.max(0, (t - settings.trimStart) / span)),
        zoom: 1 + 0.07 * Math.min(1, Math.max(0, (t - settings.trimStart) / span)),
      })
      let elapsed = 0
      for (let i = 0; i < ri; i++) elapsed += keep[i].end - keep[i].start
      elapsed += Math.max(0, t - keep[ri].start)
      onProgress({ fraction: Math.min(0.999, elapsed / totalKeep) })
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })

  onProgress({ fraction: 1 })
  try {
    video.pause()
  } catch {
    /* noop */
  }
  rec.stop()
  await stopped
  void actx.close().catch(() => undefined)
  return new Blob(chunks, { type: mime.split(';')[0] })
}
