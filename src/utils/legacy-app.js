const WORKER_URL = 'https://hm-backend.hanamemoria.workers.dev';

// ===== OFFLINE-FIRST CACHING SYSTEM =====
const AR_DB_NAME = 'hana-ar-db';
const AR_DB_VERSION = 1;
const AR_CACHE_NAME = 'hana-ar-assets-v1';

// --- IndexedDB for order data ---
function openARDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(AR_DB_NAME, AR_DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('orders')) {
                db.createObjectStore('orders', { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getCachedOrder(id) {
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

async function setCachedOrder(id, data) {
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

// --- Cache API for binary assets (video, .mind files) ---
async function cacheAssetFile(url, onProgress) {
    if (!url || typeof url !== 'string') return false;
    try {
        const cache = await caches.open(AR_CACHE_NAME);
        // Check if already cached
        const existing = await cache.match(url);
        if (existing) {
            console.log('[HM-Cache] Already cached:', url.substring(0, 80));
            return true;
        }

        // Download with progress tracking
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;

        if (!response.body || !total || typeof ReadableStream === 'undefined') {
            // Fallback: no progress tracking possible
            const blob = await response.blob();
            const cacheResponse = new Response(blob, {
                headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' }
            });
            await cache.put(url, cacheResponse);
            if (onProgress) onProgress(100);
            console.log('[HM-Cache] Cached (no progress):', url.substring(0, 80));
            return true;
        }

        // Stream with progress
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (onProgress && total > 0) {
                onProgress(Math.round((received / total) * 100));
            }
        }

        const blob = new Blob(chunks);
        const cacheResponse = new Response(blob, {
            headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' }
        });
        await cache.put(url, cacheResponse);
        console.log('[HM-Cache] Cached with progress:', url.substring(0, 80), `(${(received / 1024 / 1024).toFixed(1)}MB)`);
        return true;
    } catch (e) {
        console.warn('[HM-Cache] Failed to cache asset:', url.substring(0, 80), e.message);
        return false;
    }
}

async function getCachedAssetUrl(url) {
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

async function isAssetCached(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const cache = await caches.open(AR_CACHE_NAME);
        const response = await cache.match(url);
        return !!response;
    } catch (e) {
        return false;
    }
}

// Get the original MP4 URL from an HLS URL (for caching the source file)
function getOriginalMp4Url(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.includes('res.cloudinary.com') && url.endsWith('.m3u8')) {
        return url.replace('/video/upload/sp_auto/', '/video/upload/').replace('.m3u8', '.mp4');
    }
    return url;
}

// ===== CLOUDINARY HLS OPTIMIZATION =====
function getHlsUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.includes('res.cloudinary.com') && url.endsWith('.mp4')) {
        return url.replace('/video/upload/', '/video/upload/sp_auto/').replace('.mp4', '.m3u8');
    }
    return url;
}

// Low quality fallback for weak signal (480p, compressed)
function getLowQualityVideoUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.includes('res.cloudinary.com') && url.includes('/video/upload/')) {
        // Insert Cloudinary transformation for low quality
        return url.replace('/video/upload/', '/video/upload/q_auto:low,w_480/');
    }
    return url;
}

// ===== WEBCAM LAPTOP SUPPORT FIX (IMPROVED) =====
const _isDesktopDevice = (() => {
    const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const noTouch = !('ontouchstart' in window) && !navigator.maxTouchPoints;
    // iPad Pro reports as Mac in UA, but has touch — so it's NOT desktop
    return !uaMobile && noTouch;
})();
console.log('[HM] Device detection — isDesktop:', _isDesktopDevice, 'UA:', navigator.userAgent.substring(0, 60));

const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
        if (constraints && constraints.video) {
            const facingMode = constraints.video.facingMode;
            const isEnv = facingMode === 'environment' || (facingMode && facingMode.exact === 'environment') || (facingMode && facingMode.ideal === 'environment');

            if (isEnv && _isDesktopDevice) {
                // Desktop/laptop: hapus facingMode agar webcam depan bisa menyala
                console.log('[HM] Desktop detected — removing facingMode constraint for webcam');
                const newConstraints = JSON.parse(JSON.stringify(constraints));
                if (typeof newConstraints.video === 'object') {
                    delete newConstraints.video.facingMode;
                }
                // Coba dulu tanpa facingMode, fallback ke original jika gagal
                return originalGetUserMedia(newConstraints).catch(err => {
                    console.warn('[HM] Webcam without facingMode failed, retrying with original constraints:', err.message);
                    return originalGetUserMedia(constraints);
                });
            }
        }
        return originalGetUserMedia(constraints);
    };
}

// Inject AR Mascot Popup dynamically to bypass HTML cache
if (!document.getElementById('ar-mascot-popup')) {
    const style = document.createElement('style');
    style.innerHTML = `
        #ar-mascot-popup { position: fixed; bottom: 30px; right: 20px; z-index: 9999; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; transform: translateY(150%) scale(0.8); transition: transform 0.6s cubic-bezier(0.68, -0.55, 0.27, 1.55), opacity 0.5s ease; opacity: 0; }
        #ar-mascot-popup.show { transform: translateY(0) scale(1) !important; opacity: 1 !important; }
        #ar-mascot-speech { background: white; color: #4a3b3d; padding: 10px 18px; border-radius: 20px; font-family: 'Poppins', sans-serif; font-size: 14px; font-weight: 500; box-shadow: 0 8px 20px rgba(0,0,0,0.15); margin-bottom: 12px; position: relative; animation: floatSpeech 2.5s ease-in-out infinite; }
        #ar-mascot-speech::after { content: ''; position: absolute; bottom: -8px; right: 40px; border-width: 8px 8px 0; border-style: solid; border-color: white transparent transparent transparent; }
        #ar-mascot-popup img { width: 110px; height: auto; filter: drop-shadow(0 5px 15px rgba(0,0,0,0.25)); animation: mascotWobble 3.5s ease-in-out infinite; }
        @keyframes floatSpeech { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes mascotWobble { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
        .letter-tap-hint {
            background: rgba(226, 180, 189, 0.15) !important;
            border: 1px solid rgba(226, 180, 189, 0.8) !important;
            color: #5c3d1e !important;
            padding: 4px 15px !important;
            border-radius: 20px !important;
            display: inline-block !important;
            font-weight: 500 !important;
            margin-top: 15px !important;
            box-shadow: 0 4px 10px rgba(0,0,0,0.05);
        }
    `;
    document.head.appendChild(style);

    const popup = document.createElement('div');
    popup.id = 'ar-mascot-popup';
    popup.style.display = 'none';
    popup.innerHTML = `
        <div id="ar-mascot-speech">Sst... videonya sudah mulai! ✨</div>
        <img src="https://pub-02d853231cff4efa92ee6754c646a898.r2.dev/Animasi/1000283700-removebg-preview.png" alt="Hana">
    `;

    if (document.body) {
        document.body.appendChild(popup);
    } else {
        document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(popup); });
    }
}

const params = new URLSearchParams(window.location.search);
const rawId = params.get('id') || '';
const idValid = /^[a-zA-Z0-9_-]{1,80}$/.test(rawId);
const idPelanggan = idValid ? rawId : 'demo';

if (!idValid && rawId !== 'demo') {
    const newParams = new URLSearchParams(params);
    newParams.set('id', 'demo');
    window.location.replace(window.location.pathname + '?' + newParams.toString());
}

// ===== DEMO DATA (fallback saat mode preview tanpa ID pelanggan) =====
const DEMO_DATA = {
    link_target: 'https://cdn.jsdelivr.net/gh/nicolo-ribaudo/mindar-image-demo@main/targets.mind',
    link_video: 'https://pub-02d853231cff4efa92ee6754c646a898.r2.dev/Animasi/1000283700-removebg-preview.png',
    video_posisi: '0 0 0',
    video_skala: '1 1.5 1',
    video_rotasi: '0 0 0',
    jenis_pesanan: 'Gantungan Kunci',
    orientasi: 'portrait',
    link_frame: 'Selamat.png',
    nama_pelanggan: 'Demo User',
    slides: null
};

let slides = [];
let slideIndex = 0;
let sceneARTemplate = "";
let currentLang = 'id';

// A-Frame component for depth mask (hider material)
if (typeof AFRAME !== 'undefined' && !AFRAME.components['hider-material']) {
    AFRAME.registerComponent('hider-material', {
        init: function () {
            let applyHider = () => {
                let mesh = this.el.getObject3D('mesh');
                if (mesh) {
                    mesh.traverse(function (node) {
                        if (node.isMesh) {
                            node.material.colorWrite = false;
                        }
                    });
                }
            };
            this.el.addEventListener('model-loaded', applyHider);
            // Apply immediately in case it's a primitive (like a-plane) that loads synchronously
            applyHider();
        }
    });
}

// A-Frame component for subtle floating animation (hologram effect)
if (typeof AFRAME !== 'undefined' && !AFRAME.components['float-anim']) {
    AFRAME.registerComponent('float-anim', {
        schema: {
            amplitude: { type: 'number', default: 0.015 },
            speed: { type: 'number', default: 1.5 }
        },
        init: function () {
            this.startY = this.el.object3D.position.y;
            this.time = 0;
        },
        tick: function (t, dt) {
            this.time += (dt / 1000) * this.data.speed;
            this.el.object3D.position.y = this.startY + Math.sin(this.time) * this.data.amplitude;
        }
    });
}

// A-Frame component: video-cover (object-fit: cover untuk video AR)
// Memotong video secara cerdas agar pas dengan bidang AR tanpa bantet/gepeng.
if (typeof AFRAME !== 'undefined' && !AFRAME.components['video-cover']) {
    AFRAME.registerComponent('video-cover', {
        schema: {
            planeRatio: { type: 'number', default: 0.5625 } // default 9:16
        },
        init: function () {
            this._applied = false;
            const videoEl = this.el.components.material?.material?.map?.image;
            if (videoEl && videoEl.videoWidth) {
                this._applyUV(videoEl);
            }
            // Jika video belum siap, tunggu event loadeddata
            this.el.addEventListener('materialvideoloadeddata', () => {
                const v = this.el.components.material?.material?.map?.image;
                if (v) this._applyUV(v);
            });
        },
        _applyUV: function (video) {
            if (this._applied) return;
            const mesh = this.el.getObject3D('mesh');
            if (!mesh || !mesh.geometry) return;

            const videoRatio = video.videoWidth / video.videoHeight; // misal 0.5625 (9:16)
            const planeRatio = this.data.planeRatio;                // misal 0.8 (4:5)

            let uScale = 1, vScale = 1, uOffset = 0, vOffset = 0;

            if (videoRatio < planeRatio) {
                // Video lebih ramping dari plane → potong atas/bawah
                vScale = videoRatio / planeRatio;
                vOffset = (1 - vScale) / 2;
            } else {
                // Video lebih lebar dari plane → potong kiri/kanan
                uScale = planeRatio / videoRatio;
                uOffset = (1 - uScale) / 2;
            }

            const texture = this.el.components.material?.material?.map;
            if (texture) {
                texture.offset.set(uOffset, vOffset);
                texture.repeat.set(uScale, vScale);
                texture.needsUpdate = true;
                this._applied = true;
            }
        }
    });
}


const adminTokenParam = params.get('admin') || '';
let isAdmin = false;
let adminPosX = 0, adminPosY = 0, adminW = 1, adminH = 1.5, adminRotZ = 0;
let adminBasePx = 320;
let framePosX = 0, framePosY = 0, frameW = 1, frameH = 1.5;

async function verifyAdminAccess(token) {
    if (!token) return false;
    try {
        const res = await fetch(`${WORKER_URL}/verify-admin`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        if (!res.ok) return false;
        const { valid } = await res.json();
        return valid === true;
    } catch { return false; }
}

let scene, camera, renderer, clock;
let particles, particleMaterial;
let mpCameraInstance = null;

const particleCount = 400;
const patternData = {};
let isAnimating = false;
let isProcessingAI = false;
let consecutiveGestures = 0;

const shapesPool = ['singularity', 'heart', 'tulip', 'frame'];

const sequenceGestures = [
    { req: 'fist', text: { id: '✊ (Genggam)', en: '✊ (Fist)' } },
    { req: 'peace', text: { id: '✌️ (Peace / 2 Jari)', en: '✌️ (Peace / 2 Fingers)' } },
    { req: 'index', text: { id: '☝️ (Satu Jari Telunjuk)', en: '☝️ (Pointing)' } },
    { req: 'open_palm', text: { id: '🖐️ (Telapak Terbuka)', en: '🖐️ (Open Palm)' } },
    { req: 'thumb_up', text: { id: '👍 (Jempol)', en: '👍 (Thumb Up)' } }
];

const UNIVERSAL_SLIDES = [
    {
        t: { id: "Untuk Kamu ✨", en: "For You ✨" },
        b: { id: "Ada sesuatu yang ingin disampaikan — bukan sekadar kata, tapi rasa yang ingin dijaga.", en: "There is something to be conveyed — not just words, but feelings meant to be kept." }
    },
    {
        t: { id: "Melintasi Waktu ⏳", en: "Across Time ⏳" },
        b: { id: "Waktu mungkin berlalu, namun kenangan indah akan selalu menemukan jalannya untuk kembali.", en: "Time may pass, but beautiful memories will always find their way back." }
    },
    {
        t: { id: "Keajaiban Menanti 🌟", en: "Magic Awaits 🌟" },
        b: { id: "Arahkan kamera ke foto fisikmu, dan saksikan momen tersebut hidup kembali di hadapanmu.", en: "Point your camera at the physical photo, and watch the moment come alive before you." }
    }
];

// ===== I18N =====
const i18n = {
    id: {
        demo_banner: 'MODE PREVIEW — Bukan AR Sebenarnya',
        admin_title: 'Admin — Pengaturan Video',
        hide: '▲ Sembunyikan',
        preview: 'PREVIEW',
        dim_label: '16:9',
        position: 'POSISI',
        scale: 'SKALA',
        rotation: 'ROTASI',
        width_short: 'W',
        height_short: 'H',
        save: 'SIMPAN',
        current: 'Nilai saat ini:',
        loading_tagline: 'Mengabadikan cerita dalam setiap bingkai.',
        loading_initial: 'Menyiapkan Memori...',
        step_init: 'Menghubungkan ke server',
        step_ai: 'Memuat AI gestur',
        step_ar: 'Memuat pemindai AR',
        error_title: 'Terjadi Kesalahan',
        error_camera_denied: 'Kamera tidak tersedia. Pastikan kamu sudah mengizinkan akses kamera di browser.',
        error_no_data: 'Data tidak ditemukan. Pastikan URL valid.',
        error_network: 'Koneksi terputus. Periksa jaringan internetmu.',
        error_generic: 'Terjadi kesalahan yang tidak diketahui.',
        error_expired: 'Masa aktif kenangan ini telah berakhir. Hubungi Hana Memoria untuk perpanjangan.',
        try_again: '🔄 Coba Lagi',
        gesture_guide_title: 'Panduan Gestur',
        gesture_hint_label: 'Tunjukkan:',
        gdf_waiting: 'Mendeteksi...',
        gdf_match: 'Tepat! ✓',
        status_ready: 'Siap',
        status_downloading: 'Mengunduh AI (~10MB)...',
        status_requesting: 'Meminta Akses Kamera...',
        status_active: 'Sensor Tangan Aktif',
        status_error: 'Error',
        tutorial_title: 'Fokus ke Foto',
        tutorial_desc: 'Arahkan kameramu tepat ke foto fisik,<br>saksikan momen indah bersemi kembali. 🌸',
        preview_mascot: 'Lihat Maskot',
        gtm_header: 'Gestur yang Didukung:',
        gesture_fist: 'Genggam',
        gesture_peace: 'Peace',
        gesture_index: 'Telunjuk',
        gesture_palm: 'Telapak',
        gesture_thumb: 'Jempol',
        tap_hint: 'ketuk aku ✨',
        replay: '🔁 Ulang Pesan',
        tagline: 'Mengabadikan cerita dalam setiap bingkai.',
        start_btn: 'Mulai Pengalaman AR ✨',
        video_panel_title: '🎬 VIDEO KENANGAN'
    },
    en: {
        demo_banner: 'PREVIEW MODE — Not Real AR',
        admin_title: 'Admin — Video Settings',
        hide: '▲ Hide',
        preview: 'PREVIEW',
        dim_label: '16:9',
        position: 'POSITION',
        scale: 'SCALE',
        rotation: 'ROTATION',
        width_short: 'W',
        height_short: 'H',
        save: 'SAVE',
        current: 'Current values:',
        loading_tagline: 'Preserving stories in every frame.',
        loading_initial: 'Preparing Memories...',
        step_init: 'Connecting to server',
        step_ai: 'Loading gesture AI',
        step_ar: 'Loading AR scanner',
        error_title: 'An Error Occurred',
        error_camera_denied: 'Camera not available. Please allow camera access in your browser settings.',
        error_no_data: 'Data not found. Please ensure the URL is valid.',
        error_network: 'Connection lost. Please check your internet.',
        error_generic: 'An unknown error occurred.',
        error_expired: 'The active period for this memory has ended. Please contact Hana Memoria for extension.',
        try_again: '🔄 Try Again',
        gesture_guide_title: 'Gesture Guide',
        gesture_hint_label: 'Show:',
        gdf_waiting: 'Detecting...',
        gdf_match: 'Correct! ✓',
        status_ready: 'Ready',
        status_downloading: 'Downloading AI (~10MB)...',
        status_requesting: 'Requesting Camera...',
        status_active: 'Hand Sensor Active',
        status_error: 'Error',
        tutorial_title: 'Focus on the Photo',
        tutorial_desc: 'Point your camera at the physical photo,<br>and watch beautiful moments come alive. 🌸',
        preview_mascot: 'View Mascot',
        gtm_header: 'Supported Gestures:',
        gesture_fist: 'Fist',
        gesture_peace: 'Peace',
        gesture_index: 'Point',
        gesture_palm: 'Palm',
        gesture_thumb: 'Thumb',
        tap_hint: 'tap me ✨',
        replay: '🔁 Replay Messages',
        tagline: 'Preserving stories in every frame.',
        start_btn: 'Start AR Experience ✨',
        video_panel_title: '🎬 MEMORY VIDEO'
    }
};

function t(key) {
    return (i18n[currentLang] && i18n[currentLang][key]) ? i18n[currentLang][key] : (i18n.id[key] || key);
}

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.innerHTML = t(key);
    });
}

function switchLanguage(lang) {
    currentLang = lang;
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });

    // Move pill background
    const pill = document.getElementById('lang-pill-bg');
    if (pill) {
        if (lang === 'en') {
            pill.style.transform = 'translateX(38px)';
        } else {
            pill.style.transform = 'translateX(0)';
        }
    }

    applyI18n();
    updateGestureGuide();
    updateCardUI();
    if (slides.length > 0 && slideIndex < slides.length) {
        const tl = document.getElementById('tagline-hand');
        if (tl) tl.innerText = t('tagline');
    }
}

// ===== RIPPLE EFFECT =====
function createRipple(e) {
    const container = document.getElementById('ripple-container');
    const rect = e.target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - size / 2;
    const y = e.clientY - size / 2;
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.style.width = ripple.style.height = size + 'px';
    container.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
}

document.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (btn && !btn.disabled) createRipple(e);
});

// ===== CONFETTI =====
function triggerConfetti() {
    const container = document.getElementById('confetti-container');
    const emojis = ['🌸', '✨', '⭐', '🌷', '💫', '🌺', '🎉', '💐'];
    for (let i = 0; i < 30; i++) {
        const el = document.createElement('div');
        el.className = 'confetti-piece';
        el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        el.style.left = Math.random() * 100 + 'vw';
        el.style.fontSize = (12 + Math.random() * 14) + 'px';
        el.style.animationDuration = (2 + Math.random() * 2.5) + 's';
        el.style.animationDelay = Math.random() * 0.8 + 's';
        container.appendChild(el);
        setTimeout(() => el.remove(), 5000);
    }
}

// ===== LOADING PROGRESS =====
function setLoadingStep(stepId, state) {
    const el = document.getElementById(stepId);
    if (!el) return;
    el.classList.remove('done', 'active');
    if (state === 'done') el.classList.add('done');
    else if (state === 'active') el.classList.add('active');
    const icon = el.querySelector('.step-icon');
    if (icon) {
        icon.textContent = state === 'done' ? '✓' : (state === 'active' ? '◐' : '○');
    }
}

function setLoadingProgress(pct, statusText) {
    const fill = document.getElementById('loading-progress-fill');
    const status = document.getElementById('loading-status');
    if (fill) fill.style.width = pct + '%';
    if (status && statusText) status.textContent = statusText;
}

// ===== ERROR OVERLAY =====
let errorRetryCallback = null;
function showError(messageKey, retryCb) {
    const overlay = document.getElementById('error-overlay');
    const msg = document.getElementById('error-message');
    overlay.classList.add('visible');
    msg.textContent = t(messageKey);
    errorRetryCallback = retryCb;
}
function hideError() {
    document.getElementById('error-overlay').classList.remove('visible');
    errorRetryCallback = null;
}
window.handleErrorRetry = function () {
    hideError();
    if (errorRetryCallback) errorRetryCallback();
};

// ===== DEMO BANNER =====
function showDemoBanner() {
    document.getElementById('demo-banner').classList.add('visible');
}
function hideDemoBanner() {
    document.getElementById('demo-banner').classList.remove('visible');
}

// ===== GESTURE GUIDE PANEL =====
function buildGestureGuide() {
    const container = document.getElementById('gesture-cards-container');
    container.innerHTML = '';
    const total = slides.length > 0 ? slides.length : 3;
    const gests = sequenceGestures.slice(0, total);
    gests.forEach((g, i) => {
        const card = document.createElement('div');
        card.className = 'gesture-card';
        card.id = `gesture-card-${i}`;
        card.innerHTML = `
            <span class="gc-icon">${g.text.id.split(' ')[0]}</span>
            <span class="gc-label">${currentLang === 'id' ? g.text.id.split('(')[1]?.replace(')', '') || g.text.id : g.text.en.split('(')[1]?.replace(')', '') || g.text.en}</span>
        `;
        container.appendChild(card);
    });
    document.getElementById('gesture-total-steps').textContent = total;
}

function updateGestureGuide() {
    if (slides.length === 0) return;
    const total = slides.length;
    const gests = sequenceGestures.slice(0, total);

    document.getElementById('gesture-current-step').textContent = slideIndex + 1;
    const progressPct = total > 0 ? (slideIndex / total) * 100 : 0;
    document.getElementById('gesture-progress-fill').style.width = progressPct + '%';

    gests.forEach((g, i) => {
        const card = document.getElementById(`gesture-card-${i}`);
        if (!card) return;
        card.classList.remove('active', 'done');
        if (i < slideIndex) card.classList.add('done');
        else if (i === slideIndex) card.classList.add('active');
    });

    const currentGesture = gests[slideIndex % gests.length];
    const hintName = document.getElementById('gesture-hint-name');
    if (hintName) {
        hintName.textContent = currentGesture.text[currentLang] || currentGesture.text.id;
    }
}

// ===== GESTURE DETECTION FEEDBACK =====
let gdfVisible = false;
function showGDF() {
    if (gdfVisible) return;
    gdfVisible = true;
    document.getElementById('gesture-detection-feedback').classList.add('visible');
}
function hideGDF() {
    gdfVisible = false;
    document.getElementById('gesture-detection-feedback').classList.remove('visible');
}
function updateGDF(detected, matched, count) {
    const icon = document.getElementById('gdf-icon');
    const text = document.getElementById('gdf-text');
    const progress = document.getElementById('gdf-svg-progress');
    const countEl = document.getElementById('gdf-count');

    icon.className = '';
    text.className = '';

    if (matched) {
        icon.textContent = '✓';
        icon.classList.add('match');
        text.textContent = t('gdf_match');
        text.classList.add('match');
        progress.classList.add('match');
        triggerConfetti();
    } else if (detected) {
        icon.textContent = '✋';
        icon.classList.add('detecting');
        text.textContent = t('gdf_waiting');
        progress.classList.remove('match');
    } else {
        icon.textContent = '✋';
        text.textContent = t('gdf_waiting');
        progress.classList.remove('match');
    }

    const circumference = 163.36;
    progress.style.strokeDashoffset = circumference - (circumference * count / 3);
    countEl.textContent = `${count}/3`;
}

// ===== STATUS BAR =====
function updateStatus(key, isActive, isError) {
    const dot = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    if (!dot || !text) return;
    dot.className = 'dot' + (isActive ? ' active' : '') + (isError ? ' error' : '');
    text.textContent = t(key);
}

// ===== CARD UI =====
function updateCardUI() {
    if (slides.length > 0 && slideIndex < slides.length) {
        const slide = slides[slideIndex];
        const wrapper = document.getElementById('card-text-wrapper');
        if (!wrapper) return;

        // Initialize Story Progress Dots if empty
        const progressContainer = document.getElementById('story-progress-container');
        if (progressContainer && progressContainer.children.length === 0) {
            progressContainer.innerHTML = '';
            for (let i = 0; i < slides.length; i++) {
                const dotWrap = document.createElement('div');
                dotWrap.style.display = 'flex';
                dotWrap.style.alignItems = 'center';
                dotWrap.style.gap = '4px';

                const dot = document.createElement('div');
                dot.className = 'dot';

                const label = document.createElement('span');
                label.style.fontSize = '9px';
                label.style.opacity = '0.7';
                label.innerText = (i + 1).toString();

                dotWrap.appendChild(dot);
                dotWrap.appendChild(label);
                progressContainer.appendChild(dotWrap);
            }
        }

        // Update filled dots
        if (progressContainer) {
            const dots = progressContainer.children;
            for (let i = 0; i < dots.length; i++) {
                const theDot = dots[i].querySelector('.dot');
                if (i <= slideIndex) theDot.classList.add('active');
                else theDot.classList.remove('active');
            }
        }

        let titleText = slide.t || "Hana Memoria";
        let bodyText = slide.b || "...";

        const staticDict = {
            "Untuk Kamu ✨": { en: "For You ✨", id: "Untuk Kamu ✨" },
            "Ada sesuatu yang ingin disampaikan — bukan sekadar kata, tapi rasa yang ingin dijaga.": { en: "There is something to be conveyed — not just words, but feelings meant to be kept.", id: "Ada sesuatu yang ingin disampaikan — bukan sekadar kata, tapi rasa yang ingin dijaga." }
        };

        if (typeof titleText === 'object') titleText = titleText[currentLang] || titleText['id'];
        else if (staticDict[titleText] && staticDict[titleText][currentLang]) titleText = staticDict[titleText][currentLang];

        if (typeof bodyText === 'object') bodyText = bodyText[currentLang] || bodyText['id'];
        else if (staticDict[bodyText] && staticDict[bodyText][currentLang]) bodyText = staticDict[bodyText][currentLang];

        // Apply with cinematic fade-up effect
        wrapper.classList.add('fade-up');
        setTimeout(() => {
            document.getElementById('card-title').innerText = titleText;
            const descEl = document.getElementById('card-desc');
            typewriterText(descEl, bodyText, 35);
            wrapper.classList.remove('fade-up');
        }, 400);
    }
}

// ===== PARTICLE PATTERNS =====
function randomTriangle(arr, startIdx, count, a, b, c, zNoise = 0.0) {
    let idx = startIdx * 3;
    for (let i = 0; i < count; i++) {
        let r1 = Math.random(), r2 = Math.random();
        if (r1 + r2 > 1.0) { r1 = 1.0 - r1; r2 = 1.0 - r2; }
        arr[idx] = a.x + r1 * (b.x - a.x) + r2 * (c.x - a.x) + (Math.random() - 0.5) * zNoise;
        arr[idx + 1] = a.y + r1 * (b.y - a.y) + r2 * (c.y - a.y) + (Math.random() - 0.5) * zNoise;
        arr[idx + 2] = a.z + r1 * (b.z - a.z) + r2 * (c.z - a.z) + (Math.random() - 0.5) * 0.02;
    }
}
function getScatterPositions() {
    const arr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i++) arr[i] = (Math.random() - 0.5) * 45;
    return arr;
}
function getSingularityPositions() {
    const arr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
        const u = Math.random(), v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        const r = Math.cbrt(Math.random()) * 2.0;
        arr[i] = r * Math.sin(phi) * Math.cos(theta);
        arr[i + 1] = r * Math.sin(phi) * Math.sin(theta);
        arr[i + 2] = r * Math.cos(phi);
    }
    return arr;
}
function getHeartPositions() {
    const arr = new Float32Array(particleCount * 3);
    const scale = 4.5;
    for (let i = 0; i < particleCount * 3; i += 3) {
        let x, y;
        while (true) {
            x = (Math.random() - 0.5) * 3.0;
            y = (Math.random() - 0.5) * 3.0;
            let a = x * x + y * y - 1.0;
            if (a * a * a - x * x * y * y * y <= 0.0) break;
        }
        arr[i] = x * scale;
        arr[i + 1] = y * scale + 1.0;
        arr[i + 2] = (Math.random() - 0.5) * 0.8;
    }
    return arr;
}
function getTulipPositions() {
    const arr = new Float32Array(particleCount * 3);
    let idx = 0;
    const stemCount = Math.floor(particleCount * 0.25);
    const flowerCount = particleCount - stemCount;
    for (let i = 0; i < stemCount; i++) {
        const t = Math.random();
        arr[idx++] = Math.sin(t * 4.0) * 0.3 + (Math.random() - 0.5) * 0.1;
        arr[idx++] = t * 6.0 - 5.0;
        arr[idx++] = (Math.random() - 0.5) * 0.1;
    }
    const flowerBaseY = 1.0;
    for (let i = 0; i < flowerCount; i++) {
        const u = Math.random(), v = Math.random();
        const petalIndex = Math.floor(Math.random() * 6);
        const angleBase = (petalIndex * Math.PI * 2) / 6.0;
        const petalWidthAngle = Math.PI / 2.5;
        const theta = angleBase + (v - 0.5) * petalWidthAngle;
        let r = Math.sin(Math.acos(1 - u * 1.4)) * 2.8;
        if (isNaN(r)) r = 2.0;
        if (u > 0.6) r -= (u - 0.6) * 2.0;
        const tipPinch = Math.sin(v * Math.PI);
        const heightVariation = u * 5.0 + tipPinch * 1.5;
        arr[idx++] = r * Math.cos(theta) + (Math.random() - 0.5) * 0.1;
        arr[idx++] = flowerBaseY + heightVariation + (Math.random() - 0.5) * 0.1;
        arr[idx++] = r * Math.sin(theta) + (Math.random() - 0.5) * 0.1;
    }
    return arr;
}
function getFramePositions() {
    const arr = new Float32Array(particleCount * 3);
    const wOuter = 3.5, hOuter = 5.5, thick = 0.8;
    for (let i = 0; i < particleCount * 3; i += 3) {
        let x, y, z;
        if (Math.random() < 0.70) {
            const edge = Math.random();
            if (edge < 0.25) { x = (Math.random() - 0.5) * wOuter * 2; y = hOuter - Math.random() * thick; }
            else if (edge < 0.5) { x = (Math.random() - 0.5) * wOuter * 2; y = -hOuter + Math.random() * thick; }
            else if (edge < 0.75) { x = -wOuter + Math.random() * thick; y = (Math.random() - 0.5) * hOuter * 2; }
            else { x = wOuter - Math.random() * thick; y = (Math.random() - 0.5) * hOuter * 2; }
        } else {
            x = (Math.random() - 0.5) * (wOuter * 2 - thick * 2);
            y = (Math.random() - 0.5) * (hOuter * 2 - thick * 2);
        }
        z = (Math.random() - 0.5) * 0.5;
        arr[i] = x; arr[i + 1] = y + 0.5; arr[i + 2] = z;
    }
    return arr;
}
function getOpenEnvelopePositions() {
    const arr = new Float32Array(particleCount * 3);
    const w = 7.5, h = 4.5;
    let cBack = Math.floor(particleCount * 0.3);
    let cPaper = Math.floor(particleCount * 0.25);
    let cSide = Math.floor(particleCount * 0.15);
    let cTop = particleCount - cBack - cPaper - (cSide * 2);
    const TL = { x: -w / 2, y: h / 2, z: 0 }, TR = { x: w / 2, y: h / 2, z: 0 };
    const BL = { x: -w / 2, y: -h / 2, z: 0 }, BR = { x: w / 2, y: -h / 2, z: 0 };
    const M = { x: 0, y: 0, z: 0.1 };
    randomTriangle(arr, 0, Math.floor(cBack / 2), TL, TR, BL, 0.0);
    randomTriangle(arr, Math.floor(cBack / 2), cBack - Math.floor(cBack / 2), TR, BR, BL, 0.0);
    const pTL = { x: -w / 2 + 0.5, y: h / 2 + 2.0, z: 0.05 };
    const pTR = { x: w / 2 - 0.5, y: h / 2 + 2.0, z: 0.05 };
    const pBL = { x: -w / 2 + 0.5, y: -h / 2 + 0.5, z: 0.05 };
    const pBR = { x: w / 2 - 0.5, y: -h / 2 + 0.5, z: 0.05 };
    randomTriangle(arr, cBack, Math.floor(cPaper / 2), pTL, pTR, pBL, 0.01);
    randomTriangle(arr, cBack + Math.floor(cPaper / 2), cPaper - Math.floor(cPaper / 2), pTR, pBR, pBL, 0.01);
    randomTriangle(arr, cBack + cPaper, cSide, TL, BL, M, 0.03);
    randomTriangle(arr, cBack + cPaper + cSide, cSide, TR, BR, M, 0.03);
    randomTriangle(arr, cBack + cPaper + cSide * 2, cSide, BL, BR, { x: 0, y: -0.5, z: 0.15 }, 0.03);
    randomTriangle(arr, cBack + cPaper + cSide * 3, cTop, TL, TR, { x: 0, y: h / 2 + 2.5, z: 0.2 }, 0.03);
    for (let i = 0; i < particleCount * 3; i += 3) { arr[i + 1] -= 1.0; }
    return arr;
}

// ===== THREE.JS =====
function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = isMobile() ? 20 : 15;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', onWindowResize);
}

function isMobile() { return window.innerWidth < window.innerHeight; }

function createParticles() {
    patternData['scatter'] = getScatterPositions();
    patternData['singularity'] = getSingularityPositions();
    patternData['heart'] = getHeartPositions();
    patternData['tulip'] = getTulipPositions();
    patternData['frame'] = getFramePositions();
    patternData['openEnvelope'] = getOpenEnvelopePositions();

    clock = new THREE.Clock();
    const geometry = new THREE.BufferGeometry();
    const initialPositions = patternData['scatter'];

    const randoms = new Float32Array(particleCount);
    const scatterDirs = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        randoms[i] = Math.random();
        const theta = Math.random() * Math.PI * 2.0;
        const phi = Math.acos(2.0 * Math.random() - 1.0);
        const speed = 0.3 + Math.random() * 0.7;
        scatterDirs[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
        scatterDirs[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
        scatterDirs[i * 3 + 2] = Math.cos(phi) * speed;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(initialPositions, 3));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('aScatterDir', new THREE.BufferAttribute(scatterDirs, 3));

    particleMaterial = new THREE.ShaderMaterial({
        vertexShader: document.getElementById('vertexShader').textContent,
        fragmentShader: document.getElementById('fragmentShader').textContent,
        uniforms: {
            uTime: { value: 0 },
            uScatter: { value: 0.0 },
            uOpacity: { value: 1.0 },
            uColor: { value: new THREE.Color('#e0bfb8') },
            uSizeMultiplier: { value: isMobile() ? 4.0 : 2.0 }
        },
        transparent: false,
        blending: THREE.NoBlending,
        depthWrite: true,
        depthTest: true
    });
    particles = new THREE.Points(geometry, particleMaterial);
    scene.add(particles);
}

function transitionPattern(shapeName, callback) {
    if (isAnimating) return;
    if (!particles) {
        if (callback) callback();
        return;
    }
    isAnimating = true;

    gsap.to(particleMaterial.uniforms.uScatter, { value: 1.0, duration: 1.0, ease: "power2.in" });
    gsap.to(particleMaterial.uniforms.uOpacity, {
        value: 0.0, duration: 1.0, ease: "power2.in", onComplete: () => {
            const posAttr = particles.geometry.attributes.position;
            const newPositions = patternData[shapeName];
            for (let i = 0; i < particleCount * 3; i++) posAttr.array[i] = newPositions[i];
            posAttr.needsUpdate = true;
            particles.rotation.x = -0.2;
            gsap.to(particleMaterial.uniforms.uOpacity, { value: 1.0, duration: 1.2, ease: "power2.out" });
            gsap.to(particleMaterial.uniforms.uScatter, {
                value: 0.0, duration: 1.2, ease: "power2.out", onComplete: () => {
                    isAnimating = false;
                    if (callback) callback();
                }
            });
        }
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (particles) {
        const elapsedTime = clock.getElapsedTime();
        particleMaterial.uniforms.uTime.value = elapsedTime;
        particles.rotation.y = elapsedTime * 0.4;
        particles.rotation.x = THREE.MathUtils.lerp(particles.rotation.x, -0.2, 0.05);
        renderer.render(scene, camera);
    }
}

function onWindowResize() {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.position.z = isMobile() ? 20 : 15;
        if (particleMaterial) particleMaterial.uniforms.uSizeMultiplier.value = isMobile() ? 4.0 : 2.0;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// ===== MESSAGE FLOW (ENVELOPE) =====
window.startARExperience = function () {
    if (isAnimating) return;
    const btn = document.getElementById('main-start-btn');
    const tagline = document.getElementById('tagline-hand');
    const overlay = document.getElementById('envelope-overlay');

    if (btn) btn.style.opacity = 0;
    if (tagline) tagline.style.opacity = 0;

    const mainUI = document.getElementById('main-ui');
    if (mainUI) mainUI.style.opacity = 0;

    const letterBody = document.getElementById('letter-body');
    const closeBtn = document.getElementById('btn-read-next');
    if (closeBtn) closeBtn.style.opacity = 0; // Hide button initially

    if (letterBody && slides.length > 0) {
        letterBody.innerHTML = ''; // Blank paper initially
        window.letterParts = slides.map(s => s.b).filter(Boolean);
        window.currentLetterPart = 0;
    }

    setTimeout(() => {
        if (btn) btn.style.display = 'none';
        if (tagline) tagline.style.display = 'none';
        if (mainUI) mainUI.style.display = 'none';

        overlay.style.display = 'flex';
        // force reflow
        void overlay.offsetWidth;
        overlay.classList.add('show');
    }, 300);
};

window.openEnvelope = function () {
    requestFullScreen();
    if (window.isEnvelopeOpen) return;
    window.isEnvelopeOpen = true;

    gsap.to(['#wax-seal', '#envelope-hint', '#envelope-mascot'], {
        opacity: 0, duration: 0.3, onComplete: () => {
            const seal = document.getElementById('wax-seal');
            if (seal) seal.style.display = 'none';
            const mascot = document.getElementById('envelope-mascot');
            if (mascot) mascot.style.display = 'none';
            if (typeof triggerHaptic === 'function') triggerHaptic(20);
        }
    });

    // 1. Open the flap
    gsap.to('.top-flap', { rotationX: 180, duration: 0.6, ease: "power1.inOut" });

    // Swap top-flap behind letter
    gsap.set('.top-flap', { zIndex: 0, delay: 0.3 });
    gsap.set('.letter', { zIndex: 4, delay: 0.3 });

    // 2. Pull letter completely OUT of the pocket
    gsap.to('.letter', {
        y: -130, // Bottom edge clears the pocket peak
        duration: 0.5,
        delay: 0.4,
        ease: "power2.out",
        onStart: () => {
            gsap.to('.letter-content', { opacity: 1, duration: 0.4 });
            if (typeof triggerSakura === 'function') triggerSakura();
            if (typeof triggerHaptic === 'function') triggerHaptic(40);
            // Cinematic glow on the envelope
            gsap.to('.envelope', { filter: 'drop-shadow(0 0 25px rgba(201,164,100,0.8))', duration: 1.5, yoyo: true, repeat: 1 });
        }
    });

    // 3. Bring to front and expand over the envelope
    gsap.set('.letter', { zIndex: 10, delay: 0.9 });

    gsap.to('.letter', {
        y: -80, // Drop down to center
        x: -10, // Widen
        width: "320px",
        height: "380px", // Expand downwards
        paddingBottom: "25px", // Normal padding
        duration: 0.7,
        delay: 0.9,
        ease: "back.out(1.1)",
        onComplete: () => {
            const letterBody = document.getElementById('letter-body');
            const letterEl = document.querySelector('.letter');

            // Subtle 3D floating animation to make it feel magical
            gsap.to(letterEl, { y: "-=8", rotationZ: 0.5, rotationX: 2, duration: 2.5, yoyo: true, repeat: -1, ease: "sine.inOut" });

            if (letterBody && window.letterParts && window.letterParts.length > 0) {
                // Populate all parts at once, hidden
                letterBody.innerHTML = window.letterParts.map((part, i) => {
                    let customClass = "part-body";
                    if (window.letterParts.length >= 3) {
                        if (i === 0) customClass = "part-intro";
                        else if (i === window.letterParts.length - 1) customClass = "part-outro";
                    }
                    return `<div class="letter-part ${customClass}" style="opacity: 0; transform: translateY(15px); margin-bottom: 16px; display: none;">${part}</div>`;
                }).join('');

                const parts = Array.from(letterBody.querySelectorAll('.letter-part'));
                let currentIndex = 0;
                let autoAdvanceTimer = null;

                const tapHint = document.getElementById('letter-tap-hint');
                if (tapHint) {
                    gsap.set(tapHint, { display: 'inline-block', opacity: 0 });
                }

                const advanceToNext = () => {
                    currentIndex++;
                    showPart(currentIndex);
                };

                const showPart = (index) => {
                    clearTimeout(autoAdvanceTimer);

                    if (index >= parts.length) {
                        // All parts shown, show the start AR button
                        gsap.to('#btn-read-next', { opacity: 1, duration: 0.8 });
                        if (tapHint) {
                            gsap.to(tapHint, { opacity: 0, duration: 0.5, onComplete: () => tapHint.style.display = 'none' });
                        }
                        if (letterEl) letterEl.onclick = null;
                        return;
                    }

                    const el = parts[index];
                    gsap.set(el, { display: 'block' });

                    // Show tap hint if it's the first text
                    if (tapHint && index === 0) {
                        gsap.to(tapHint, { opacity: 0.8, duration: 1, delay: 1.5 });
                    }

                    gsap.to(el, {
                        opacity: 1,
                        y: 0,
                        duration: 1.2,
                        ease: "power2.out",
                        onComplete: () => {
                            // Dynamic reading time based on text length (min 2.5s)
                            const textLength = el.innerText.length;
                            const readingTime = Math.max(2500, textLength * 50);
                            autoAdvanceTimer = setTimeout(advanceToNext, readingTime);
                        }
                    });

                    if (index === 1 && typeof triggerGoldDust === 'function') {
                        triggerGoldDust();
                    }
                };

                if (letterEl) {
                    letterEl.onclick = () => {
                        clearTimeout(autoAdvanceTimer);

                        // Instantly finish the current part animation so it doesn't look broken
                        if (currentIndex < parts.length) {
                            gsap.killTweensOf(parts[currentIndex]);
                            gsap.set(parts[currentIndex], { opacity: 1, y: 0 });
                        }

                        // Skip to next part immediately
                        advanceToNext();
                    };
                }

                // Start first part
                showPart(0);
            } else {
                gsap.to('#btn-read-next', { opacity: 1, duration: 0.5 });
            }
        }
    });
};

window.closeLetterAndStartAR = function () {
    primeAudio();
    const overlay = document.getElementById('envelope-overlay');

    gsap.to(overlay, {
        opacity: 0,
        scale: 0.9,
        duration: 0.8,
        ease: "power2.in",
        onComplete: () => {
            overlay.classList.remove('show');
            overlay.style.display = 'none';
            document.getElementById('main-ui').style.display = 'none';
            startMindAR();
        }
    });
};

function primeAudio() {
    const magicSound = document.getElementById('magic-sound');
    if (magicSound) {
        magicSound.volume = 0;
        magicSound.play().then(() => {
            magicSound.pause();
            magicSound.currentTime = 0;
            magicSound.volume = 1;
        }).catch(e => console.log('Audio priming blocked:', e));
    }
    
    const vid = document.getElementById('webVideo');
    if (vid) {
        vid.muted = false; 
        vid.volume = 0; // Pastikan benar-benar sunyi saat pancingan
        vid.play().then(() => {
            vid.pause();
            vid.currentTime = 0;
            vid.volume = 1; // Kembalikan volume normal setelah terbuka
            console.log('[HM] webVideo primed successfully for unmuted playback');
        }).catch(e => console.log('[HM] webVideo priming blocked:', e));
    }
}

// Helper untuk setup video secara global agar bisa di-prime
function setupGlobalVideo(src) {
    let vid = document.getElementById('webVideo');
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
        if (typeof _isIOS !== 'undefined' && !_isIOS && typeof Hls !== 'undefined' && Hls.isSupported()) {
            if (window.hmHlsInstance) window.hmHlsInstance.destroy();
            const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
            hls.loadSource(vid.src);
            hls.attachMedia(vid);
            window.hmHlsInstance = hls;
        }
    }
}



// ===== MINDAR AR =====
function startMindAR() {
    console.log('[HM] startMindAR called, sceneARTemplate length:', sceneARTemplate.length);

    if (!sceneARTemplate) {
        console.error('[HM] sceneARTemplate is empty! Cannot start AR.');
        showError('error_generic', () => window.location.reload());
        return;
    }

    try {
        // --- INJECT AR SCANNER LOADING INDICATOR ---
        if (!document.getElementById('ar-loading-indicator')) {
            const style = document.createElement('style');
            style.innerHTML = `
                #ar-loading-indicator {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.85); color: white;
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    z-index: 9998; backdrop-filter: blur(8px);
                    font-family: 'Poppins', sans-serif; font-size: 14px; font-weight: 500; gap: 16px;
                }
                .ar-spinner {
                    width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.2);
                    border-top-color: #c9a464; border-radius: 50%;
                    animation: ar-spin 1s linear infinite;
                }
                @keyframes ar-spin { to { transform: rotate(360deg); } }
            `;
            document.head.appendChild(style);

            const div = document.createElement('div');
            div.id = 'ar-loading-indicator';
            div.innerHTML = `<div class="ar-spinner"></div> <span style="text-align:center; padding: 0 20px; line-height: 1.5; color: #e0bfb8;">Memuat Data AR...<br><small style="font-size:11px; opacity:0.7;">Bisa memakan waktu jika sinyal lambat</small></span>`;
            document.body.appendChild(div);
        } else {
            document.getElementById('ar-loading-indicator').style.display = 'flex';
        }
        // --- END INJECT ---

        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.backgroundColor = 'transparent'; // Reveal camera feed
        const container = document.getElementById('mindar-overlay-container');
        container.classList.add('active');
        document.getElementById('ar-scene-target-container').innerHTML = sceneARTemplate;

        // Prime video texture to avoid black screen without autoplay
        setTimeout(() => {
            const vid = document.getElementById('webVideo');
            if (vid) {
                // Tunggu video siap sebelum prime play (fix iOS blank)
                const primePlay = () => {
                    vid.play().then(() => {
                        console.log('[HM] Video primed successfully');
                        vid.pause();
                        vid.currentTime = 0;
                    }).catch(e => {
                        console.log('[HM] Video prime play blocked (normal on iOS):', e.message);
                    });
                };

                if (vid.readyState >= 2) {
                    primePlay();
                } else {
                    vid.addEventListener('loadeddata', primePlay, { once: true });
                    // Fallback timeout — jika loadeddata tidak fire dalam 3s
                    setTimeout(() => {
                        if (vid.readyState < 2) {
                            console.log('[HM] Video loadeddata timeout, attempting prime anyway');
                            primePlay();
                        }
                    }, 3000);
                }
            }
        }, 200);

        // PENTING: Jangan gunakan backdrop blur — ini menutupi feed kamera di mobile!
        container.style.backdropFilter = 'none';
        container.style.webkitBackdropFilter = 'none';

        if (!sessionStorage.getItem('tutorialSeen')) {
            document.getElementById('tutorial-overlay').style.display = 'flex';
            startScanTipsCarousel();
        } else {
            document.getElementById('tutorial-overlay').style.display = 'none';
        }

        const initAR = () => {
            try {
                const sc = document.getElementById('ar-scene');
                if (sc && sc.systems && sc.systems['mindar-image-system']) {
                    console.log('[HM] Starting MindAR image system...');
                    sc.systems['mindar-image-system'].start();
                } else {
                    console.warn('[HM] MindAR system not ready yet, systems:', sc?.systems ? Object.keys(sc.systems) : 'none');
                }
            } catch (e) {
                console.error('[HM] Error starting MindAR system:', e);
            }
        };

        const scNode = document.getElementById('ar-scene');
        if (scNode) {

            scNode.addEventListener('arReady', () => {
                console.log('[HM] arReady fired!');
                const arInd = document.getElementById('ar-loading-indicator');
                if (arInd) arInd.style.display = 'none';
            });

            // Handle camera conflict (e.g. used by another tab)
            scNode.addEventListener('arError', (event) => {
                console.error('[HM] arError fired (camera in use?):', event);
                if (typeof showErrorWithCountdown === 'function') {
                    showErrorWithCountdown(
                        'Kamera Sedang Digunakan',
                        'Kamera gagal diakses karena sedang dipakai oleh tab atau aplikasi lain. Harap tutup tab browser lain lalu tunggu sebentar.',
                        () => window.location.reload()
                    );
                }
            });

            // Release camera when tab is hidden, restart when visible
            document.addEventListener('visibilitychange', () => {
                try {
                    const sys = scNode.systems && scNode.systems['mindar-image-system'];
                    if (sys) {
                        if (document.hidden) {
                            sys.stop();
                        } else {
                            sys.start();
                        }
                    }
                } catch (e) { }
            });

            if (scNode.hasLoaded) {
                initAR();
            } else {
                scNode.addEventListener('loaded', initAR);
                // Fallback: jika scene tidak pernah fire 'loaded' dalam 10 detik
                setTimeout(() => {
                    if (!scNode.hasLoaded) {
                        console.warn('[HM] Scene load timeout, attempting start anyway...');
                        initAR();
                    }
                }, 10000);
            }
        } else {
            console.error('[HM] ar-scene element not found in DOM after injecting template');
        }
    } catch (e) {
        console.error('[HM] Error in startMindAR:', e);
        showError('error_generic', () => window.location.reload());
    }

    setTimeout(() => {
        const targetAR = document.getElementById('target-ar');
        const vid = document.getElementById('webVideo');
        if (targetAR && vid) {
            if (!document.getElementById('video-buffering-indicator')) {
                const style = document.createElement('style');
                style.innerHTML = `
                    #video-buffering-indicator {
                        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                        background: rgba(0,0,0,0.7); color: white; padding: 12px 24px;
                        border-radius: 30px; font-family: 'Poppins', sans-serif; font-size: 13px;
                        display: none; z-index: 9999; backdrop-filter: blur(5px);
                        align-items: center; gap: 8px; font-weight: 500; text-align: center;
                    }
                    .hm-spinner {
                        width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
                        border-top-color: white; border-radius: 50%;
                        animation: hm-spin 1s linear infinite;
                    }
                    @keyframes hm-spin { to { transform: rotate(360deg); } }
                `;
                document.head.appendChild(style);

                const div = document.createElement('div');
                div.id = 'video-buffering-indicator';
                div.innerHTML = `<div class="hm-spinner"></div> <span>Sinyal lambat, memuat video...</span>`;
                document.body.appendChild(div);
            }

            const ind = document.getElementById('video-buffering-indicator');
            vid.addEventListener('waiting', () => {
                const wrap = document.getElementById('ar-wrapper');
                if (wrap && wrap.getAttribute('scale') && wrap.getAttribute('scale').x > 0) {
                    ind.style.display = 'flex';
                }
            });
            vid.addEventListener('playing', () => { ind.style.display = 'none'; });
            vid.addEventListener('canplay', () => { ind.style.display = 'none'; });
            targetAR.addEventListener('targetLost', () => { ind.style.display = 'none'; });

            let lastVideoTime = 0;
            let firstFound = true;

            // iOS Safari: pastikan video muted agar bisa autoplay
            vid.muted = true;
            vid.playsInline = true;

            // Auto-fallback to low quality video if original fails to load (weak signal)
            let videoFallbackAttempted = false;
            vid.addEventListener('error', () => {
                if (!videoFallbackAttempted && vid.src && !vid.src.startsWith('blob:')) {
                    videoFallbackAttempted = true;
                    const lowQUrl = getLowQualityVideoUrl(vid.src);
                    if (lowQUrl !== vid.src) {
                        console.warn('[HM] Video load error — falling back to low quality:', lowQUrl);
                        vid.src = lowQUrl;
                        vid.load();
                        ind.innerHTML = `<div class="hm-spinner"></div> <span>Memuat video kualitas ringan...</span>`;
                        ind.style.display = 'flex';
                    }
                }
            });

            // If video stalls for too long, also try low quality
            let stallTimer = null;
            vid.addEventListener('stalled', () => {
                if (!videoFallbackAttempted && vid.src && !vid.src.startsWith('blob:')) {
                    stallTimer = setTimeout(() => {
                        videoFallbackAttempted = true;
                        const lowQUrl = getLowQualityVideoUrl(vid.src);
                        if (lowQUrl !== vid.src) {
                            console.warn('[HM] Video stalled 10s — falling back to low quality');
                            vid.src = lowQUrl;
                            vid.load();
                            ind.innerHTML = `<div class="hm-spinner"></div> <span>Sinyal lemah, memuat versi ringan...</span>`;
                            ind.style.display = 'flex';
                        }
                    }, 10000);
                }
            });
            vid.addEventListener('playing', () => { clearTimeout(stallTimer); });

            targetAR.addEventListener("targetFound", () => {
                console.log('[HM] Target FOUND!');
                sessionStorage.setItem('tutorialSeen', 'true');
                document.getElementById('tutorial-overlay').style.display = 'none';
                stopScanTipsCarousel();
                if (typeof triggerHaptic === 'function') triggerHaptic(30);

                // Show Mascot Popup
                const mascotPopup = document.getElementById('ar-mascot-popup');
                if (mascotPopup) {
                    mascotPopup.style.display = 'flex';
                    setTimeout(() => mascotPopup.classList.add('show'), 50);

                    // Hide after 4 seconds
                    setTimeout(() => {
                        mascotPopup.classList.remove('show');
                        setTimeout(() => mascotPopup.style.display = 'none', 600);
                    }, 4000);
                }

                const wrapper = document.getElementById('ar-wrapper');
                if (wrapper && firstFound) {
                    firstFound = false;
                    wrapper.emit('doScale');
                } else if (wrapper) {
                    wrapper.setAttribute('scale', '1 1 1');
                }

                // Magical Sound Effect
                const magicSound = document.getElementById('magic-sound');
                if (magicSound && lastVideoTime === 0) {
                    magicSound.currentTime = 0;
                    magicSound.play().catch(e => console.log('Audio blocked', e));
                }

                if (lastVideoTime > 0) vid.currentTime = lastVideoTime;

                // iOS-safe: play muted dulu, lalu unmute setelah berhasil
                // Dengan retry mechanism untuk iOS yang sering gagal play pertama kali
                const attemptPlay = (retryCount = 0) => {
                    vid.muted = true;
                    vid.playsInline = true;

                    const doPlay = () => {
                        vid.play().then(() => {
                            console.log('[HM] Video playing (muted). Attempting unmute...');
                            // Coba unmute setelah play berhasil — delay lebih lama untuk iOS
                            setTimeout(() => {
                                vid.muted = false;
                                console.log('[HM] Video unmuted successfully');
                                // FIX: Cek apakah browser otomatis pause video karena policy unmute
                                setTimeout(() => {
                                    if (vid.paused) {
                                        console.warn('[HM] Video paused by browser after unmute. Reverting to muted play.');
                                        vid.muted = true;
                                        vid.play().catch(e => console.log('[HM] Muted fallback failed:', e));
                                    }
                                }, 100);
                            }, _isIOS ? 300 : 100);
                        }).catch(e => {
                            console.warn(`[HM] Video play attempt ${retryCount + 1} failed:`, e.message);
                            if (retryCount < 3) {
                                // Retry setelah delay — iOS kadang butuh waktu lebih
                                setTimeout(() => attemptPlay(retryCount + 1), 500 * (retryCount + 1));
                            } else {
                                console.error('[HM] Video play failed after all retries');
                            }
                        });
                    };

                    // Pastikan video ready sebelum play (fix iOS blank screen)
                    if (vid.readyState >= 2) {
                        doPlay();
                    } else {
                        console.log('[HM] Video not ready (readyState:', vid.readyState, '), waiting for loadeddata...');
                        vid.addEventListener('loadeddata', doPlay, { once: true });
                        // Load video jika belum dimulai
                        if (vid.readyState === 0) vid.load();
                        // Fallback timeout
                        setTimeout(() => {
                            if (vid.readyState < 2 && retryCount < 3) {
                                console.log('[HM] Fallback: attempting play despite low readyState');
                                doPlay();
                            }
                        }, 2000);
                    }
                };
                attemptPlay();
            });
            targetAR.addEventListener("targetLost", () => {
                console.log('[HM] Target LOST');
                if (!sessionStorage.getItem('tutorialSeen')) {
                    document.getElementById('tutorial-overlay').style.display = 'flex';
                }
                lastVideoTime = vid.currentTime;
                vid.pause();

                const wrapper = document.getElementById('ar-wrapper');
                if (wrapper) wrapper.setAttribute('scale', '0 0 0');
            });
        } else {
            console.warn('[HM] targetAR or vid element not found. targetAR:', !!targetAR, 'vid:', !!vid);
        }
    }, 500);
}

// ===== AR VIDEO RECORDING (CROSS-PLATFORM) =====
let _arRecorder = null;
let _arRecordedChunks = [];
let _arRecordingStartTime = 0;
let _arRecordTimerInterval = null;
let _arIsRecording = false;

// Deteksi codec yang didukung browser
function _getRecordingMimeType() {
    const candidates = [
        'video/mp4;codecs=avc1',          // iOS Safari (14.3+)
        'video/mp4',                       // iOS fallback
        'video/webm;codecs=vp9,opus',      // Chrome/Android (best)
        'video/webm;codecs=vp8,opus',      // Chrome fallback
        'video/webm;codecs=vp9',           // Chrome tanpa audio
        'video/webm;codecs=vp8',           // Chrome tanpa audio
        'video/webm',                      // Generic webm
    ];
    for (const mimeType of candidates) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType)) {
            console.log('[HM-Rec] Supported mimeType:', mimeType);
            return mimeType;
        }
    }
    console.warn('[HM-Rec] No supported mimeType found!');
    return null;
}

function _getFileExtension(mimeType) {
    if (!mimeType) return 'webm';
    if (mimeType.includes('mp4')) return 'mp4';
    return 'webm';
}

// Inject recording UI dynamically
function _injectRecordingUI() {
    if (document.getElementById('ar-record-btn')) return;

    const style = document.createElement('style');
    style.innerHTML = `
        #ar-record-btn {
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            z-index: 10001; width: 64px; height: 64px; border-radius: 50%;
            background: rgba(30,25,35,0.85); border: 3px solid rgba(255,255,255,0.6);
            display: none; align-items: center; justify-content: center;
            cursor: pointer; backdrop-filter: blur(10px);
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #ar-record-btn:hover { transform: translateX(-50%) scale(1.08); }
        #ar-record-btn:active { transform: translateX(-50%) scale(0.95); }
        #ar-record-btn .rec-dot {
            width: 24px; height: 24px; border-radius: 50%;
            background: #ff3b30; transition: all 0.3s ease;
        }
        #ar-record-btn.recording .rec-dot {
            width: 18px; height: 18px; border-radius: 4px;
            background: #ff3b30; animation: rec-pulse 1.2s ease-in-out infinite;
        }
        #ar-record-btn.recording {
            border-color: #ff3b30;
            box-shadow: 0 0 20px rgba(255, 59, 48, 0.5);
        }
        @keyframes rec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

        #ar-record-timer {
            position: fixed; bottom: 102px; left: 50%; transform: translateX(-50%);
            z-index: 10001; background: rgba(255, 59, 48, 0.9); color: white;
            padding: 4px 14px; border-radius: 20px; font-family: 'Poppins', sans-serif;
            font-size: 13px; font-weight: 600; letter-spacing: 1px;
            display: none; align-items: center; gap: 6px;
            backdrop-filter: blur(5px); box-shadow: 0 2px 10px rgba(255,59,48,0.4);
        }
        #ar-record-timer .rec-live-dot {
            width: 8px; height: 8px; border-radius: 50%; background: white;
            animation: rec-pulse 1s ease-in-out infinite;
        }

        #ar-record-unsupported {
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            z-index: 10001; background: rgba(30,25,35,0.9); color: #e0bfb8;
            padding: 10px 20px; border-radius: 30px; font-family: 'Poppins', sans-serif;
            font-size: 12px; font-weight: 500; display: none; text-align: center;
            backdrop-filter: blur(10px); border: 1px solid rgba(201,164,100,0.3);
        }

        #ar-record-saved-toast {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.8);
            z-index: 10002; background: rgba(30,25,35,0.95); color: white;
            padding: 24px 32px; border-radius: 20px; font-family: 'Poppins', sans-serif;
            display: none; flex-direction: column; align-items: center; gap: 12px;
            backdrop-filter: blur(15px); border: 1px solid rgba(201,164,100,0.4);
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            opacity: 0; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #ar-record-saved-toast.show {
            opacity: 1; transform: translate(-50%, -50%) scale(1);
        }
        #ar-record-saved-toast .saved-icon { font-size: 40px; }
        #ar-record-saved-toast .saved-text { font-size: 15px; font-weight: 600; }
        #ar-record-saved-toast .saved-sub { font-size: 12px; opacity: 0.7; }
        #ar-record-saved-toast .saved-actions { display: flex; gap: 10px; margin-top: 8px; }
        #ar-record-saved-toast .saved-actions button {
            padding: 8px 20px; border-radius: 12px; border: none; cursor: pointer;
            font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 600;
        }
        #ar-record-saved-toast .btn-download {
            background: linear-gradient(135deg, #c9a464, #e0bfb8); color: #1f1b24;
        }
        #ar-record-saved-toast .btn-close-toast {
            background: rgba(255,255,255,0.15); color: white;
        }
    `;
    document.head.appendChild(style);

    // Record button
    const btn = document.createElement('button');
    btn.id = 'ar-record-btn';
    btn.innerHTML = '<div class="rec-dot"></div>';
    btn.onclick = _toggleARRecording;
    document.body.appendChild(btn);

    // Timer display
    const timer = document.createElement('div');
    timer.id = 'ar-record-timer';
    timer.innerHTML = '<div class="rec-live-dot"></div><span id="ar-record-time">00:00</span>';
    document.body.appendChild(timer);

    // Saved toast
    const toast = document.createElement('div');
    toast.id = 'ar-record-saved-toast';
    toast.innerHTML = `
        <div class="saved-icon">✅</div>
        <div class="saved-text">Video AR Tersimpan!</div>
        <div class="saved-sub">Klik unduh untuk menyimpan ke perangkat</div>
        <div class="saved-actions">
            <button class="btn-download" id="ar-record-download-btn">💾 Unduh</button>
            <button class="btn-close-toast" onclick="document.getElementById('ar-record-saved-toast').classList.remove('show'); setTimeout(() => document.getElementById('ar-record-saved-toast').style.display = 'none', 400);">Tutup</button>
        </div>
    `;
    document.body.appendChild(toast);

    // Unsupported message (hidden)
    const unsup = document.createElement('div');
    unsup.id = 'ar-record-unsupported';
    unsup.textContent = '📹 Perekaman video tidak didukung di browser ini';
    document.body.appendChild(unsup);
}

// Show record button when AR is active
function _showRecordButton() {
    _injectRecordingUI();
    const btn = document.getElementById('ar-record-btn');
    if (!btn) return;

    if (typeof MediaRecorder === 'undefined' || !_getRecordingMimeType()) {
        // Browser doesn't support MediaRecorder
        const unsup = document.getElementById('ar-record-unsupported');
        if (unsup) {
            unsup.style.display = 'block';
            setTimeout(() => { unsup.style.display = 'none'; }, 5000);
        }
        return;
    }

    btn.style.display = 'flex';
}

function _hideRecordButton() {
    const btn = document.getElementById('ar-record-btn');
    if (btn) btn.style.display = 'none';
    if (_arIsRecording) _stopARRecording();
}

function _toggleARRecording() {
    if (_arIsRecording) {
        _stopARRecording();
    } else {
        _startARRecording();
    }
}

function _startARRecording() {
    const arScene = document.getElementById('ar-scene');
    if (!arScene) {
        console.error('[HM-Rec] AR scene not found');
        return;
    }

    const canvas = arScene.querySelector('canvas') || arScene.canvas;
    if (!canvas) {
        console.error('[HM-Rec] AR canvas not found');
        return;
    }

    const mimeType = _getRecordingMimeType();
    if (!mimeType) {
        console.error('[HM-Rec] No supported codec found');
        return;
    }

    // Guard: captureStream mungkin tidak tersedia di beberapa browser (terutama iOS Safari lama)
    if (!canvas.captureStream) {
        console.warn('[HM-Rec] canvas.captureStream not supported on this browser');
        const unsup = document.getElementById('ar-record-unsupported');
        if (unsup) {
            unsup.textContent = '📹 Perekaman tidak didukung di browser ini. Coba gunakan Chrome.';
            unsup.style.display = 'block';
            setTimeout(() => { unsup.style.display = 'none'; }, 5000);
        }
        return;
    }

    try {
        // Capture canvas stream (30fps)
        const canvasStream = canvas.captureStream(30);

        // Coba ambil audio dari video AR jika ada
        const vid = document.getElementById('webVideo');
        if (vid && vid.captureStream) {
            try {
                const vidStream = vid.captureStream();
                const audioTracks = vidStream.getAudioTracks();
                audioTracks.forEach(track => canvasStream.addTrack(track));
            } catch (e) {
                console.warn('[HM-Rec] Could not capture video audio:', e.message);
            }
        }

        _arRecordedChunks = [];
        _arRecorder = new MediaRecorder(canvasStream, {
            mimeType: mimeType,
            videoBitsPerSecond: 4000000 // 4 Mbps
        });

        _arRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                _arRecordedChunks.push(event.data);
            }
        };

        _arRecorder.onstop = () => {
            _onRecordingStopped();
        };

        _arRecorder.onerror = (e) => {
            console.error('[HM-Rec] Recording error:', e);
            _stopARRecording();
        };

        _arRecorder.start(1000); // Collect data setiap 1 detik
        _arIsRecording = true;
        _arRecordingStartTime = Date.now();

        // Update UI
        const btn = document.getElementById('ar-record-btn');
        if (btn) btn.classList.add('recording');
        const timer = document.getElementById('ar-record-timer');
        if (timer) timer.style.display = 'flex';

        _arRecordTimerInterval = setInterval(_updateRecordTimer, 1000);
        _updateRecordTimer();

        if (typeof triggerHaptic === 'function') triggerHaptic(30);
        console.log('[HM-Rec] Recording started with codec:', mimeType);

    } catch (e) {
        console.error('[HM-Rec] Failed to start recording:', e);
    }
}

function _stopARRecording() {
    if (_arRecorder && _arRecorder.state !== 'inactive') {
        _arRecorder.stop();
    }
    _arIsRecording = false;

    const btn = document.getElementById('ar-record-btn');
    if (btn) btn.classList.remove('recording');
    const timer = document.getElementById('ar-record-timer');
    if (timer) timer.style.display = 'none';
    clearInterval(_arRecordTimerInterval);

    if (typeof triggerHaptic === 'function') triggerHaptic(20);
    console.log('[HM-Rec] Recording stopped');
}

function _updateRecordTimer() {
    const elapsed = Math.floor((Date.now() - _arRecordingStartTime) / 1000);
    const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const secs = (elapsed % 60).toString().padStart(2, '0');
    const el = document.getElementById('ar-record-time');
    if (el) el.textContent = `${mins}:${secs}`;
}

function _onRecordingStopped() {
    if (_arRecordedChunks.length === 0) {
        console.warn('[HM-Rec] No recorded data');
        return;
    }

    const mimeType = _getRecordingMimeType() || 'video/webm';
    const blob = new Blob(_arRecordedChunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const ext = _getFileExtension(mimeType);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `HanaMemoria_AR_${timestamp}.${ext}`;

    console.log('[HM-Rec] Video saved:', filename, 'Size:', (blob.size / 1024 / 1024).toFixed(1), 'MB');

    // Show saved toast
    const toast = document.getElementById('ar-record-saved-toast');
    if (toast) {
        toast.style.display = 'flex';
        setTimeout(() => toast.classList.add('show'), 50);

        const dlBtn = document.getElementById('ar-record-download-btn');
        if (dlBtn) {
            dlBtn.onclick = () => {
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                // Jangan revoke URL segera — beri waktu download
                setTimeout(() => URL.revokeObjectURL(url), 30000);
            };
        }
    }

    _arRecordedChunks = [];
}

// Hook into AR scene lifecycle — show record button when AR is ready
const _origStartMindAR = startMindAR;
// Monkey-patch: setelah AR siap, tampilkan tombol record
(function() {
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.id === 'ar-scene' || (node.querySelector && node.querySelector('#ar-scene'))) {
                    setTimeout(_showRecordButton, 2000);
                    observer.disconnect();
                    return;
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();

// ===== MASCOT STAGE =====
let arSlides = [];
let arSlideIdx = 0;
let arVideoSrc = null;
let bubbleOpen = false;
let isMuted = false;

function initMascotData(data) {
    let raw = data.slides;
    try { if (typeof raw === 'string') raw = JSON.parse(raw); } catch (e) { }
    arSlides = (Array.isArray(raw) && raw.length > 0 && raw[0].t) ? raw : UNIVERSAL_SLIDES;
    arSlideIdx = 0;
    arVideoSrc = getHlsUrl(data.link_video) || null;
    const v = document.getElementById('ar-video-el');
    if (v && arVideoSrc) {
        if (arVideoSrc.startsWith('blob:')) {
            // Cached video — use directly
            v.src = arVideoSrc;
        } else if (arVideoSrc.includes('.m3u8')) {
            if (_isIOS) {
                // iOS Safari mendukung HLS natively
                v.src = arVideoSrc;
            } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
                hls.loadSource(arVideoSrc);
                hls.attachMedia(v);
            } else {
                v.src = arVideoSrc;
            }
        } else {
            v.src = arVideoSrc;
        }
    }
}

function showMascotStage() {
    const stage = document.getElementById('ar-mascot-stage');
    stage.classList.add('active');
    setTimeout(() => {
        const wrap = document.getElementById('mascot-wrap');
        wrap.classList.add('entered');
        setTimeout(() => openBubble(), 700);
    }, 80);
}

function hideMascotStage() {
    const stage = document.getElementById('ar-mascot-stage');
    stage.classList.remove('active');
    const wrap = document.getElementById('mascot-wrap');
    wrap.classList.remove('entered');
    wrap.style.opacity = '0';
    closeBubble();
    closeVideoPanel();
    setTimeout(() => { wrap.style.opacity = ''; }, 100);
}

function openBubble() {
    arSlideIdx = 0;
    updateBubble();
    document.getElementById('speech-bubble').classList.add('show');
    document.getElementById('mascot-tap-hint').classList.add('hidden');
    document.getElementById('bubble-prev-btn').style.visibility = 'hidden';
    bubbleOpen = true;
}

function closeBubble() {
    document.getElementById('speech-bubble').classList.remove('show');
    document.getElementById('mascot-tap-hint').classList.remove('hidden');
    bubbleOpen = false;
}

function updateBubble() {
    if (arSlides.length > 0) {
        document.getElementById('bubble-slide-title').innerText = arSlides[arSlideIdx].t || "";
        document.getElementById('bubble-slide-body').innerText = arSlides[arSlideIdx].b || "";
        const isLast = arSlideIdx === arSlides.length - 1;
        document.getElementById('bubble-next-btn').innerText = isLast ? (currentLang === 'id' ? 'TUTUP ×' : 'CLOSE ×') : (currentLang === 'id' ? 'LANJUT ›' : 'NEXT ›');
        document.getElementById('bubble-prev-btn').style.visibility = arSlideIdx > 0 ? 'visible' : 'hidden';
    }
}

window.onBubbleNext = function (e) {
    e.stopPropagation();
    if (arSlideIdx < arSlides.length - 1) {
        arSlideIdx++;
        updateBubble();
    } else {
        closeBubble();
    }
};

window.onBubblePrev = function (e) {
    e.stopPropagation();
    if (arSlideIdx > 0) {
        arSlideIdx--;
        updateBubble();
    }
};

window.onBubbleReplay = function (e) {
    e.stopPropagation();
    arSlideIdx = 0;
    updateBubble();
};

window.onMascotTap = function () {
    if (bubbleOpen) closeBubble();
    else openBubble();
};

window.onHeartTap = function (e) {
    e.stopPropagation();
    openVideoPanel();
};

function openVideoPanel() {
    const panel = document.getElementById('video-panel');
    panel.classList.add('show');
    const v = document.getElementById('ar-video-el');
    if (v) {
        v.muted = isMuted;
        v.play().catch(() => { });
    }
    closeBubble();
}

window.closeVideoPanel = function () {
    const panel = document.getElementById('video-panel');
    panel.classList.remove('show');
    const v = document.getElementById('ar-video-el');
    if (v) { v.pause(); v.currentTime = 0; }
};

window.toggleVideoMute = function () {
    isMuted = !isMuted;
    const v = document.getElementById('ar-video-el');
    if (v) v.muted = isMuted;
    document.getElementById('video-mute-icon').textContent = isMuted ? '🔇' : '🔊';
};

window.toggleVideoFullscreen = function () {
    const v = document.getElementById('ar-video-el');
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen();
    else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
};

let isPreviewMode = false;
window.toggleMascotPreview = function () {
    if (isPreviewMode) { closeMascotPreview(); return; }
    isPreviewMode = true;
    const stage = document.getElementById('ar-mascot-stage');
    stage.classList.add('active', 'preview-mode');
    const arContainer = document.getElementById('mindar-overlay-container');
    if (arContainer) arContainer.style.visibility = 'hidden';
    const tutOverlay = document.getElementById('tutorial-overlay');
    if (tutOverlay) tutOverlay.style.opacity = '0';
    const wrap = document.getElementById('mascot-wrap');
    wrap.classList.add('entered');
    setTimeout(() => openBubble(), 700);
};

window.closeMascotPreview = function () {
    isPreviewMode = false;
    const stage = document.getElementById('ar-mascot-stage');
    stage.classList.remove('active', 'preview-mode');
    const arContainer = document.getElementById('mindar-overlay-container');
    if (arContainer) arContainer.style.visibility = 'visible';
    const tutOverlay = document.getElementById('tutorial-overlay');
    if (tutOverlay) tutOverlay.style.opacity = '1';
    hideMascotStage();
};

// ===== ADMIN FUNCTIONS =====
function adminUpdateVideo() {
    const vd = document.getElementById('vDisplay');
    if (vd) {
        vd.setAttribute('position', `${adminPosX.toFixed(2)} ${adminPosY.toFixed(2)} 0`);
        vd.setAttribute('width', adminW.toFixed(2));
        vd.setAttribute('height', adminH.toFixed(2));
        vd.setAttribute('rotation', `0 0 ${adminRotZ}`);
    }
    // Update preview inputs
    const elX = document.getElementById('admin-input-x');
    const elY = document.getElementById('admin-input-y');
    const elW = document.getElementById('admin-input-w');
    const elH = document.getElementById('admin-input-h');
    const elRot = document.getElementById('admin-input-rot');
    const elVals = document.getElementById('admin-current-values');
    if (elX) elX.value = adminPosX.toFixed(2);
    if (elY) elY.value = adminPosY.toFixed(2);
    if (elW) elW.value = adminW.toFixed(2);
    if (elH) elH.value = adminH.toFixed(2);
    if (elRot) elRot.value = Math.round(adminRotZ);
    if (elVals) elVals.textContent =
        `vid: ${adminPosX.toFixed(2)} ${adminPosY.toFixed(2)} ${adminW.toFixed(2)}×${adminH.toFixed(2)} ${Math.round(adminRotZ)}° | frame: ${framePosX.toFixed(2)} ${framePosY.toFixed(2)} ${frameW.toFixed(2)}×${frameH.toFixed(2)}`;
    // Update preview video in 2D panel
    const pv = document.getElementById('admin-preview-video');
    if (pv) {
        if (arVideoSrc && !pv.src.endsWith(arVideoSrc.split('/').pop())) {
            if (arVideoSrc.includes('.m3u8')) {
                if (_isIOS) {
                    // iOS Safari mendukung HLS natively
                    pv.src = arVideoSrc;
                } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                    const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
                    hls.loadSource(arVideoSrc);
                    hls.attachMedia(pv);
                } else {
                    pv.src = arVideoSrc;
                }
            } else {
                pv.src = arVideoSrc;
            }
            pv.play().catch(() => { });
        }
        const basePx = adminBasePx; // Use dynamic basePx
        pv.style.position = 'absolute';
        pv.style.width = `${adminW * basePx}px`;
        pv.style.height = `${adminH * basePx}px`;
        pv.style.left = '50%';
        pv.style.top = '50%';

        const vOffsetX = adminPosX * basePx;
        const vOffsetY = -adminPosY * basePx;
        pv.style.transform = `translate(-50%, -50%) translate(${vOffsetX}px, ${vOffsetY}px) rotate(${-adminRotZ}deg)`;
        pv.style.objectFit = 'fill';
    }

    // Also update frame inputs so they aren't empty initially
    adminUpdateFrame();
}

function adminUpdateFrame() {
    const fe = document.getElementById('frameOverlay');
    if (fe) {
        fe.setAttribute('position', `${framePosX.toFixed(2)} ${framePosY.toFixed(2)} 0.05`);
        fe.setAttribute('width', frameW.toFixed(2));
        fe.setAttribute('height', frameH.toFixed(2));
    }

    // Update frame in 2D panel
    const pf = document.getElementById('admin-preview-frame');
    if (pf) {
        const basePx = adminBasePx; // Use dynamic basePx
        pf.style.position = 'absolute';
        pf.style.width = `${frameW * basePx}px`;
        pf.style.height = `${frameH * basePx}px`;
        pf.style.left = '50%';
        pf.style.top = '50%';

        const fOffsetX = framePosX * basePx;
        const fOffsetY = -framePosY * basePx;
        pf.style.transform = `translate(-50%, -50%) translate(${fOffsetX}px, ${fOffsetY}px)`;
        pf.style.objectFit = 'fill';
    }

    // Update frame inputs
    const elFX = document.getElementById('admin-input-fx');
    const elFY = document.getElementById('admin-input-fy');
    const elFW = document.getElementById('admin-input-fw');
    const elFH = document.getElementById('admin-input-fh');
    if (elFX) elFX.value = framePosX.toFixed(2);
    if (elFY) elFY.value = framePosY.toFixed(2);
    if (elFW) elFW.value = frameW.toFixed(2);
    if (elFH) elFH.value = frameH.toFixed(2);
    // Also update the combined status display
    const elVals = document.getElementById('admin-current-values');
    if (elVals) elVals.textContent =
        `vid: ${adminPosX.toFixed(2)} ${adminPosY.toFixed(2)} ${adminW.toFixed(2)}×${adminH.toFixed(2)} ${Math.round(adminRotZ)}° | frame: ${framePosX.toFixed(2)} ${framePosY.toFixed(2)} ${frameW.toFixed(2)}×${frameH.toFixed(2)}`;
}

window.adminMove = function (dir) {
    if (dir === 'up') adminPosY += 0.05;
    if (dir === 'down') adminPosY -= 0.05;
    if (dir === 'left') adminPosX -= 0.05;
    if (dir === 'right') adminPosX += 0.05;
    adminUpdateVideo();
};

window.adminAdjust = function (type, val) {
    if (type === 'w') adminW = Math.max(0.1, adminW + val);
    if (type === 'h') adminH = Math.max(0.1, adminH + val);
    adminUpdateVideo();
};

window.adminRotate = function (val) {
    adminRotZ += val;
    adminUpdateVideo();
};

window.adminInputChange = function (type, val) {
    const v = parseFloat(val);
    if (isNaN(v)) return;
    if (type === 'x') adminPosX = v;
    if (type === 'y') adminPosY = v;
    if (type === 'w') adminW = Math.max(0.1, v);
    if (type === 'h') adminH = Math.max(0.1, v);
    if (type === 'rot') adminRotZ = v;
    adminUpdateVideo();
};

// ===== ADMIN FRAME FUNCTIONS =====
window.adminFrameMove = function (dir) {
    if (dir === 'up') framePosY += 0.05;
    if (dir === 'down') framePosY -= 0.05;
    if (dir === 'left') framePosX -= 0.05;
    if (dir === 'right') framePosX += 0.05;
    adminUpdateFrame();
};

window.adminFrameAdjust = function (type, val) {
    if (type === 'w') frameW = Math.max(0.1, frameW + val);
    if (type === 'h') frameH = Math.max(0.1, frameH + val);
    adminUpdateFrame();
};

window.adminFrameInputChange = function (type, val) {
    const v = parseFloat(val);
    if (isNaN(v)) return;
    if (type === 'x') framePosX = v;
    if (type === 'y') framePosY = v;
    if (type === 'w') frameW = Math.max(0.1, v);
    if (type === 'h') frameH = Math.max(0.1, v);
    adminUpdateFrame();
};

window.adminToggle = function () {
    const body = document.getElementById('admin-body');
    const toggleText = document.getElementById('admin-toggle-text');
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? '' : 'none';
    toggleText.textContent = isHidden ? t('hide') : (currentLang === 'id' ? '▼ Tampilkan' : '▼ Show');
};

window.adminSimpan = async function () {
    if (!isAdmin) {
        showAdminToast(currentLang === 'id' ? '❌ Akses ditolak' : '❌ Access Denied', true);
        return;
    }
    const payload = {
        token: adminTokenParam,
        id_pesanan: idPelanggan,
        video_posisi: `${adminPosX.toFixed(2)} ${adminPosY.toFixed(2)} 0`,
        video_skala: `${adminW.toFixed(2)} ${adminH.toFixed(2)} 1`,
        video_rotasi: `0 0 ${adminRotZ}`,
        frame_posisi: `${framePosX.toFixed(2)} ${framePosY.toFixed(2)}`,
        frame_skala: `${frameW.toFixed(2)} ${frameH.toFixed(2)}`
    };
    try {
        const res = await fetch(`${WORKER_URL}/update-layout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (result.success) {
            showAdminToast(currentLang === 'id' ? '✅ Tersimpan!' : '✅ Saved!', false);
        } else {
            throw new Error(result.message || 'Unknown error');
        }
    } catch (e) {
        showAdminToast((currentLang === 'id' ? '❌ Gagal simpan: ' : '❌ Save failed: ') + e.message, true);
    }
};

function showAdminToast(msg, isError) {
    const toast = document.getElementById('admin-toast');
    toast.textContent = msg;
    toast.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.className = ''; }, 3000);
}



// ===== OFFLINE CACHING (SERVICE WORKER + PRE-DOWNLOAD) =====
async function cacheAssets(data) {
    // 1. Register Service Worker
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('sw-ar.js');
        } catch (e) {
            console.error('[HM] Failed to register AR Service Worker:', e);
        }
    }

    // 2. Pre-download assets in background (non-blocking)
    if (data) {
        // Don't await — let it run in background
        preDownloadAssets(data).catch(e => console.warn('[HM-Cache] Background pre-download failed:', e));
    }
}

async function preDownloadAssets(data) {
    const videoUrl = data.link_video;
    const mindUrl = data.link_target;

    // Cache the .mind file (critical for AR scanning)
    if (mindUrl) {
        console.log('[HM-Cache] Pre-caching .mind file...');
        await cacheAssetFile(mindUrl);
    }

    // Cache the video file (MP4 source for offline playback)
    if (videoUrl) {
        // Cache the original MP4 (not HLS) for reliable offline playback
        const mp4Url = getOriginalMp4Url(getHlsUrl(videoUrl));
        const sourceUrl = mp4Url.endsWith('.m3u8') ? videoUrl : mp4Url;

        const alreadyCached = await isAssetCached(sourceUrl);
        if (!alreadyCached) {
            console.log('[HM-Cache] Pre-caching video file...');
            showCacheProgress(0);
            await cacheAssetFile(sourceUrl, (pct) => {
                showCacheProgress(pct);
            });
            hideCacheProgress();
        }
    }

    // Cache the frame image
    if (data.link_frame && data.link_frame !== 'none') {
        await cacheAssetFile(data.link_frame);
    }

    console.log('[HM-Cache] All assets pre-cached successfully!');
}

// --- Cache progress indicator (bottom toast) ---
function showCacheProgress(pct) {
    let el = document.getElementById('cache-progress-toast');
    if (!el) {
        const style = document.createElement('style');
        style.innerHTML = `
            #cache-progress-toast {
                position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                background: rgba(30,25,35,0.9); color: #e0bfb8; padding: 10px 20px;
                border-radius: 30px; font-family: 'Poppins', sans-serif; font-size: 12px;
                font-weight: 500; z-index: 10000; backdrop-filter: blur(10px);
                border: 1px solid rgba(201,164,100,0.3); display: flex; align-items: center; gap: 10px;
                box-shadow: 0 8px 25px rgba(0,0,0,0.3);
                animation: cacheToastIn 0.4s ease-out;
            }
            @keyframes cacheToastIn { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
            #cache-progress-toast .cache-bar { width: 80px; height: 4px; background: rgba(255,255,255,0.15); border-radius: 2px; overflow: hidden; }
            #cache-progress-toast .cache-fill { height: 100%; background: linear-gradient(90deg, #c9a464, #e0bfb8); border-radius: 2px; transition: width 0.3s; }
        `;
        document.head.appendChild(style);
        el = document.createElement('div');
        el.id = 'cache-progress-toast';
        el.innerHTML = `<span>💾 Menyimpan ke HP...</span><div class="cache-bar"><div class="cache-fill" style="width:0%"></div></div><span class="cache-pct">0%</span>`;
        document.body.appendChild(el);
    }
    el.style.display = 'flex';
    el.querySelector('.cache-fill').style.width = pct + '%';
    el.querySelector('.cache-pct').textContent = pct + '%';
}

function hideCacheProgress() {
    const el = document.getElementById('cache-progress-toast');
    if (el) {
        el.querySelector('.cache-pct').textContent = '✓';
        el.querySelector('span').textContent = '✅ Tersimpan!';
        el.querySelector('.cache-fill').style.width = '100%';
        setTimeout(() => { el.style.display = 'none'; }, 2500);
    }
}

// ===== MAIN ONLOAD =====
window.onload = async () => {
    // Language setup
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => switchLanguage(btn.getAttribute('data-lang')));
    });
    applyI18n();

    // Loading progress
    setLoadingProgress(10, t('loading_initial'));
    setLoadingStep('step-init', 'active');

    // Admin check
    if (adminTokenParam) {
        isAdmin = await verifyAdminAccess(adminTokenParam);
        if (isAdmin) {
            document.getElementById('admin-controls').style.display = 'flex';
            document.getElementById('admin-controls').classList.add('visible');
        }
    }

    // Demo banner
    if (idPelanggan === 'demo') {
        showDemoBanner();
    }

    // KUNCI RASIO CERDAS — Sesuai ukuran fisik produk
    // Pigura: 4:5, Ganci: 32:49
    function getProductRatio(jenis, isLandscape) {
        const j = (jenis || '').toLowerCase();
        if (j.includes('figura') || j.includes('pigura')) return isLandscape ? 5 / 4 : 4 / 5;
        // Gantungan Kunci (default)
        return isLandscape ? 49 / 32 : 32 / 49;
    }

    if (idPelanggan === 'demo') {
        setLoadingStep('step-init', 'done');
        setLoadingProgress(40, currentLang === 'id' ? 'Memuat data...' : 'Loading data...');
        const data = typeof DEMO_DATA !== 'undefined' ? DEMO_DATA : {
            link_target: 'https://cdn.jsdelivr.net/gh/nicolo-ribaudo/mindar-image-demo@main/targets.mind',
            link_video: '', video_posisi: '0 0 0', video_skala: '1 1.5 1',
            video_rotasi: '0 0 0', jenis_pesanan: 'Gantungan Kunci', orientasi: 'portrait',
            link_frame: 'none', nama_pelanggan: 'Demo', slides: null
        };
        slides = UNIVERSAL_SLIDES;
        arVideoSrc = getHlsUrl(data.link_video);

        const isLandscape = data.orientasi === 'landscape';
        const productRatio = getProductRatio(data.jenis_pesanan, isLandscape);

        const defaultHeight = (1 / productRatio).toFixed(5);
        const p = (data.video_posisi || "0 0 0").split(' ');
        const rawS = (data.video_skala || `1 ${defaultHeight} 1`).split(' ');

        const baseW = parseFloat(rawS[0]);
        const baseH = parseFloat(rawS[1]);

        // Bebaskan tinggi video (baseH) agar sesuai 100% dengan pilihan Admin di Editor
        const s = [baseW.toString(), baseH.toString(), rawS[2] || "1"];
        // Gunakan rasio ukuran pilihan admin agar efek cover pas memotong videonya
        const currentPlaneRatio = baseW / baseH;

        let rotZ = 0;
        if (data.video_rotasi) {
            const rotArr = data.video_rotasi.split(' ');
            rotZ = rotArr.length >= 3 ? parseFloat(rotArr[2]) : 0;
        }
        adminPosX = parseFloat(p[0]); adminPosY = parseFloat(p[1]);
        adminW = parseFloat(s[0]); adminH = parseFloat(s[1]); adminRotZ = rotZ;

        const frameSrc = data.link_frame || "Selamat.png";

        // Frame: untuk demo, gunakan default scaling
        const isDefaultInstaFrame = frameSrc.toLowerCase().includes("selamat");
        frameW = parseFloat(s[0]) * (isDefaultInstaFrame ? 1.15 : 1.0);
        frameH = parseFloat(s[1]) * (isDefaultInstaFrame ? 1.35 : 1.0);
        framePosX = 0;
        framePosY = isDefaultInstaFrame ? 0.15 : 0.0;

        const frameAsset = frameSrc !== "none" ? `<img id="customFrame" src="${frameSrc}" crossorigin="anonymous">` : "";
        const frameEntity = frameSrc !== "none" ? `<a-image id="frameOverlay" src="#customFrame" position="${framePosX.toFixed(2)} ${framePosY.toFixed(2)} 0.05" width="${frameW.toFixed(2)}" height="${frameH.toFixed(2)}"></a-image>` : "";

        setupGlobalVideo(getHlsUrl(data.link_video));

        sceneARTemplate = `
            <a-scene id="ar-scene" mindar-image="imageTargetSrc: ${data.link_target}; autoStart: false; uiLoading: no; uiScanning: no; filterMinCF: 0.0001; filterBeta: 0.001;" vr-mode-ui="enabled: false" device-orientation-permission-ui="enabled: false" loading-screen="enabled: false" embedded>
                <a-assets>
                    ${frameAsset}
                </a-assets>
                <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
                <a-entity mindar-image-target="targetIndex: 0" id="target-ar">
                    
                    <!-- Wrapper: position + rotation + entry animation (Removed float-anim for stability) -->
                    <a-entity id="ar-wrapper" position="${p[0]} ${p[1]} 0" rotation="0 0 ${rotZ}" scale="0.001 0.001 0.001" animation="property: scale; from: 0.001 0.001 0.001; to: 1 1 1; dur: 1200; easing: easeOutElastic; startEvents: doScale">
                        
                        <!-- Point light for realistic gold reflections -->
                        <a-light type="point" color="#e8f4ff" intensity="0.8" distance="3" position="0 0 0.5"></a-light>

                        <!-- Layer 3: Video -->
                        <a-video id="vDisplay" src="#webVideo" position="0 0 0" width="${s[0]}" height="${s[1]}" video-cover="planeRatio: ${currentPlaneRatio}"></a-video>
                        
                        <!-- Custom PNG Frame Overlay -->
                        ${frameEntity}
                    </a-entity>

                </a-entity>
            </a-scene>
        `;


        setLoadingStep('step-ai', 'active');
        setLoadingProgress(70, t('step_ai'));
        await new Promise(r => setTimeout(r, 800));
        setLoadingStep('step-ai', 'done');

        setLoadingStep('step-ar', 'active');
        setLoadingProgress(90, t('step_ar'));
        await new Promise(r => setTimeout(r, 600));
        setLoadingStep('step-ar', 'done');

        setLoadingProgress(100, currentLang === 'id' ? 'Selesai!' : 'Done!');

        document.getElementById('loading').classList.add('fade-out');
        showWelcomeModal();
        updateCardUI(); // Pre-render card but don't show it yet
        updateStatus('status_ready', false);

        cacheAssets(data);


    } else {
        try {
            setLoadingStep('step-init', 'done');
            setLoadingProgress(20, currentLang === 'id' ? 'Memeriksa cache...' : 'Checking cache...');

            // === CACHE-FIRST STRATEGY ===
            let data = null;
            let fromCache = false;

            // 1. Check IndexedDB cache first
            const cachedData = await getCachedOrder(idPelanggan);

            // 2. Try network fetch with retry for weak signals
            let networkData = null;
            let networkError = null;

            // Retry config: more patient if no cache (first time ever)
            const maxRetries = cachedData ? 1 : 3;
            const baseTimeouts = cachedData ? [8000] : [15000, 30000, 60000];
            const retryMessages = [
                currentLang === 'id' ? 'Mengambil data pesanan...' : 'Fetching order data...',
                currentLang === 'id' ? '📶 Sinyal lambat, mencoba lagi...' : '📶 Slow signal, retrying...',
                currentLang === 'id' ? '📶 Masih mencoba... mohon tunggu sebentar' : '📶 Still trying... please wait'
            ];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    setLoadingProgress(25 + (attempt * 5), retryMessages[attempt] || retryMessages[0]);

                    const controller = new AbortController();
                    const timeoutMs = baseTimeouts[attempt] || baseTimeouts[baseTimeouts.length - 1];
                    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                    const res = await fetch(`${WORKER_URL}/pesanan?id=${idPelanggan}&t=${Date.now()}`, {
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    if (res.status === 403) { networkError = new Error("error_expired"); break; }
                    if (!res.ok) throw new Error("fetch_failed");

                    const rawData = await res.json();
                    const extracted = Array.isArray(rawData) ? rawData[0] : rawData;

                    if (extracted && extracted.link_target) {
                        networkData = extracted;
                        // Save to cache for future offline use
                        setCachedOrder(idPelanggan, networkData);
                        console.log('[HM-Cache] Order data saved to IndexedDB');
                        break; // Success — exit retry loop
                    }
                } catch (e) {
                    networkError = e;
                    console.warn(`[HM-Cache] Network fetch attempt ${attempt + 1}/${maxRetries} failed:`, e.message);

                    if (attempt < maxRetries - 1) {
                        // Wait before retry (exponential backoff: 1s, 2s, 4s)
                        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 4000);
                        setLoadingProgress(25 + (attempt * 5), currentLang === 'id'
                            ? `⏳ Menunggu ${backoffMs / 1000}s sebelum mencoba lagi...`
                            : `⏳ Waiting ${backoffMs / 1000}s before retry...`);
                        await new Promise(r => setTimeout(r, backoffMs));
                    }
                }
            }

            // 3. Decide which data to use
            if (networkData) {
                data = networkData;
                fromCache = false;
            } else if (cachedData) {
                data = cachedData;
                fromCache = true;
                console.log('[HM-Cache] Using cached order data (offline mode)');
                setLoadingProgress(35, currentLang === 'id' ? '📱 Memuat dari penyimpanan HP...' : '📱 Loading from device storage...');
            } else {
                // No cache, no network after all retries — throw the network error
                if (networkError) {
                    if (networkError.message === 'error_expired') throw networkError;
                    throw new Error('fetch_failed');
                }
                throw new Error('error_no_data');
            }

            if (!data || !data.link_target) {
                console.error('Data pesanan tidak valid atau link_target kosong');
                throw new Error('error_no_data');
            }

            setLoadingStep('step-init', 'done');
            setLoadingProgress(50, fromCache
                ? (currentLang === 'id' ? '📱 Data dimuat dari HP!' : '📱 Data loaded from device!')
                : (currentLang === 'id' ? 'Data ditemukan!' : 'Data found!'));

            // === Check if video/mind assets are cached, use blob URLs if so ===
            let videoSrcForTemplate = getHlsUrl(data.link_video);
            let mindSrcForTemplate = data.link_target;

            // Try to use cached .mind file (blob URL)
            const cachedMindUrl = await getCachedAssetUrl(data.link_target);
            if (cachedMindUrl) {
                mindSrcForTemplate = cachedMindUrl;
                console.log('[HM-Cache] Using cached .mind file');
            }

            // Try to use cached video file (blob URL → use MP4 directly instead of HLS)
            const mp4Url = getOriginalMp4Url(getHlsUrl(data.link_video));
            const videoSourceUrl = mp4Url.endsWith('.m3u8') ? data.link_video : mp4Url;
            const cachedVideoUrl = await getCachedAssetUrl(videoSourceUrl);
            if (cachedVideoUrl) {
                videoSrcForTemplate = cachedVideoUrl;
                console.log('[HM-Cache] Using cached video file (offline MP4)');
            }

            arVideoSrc = cachedVideoUrl || getHlsUrl(data.link_video);

            let rawSlides = data.slides;
            try { if (typeof rawSlides === 'string') rawSlides = JSON.parse(rawSlides); } catch (e) { }

            // --- REBUILT SLIDE PARSING LOGIC ---
            let parts = [];

            // Try to get strings from data fields first
            let finalIntro = data.intro || "";
            let finalUcapan = data.ucapan || "";
            let finalOutro = data.outro || "";

            // Fallback: If data fields are empty, try to extract from rawSlides (Backend Worker format)
            if (!finalIntro && !finalUcapan && !finalOutro && Array.isArray(rawSlides)) {
                if (rawSlides.length === 3) {
                    finalIntro = typeof rawSlides[0].t === 'string' ? rawSlides[0].t : (rawSlides[0].t?.id || "");
                    finalUcapan = typeof rawSlides[1].b === 'string' ? rawSlides[1].b : (rawSlides[1].b?.id || "");
                    finalOutro = typeof rawSlides[2].b === 'string' ? rawSlides[2].b : (rawSlides[2].b?.id || "");

                    // Ignore default worker texts
                    if (finalIntro === "Untuk Kamu ✨" || finalIntro === "For You ✨") finalIntro = "";
                    if (finalUcapan.includes("Waktu mungkin berlalu")) finalUcapan = "";
                    if (finalOutro.includes("Arahkan kamera")) finalOutro = "";
                } else if (rawSlides.length === 1 && rawSlides[0].b) {
                    // Extract from concatenated string (from Customer-React)
                    let text = rawSlides[0].b;
                    // Try to extract intro (<strong>...</strong>)
                    let introMatch = text.match(/<strong>(.*?)<\/strong>/);
                    if (introMatch) finalIntro = introMatch[1];
                    // Try to extract outro (<em>...</em>)
                    let outroMatch = text.match(/<em>(.*?)<\/em>/);
                    if (outroMatch) finalOutro = outroMatch[1];
                    // Remove intro, outro, and <br> tags to get the main message
                    finalUcapan = text.replace(/<strong>.*?<\/strong>/, '').replace(/<em>.*?<\/em>/, '').replace(/<br\s*\/?>/gi, '').trim();
                }
            }

            // If we still have nothing, check if there's at least a valid raw slide
            if (!finalIntro && !finalUcapan && !finalOutro && Array.isArray(rawSlides) && rawSlides.length > 0 && rawSlides[0].t) {
                slides = rawSlides; // Fallback to raw
            } else if (finalIntro || finalUcapan || finalOutro) {
                if (finalIntro) parts.push({ t: "Intro", b: `<strong>${finalIntro}</strong>` });

                if (finalUcapan && finalUcapan !== "Ada sesuatu yang ingin disampaikan — bukan sekadar kata, tapi rasa yang ingin dijaga.") {
                    parts.push({ t: "Pesan", b: `${finalUcapan}` });
                } else {
                    parts.push({ t: "Pesan", b: `Ada sesuatu yang ingin disampaikan — bukan sekadar kata, tapi rasa yang ingin dijaga.` });
                }

                if (finalOutro) parts.push({ t: "Penutup", b: `<em>${finalOutro}</em>` });
                slides = parts;
            } else {
                slides = UNIVERSAL_SLIDES;
            }

            const p = (data.video_posisi || "0 0 0").split(' ');

            // KUNCI RASIO CERDAS — Sesuai ukuran fisik produk
            const isLandscape = data.orientasi === 'landscape';
            const productRatio = getProductRatio(data.jenis_pesanan, isLandscape);

            // Default tinggi video = 1 / rasio produk agar pas sempurna menutupi target
            const defaultHeight = (1 / productRatio).toFixed(5);
            const rawS = (data.video_skala || `1 ${defaultHeight} 1`).split(' ');

            const baseW = parseFloat(rawS[0]);
            const baseH = parseFloat(rawS[1]);

            // Bebaskan tinggi video (baseH) agar sesuai 100% dengan pilihan Admin di Editor
            const s = [baseW.toString(), baseH.toString(), rawS[2] || "1"];
            // Gunakan rasio ukuran pilihan admin agar efek cover pas memotong videonya
            const currentPlaneRatio = baseW / baseH;

            let rotZ = 0;
            if (data.video_rotasi) {
                const rotArr = data.video_rotasi.split(' ');
                rotZ = rotArr.length >= 3 ? parseFloat(rotArr[2]) : 0;
            }
            adminPosX = parseFloat(p[0]); adminPosY = parseFloat(p[1]);
            adminW = parseFloat(s[0]); adminH = parseFloat(s[1]); adminRotZ = rotZ;

            const previewBox = document.getElementById('admin-video-preview');
            const previewLabel = document.getElementById('admin-dim-label');
            if (previewBox && previewLabel) {
                // Preview box sesuai rasio produk
                const maxDim = 320;
                let pw, ph, labelText;
                if (isLandscape) {
                    pw = maxDim;
                    ph = Math.round(maxDim / productRatio);
                    labelText = data.jenis_pesanan === 'Figura' ? '5:4' : '49:32';
                } else {
                    ph = maxDim;
                    pw = Math.round(maxDim * productRatio);
                    labelText = data.jenis_pesanan === 'Figura' ? '4:5' : '32:49';
                }
                previewBox.style.width = pw + 'px';
                previewBox.style.height = ph + 'px';
                adminBasePx = pw;
                previewLabel.textContent = labelText;
            }

            const frameSrc = data.link_frame || "none";

            // Frame posisi & skala dari database (independen dari video)
            if (data.frame_posisi) {
                const fp = data.frame_posisi.split(' ');
                framePosX = parseFloat(fp[0]) || 0;
                framePosY = parseFloat(fp[1]) || 0;
            } else {
                framePosX = 0;
                framePosY = 0;
            }

            if (data.frame_skala) {
                const fs = data.frame_skala.split(' ');
                frameW = parseFloat(fs[0]) || parseFloat(s[0]);
                frameH = parseFloat(fs[1]) || parseFloat(s[1]);
            } else {
                // Fallback: untuk pesanan lama tanpa data frame, gunakan ukuran video
                const isDefaultInstaFrame = frameSrc.toLowerCase().includes("selamat");
                frameW = parseFloat(s[0]) * (isDefaultInstaFrame ? 1.15 : 1.0);
                frameH = parseFloat(s[1]) * (isDefaultInstaFrame ? 1.35 : 1.0);
                framePosY = isDefaultInstaFrame ? 0.15 : 0.0;
            }

            // Try to use cached frame image
            let frameSrcForTemplate = frameSrc;
            if (frameSrc !== "none") {
                const cachedFrameUrl = await getCachedAssetUrl(frameSrc);
                if (cachedFrameUrl) {
                    frameSrcForTemplate = cachedFrameUrl;
                    console.log('[HM-Cache] Using cached frame image');
                }
            }

            const frameAsset = frameSrc !== "none" ? `<img id="customFrame" src="${frameSrcForTemplate}" crossorigin="anonymous">` : "";
            if (frameSrc !== "none") {
                const pf = document.getElementById('admin-preview-frame');
                if (pf) { pf.src = frameSrcForTemplate; pf.style.display = 'block'; }
            }
            const frameEntity = frameSrc !== "none" ? `<a-image id="frameOverlay" src="#customFrame" position="${framePosX.toFixed(2)} ${framePosY.toFixed(2)} 0.05" width="${frameW.toFixed(2)}" height="${frameH.toFixed(2)}"></a-image>` : "";

            setupGlobalVideo(videoSrcForTemplate);

            sceneARTemplate = `
                <a-scene id="ar-scene" mindar-image="imageTargetSrc: ${mindSrcForTemplate}; autoStart: false; uiLoading: no; uiScanning: no; filterMinCF: 0.0001; filterBeta: 0.001;" vr-mode-ui="enabled: false" device-orientation-permission-ui="enabled: false" loading-screen="enabled: false" embedded>
                    <a-assets>
                        ${frameAsset}
                    </a-assets>
                    <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
                    <a-entity mindar-image-target="targetIndex: 0" id="target-ar">
                        
                        <!-- Wrapper: position + rotation + entry animation (Removed float-anim for stability) -->
                        <a-entity id="ar-wrapper" position="${p[0]} ${p[1]} 0" rotation="0 0 ${rotZ}" scale="0.001 0.001 0.001" animation="property: scale; from: 0.001 0.001 0.001; to: 1 1 1; dur: 1200; easing: easeOutElastic; startEvents: doScale">
                            
                            <!-- Point light for realistic gold reflections -->
                            <a-light type="point" color="#e8f4ff" intensity="0.8" distance="3" position="0 0 0.5"></a-light>

                            <!-- Layer 3: Video -->
                            <a-video id="vDisplay" src="#webVideo" position="0 0 0" width="${s[0]}" height="${s[1]}" video-cover="planeRatio: ${currentPlaneRatio}"></a-video>
                            
                            <!-- Custom PNG Frame Overlay -->
                            ${frameEntity}
                        </a-entity>

                    </a-entity>
                </a-scene>
            `;

            setLoadingStep('step-ai', 'active');
            setLoadingProgress(70, t('step_ai'));
            await new Promise(r => setTimeout(r, 800));
            setLoadingStep('step-ai', 'done');

            setLoadingStep('step-ar', 'active');
            setLoadingProgress(90, t('step_ar'));
            await new Promise(r => setTimeout(r, 600));
            setLoadingStep('step-ar', 'done');

            setLoadingProgress(100, currentLang === 'id' ? 'Selesai!' : 'Done!');

            document.getElementById('loading').classList.add('fade-out');
            showWelcomeModal();
            updateCardUI(); // Pre-render card but don't show it yet
            updateStatus('status_ready', false);

            // Pre-download assets to device storage (background, non-blocking)
            cacheAssets(data);

        } catch (e) {
            const msgKey = e.message === 'error_no_data' ? 'error_no_data' :
                e.message === 'error_expired' ? 'error_expired' :
                    e.message === 'fetch_failed' ? 'error_network' : 'error_generic';
            showError(msgKey, () => {
                window.location.reload();
            });
            document.getElementById('loading').classList.add('fade-out');
        }
    }
};
/* ==================================================== */
/* UX OPTIMIZATIONS HELPER FUNCTIONS                    */
/* ==================================================== */

// Haptic Feedback Helper
window.triggerHaptic = function (ms = 15) {
    try {
        if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { }
};

// Sakura Petal Animation
window.triggerSakura = function () {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.inset = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '9999';
    container.style.overflow = 'hidden';
    document.body.appendChild(container);

    const petalCount = 20;
    for (let i = 0; i < petalCount; i++) {
        const petal = document.createElement('div');
        petal.style.position = 'absolute';
        petal.style.top = '-30px';
        petal.style.left = Math.random() * 100 + 'vw';

        const size = 8 + Math.random() * 8;
        petal.style.width = size + 'px';
        petal.style.height = size * 1.5 + 'px';
        petal.style.background = 'linear-gradient(135deg, #ffd1dc, #ffb6c1)';
        petal.style.borderRadius = '15px 0 15px 0'; // Elegant petal shape
        petal.style.opacity = (0.5 + Math.random() * 0.4);
        petal.style.filter = 'drop-shadow(0 2px 4px rgba(255, 180, 200, 0.4))';
        petal.style.transform = `rotate(${Math.random() * 360}deg)`;

        container.appendChild(petal);

        const duration = 3 + Math.random() * 4;
        const delay = Math.random() * 0.8;

        gsap.to(petal, {
            y: window.innerHeight + 100,
            x: `+=${-100 + Math.random() * 200}`,
            rotation: `+=${180 + Math.random() * 360}`,
            duration: duration,
            delay: delay,
            ease: "power1.out"
        });
    }

    setTimeout(() => {
        if (container.parentNode) container.parentNode.removeChild(container);
    }, 7000);
};

// Gold Dust Animation (For Main Message)
window.triggerGoldDust = function () {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.inset = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '9999';
    container.style.overflow = 'hidden';
    document.body.appendChild(container);

    const dustCount = 40;
    for (let i = 0; i < dustCount; i++) {
        const dust = document.createElement('div');
        dust.style.position = 'absolute';
        dust.style.top = '50%';
        dust.style.left = '50%';

        const size = 1.5 + Math.random() * 3;
        dust.style.width = size + 'px';
        dust.style.height = size + 'px';
        dust.style.background = '#d4af7a'; // Gold color
        dust.style.borderRadius = '50%';
        dust.style.opacity = '0';
        dust.style.boxShadow = '0 0 6px 2px rgba(212, 175, 122, 0.8)';

        container.appendChild(dust);

        const angle = Math.random() * Math.PI * 2;
        const radius = 60 + Math.random() * 140;

        gsap.to(dust, {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius - 20,
            opacity: 0.6 + Math.random() * 0.4,
            duration: 1.5 + Math.random() * 1.5,
            ease: "power2.out",
            onComplete: () => {
                gsap.to(dust, { opacity: 0, duration: 1 + Math.random() });
            }
        });
    }

    setTimeout(() => {
        if (container.parentNode) container.parentNode.removeChild(container);
    }, 4500);
};

// Ambient particles (petals)
function spawnAmbientParticles() {
    const container = document.getElementById('ambient-petals');
    if (!container) return;
    for (let i = 0; i < 30; i++) {
        const petal = document.createElement('div');
        petal.className = 'petal';
        petal.style.left = Math.random() * 100 + 'vw';
        petal.style.animationDelay = Math.random() * 8 + 's';
        petal.style.animationDuration = 6 + Math.random() * 4 + 's';
        container.appendChild(petal);
    }
}
spawnAmbientParticles();

// Typewriter effect
let typeWriterTimeout;
function typewriterText(element, text, speed = 40, onComplete) {
    element.innerHTML = '';
    clearTimeout(typeWriterTimeout);
    let i = 0;
    function type() {
        if (i < text.length) {
            if (text.charAt(i) === '<') {
                const endIdx = text.indexOf('>', i);
                if (endIdx !== -1) {
                    element.innerHTML += text.substring(i, endIdx + 1);
                    i = endIdx + 1;
                } else {
                    element.innerHTML += text.charAt(i);
                    i++;
                }
            } else {
                element.innerHTML += text.charAt(i);
                i++;
            }
            typeWriterTimeout = setTimeout(type, speed);
        } else if (onComplete) {
            onComplete();
        }
    }
    type();
}

// Welcome Modal logic
function showWelcomeModal() {
    document.getElementById('loading').classList.add('fade-out');
    document.getElementById('welcome-modal').classList.add('show');
}

// Fullscreen helper
function requestFullScreen() {
    try {
        if (!document.fullscreenElement) {
            const elem = document.documentElement;
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) { /* Safari */
                elem.webkitRequestFullscreen();
            } else if (elem.msRequestFullscreen) { /* IE11 */
                elem.msRequestFullscreen();
            }
        }
    } catch (e) {
        console.log("Fullscreen request blocked or not supported", e);
    }
}

window.dismissWelcomeModal = function () {
    requestFullScreen();
    document.getElementById('welcome-modal').classList.remove('show');
    document.getElementById('main-ui').style.display = 'flex';
    setTimeout(() => {
        document.getElementById('main-start-btn').style.display = 'inline-block';
    }, 100);
}

// Tutorial Overlay Scan Tips Carousel
let tipInterval;
function startScanTipsCarousel() {
    const tips = document.querySelectorAll('.scan-tip');
    if (!tips.length) return;
    let currentTip = 0;
    tipInterval = setInterval(() => {
        tips[currentTip].classList.remove('active');
        currentTip = (currentTip + 1) % tips.length;
        tips[currentTip].classList.add('active');
    }, 3000);
}
function stopScanTipsCarousel() {
    clearInterval(tipInterval);
}

// Error Auto-Retry
let errorCountdownInterval;
window.showErrorWithCountdown = function (title, msg, retryCb) {
    document.getElementById('error-overlay').classList.add('visible');
    document.getElementById('error-title').innerText = title;
    document.getElementById('error-message').innerText = msg;

    let countdown = 5;
    document.getElementById('error-countdown-num').innerText = countdown;
    document.getElementById('error-countdown-fill').style.width = '100%';
    document.getElementById('error-countdown').style.display = 'block';

    clearInterval(errorCountdownInterval);
    errorCountdownInterval = setInterval(() => {
        countdown--;
        document.getElementById('error-countdown-num').innerText = countdown;
        document.getElementById('error-countdown-fill').style.width = (countdown / 5 * 100) + '%';
        if (countdown <= 0) {
            clearInterval(errorCountdownInterval);
            retryCb();
        }
    }, 1000);
}
