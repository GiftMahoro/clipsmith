/** Shared pipeline types. */

export interface Word {
  text: string
  start: number
  end: number
}

export interface SentenceFactor {
  label: string
  points: number
}

export interface Sentence {
  text: string
  start: number
  end: number
  words: Word[]
  score: number
  factors: SentenceFactor[]
}

export interface Clip {
  id: string
  start: number
  end: number
  title: string
  hook: string
  score: number
  reasons: SentenceFactor[]
  sentences: Sentence[]
  words: Word[]
}

export interface CutRange {
  start: number
  end: number
}

export interface AnalysisResult {
  words: Word[]
  sentences: Sentence[]
  clips: Clip[]
  silences: CutRange[]
  filler: CutRange[]
  duration: number
}

/** Normalized horizontal center of the crop per sample time. */
export interface FaceTrack {
  times: number[]
  cx: number[]
}

export type CaptionStyle = 'hormozi' | 'minimal' | 'neon'

export interface EditorSettings {
  trimStart: number
  trimEnd: number
  captionStyle: CaptionStyle
  removeSilence: boolean
  removeFiller: boolean
  faceTrack: boolean
}

export function defaultSettings(clip: Clip): EditorSettings {
  return {
    trimStart: clip.start,
    trimEnd: clip.end,
    captionStyle: 'hormozi',
    removeSilence: true,
    removeFiller: true,
    faceTrack: true,
  }
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
