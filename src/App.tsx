import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import LoadingScreen from './components/UI/LoadingScreen';
import EnvelopeUI from './components/UI/EnvelopeUI';
import WelcomeModal from './components/UI/WelcomeModal';
import TutorialOverlay from './components/UI/TutorialOverlay';
import AdminPanel from './components/UI/AdminPanel';
import MascotStage from './components/UI/MascotStage';
import ARScene from './components/ARScene';
import { fetchOrderData } from './utils/api';
import { loadGestureModel } from './utils/gesture';
import { getHlsUrl, isIOS } from './utils/helpers';
import { getCachedAssetUrl } from './utils/cache';
import './style.css';

// Declare Hls for TypeScript
declare global {
  interface Window { hmHlsInstance: any; }
  const Hls: any;
}

function setupGlobalVideo(src: string) {
  let vid = document.getElementById('webVideo') as HTMLVideoElement;
  if (!vid) {
      vid = document.createElement('video');
      vid.id = 'webVideo';
      vid.crossOrigin = 'anonymous';
      vid.loop = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.setAttribute('playsinline', '');
      vid.setAttribute('webkit-playsinline', '');
      vid.preload = 'auto';
      vid.style.display = 'none';
      document.body.appendChild(vid);
  }
  vid.src = src;

  if (!vid.src.startsWith('blob:') && vid.src.includes('.m3u8')) {
      if (!isIOS && typeof Hls !== 'undefined' && Hls.isSupported()) {
          if (window.hmHlsInstance) window.hmHlsInstance.destroy();
          const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
          hls.loadSource(vid.src);
          hls.attachMedia(vid);
          window.hmHlsInstance = hls;
      }
  }
}

function App() {
  const { hasStarted, setHasStarted, setLoadingProgress, setLoadingStep, envelopeDismissed, setOrderData, setIsAdmin } = useAppStore();

  useEffect(() => {
    const initApp = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const rawId = urlParams.get('id');
        const idPelanggan = (rawId && rawId.length > 2) ? rawId : 'demo';
        const adminMode = urlParams.get('admin') === 'true';
        
        if (adminMode) setIsAdmin(true);

        setLoadingStep('init');
        setLoadingProgress(20);

        const data = await fetchOrderData(idPelanggan);
        setOrderData(data);
        
        setLoadingProgress(50);
        setLoadingStep('ai');
        
        await loadGestureModel((p) => {
           setLoadingProgress(50 + (p * 0.4)); // Scale progress to 50-90%
        });

        // Initialize global video for A-Frame
        const rawVideoUrl = data.link_video;
        let videoSrcForTemplate = rawVideoUrl ? getHlsUrl(rawVideoUrl) : '';
        const cachedVideoUrl = await getCachedAssetUrl(rawVideoUrl);
        if (cachedVideoUrl) {
           videoSrcForTemplate = cachedVideoUrl;
        }
        if (videoSrcForTemplate) {
           setupGlobalVideo(videoSrcForTemplate);
        }

        setLoadingStep('ar');
        setLoadingProgress(100);
        setTimeout(() => setHasStarted(true), 500);

      } catch (err: any) {
        console.error('[App] Init error:', err);
        alert(`Error: ${err.message}`); // Will be replaced by proper error UI
      }
    };

    initApp();
  }, []);

  return (
    <div className="app-container">
      <WelcomeModal />
      {!hasStarted && <LoadingScreen />}
      {hasStarted && !envelopeDismissed && <EnvelopeUI />}
      <TutorialOverlay />
      <ARScene />
      <MascotStage />
      <AdminPanel />
    </div>
  );
}

export default App;
