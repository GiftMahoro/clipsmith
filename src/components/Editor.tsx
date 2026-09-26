import type { CaptionStyle, Clip, EditorSettings } from '../pipeline/types'
import { fmtTime } from '../pipeline/types'

interface Props {
  clip: Clip
  settings: EditorSettings
  onChange: (s: EditorSettings) => void
  onExport: () => void
  exporting: boolean
  exportPct: number
  downloadUrl: string | null
}

const STYLES: Array<{ id: CaptionStyle; label: string }> = [
  { id: 'hormozi', label: 'Hormozi' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'neon', label: 'Neon' },
]

export default function Editor({
  clip,
  settings,
  onChange,
  onExport,
  exporting,
  exportPct,
  downloadUrl,
}: Props) {
  const set = (patch: Partial<EditorSettings>) => onChange({ ...settings, ...patch })

  return (
    <div className="editor">
      <h4>Edit & export</h4>

      <div className="ed-row">
        <label>Trim start</label>
        <input
          type="range"
          min={clip.start}
          max={settings.trimEnd - 5}
          step={0.5}
          value={settings.trimStart}
          onChange={(e) => set({ trimStart: parseFloat(e.target.value) })}
        />
        <span className="val">{fmtTime(settings.trimStart)}</span>
      </div>
      <div className="ed-row">
        <label>Trim end</label>
        <input
          type="range"
          min={settings.trimStart + 5}
          max={clip.end}
          step={0.5}
          value={settings.trimEnd}
          onChange={(e) => set({ trimEnd: parseFloat(e.target.value) })}
        />
        <span className="val">{fmtTime(settings.trimEnd)}</span>
      </div>

      <div className="ed-row">
        <label>Caption style</label>
        <div className="seg">
          {STYLES.map((s) => (
            <button
              key={s.id}
              className={settings.captionStyle === s.id ? 'on' : ''}
              onClick={() => set({ captionStyle: s.id })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ed-row">
        <label>Cleanup</label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.removeSilence}
            onChange={(e) => set({ removeSilence: e.target.checked })}
          />
          Remove silences
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.removeFiller}
            onChange={(e) => set({ removeFiller: e.target.checked })}
          />
          Remove filler words
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.faceTrack}
            onChange={(e) => set({ faceTrack: e.target.checked })}
          />
          Speaker tracking
        </label>
      </div>

      <div className="export-row">
        <button className="btn-primary" onClick={onExport} disabled={exporting}>
          {exporting ? `Rendering… ${Math.round(exportPct * 100)}%` : 'Export clip'}
        </button>
        {exporting && (
          <div className="bar" style={{ flex: 1, minWidth: 120 }}>
            <div style={{ width: `${exportPct * 100}%` }} />
          </div>
        )}
        {downloadUrl && !exporting && (
          <a className="dl-link" href={downloadUrl} download={`clipsmith-${clip.id}.webm`}>
            Download again
          </a>
        )}
      </div>
    </div>
  )
}
