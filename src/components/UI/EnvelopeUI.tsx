import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { SlideData } from '../../utils/types';
import { parseSlides } from '../../utils/types';
import gsap from 'gsap';

declare var window: any;

export default function EnvelopeUI() {
  const { orderData, setEnvelopeDismissed } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [showNextBtn, setShowNextBtn] = useState(false);
  
  useEffect(() => {
    if (orderData) {
      const slidesData = parseSlides(orderData, (k) => k);
      setSlides(slidesData);
    }
  }, [orderData]);

  const openEnvelope = () => {
    if (isOpen) return;
    setIsOpen(true);
    
    gsap.to(['#wax-seal', '#envelope-hint', '#envelope-mascot'], {
      opacity: 0, duration: 0.3, onComplete: () => {
          const seal = document.getElementById('wax-seal');
          if (seal) seal.style.display = 'none';
          const mascot = document.getElementById('envelope-mascot');
          if (mascot) mascot.style.display = 'none';
          if (typeof window.triggerHaptic === 'function') window.triggerHaptic(20);
      }
    });

    gsap.to('.top-flap', { rotationX: 180, duration: 0.6, ease: "power1.inOut" });
    gsap.set('.top-flap', { zIndex: 0, delay: 0.3 });
    gsap.set('.letter', { zIndex: 4, delay: 0.3 });

    gsap.to('.letter', {
        y: -130, 
        duration: 0.5,
        delay: 0.4,
        ease: "power2.out",
        onStart: () => {
            gsap.to('.letter-content', { opacity: 1, duration: 0.4 });
            if (typeof window.triggerSakura === 'function') window.triggerSakura();
            if (typeof window.triggerHaptic === 'function') window.triggerHaptic(40);
            gsap.to('.envelope', { filter: 'drop-shadow(0 0 25px rgba(201,164,100,0.8))', duration: 1.5, yoyo: true, repeat: 1 });
        }
    });

    gsap.set('.letter', { zIndex: 10, delay: 0.9 });

    gsap.to('.letter', {
        y: -80,
        x: -10,
        width: "320px",
        height: "380px",
        paddingBottom: "25px",
        duration: 0.7,
        delay: 0.9,
        ease: "back.out(1.1)",
        onComplete: () => {
          const letterEl = document.querySelector('.letter');
          gsap.to(letterEl, { y: "-=8", rotationZ: 0.5, rotationX: 2, duration: 2.5, yoyo: true, repeat: -1, ease: "sine.inOut" });
          
          setShowNextBtn(true);
        }
    });
  };

  const primeAudio = () => {
    const magicSound = document.getElementById('magic-sound') as HTMLAudioElement;
    if (magicSound) {
        magicSound.volume = 0;
        magicSound.play().then(() => {
            magicSound.pause();
            magicSound.currentTime = 0;
            magicSound.volume = 1;
        }).catch(e => console.log('Audio priming blocked:', e));
    }
    
    const vid = document.getElementById('webVideo') as HTMLVideoElement;
    if (vid) {
        vid.muted = false; 
        vid.volume = 0;
        vid.play().then(() => {
            vid.pause();
            vid.currentTime = 0;
            vid.volume = 1;
        }).catch(e => console.log('[HM] webVideo priming blocked:', e));
    }
  };

  const closeLetterAndStartAR = () => {
    primeAudio();
    const overlay = document.getElementById('envelope-overlay');
    if (overlay) {
      gsap.to(overlay, {
          opacity: 0,
          scale: 0.9,
          duration: 0.8,
          ease: "power2.in",
          onComplete: () => {
              overlay.classList.remove('show');
              overlay.style.display = 'none';
              
              setEnvelopeDismissed(true); 

              const sceneEl = document.querySelector('a-scene') as any;
              if (sceneEl && sceneEl.systems['mindar-image-system']) {
                  sceneEl.systems['mindar-image-system'].start();
              } else {
                  console.warn('A-Frame scene or MindAR system not found to start manually.');
              }
          }
      });
    }
  };

  return (
    <div id="envelope-overlay" className="show" style={{ display: 'flex' }}>
      <div id="envelope-container" className={isOpen ? 'open' : ''}>
        
        {!isOpen && (
          <div
            id="envelope-mascot"
            style={{
              position: 'absolute',
              top: '-120px',
              left: '50%',
              transform: 'translateX(-50%)',
              textAlign: 'center',
              pointerEvents: 'none',
              opacity: 1,
              transition: 'opacity 0.5s',
              zIndex: 10,
            }}
          >
            <div
              style={{
                background: 'white',
                color: '#4a3b3d',
                padding: '6px 12px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 600,
                marginBottom: '8px',
                fontFamily: "'Poppins', sans-serif",
                boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
                display: 'inline-block',
                position: 'relative',
              }}
            >
              Ada pesan untukmu! ✨
              <div
                style={{
                  position: 'absolute',
                  bottom: '-5px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  borderWidth: '5px 5px 0',
                  borderStyle: 'solid',
                  borderColor: 'white transparent transparent transparent',
                }}
              ></div>
            </div>
            <br />
            <img
              src="https://pub-02d853231cff4efa92ee6754c646a898.r2.dev/Animasi/1000283700-removebg-preview.png"
              alt="Hana"
              style={{
                width: '80px',
                filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.2))',
                animation: 'mascotBounce 2.5s infinite ease-in-out',
              }}
            />
          </div>
        )}

        <div className="envelope">
          <div className="letter">
            <div className="letter-content">
               <div id="letter-body" className="letter-body" style={{ position: 'relative', overflow: 'hidden' }}>
                  {isOpen && slides.length > 0 && (
                    <div 
                      key={currentSlideIndex} 
                      className="letter-part" 
                      style={{ animation: 'fadeInSlide 0.6s ease-out forwards', width: '100%', textAlign: 'center' }}
                    >
                      <div className="part-title" style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px', color: '#c9a464' }}>
                        {slides[currentSlideIndex].t}
                      </div>
                      <div className="part-body" dangerouslySetInnerHTML={{ __html: slides[currentSlideIndex].b }} />
                    </div>
                  )}
               </div>
               
               {isOpen && showNextBtn && (
                 <div style={{ display: 'flex', justifyContent: 'center', marginTop: '15px', zIndex: 5 }}>
                   {currentSlideIndex < slides.length - 1 ? (
                     <button id="btn-read-next" onClick={(e) => { e.stopPropagation(); setCurrentSlideIndex(s => s + 1); }}>
                       Selanjutnya ➔
                     </button>
                   ) : (
                     <button id="btn-read-next" onClick={(e) => { e.stopPropagation(); closeLetterAndStartAR(); }}>
                       Mulai Pengalaman AR ✨
                     </button>
                   )}
                 </div>
               )}
            </div>
          </div>
          {/* Flaps */}
          <div className="flap top-flap"></div>
          <div className="pocket"></div>
        </div>

        {/* Wax seal for clicking to open */}
        <div className="wax-seal" id="wax-seal" onClick={openEnvelope} style={{ opacity: isOpen ? 0 : 1, pointerEvents: isOpen ? 'none' : 'auto' }}>
          <div className="seal-inner">
            <img src="https://pub-02d853231cff4efa92ee6754c646a898.r2.dev/Logo_HM.png" alt="Seal" />
          </div>
        </div>
      </div>
      
      {!isOpen && (
        <div
          id="envelope-hint"
          style={{
            marginTop: '50px',
            fontFamily: "'Poppins', sans-serif",
            fontSize: '13px',
            fontWeight: 500,
            color: 'white',
            background: 'rgba(255,255,255,0.15)',
            padding: '8px 16px',
            borderRadius: '20px',
            backdropFilter: 'blur(5px)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
            animation: 'pulseHint 2s infinite',
          }}
        >
          <span style={{ display: 'inline-block', animation: 'bounceUp 1.5s infinite', marginRight: '6px' }}>
            👆
          </span>{' '}
          Ketuk stempel untuk membuka
        </div>
      )}
    </div>
  );
}
