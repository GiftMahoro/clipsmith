import { useState } from 'react'
import Landing from './components/Landing'
import Studio from './components/Studio'

export default function App() {
  const [view, setView] = useState<'landing' | 'studio'>('landing')

  return (
    <div className="app">
      <nav className="nav">
        <div className="logo" onClick={() => setView('landing')}>
          <div className="logo-mark">C</div>
          Clipsmith
        </div>
        <div className="nav-links">
          <button className={`nav-btn ${view === 'landing' ? 'active' : ''}`} onClick={() => setView('landing')}>
            Product
          </button>
          <button className={`nav-btn ${view === 'studio' ? 'active' : ''}`} onClick={() => setView('studio')}>
            Studio
          </button>
          <button className="btn-primary" onClick={() => setView('studio')}>
            Make clips
          </button>
        </div>
      </nav>

      {view === 'landing' ? <Landing onStart={() => setView('studio')} /> : <Studio />}

      <div className="footer">
        Clipsmith — long video in, viral clips out. Everything runs in your browser.
      </div>
    </div>
  )
}
