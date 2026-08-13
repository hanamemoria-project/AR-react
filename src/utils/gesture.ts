import * as tf from '@tensorflow/tfjs';
import * as handpose from '@tensorflow-models/handpose';

let aiModel: handpose.HandPose | null = null;
let isAiLoading = false;

// Caching functions
async function checkModelCache(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open('hana-ar-assets-v1');
    const keys = await cache.keys();
    // Handpose loads multiple shards, we check if any exist
    return keys.some(req => req.url.includes('tfhub.dev') || req.url.includes('handpose'));
  } catch (e) {
    return false;
  }
}

export async function loadGestureModel(onProgress?: (p: number) => void) {
  if (aiModel) return aiModel;
  if (isAiLoading) {
    // Wait until it's loaded
    while (isAiLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return aiModel;
  }

  isAiLoading = true;
  try {
    const isCached = await checkModelCache();
    if (isCached) {
      console.log('[AI] Loading from cache...');
      if (onProgress) onProgress(80);
    } else {
      console.log('[AI] Downloading model from network...');
      // Simulate progress for downloading
      let p = 0;
      const interval = setInterval(() => {
        p += 5;
        if (p < 90 && onProgress) onProgress(p);
      }, 200);
      
      // Tell tfjs to use webgl backend
      await tf.setBackend('webgl');
      await tf.ready();
      
      aiModel = await handpose.load();
      clearInterval(interval);
    }
    
    if (!aiModel) {
      aiModel = await handpose.load();
    }
    
    if (onProgress) onProgress(100);
    console.log('[AI] Model loaded successfully');
    isAiLoading = false;
    return aiModel;
  } catch (err) {
    console.error('[AI] Error loading model:', err);
    isAiLoading = false;
    return null;
  }
}

export async function detectGesture(video: HTMLVideoElement) {
  if (!aiModel || !video) return null;
  
  try {
    const predictions = await aiModel.estimateHands(video);
    if (predictions.length > 0) {
      // Analyze landmarks to determine gesture
      // 0: wrist, 1-4: thumb, 5-8: index, 9-12: middle, 13-16: ring, 17-20: pinky
      const landmarks = predictions[0].landmarks;
      
      // Simple heuristic for detection
      const isThumbUp = landmarks[4][1] < landmarks[3][1] && landmarks[4][1] < landmarks[2][1];
      const isIndexUp = landmarks[8][1] < landmarks[6][1];
      const isMiddleUp = landmarks[12][1] < landmarks[10][1];
      const isRingUp = landmarks[16][1] < landmarks[14][1];
      const isPinkyUp = landmarks[20][1] < landmarks[18][1];

      if (isIndexUp && isMiddleUp && !isRingUp && !isPinkyUp) return 'peace';
      if (!isIndexUp && !isMiddleUp && !isRingUp && !isPinkyUp && isThumbUp) return 'thumb';
      if (isIndexUp && !isMiddleUp && !isRingUp && !isPinkyUp) return 'index';
      if (isIndexUp && isMiddleUp && isRingUp && isPinkyUp) return 'palm';
      if (!isIndexUp && !isMiddleUp && !isRingUp && !isPinkyUp && !isThumbUp) return 'fist';
    }
  } catch (e) {
    // console.warn('[AI] Detection error', e);
  }
  return null;
}
