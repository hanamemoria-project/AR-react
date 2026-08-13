import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function AdminPanel() {
  const { isAdmin } = useAppStore();
  const [isMinimized, setIsMinimized] = useState(false);

  // If not admin, don't render anything
  if (!isAdmin) return null;

  return (
    <div id="admin-controls">
      <div id="admin-header">
        <div id="admin-label">
          <span>⚙️</span>
          <span>Admin — Pengaturan Video</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-admin" onClick={() => document.getElementById('ar-target-0')?.dispatchEvent(new Event('targetFound'))}>
            Simulate Found
          </button>
          <button className="btn-admin" onClick={() => document.getElementById('ar-target-0')?.dispatchEvent(new Event('targetLost'))}>
            Simulate Lost
          </button>
          <button className="btn-admin" id="btn-toggle-admin" onClick={() => setIsMinimized(!isMinimized)}>
            <span id="admin-toggle-text">{isMinimized ? '▼ Tampilkan' : '▲ Sembunyikan'}</span>
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <div id="admin-body">
          {/* Preview Video */}
          <div id="admin-preview">
            <div id="admin-preview-label">PREVIEW</div>
            <div id="admin-video-preview">
              <video id="admin-preview-video" loop muted playsInline></video>
              <div id="admin-preview-frame-wrap" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                <img id="admin-preview-frame" style={{ display: 'none', position: 'absolute', width: '100%', height: '100%', objectFit: 'fill' }} crossOrigin="anonymous" />
              </div>
              <div id="admin-preview-overlay" style={{ zIndex: 3 }}>
                <div className="admin-crosshair-h"></div>
                <div className="admin-crosshair-v"></div>
                <div id="admin-dim-label">16:9</div>
              </div>
            </div>
          </div>

          {/* Controls Grid */}
          <div id="admin-controls-grid">
            {/* Position */}
            <div className="admin-control-group">
              <div className="admin-group-label">POSISI</div>
              <div className="admin-btn-row">
                <button className="btn-admin">↑</button>
                <button className="btn-admin">↓</button>
                <button className="btn-admin">←</button>
                <button className="btn-admin">→</button>
              </div>
              <div className="admin-numeric-inputs">
                <div className="admin-num-group">
                  <label>X</label>
                  <input type="number" step="0.05" id="admin-input-x" />
                </div>
                <div className="admin-num-group">
                  <label>Y</label>
                  <input type="number" step="0.05" id="admin-input-y" />
                </div>
              </div>
            </div>
            
            {/* Scale */}
            <div className="admin-control-group">
              <div className="admin-group-label">SKALA</div>
              <div className="admin-btn-row">
                <button className="btn-admin style-scale">W+</button>
                <button className="btn-admin style-scale">W−</button>
                <button className="btn-admin style-scale">H+</button>
                <button className="btn-admin style-scale">H−</button>
              </div>
              <div className="admin-numeric-inputs">
                <div className="admin-num-group">
                  <label>W</label>
                  <input type="number" step="0.1" id="admin-input-w" />
                </div>
                <div className="admin-num-group">
                  <label>H</label>
                  <input type="number" step="0.1" id="admin-input-h" />
                </div>
              </div>
            </div>
            
            {/* Rotation */}
            <div className="admin-control-group">
              <div className="admin-group-label">ROTASI</div>
              <div className="admin-btn-row">
                <button className="btn-admin style-rotate">⟳ +5°</button>
                <button className="btn-admin style-rotate">⟳ −5°</button>
              </div>
              <div className="admin-num-single">
                <input type="number" step="1" id="admin-input-rot" />
                <label>°</label>
              </div>
            </div>
            
            {/* Frame */}
            <div className="admin-control-group">
              <div className="admin-group-label">🖼️ FRAME</div>
              <div className="admin-btn-row">
                <button className="btn-admin">↑</button>
                <button className="btn-admin">↓</button>
                <button className="btn-admin">←</button>
                <button className="btn-admin">→</button>
              </div>
              <div className="admin-btn-row">
                <button className="btn-admin style-scale">W+</button>
                <button className="btn-admin style-scale">W−</button>
                <button className="btn-admin style-scale">H+</button>
                <button className="btn-admin style-scale">H−</button>
              </div>
              <div className="admin-numeric-inputs">
                <div className="admin-num-group">
                  <label>FX</label>
                  <input type="number" step="0.05" id="admin-input-fx" />
                </div>
                <div className="admin-num-group">
                  <label>FY</label>
                  <input type="number" step="0.05" id="admin-input-fy" />
                </div>
                <div className="admin-num-group">
                  <label>FW</label>
                  <input type="number" step="0.05" id="admin-input-fw" />
                </div>
                <div className="admin-num-group">
                  <label>FH</label>
                  <input type="number" step="0.05" id="admin-input-fh" />
                </div>
              </div>
            </div>
          </div>
          
          {/* Save Button */}
          <div id="admin-save-area">
            <button className="btn-admin btn-save">
              💾 <span>SIMPAN</span>
            </button>
            <div id="admin-values-display">
              <span>Nilai saat ini:</span>
              <code id="admin-current-values">—</code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
