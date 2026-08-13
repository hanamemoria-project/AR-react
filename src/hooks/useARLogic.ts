import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { detectGesture } from '../utils/gesture';

export function useARLogic() {
  const { hasStarted, setIsARReady } = useAppStore();
  const lastVideoTime = useRef(0);
  const firstFound = useRef(true);
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Only initialize once hasStarted is true and we haven't already bound events
    if (!hasStarted || hasInitialized.current) return;

    // A-Frame takes a moment to mount the scene elements, so we poll for them
    const checkTimer = setInterval(() => {
      const targetAR = document.getElementById('ar-target-0');
      const vid = document.getElementById('webVideo') as HTMLVideoElement;
      
      if (!targetAR || !vid) return; // Keep waiting
      
      clearInterval(checkTimer);
      hasInitialized.current = true;
      setIsARReady(true);
      console.log('[HM-React] AR Logic Initialized - Binding events');

      // Video buffering indicators
      const ind = document.getElementById('ar-loading-indicator');
      if (ind) {
         vid.addEventListener('waiting', () => { ind.style.display = 'flex'; });
         vid.addEventListener('playing', () => { ind.style.display = 'none'; });
         vid.addEventListener('canplay', () => { ind.style.display = 'none'; });
      }

      // iOS Safari requires video to be muted for autoplay initially
      vid.muted = true;
      vid.playsInline = true;

      const attemptPlay = (retryCount = 0) => {
        vid.muted = true;
        vid.playsInline = true;

        const doPlay = () => {
            vid.play().then(() => {
                console.log('[HM] Video playing (muted). Attempting unmute...');
                setTimeout(() => {
                    vid.muted = false;
                    console.log('[HM] Video unmuted successfully');
                    setTimeout(() => {
                        if (vid.paused) {
                            console.warn('[HM] Video paused by browser after unmute. Reverting to muted play.');
                            vid.muted = true;
                            vid.play().catch(e => console.log('[HM] Muted fallback failed:', e));
                        }
                    }, 100);
                }, 300); // 300ms delay for iOS safety
            }).catch(e => {
                console.warn(`[HM] Video play attempt ${retryCount + 1} failed:`, e.message);
                if (retryCount < 3) {
                    setTimeout(() => attemptPlay(retryCount + 1), 500 * (retryCount + 1));
                }
            });
        };

        if (vid.readyState >= 2) {
            doPlay();
        } else {
            console.log('[HM] Video not ready, waiting for loadeddata...');
            vid.addEventListener('loadeddata', doPlay, { once: true });
            if (vid.readyState === 0) vid.load();
            // Fallback
            setTimeout(() => {
               if (vid.readyState < 2) doPlay();
            }, 2000);
        }
      };

      // --- Gesture Tracking Loop ---
      let gestureLoop: number;
      const startGestureLoop = () => {
        const loop = async () => {
          const camVideo = document.querySelector('video:not(#webVideo)') as HTMLVideoElement;
          if (camVideo) {
            const detected = await detectGesture(camVideo);
            if (detected) {
              window.dispatchEvent(new CustomEvent('gestureDetected', { detail: detected }));
            }
          }
          gestureLoop = requestAnimationFrame(loop);
        };
        loop();
      };

      const stopGestureLoop = () => {
        if (gestureLoop) cancelAnimationFrame(gestureLoop);
      };

      // --- AR Event Listeners ---
      targetAR.addEventListener('targetFound', () => {
         console.log('[HM] Target FOUND!');
         
         // Visual indicators
         if (ind) ind.style.display = 'none';
         const tut = document.getElementById('tutorial-overlay');
         if (tut) tut.style.display = 'none';
         
         sessionStorage.setItem('tutorialSeen', 'true');
         if (typeof (window as any).triggerHaptic === 'function') (window as any).triggerHaptic(30);

         // Handle Mascot popup logic via external store or state if needed, 
         // for now the component MascotStage handles its own logic based on AR Ready,
         // but we can trigger events here too.

         const wrapper = document.getElementById('ar-wrapper');
         if (wrapper && firstFound.current) {
             firstFound.current = false;
             wrapper.dispatchEvent(new Event('doScale'));
         } else if (wrapper) {
             wrapper.setAttribute('scale', '1 1 1');
         }

         // Audio
         const magicSound = document.getElementById('magic-sound') as HTMLAudioElement;
         if (magicSound && lastVideoTime.current === 0) {
             magicSound.currentTime = 0;
             magicSound.play().catch(e => console.log('Audio blocked', e));
         }

         if (lastVideoTime.current > 0) vid.currentTime = lastVideoTime.current;
         attemptPlay();
         startGestureLoop();
      });

      targetAR.addEventListener('targetLost', () => {
         console.log('[HM] Target LOST');
         stopGestureLoop();
         
         if (!sessionStorage.getItem('tutorialSeen')) {
             const tut = document.getElementById('tutorial-overlay');
             if (tut) tut.style.display = 'flex';
         }
         
         lastVideoTime.current = vid.currentTime;
         vid.pause();

         const wrapper = document.getElementById('ar-wrapper');
         if (wrapper) wrapper.setAttribute('scale', '0 0 0');
      });

    }, 200);

    return () => clearInterval(checkTimer);
  }, [hasStarted, setIsARReady]);

}
