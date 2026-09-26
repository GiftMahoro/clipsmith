import type { Word } from './types'

export interface CaptionWord extends Word {
  keyword: boolean
}

export interface CaptionPhrase {
  words: CaptionWord[]
  start: number
  end: number
}

const KEYWORDS = new Set(
  'secret secrets mistake never always stop truth hack free proven warning shocking insane crazy unbelievable nobody everybody everyone why how story exposed lie fake real money million growth viral success fail failed win trust'.split(' '),
)

const isKeyword = (text: string): boolean => {
  const c = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  return KEYWORDS.has(c) || /\d/.test(c) || c.length >= 10
}

/** Group words into short caption phrases (≤4 words, break on punctuation/pauses). */
export function buildPhrases(words: Word[]): CaptionPhrase[] {
  const phrases: CaptionPhrase[] = []
  let cur: CaptionWord[] = []
  const flush = () => {
    if (cur.length === 0) return
    phrases.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end })
    cur = []
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    cur.push({ ...w, keyword: isKeyword(w.text) })
    const punct = /[.!?,;:…]["']?$/.test(w.text)
    const next = words[i + 1]
    const pause = next != null && next.start - w.end > 0.55
    if (punct || pause || cur.length >= 4) flush()
  }
  flush()
  return phrases
}

/** The phrase visible at time t (with a short hold tail). */
export function phraseAt(phrases: CaptionPhrase[], t: number): CaptionPhrase | null {
  for (const p of phrases) {
    if (t >= p.start - 0.04 && t <= p.end + 0.4) return p
  }
  return null
}
