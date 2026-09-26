# Clipsmith

Turn long videos into viral vertical clips — right in the browser.

Upload a recording (podcast, stream, talking-head video) and Clipsmith:

1. **Transcribes** it with Whisper (in-browser, no upload to a server)
2. **Finds the highlights** — emotional peaks, strong hooks, standalone segments
3. **Scores every clip 0–100** for predicted virality, with the reasoning shown
4. **Reframes to 9:16** around the speaker with face tracking
5. **Burns in animated captions** with keyword highlights
6. **Trims silences and filler words** ("um", "uh", "you know")
7. **Exports** ready-to-post vertical video (WebM)

## Run it

```bash
npm install
npm run dev
```

Open the Studio, drop in an MP4, and wait for the analysis. The first run
downloads the Whisper model (~150 MB) and caches it in the browser.

## Deploy

Any static host works (`npm run build` → `dist/`): Vercel, Netlify, or import
the repo into Lovable from GitHub.

## Notes

- Everything runs client-side. Long videos (60+ min) take a while to
  transcribe — that's the honest tradeoff of no-backend processing.
- Export is WebM (VP9). Convert to MP4 with ffmpeg if a platform needs it:
  `ffmpeg -i clip.webm -c:v libx264 -c:a aac clip.mp4`
- Roadmap: link import (YouTube etc. needs a backend), AI B-roll, scheduled
  posting.
