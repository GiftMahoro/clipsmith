import type { FaceTrack } from './types'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detector = any
let detectorPromise: Promise<Detector> | null = null

function getDetector(): Promise<Detector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import('@mediapipe/tasks-vision')) as any
      const vision = await mod.FilesetResolver.forVisionTasks(WASM_URL)
      return mod.FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.45,
      })
    })()
  }
  return detectorPromise
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener('seeked', finish)
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, 1600)
    video.addEventListener('seeked', finish)
    try {
      video.currentTime = Math.min(t, (video.duration || t + 1) - 0.05)
    } catch {
      finish()
    }
  })
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  W: number,
  H: number,
): { scale: number; ox: number; oy: number } {
  const vw = video.videoWidth || 16
  const vh = video.videoHeight || 9
  const scale = Math.min(W / vw, H / vh)
  const w = vw * scale
  const h = vh * scale
  const ox = (W - w) / 2
  const oy = (H - h) / 2
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(video, ox, oy, w, h)
  return { scale, ox, oy }
}

/**
 * Sample the speaker's horizontal face position across [start, end].
 * Returns null when no face is ever found (caller falls back to center crop).
 */
export async function computeFaceTrack(
  videoUrl: string,
  start: number,
  end: number,
  onProgress?: (fraction: number) => void,
): Promise<FaceTrack | null> {
  const detector = await getDetector()
  const video = document.createElement('video')
  video.src = videoUrl
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Could not load video for face tracking'))
  })

  const W = 320
  const H = 180
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  const n = Math.min(110, Math.max(10, Math.round((end - start) / 0.6)))
  const raw: Array<number | null> = []
  const times: number[] = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? start : start + (i / (n - 1)) * (end - start)
    times.push(t)
    await seekTo(video, t)
    const { scale, ox } = drawContain(ctx, video, W, H)
    let cx: number | null = null
    try {
      const res = detector.detectForVideo(canvas, performance.now())
      const dets = (res?.detections ?? []) as Array<{
        boundingBox?: { originX: number; originY: number; width: number; height: number }
      }>
      let best: { originX: number; originY: number; width: number; height: number } | null = null
      let bestArea = 0
      for (const d of dets) {
        const b = d.boundingBox
        if (!b) continue
        const area = b.width * b.height
        if (area > bestArea) {
          bestArea = area
          best = b
        }
      }
      if (best) {
        // Map from the letterboxed sample back to normalized video coords.
        const boxCx = best.originX + best.width / 2
        cx = (boxCx - ox) / (video.videoWidth * scale)
        if (!Number.isFinite(cx)) cx = null
        else cx = Math.min(0.92, Math.max(0.08, cx))
      }
    } catch {
      cx = null
    }
    raw.push(cx)
    onProgress?.(i / n)
  }

  // Fill gaps by interpolation; if nothing was ever found, bail out.
  const known = raw.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0)
  if (known.length === 0) return null
  const filled = raw.map((v, i) => {
    if (v != null) return v
    const prev = [...known].reverse().find((k) => k < i)
    const next = known.find((k) => k > i)
    if (prev == null) return raw[next!]!
    if (next == null) return raw[prev]!
    const f = (i - prev) / (next - prev)
    return raw[prev]! * (1 - f) + raw[next!]! * f
  })

  // Smooth (moving average) + clamp pan speed for a cinematic feel.
  const sm: number[] = []
  for (let i = 0; i < filled.length; i++) {
    const a = filled[Math.max(0, i - 1)]
    const b = filled[i]
    const c = filled[Math.min(filled.length - 1, i + 1)]
    sm.push((a + b + c) / 3)
  }
  const maxStep = 0.1
  for (let i = 1; i < sm.length; i++) {
    const d = sm[i] - sm[i - 1]
    if (Math.abs(d) > maxStep) sm[i] = sm[i - 1] + Math.sign(d) * maxStep
  }
  onProgress?.(1)
  return { times, cx: sm }
}

/** Interpolate the tracked center-x at time t (0..1). Falls back to center. */
export function sampleTrack(track: FaceTrack | null, t: number): number {
  if (!track || track.times.length === 0) return 0.5
  const { times, cx } = track
  if (t <= times[0]) return cx[0]
  if (t >= times[times.length - 1]) return cx[cx.length - 1]
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) {
      const f = (t - times[i - 1]) / Math.max(1e-6, times[i] - times[i - 1])
      return cx[i - 1] * (1 - f) + cx[i] * f
    }
  }
  return 0.5
}
