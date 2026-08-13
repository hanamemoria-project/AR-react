import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { SlideData } from '../../utils/types';
import { parseSlides } from '../../utils/types';
import { getHlsUrl } from '../../utils/helpers';

export default function MascotStage() {
  const { isARReady, orderData, currentLang } = useAppStore();
  const [showMascot, setShowMascot] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [bubbleOpen, setBubbleOpen] = useState(false);

  useEffect(() => {
    if (orderData) {
      // Mocking translation function for now
      const slidesData = parseSlides(orderData, (k) => k);
      setSlides(slidesData);
    }
  }, [orderData]);

  // Mascot appears when AR is ready
  useEffect(() => {
    if (isARReady) {
      // Show mascot, wait a bit, then open bubble automatically for the first time
      setShowMascot(true);
      setTimeout(() => setBubbleOpen(true), 2000);
    }
  }, [isARReady]);

  const currentSlide = slides[slideIndex] || { t: '', b: '' };
  const isLast = slides.length > 0 ? slideIndex === slides.length - 1 : true;

  // Gesture listener
  useEffect(() => {
    let lastGestureTime = 0;
    const handleGesture = (e: any) => {
      const now = Date.now();
      if (now - lastGestureTime < 1500) return; // 1.5s cooldown
      
      const gesture = e.detail;
      if (gesture === 'peace' || gesture === 'thumb') {
        lastGestureTime = now;
        if (!bubbleOpen) setBubbleOpen(true);
        else if (!isLast) setSlideIndex(prev => prev + 1);
      }
    };
    window.addEventListener('gestureDetected', handleGesture);
    return () => window.removeEventListener('gestureDetected', handleGesture);
  }, [bubbleOpen, isLast]);

  if (!isARReady) return null;
  if (!showMascot && !showVideo) return null;

  const handleNext = (e: any) => {
    e.stopPropagation();
    if (isLast) setBubbleOpen(false);
    else setSlideIndex(prev => prev + 1);
  };

  const handlePrev = (e: any) => {
    e.stopPropagation();
    if (slideIndex > 0) setSlideIndex(prev => prev - 1);
  };

  const openVideo = (e: any) => {
    e.stopPropagation();
    setShowVideo(true);
    setBubbleOpen(false);
    const v = document.getElementById('ar-video-el') as HTMLVideoElement;
    if (v) {
      v.play().catch(() => {});
    }
  };

  const closeVideo = () => {
    setShowVideo(false);
    const v = document.getElementById('ar-video-el') as HTMLVideoElement;
    if (v) {
      v.pause();
    }
  };

  return (
    <div id="ar-mascot-stage" className={showMascot || showVideo ? 'active' : ''} style={{ display: 'block', visibility: showMascot ? 'visible' : 'hidden' }}>
      
      {showVideo && (
        <div id="video-panel" className="show" style={{ display: 'flex' }}>
          <div id="video-panel-header">
            <span>🎬 VIDEO KENANGAN</span>
            <div id="video-panel-controls">
              <button id="video-panel-close" onClick={closeVideo}>✕</button>
            </div>
          </div>
          <video 
            id="ar-video-el" 
            playsInline 
            loop 
            src={orderData?.link_video ? getHlsUrl(orderData.link_video) : ''}
            style={{ width: '100%', height: 'calc(100% - 50px)', background: '#000' }}
            controls
          ></video>
        </div>
      )}

      {showMascot && (
        <div id="mascot-wrap" className="entered" onClick={() => setBubbleOpen(!bubbleOpen)}>
          <div id="speech-bubble" className={bubbleOpen ? 'show' : ''}>
            <div id="bubble-slide-title">{currentSlide.t}</div>
            <div id="bubble-slide-body" dangerouslySetInnerHTML={{ __html: currentSlide.b }}></div>
            <div id="bubble-nav">
              <button id="bubble-prev-btn" onClick={handlePrev} style={{ visibility: slideIndex > 0 ? 'visible' : 'hidden' }}>‹</button>
              <button id="bubble-next-btn" onClick={handleNext}>{isLast ? (currentLang === 'id' ? 'TUTUP ×' : 'CLOSE ×') : (currentLang === 'id' ? 'LANJUT ›' : 'NEXT ›')}</button>
            </div>
            <button id="bubble-replay-btn" onClick={(e) => { e.stopPropagation(); setSlideIndex(0); }} style={{ display: bubbleOpen && isLast ? 'block' : 'none', marginTop: '10px', fontSize: '10px' }}>
              🔁 Ulang Pesan
            </button>
          </div>

          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img 
              id="mascot-img"
              src="https://pub-02d853231cff4efa92ee6754c646a898.r2.dev/Animasi/1000283700-removebg-preview.png"
              alt="Hana"
            />
            <button id="mascot-heart-btn" title="Putar video kenangan" onClick={openVideo}>
              ▶
            </button>
          </div>

          <div id="mascot-tap-hint" className={bubbleOpen ? 'hidden' : ''}>ketuk aku ✨</div>
        </div>
      )}

      {/* Particles */}
      <div className="deco-particle" style={{ left: '8%', animationDuration: '7s', animationDelay: '0s' }}>🌸</div>
      <div className="deco-particle" style={{ left: '18%', animationDuration: '9s', animationDelay: '1.5s' }}>✨</div>
    </div>
  );
}
