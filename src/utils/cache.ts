// Caching utilities for offline support

const AR_CACHE_NAME = 'hana-ar-assets-v1';
const AR_DB_NAME = 'hana-ar-db';
const AR_DB_VERSION = 1;

export async function getCachedAssetUrl(url: string): Promise<string | null> {
  if (!url || typeof url !== 'string') return null;
  try {
      const cache = await caches.open(AR_CACHE_NAME);
      const response = await cache.match(url);
      if (response) {
          const blob = await response.blob();
          return URL.createObjectURL(blob);
      }
  } catch (e) {
      console.warn('[HM-Cache] Cache read failed:', e);
  }
  return null;
}

export async function isAssetCached(url: string): Promise<boolean> {
  if (!url || typeof url !== 'string') return false;
  try {
      const cache = await caches.open(AR_CACHE_NAME);
      const response = await cache.match(url);
      return !!response;
  } catch (e) {
      return false;
  }
}

// Minimal polyfill for indexedDB
function openARDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
      const request = indexedDB.open(AR_DB_NAME, AR_DB_VERSION);
      request.onupgradeneeded = (e: any) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('orders')) {
              db.createObjectStore('orders', { keyPath: 'id' });
          }
      };
      request.onsuccess = (e: any) => resolve(e.target.result);
      request.onerror = (e: any) => reject(e.target.error);
  });
}

export async function getCachedOrder(id: string): Promise<any> {
  try {
      const db = await openARDB();
      return new Promise((resolve) => {
          const tx = db.transaction('orders', 'readonly');
          const store = tx.objectStore('orders');
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result?.data || null);
          req.onerror = () => resolve(null);
      });
  } catch (e) {
      console.warn('[HM-Cache] IndexedDB read failed:', e);
      return null;
  }
}

export async function setCachedOrder(id: string, data: any): Promise<boolean> {
  try {
      const db = await openARDB();
      return new Promise((resolve) => {
          const tx = db.transaction('orders', 'readwrite');
          const store = tx.objectStore('orders');
          store.put({ id, data, cachedAt: Date.now() });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
      });
  } catch (e) {
      console.warn('[HM-Cache] IndexedDB write failed:', e);
      return false;
  }
}
