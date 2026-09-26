import type { Word } from './types'

const MODEL_ID = 'Xenova/whisper-base'
/** Transcribe in segments this long so long videos don't blow up memory. */
const SEGMENT_SECONDS = 300

interface TranscribeProgress {
  phase: 'loading-model' | 'transcribing'
  /** 0..1 overall */
  fraction: number
  detail: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Transcriber = (audio: Float32Array, opts: Record<string, any>) => Promise<{
  chunks: Array<{ text: string; timestamp: [number, number] }>
}>

let cachedTranscriber: Transcriber | null = null

async function getTranscriber(onProgress: (p: TranscribeProgress) => void): Promise<Transcriber> {
  if (cachedTranscriber) return cachedTranscriber
  // Dynamic import keeps the heavy onnxruntime bundle out of the initial load.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import('@xenova/transformers')) as any
  const pipeline = mod.pipeline as (
    task: string,
    model: string,
    opts: Record<string, unknown>,
  ) => Promise<Transcriber>
  const t = await pipeline('automatic-speech-recognition', MODEL_ID, {
    progress_callback: (ev: { status: string; progress?: number; file?: string }) => {
      if (ev.status === 'progress') {
        onProgress({
          phase: 'loading-model',
          fraction: Math.min(0.99, (ev.progress ?? 0) / 100),
          detail: `Downloading speech model… ${Math.round((ev.progress ?? 0))}%`,
        })
      } else if (ev.status === 'done') {
        onProgress({ phase: 'loading-model', fraction: 1, detail: 'Speech model ready' })
      }
    },
  })
  cachedTranscriber = t
  return t
}

/**
 * Transcribe 16 kHz mono audio with word-level timestamps.
 * Long audio is processed in segments with progress reporting.
 */
export async function transcribeAudio(
  samples: Float32Array,
  duration: number,
  onProgress: (p: TranscribeProgress) => void,
): Promise<Word[]> {
  const transcriber = await getTranscriber(onProgress)
  const sr = 16000
  const segLen = SEGMENT_SECONDS * sr
  const nSeg = Math.max(1, Math.ceil(samples.length / segLen))
  const words: Word[] = []

  for (let s = 0; s < nSeg; s++) {
    const from = s * segLen
    const to = Math.min(samples.length, from + segLen)
    const chunk = samples.slice(from, to)
    const offset = from / sr
    onProgress({
      phase: 'transcribing',
      fraction: s / nSeg,
      detail: `Transcribing speech… part ${s + 1} of ${nSeg}`,
    })
    const out = await transcriber(chunk, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    })
    for (const c of out.chunks ?? []) {
      const text = c.text.trim()
      if (!text) continue
      const [cs, ce] = c.timestamp
      if (cs == null || ce == null || ce <= cs) continue
      words.push({ text, start: offset + cs, end: offset + ce })
    }
    onProgress({
      phase: 'transcribing',
      fraction: (s + 1) / nSeg,
      detail: `Transcribing speech… part ${s + 1} of ${nSeg}`,
    })
  }

  // Safety: clamp to duration and sort.
  const cleaned = words
    .filter((w) => w.start < duration && w.end > 0)
    .map((w) => ({ ...w, start: Math.max(0, w.start), end: Math.min(duration, w.end) }))
    .sort((a, b) => a.start - b.start)
  return cleaned
}
