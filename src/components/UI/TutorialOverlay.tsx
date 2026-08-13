import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function TutorialOverlay() {
  const { isARReady } = useAppStore();
  const [activeTip, setActiveTip] = useState(0);

  // We might only want to show the tutorial when AR is ready but target is not found yet
  // However, according to original flow, it is a persistent overlay until target found.
  // We'll manage the visibility through CSS or state later.

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTip((prev) => (prev + 1) % 4);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!isARReady) return null;

  return (
    <div id="tutorial-overlay">
      <div className="tutorial-mascot-container">
        <div className="tutorial-mascot-speech">Arahkan kameramu tepat ke foto fisik ya! ✨</div>
        <img
          src="https://pub-02d853231cff4efa92ee6754c646a898.r2.dev/Animasi/1000283700-removebg-preview.png"
          className="tutorial-mascot"
          alt="Hana Mascot"
        />
      </div>
      <div id="tutorial-scan-halo" style={{ marginTop: '20px' }}>
        <div className="tutorial-logo-container">
          <div className="scan-line-logo"></div>
        </div>
      </div>
      <div className="tutorial-text">
        <h3>Fokus ke Foto</h3>
      </div>

      {/* Animated scan tips carousel */}
      <div id="scan-tips-carousel">
        <div className={`scan-tip ${activeTip === 0 ? 'active' : ''}`}>💡 Pencahayaan cukup</div>
        <div className={`scan-tip ${activeTip === 1 ? 'active' : ''}`}>📏 Jarak 20–40 cm</div>
        <div className={`scan-tip ${activeTip === 2 ? 'active' : ''}`}>📐 Permukaan rata</div>
        <div className={`scan-tip ${activeTip === 3 ? 'active' : ''}`}>🎯 Untuk frame penuh</div>
      </div>
    </div>
  );
}
