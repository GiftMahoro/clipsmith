import type { Clip, CutRange, Sentence, SentenceFactor, Word } from './types'
import { mergeCuts } from './audio'

/* ------------------------------------------------------------------ */
/* Lexicons                                                            */
/* ------------------------------------------------------------------ */

const HOOK_WORDS = new Set(
  'secret secrets mistake mistakes never always stop truth hack hacks free proven warning shocking insane crazy unbelievable nobody everybody everyone why how story behind exposed lie lies fake real'.split(' '),
)
const EMOTION_WORDS = new Set(
  'love hate fear scared angry amazing incredible awesome terrible awful wow omg worried excited nervous proud ashamed regret success fail failed win winning lose lost pain hurt dream dreams hope'.split(' '),
)
const CURIOSITY_WORDS = new Set(
  'because reason actually imagine remember notice realized learn learned nobody knows knew guess what'.split(' '),
)
const FILLER_START = new Set(['so', 'and', 'like', 'um', 'uh', 'well', 'yeah', 'okay', 'right'])

const FILLER_WORDS = new Set(['um', 'uh', 'umm', 'uhh', 'er', 'erm'])
const FILLER_PHRASES: string[][] = [['you', 'know'], ['i', 'mean']]

const clean = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '')

/* ------------------------------------------------------------------ */
/* Sentences                                                           */
/* ------------------------------------------------------------------ */

export function wordsToSentences(words: Word[]): Sentence[] {
  const sentences: Sentence[] = []
  let cur: Word[] = []
  const flush = () => {
    if (cur.length === 0) return
    sentences.push({
      text: cur.map((w) => w.text).join(' '),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      words: cur,
      score: 0,
      factors: [],
    })
    cur = []
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    cur.push(w)
    const endsSentence = /[.!?…]["']?$/.test(w.text)
    const next = words[i + 1]
    const longPause = next != null && next.start - w.end > 0.9
    if (endsSentence || longPause || cur.length >= 30) flush()
  }
  flush()
  // Drop degenerate sentences.
  return sentences.filter((s) => s.words.length >= 3 && s.end - s.start > 0.8)
}

/** Score a sentence for "clip-worthiness" and record why. */
function scoreSentence(s: Sentence): { score: number; factors: SentenceFactor[] } {
  const factors: SentenceFactor[] = []
  let score = 30 // base: coherent speech
  const words = s.words.map((w) => clean(w.text))
  const text = s.text

  const first5 = words.slice(0, 5)
  const hookHits = first5.filter((w) => HOOK_WORDS.has(w))
  if (hookHits.length > 0) {
    score += 22
    factors.push({ label: `Hook word (“${hookHits[0]}”) in the first seconds`, points: 22 })
  }
  if (/^(why|how|what|when|where|who)\b/i.test(text.trim())) {
    score += 14
    factors.push({ label: 'Opens with a question', points: 14 })
  }
  const emotionHits = words.filter((w) => EMOTION_WORDS.has(w))
  if (emotionHits.length > 0) {
    const pts = Math.min(18, 8 + emotionHits.length * 5)
    score += pts
    factors.push({ label: `Emotional language (“${emotionHits.slice(0, 2).join('”, “')}”)`, points: pts })
  }
  const curiosityHits = words.filter((w) => CURIOSITY_WORDS.has(w))
  if (curiosityHits.length > 0) {
    score += 10
    factors.push({ label: 'Curiosity gap — payoff promised', points: 10 })
  }
  if (/\d/.test(text)) {
    score += 8
    factors.push({ label: 'Concrete number / stat', points: 8 })
  }
  if (/[!?]["']?$/.test(text.trim())) {
    score += 6
    factors.push({ label: 'High-energy delivery', points: 6 })
  }
  const n = words.length
  if (n >= 8 && n <= 32) {
    score += 8
    factors.push({ label: 'Self-contained thought', points: 8 })
  } else if (n < 6) {
    score -= 8
  }
  if (FILLER_START.has(words[0])) {
    score -= 10
    factors.push({ label: 'Starts with filler', points: -10 })
  }
  // Personal story signal.
  if (/\b(i|me|my)\b/i.test(text) && emotionHits.length > 0) {
    score += 6
    factors.push({ label: 'Personal story', points: 6 })
  }
  return { score: Math.max(5, score), factors }
}

export function scoreSentences(sentences: Sentence[]): Sentence[] {
  return sentences.map((s) => {
    const { score, factors } = scoreSentence(s)
    return { ...s, score, factors }
  })
}

/* ------------------------------------------------------------------ */
/* Clips                                                               */
/* ------------------------------------------------------------------ */

const MIN_CLIP = 22
const MAX_CLIP = 58
const IDEAL_LO = 28
const IDEAL_HI = 46

interface Candidate {
  start: number
  end: number
  sentences: Sentence[]
  raw: number
}

function buildCandidates(sentences: Sentence[]): Candidate[] {
  const out: Candidate[] = []
  for (let i = 0; i < sentences.length; i++) {
    let j = i
    while (j < sentences.length) {
      const dur = sentences[j].end - sentences[i].start
      if (dur > MAX_CLIP) break
      j++
      if (dur >= MIN_CLIP) {
        const slice = sentences.slice(i, j)
        const mean = slice.reduce((a, s) => a + s.score, 0) / slice.length
        const hookBonus = slice[0].score * 0.45
        let lengthBonus = 0
        if (dur >= IDEAL_LO && dur <= IDEAL_HI) lengthBonus = 8
        else if (dur < IDEAL_LO) lengthBonus = -6
        out.push({ start: sentences[i].start, end: sentences[j - 1].end, sentences: slice, raw: mean + hookBonus + lengthBonus })
      }
    }
  }
  return out
}

function overlaps(a: Candidate, b: Candidate): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

function makeTitle(s: Sentence): string {
  let t = s.text.trim()
  // Strip leading filler.
  t = t.replace(/^(so|and|like|well|yeah|okay|right|um|uh)[, ]+/i, '')
  const words = t.split(/\s+/).slice(0, 8).join(' ')
  const titled = words.length > 62 ? words.slice(0, 62).replace(/\s+\S*$/, '') + '…' : words
  return titled.charAt(0).toUpperCase() + titled.slice(1)
}

function aggregateReasons(sentences: Sentence[]): SentenceFactor[] {
  const byLabel = new Map<string, number>()
  for (const s of sentences) {
    for (const f of s.factors) {
      if (f.points <= 0) continue
      byLabel.set(f.label, (byLabel.get(f.label) ?? 0) + f.points)
    }
  }
  return [...byLabel.entries()]
    .map(([label, points]) => ({ label, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 4)
}

/** Pick the best non-overlapping windows and map them to 0–100 virality scores. */
export function findClips(sentences: Sentence[], maxClips = 10): Clip[] {
  const candidates = buildCandidates(sentences).sort((a, b) => b.raw - a.raw)
  const picked: Candidate[] = []
  for (const c of candidates) {
    if (picked.length >= maxClips) break
    const bad = picked.some((p) => overlaps(c, p) > Math.min(c.end - c.start, p.end - p.start) * 0.35)
    if (!bad) picked.push(c)
  }
  if (picked.length === 0) return []

  const raws = picked.map((p) => p.raw)
  const lo = Math.min(...raws)
  const hi = Math.max(...raws)
  const span = Math.max(1, hi - lo)

  return picked.map((p, idx) => {
    const score = Math.round(58 + ((p.raw - lo) / span) * 37)
    const words = p.sentences.flatMap((s) => s.words)
    const first = p.sentences[0]
    return {
      id: `clip-${idx + 1}`,
      start: Math.max(0, p.start - 0.25),
      end: p.end + 0.25,
      title: makeTitle(first),
      hook: first.text,
      score: Math.min(97, score),
      reasons: aggregateReasons(p.sentences),
      sentences: p.sentences,
      words,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Filler-word cuts                                                    */
/* ------------------------------------------------------------------ */

export function findFillerCuts(words: Word[]): CutRange[] {
  const cuts: CutRange[] = []
  for (let i = 0; i < words.length; i++) {
    const w = clean(words[i].text)
    if (FILLER_WORDS.has(w)) {
      cuts.push({ start: words[i].start - 0.03, end: words[i].end + 0.12 })
      continue
    }
    for (const phrase of FILLER_PHRASES) {
      const seq = words.slice(i, i + phrase.length).map((x) => clean(x.text))
      if (seq.length === phrase.length && seq.every((x, k) => x === phrase[k])) {
        cuts.push({ start: words[i].start - 0.03, end: words[i + phrase.length - 1].end + 0.12 })
      }
    }
  }
  return mergeCuts(cuts, 0.3)
}
