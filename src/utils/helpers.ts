// ===== CLOUDINARY HLS OPTIMIZATION =====
export function getOriginalMp4Url(url: string) {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('res.cloudinary.com') && url.endsWith('.m3u8')) {
    return url.replace('/video/upload/sp_auto/', '/video/upload/').replace('.m3u8', '.mp4');
  }
  return url;
}

export function getHlsUrl(url: string) {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('res.cloudinary.com') && url.endsWith('.mp4')) {
    return url.replace('/video/upload/', '/video/upload/sp_auto/').replace('.mp4', '.m3u8');
  }
  return url;
}

export function getLowQualityVideoUrl(url: string) {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('res.cloudinary.com') && url.includes('/video/upload/')) {
    return url.replace('/video/upload/', '/video/upload/q_auto:low,w_480/');
  }
  return url;
}

// ===== DEVICE DETECTION =====
export const isDesktopDevice = (() => {
  const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const noTouch = !('ontouchstart' in window) && !navigator.maxTouchPoints;
  return !uaMobile && noTouch;
})();

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Enhance getUserMedia for laptop webcam fix (desktop facingMode fix)
export function applyWebcamFix() {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints: any) {
      if (constraints && constraints.video) {
        const facingMode = constraints.video.facingMode;
        const isEnv = facingMode === 'environment' || (facingMode && facingMode.exact === 'environment') || (facingMode && facingMode.ideal === 'environment');

        if (isEnv && isDesktopDevice) {
          console.log('[HM] Desktop detected — removing facingMode constraint for webcam');
          const newConstraints = JSON.parse(JSON.stringify(constraints));
          if (typeof newConstraints.video === 'object') {
            delete newConstraints.video.facingMode;
          }
          return originalGetUserMedia(newConstraints).catch(err => {
            console.warn('[HM] Webcam without facingMode failed, retrying with original constraints:', err.message);
            return originalGetUserMedia(constraints);
          });
        }
      }
      return originalGetUserMedia(constraints);
    };
  }
}
