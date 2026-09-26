import type { CutRange } from './types'

/** Decode a video/audio file and return 16 kHz mono samples for Whisper. */
export async function decodeToMono16k(file: File): Promise<{ samples: Float32Array; duration: number }> {
  const raw = await file.arrayBuffer()
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const actx = new AC()
  try {
    const decoded = await actx.decodeAudioData(raw)
    const duration = decoded.duration
    // Mix down to mono.
    const mono = actx.createBuffer(1, decoded.length, decoded.sampleRate)
    const out = mono.getChannelData(0)
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch)
      for (let i = 0; i < data.length; i++) out[i] += data[i] / decoded.numberOfChannels
    }
    // Resample to 16 kHz.
    const targetLen = Math.ceil((mono.length / mono.sampleRate) * 16000)
    const off = new OfflineAudioContext(1, targetLen, 16000)
    const src = off.createBufferSource()
    src.buffer = mono
    src.connect(off.destination)
    src.start(0)
    const rendered = await off.startRendering()
    return { samples: rendered.getChannelData(0).slice(), duration }
  } finally {
    void actx.close().catch(() => undefined)
  }
}

/**
 * Find low-energy regions (pauses / dead air) in 16 kHz mono audio.
 * Returns cut ranges, padded slightly so cuts don't clip word edges.
 */
export function detectSilences(
  samples: Float32Array,
  thresholdDb = -38,
  minSeconds = 0.5,
  pad = 0.1,
): CutRange[] {
  const sr = 16000
  const frame = 1024
  const hop = 512
  const nFrames = Math.floor((samples.length - frame) / hop)
  const quiet: boolean[] = new Array(nFrames)
  for (let f = 0; f < nFrames; f++) {
    let sum = 0
    const off = f * hop
    for (let i = 0; i < frame; i += 4) {
      const v = samples[off + i]
      sum += v * v
    }
    const rms = Math.sqrt(sum / (frame / 4))
    const db = 20 * Math.log10(rms + 1e-9)
    quiet[f] = db < thresholdDb
  }
  const ranges: CutRange[] = []
  let start = -1
  for (let f = 0; f <= nFrames; f++) {
    const q = f < nFrames && quiet[f]
    if (q && start < 0) start = f
    if (!q && start >= 0) {
      const s = (start * hop) / sr
      const e = (f * hop) / sr
      if (e - s >= minSeconds) {
        ranges.push({ start: Math.max(0, s + pad), end: Math.max(s + pad, e - pad) })
      }
      start = -1
    }
  }
  return ranges
}

/** Merge overlapping / adjacent cut ranges. */
export function mergeCuts(ranges: CutRange[], gap = 0.25): CutRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: CutRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + gap) {
      last.end = Math.max(last.end, r.end)
    } else {
      out.push({ ...r })
    }
  }
  return out.filter((r) => r.end - r.start > 0.05)
}

/** Invert cut ranges within [from, to] → the ranges we keep. */
export function invertCuts(cuts: CutRange[], from: number, to: number): CutRange[] {
  const kept: CutRange[] = []
  let cursor = from
  for (const c of mergeCuts(cuts)) {
    if (c.end <= from || c.start >= to) continue
    const s = Math.max(c.start, from)
    const e = Math.min(c.end, to)
    if (s > cursor) kept.push({ start: cursor, end: s })
    cursor = Math.max(cursor, e)
  }
  if (cursor < to) kept.push({ start: cursor, end: to })
  return kept.filter((r) => r.end - r.start > 0.2)
}
