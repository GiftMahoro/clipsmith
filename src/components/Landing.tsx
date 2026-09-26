const FEATURES = [
  {
    n: '01',
    title: 'AI Highlight Detection',
    body: 'Scans your transcript for emotional peaks, strong hooks, and coherent standalone segments — so every cut makes sense without the surrounding hour.',
    tags: ['Emotional peaks', 'Hook strength', 'Standalone segments', 'Topic boundaries'],
  },
  {
    n: '02',
    title: 'Virality Score',
    body: 'Ranks each generated short from 0 to 100 on hook strength, emotional intensity, and curiosity gap — and shows you the reasoning behind every point.',
    tags: ['0–100 ranking', 'Hook analysis', 'Per-clip reasoning', 'Ranked feed'],
  },
  {
    n: '03',
    title: 'Auto-Reframing & Captions',
    body: 'Crops to 9:16 around the active speaker with face tracking, then burns in animated word-by-word captions with keyword highlights.',
    tags: ['9:16 crop', 'Speaker tracking', 'Animated subtitles', 'Keyword highlights'],
  },
  {
    n: '04',
    title: 'Silence & Filler Removal',
    body: 'Dead air, awkward pauses, ums and uhs are detected in the waveform and transcript — then stitched out of every clip automatically.',
    tags: ['Dead-air trim', 'Filler-word cuts', 'Tight pacing', 'Toggle per clip'],
  },
]

const DEMO = [
  { score: 94, title: 'The mistake that cost me $40k', why: 'Hook word in first seconds · emotional language' },
  { score: 89, title: 'Nobody talks about this part of winning', why: 'Curiosity gap · personal story' },
  { score: 86, title: 'Why I stopped chasing followers', why: 'Opens with a question · concrete number' },
  { score: 82, title: 'The 3am rule for hard days', why: 'Strong hook · self-contained thought' },
]

export default function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div>
      <section className="hero">
        <span className="kicker">Long video in · short clips out</span>
        <h1>
          Your 90-minute podcast is hiding <span className="grad">a dozen viral clips.</span>
        </h1>
        <p>
          Clipsmith finds the highlights, reframes to 9:16 around the speaker, burns in animated
          captions, and ranks every cut by predicted virality — before you ever open an editor.
        </p>
        <div className="hero-cta">
          <button className="btn-primary" onClick={onStart}>
            Make clips free
          </button>
          <button className="btn-ghost" onClick={onStart}>
            Open the studio
          </button>
        </div>
      </section>

      <section className="demo-strip">
        {DEMO.map((d) => (
          <div className="demo-card" key={d.title}>
            <div className="thumb" />
            <span className="demo-score">{d.score} virality</span>
            <h4>{d.title}</h4>
            <p>{d.why}</p>
          </div>
        ))}
      </section>

      <section className="features">
        <h2>Everything between the raw recording and the post.</h2>
        <p className="sub">Drop in an MP4. Get ranked, captioned, ready-to-post vertical clips.</p>
        <div className="feat-grid">
          {FEATURES.map((f) => (
            <div className="feat" key={f.n}>
              <div className="num">{f.n}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              <ul>
                {f.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="how">
        <h2>Three steps. No editor required.</h2>
        <p className="sub">The whole pipeline runs in your browser — your footage never leaves your machine.</p>
        <div className="steps">
          <div className="step">
            <div className="n">1</div>
            <h4>Drop in a video</h4>
            <p>Upload a podcast, stream, or talking-head recording. Speech is transcribed on-device with Whisper.</p>
          </div>
          <div className="step">
            <div className="n">2</div>
            <h4>Pick from ranked clips</h4>
            <p>Every candidate moment is scored 0–100 with the reasoning shown. Preview, trim, restyle captions.</p>
          </div>
          <div className="step">
            <div className="n">3</div>
            <h4>Export & post</h4>
            <p>One click renders 9:16 video with burned-in captions, ready for TikTok, Reels, and Shorts.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
