import { useState } from 'react';

export default function WelcomeModal() {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  return (
    <div id="welcome-modal" role="dialog" aria-labelledby="welcome-title" aria-modal="true" style={{ display: 'flex' }}>
      <div id="welcome-card">
        <div id="welcome-icon">
          <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="camGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#e0bfb8" />
                <stop offset="100%" stopColor="#c9a464" />
              </linearGradient>
            </defs>
            <rect x="8" y="18" width="48" height="32" rx="4" fill="none" stroke="url(#camGrad)" strokeWidth="2" />
            <circle cx="32" cy="34" r="9" fill="none" stroke="url(#camGrad)" strokeWidth="2" />
            <circle cx="32" cy="34" r="4" fill="url(#camGrad)" />
            <rect x="22" y="14" width="20" height="6" rx="2" fill="url(#camGrad)" />
            <circle cx="49" cy="24" r="1.5" fill="#c9a464" />
          </svg>
        </div>
        <h2 id="welcome-title">Lihat Kenangan dalam AR</h2>
        <p id="welcome-desc">Izinkan akses kamera untuk menghidupkan kembali foto dan cerita orang-orang tercinta.</p>
        <ul id="welcome-bullets">
          <li><span className="bullet-icon">📸</span><span>Arahkan ke foto fisik</span></li>
          <li><span className="bullet-icon">✨</span><span>Saksikan ia hidup kembali</span></li>
          <li><span className="bullet-icon">🔒</span><span>Privasi terlindungi</span></li>
        </ul>
        <button id="welcome-start-btn" className="btn-primary" onClick={() => setIsVisible(false)}>
          <span>Mulai Pengalaman</span>
          <span className="btn-arrow">→</span>
        </button>
        <p id="welcome-fineprint">Hanya aktif saat kamu memulai. Tidak ada rekaman.</p>
      </div>
    </div>
  );
}
