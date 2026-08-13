import { useEffect, useRef, memo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getProductRatio } from '../utils/types';
import { useARLogic } from '../hooks/useARLogic';

// Declare a-frame elements for TypeScript
declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        [elemName: string]: any;
      }
    }
  }
  interface Window { AFRAME: any }
}

const ARScene = memo(() => {
  const sceneRef = useRef<any>(null);
  const { orderData, envelopeDismissed } = useAppStore();

  useARLogic();

  useEffect(() => {
    // Prevent accidental re-renders of the AR scene by memoizing and relying on refs for updates
  }, []);

  if (!orderData) return null;

  // Process data similar to old app.js
  const isLandscape = orderData.orientasi === 'landscape';
  const productRatio = getProductRatio(orderData.jenis_pesanan, isLandscape);
  
  const defaultHeight = (1 / productRatio).toFixed(5);
  const p = (orderData.video_posisi || "0 0 0").split(' ');
  const rawS = (orderData.video_skala || `1 ${defaultHeight} 1`).split(' ');

  const baseW = parseFloat(rawS[0]);
  const baseH = parseFloat(rawS[1]);
  const s = [baseW.toString(), baseH.toString(), rawS[2] || "1"];
  const currentPlaneRatio = baseW / baseH;

  let rotZ = 0;
  if (orderData.video_rotasi) {
      const rotArr = orderData.video_rotasi.split(' ');
      rotZ = rotArr.length >= 3 ? parseFloat(rotArr[2]) : 0;
  }

  const frameSrc = orderData.link_frame || "none";
  let framePosX = 0;
  let framePosY = 0;
  let frameW = baseW;
  let frameH = baseH;

  if (orderData.frame_posisi) {
      const fp = orderData.frame_posisi.split(' ');
      framePosX = parseFloat(fp[0]) || 0;
      framePosY = parseFloat(fp[1]) || 0;
  }

  if (orderData.frame_skala) {
      const fs = orderData.frame_skala.split(' ');
      frameW = parseFloat(fs[0]) || baseW;
      frameH = parseFloat(fs[1]) || baseH;
  } else {
      const isDefaultInstaFrame = frameSrc.toLowerCase().includes("selamat");
      frameW = baseW * (isDefaultInstaFrame ? 1.15 : 1.0);
      frameH = baseH * (isDefaultInstaFrame ? 1.35 : 1.0);
      framePosY = isDefaultInstaFrame ? 0.15 : 0.0;
  }

  return (
    <div id="mindar-overlay-container" className={envelopeDismissed ? 'active' : ''}>
      <div id="ar-scene-target-container" style={{ width: '100%', height: '100vh' }}>
        <a-scene
          ref={sceneRef}
          mindar-image={`imageTargetSrc: ${orderData.link_target}; autoStart: false; uiLoading: no; uiError: no; uiScanning: no;`}
          color-space="sRGB"
          renderer="colorManagement: true, physicallyCorrectLights: true"
          vr-mode-ui="enabled: false"
          device-orientation-permission-ui="enabled: false"
        >
          <a-assets>
            {frameSrc !== 'none' && <img id="customFrame" src={frameSrc} crossOrigin="anonymous" />}
          </a-assets>

          <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
          
          <a-entity mindar-image-target="targetIndex: 0" id="ar-target-0">
             <a-entity 
                id="ar-wrapper" 
                position={`${p[0]} ${p[1]} 0`} 
                rotation={`0 0 ${rotZ}`} 
                scale="1 1 1"
                animation="property: scale; from: 0 0 0; to: 1 1 1; dur: 800; easing: easeOutElastic; startEvents: doScale"
              >
                <a-light type="point" color="#e8f4ff" intensity="0.8" distance="3" position="0 0 0.5"></a-light>

                <a-video
                  id="ar-video-plane"
                  src="#webVideo"
                  position="0 0 0"
                  width={s[0]}
                  height={s[1]}
                  video-cover={`planeRatio: ${currentPlaneRatio}`}
                ></a-video>

                {frameSrc !== 'none' && (
                  <a-image 
                    id="frameOverlay" 
                    src="#customFrame" 
                    position={`${framePosX.toFixed(2)} ${framePosY.toFixed(2)} 0.05`} 
                    width={frameW.toFixed(2)} 
                    height={frameH.toFixed(2)}
                  ></a-image>
                )}
             </a-entity>
          </a-entity>
        </a-scene>
      </div>
    </div>
  );
});

export default ARScene;
