import type { CaptionStyle, FaceTrack } from './types'
import { phraseAt, type CaptionPhrase } from './captions'
import { sampleTrack } from './reframe'

export const OUT_W = 1080
export const OUT_H = 1920

export interface RenderOpts {
  video: HTMLVideoElement
  ctx: CanvasRenderingContext2D
  /** Current video time (seconds). */
  t: number
  track: FaceTrack | null
  useFaceTrack: boolean
  phrases: CaptionPhrase[]
  style: CaptionStyle
  score: number
  /** 0..1 progress through the clip. */
  progress: number
  /** Slow push-in zoom, ~1.0–1.08. */
  zoom: number
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function easeOutBack(x: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

const STYLE_COLORS: Record<CaptionStyle, { hot: string; glow: boolean }> = {
  hormozi: { hot: '#FFD60A', glow: false },
  minimal: { hot: '#FFFFFF', glow: false },
  neon: { hot: '#00F5D4', glow: true },
}

export function drawClipFrame(o: RenderOpts): void {
  const { video, ctx, t } = o
  const W = OUT_W
  const H = OUT_H
  const vw = video.videoWidth || 16
  const vh = video.videoHeight || 9

  // 1) Blurred background fill.
  ctx.save()
  try {
    ctx.filter = 'blur(48px) brightness(0.45) saturate(1.2)'
  } catch {
    /* filter unsupported — draw plain */
  }
  const bgScale = Math.max(W / vw, H / vh)
  const bgW = vw * bgScale
  const bgH = vh * bgScale
  ctx.drawImage(video, (W - bgW) / 2, (H - bgH) / 2, bgW, bgH)
  ctx.restore()

  // 2) Sharp 9:16 foreground crop around the speaker.
  const cx = o.useFaceTrack ? sampleTrack(o.track, t) : 0.5
  const cropH = vh / o.zoom
  const cropW = (cropH * 9) / 16
  const sx = Math.min(Math.max(cx * vw - cropW / 2, 0), Math.max(0, vw - cropW))
  const sy = Math.min(Math.max(vh * 0.42 - cropH / 2, 0), Math.max(0, vh - cropH))
  ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, W, H)

  // 3) Top scrim + progress bar + virality pill.
  const grad = ctx.createLinearGradient(0, 0, 0, 220)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, 220)

  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(0, 0, W, 6)
  ctx.fillStyle = '#C8F04A'
  ctx.fillRect(0, 0, W * Math.min(1, Math.max(0, o.progress)), 6)

  const pill = `${o.score}`
  ctx.font = '800 44px Inter, system-ui, sans-serif'
  const pw = ctx.measureText(pill).width
  ctx.font = '700 20px Inter, system-ui, sans-serif'
  const lw = ctx.measureText('VIRALITY').width
  const pillW = pw + lw + 84
  const px = W - pillW - 32
  const py = 44
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  rr(ctx, px, py, pillW, 76, 38)
  ctx.fill()
  ctx.textBaseline = 'middle'
  ctx.font = '800 44px Inter, system-ui, sans-serif'
  ctx.fillStyle = '#C8F04A'
  ctx.fillText(pill, px + 28, py + 40)
  ctx.font = '700 20px Inter, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillText('VIRALITY', px + 28 + pw + 14, py + 42)

  // 4) Animated captions.
  const phrase = phraseAt(o.phrases, t)
  if (phrase) {
    const colors = STYLE_COLORS[o.style]
    let size = 92
    ctx.textBaseline = 'alphabetic'
    const setFont = (s: number) => {
      ctx.font = `800 ${s}px Inter, system-ui, sans-serif`
    }
    setFont(size)
    const widths = phrase.words.map((w) => ctx.measureText(w.text.toUpperCase()).width)
    const gap = size * 0.28
    let total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)
    while (total > 940 && size > 44) {
      size -= 6
      setFont(size)
      for (let i = 0; i < widths.length; i++) widths[i] = ctx.measureText(phrase.words[i].text.toUpperCase()).width
      total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)
    }
    const baseY = H * 0.72
    let x = (W - total) / 2
    phrase.words.forEach((w, i) => {
      const active = t >= w.start && t < w.end + 0.08
      const hot = active || w.keyword
      const since = Math.min(1, Math.max(0, (t - w.start) / 0.16))
      const scale = active ? 1 + 0.22 * easeOutBack(since) : 1
      ctx.save()
      const wy = baseY
      const wx = x + widths[i] / 2
      ctx.translate(wx, wy)
      ctx.scale(scale, scale)
      ctx.translate(-wx, -wy)
      setFont(size)
      ctx.lineWidth = Math.max(8, size * 0.14)
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.lineJoin = 'round'
      const upper = w.text.toUpperCase()
      ctx.strokeText(upper, x, wy)
      if (colors.glow && hot) {
        ctx.shadowColor = colors.hot
        ctx.shadowBlur = 26
      }
      ctx.fillStyle = hot ? colors.hot : o.style === 'minimal' ? 'rgba(255,255,255,0.82)' : '#FFFFFF'
      ctx.fillText(upper, x, wy)
      ctx.restore()
      x += widths[i] + gap
    })
  }
  ctx.textBaseline = 'alphabetic'
}
