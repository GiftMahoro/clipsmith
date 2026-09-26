import type { Clip } from '../pipeline/types'
import { fmtTime } from '../pipeline/types'

interface Props {
  clips: Clip[]
  selectedId: string | null
  onSelect: (id: string) => void
  thumbs: Record<string, string>
}

export default function ClipList({ clips, selectedId, onSelect, thumbs }: Props) {
  if (clips.length === 0) {
    return <div className="empty-clips">No clip-worthy moments found in this video.</div>
  }
  return (
    <div className="clip-list">
      {clips.map((c, i) => (
        <button
          key={c.id}
          className={`clip-card ${c.id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          {thumbs[c.id] ? (
            <img className="clip-thumb" src={thumbs[c.id]} alt="" />
          ) : (
            <div className="clip-thumb" />
          )}
          <div className="clip-meta">
            <div className="clip-top">
              <span className="rank">#{i + 1}</span>
              <span className={`score-pill ${c.score >= 80 ? 'score-hi' : 'score-mid'}`}>
                {c.score} virality
              </span>
            </div>
            <h4>{c.title}</h4>
            <p className="why">{c.reasons.slice(0, 2).map((r) => r.label).join(' · ')}</p>
            <div className="clip-dur">
              {fmtTime(c.start)} → {fmtTime(c.end)} · {Math.round(c.end - c.start)}s
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
