// Reel project model and persistence. The project (clips, texts, audio
// tracks) is small JSON kept in localStorage; the media files behind it are
// blobs kept in IndexedDB so a project survives a reload.

const PROJECT_KEY = 'reel_project';
const DB_NAME = 'reel-media';
const STORE = 'media';

export const REEL = { width: 1080, height: 1920, fps: 30 };

export const FILTERS = {
    none: { label: 'Original', css: '' },
    vivid: { label: 'Vivid', css: 'saturate(1.5) contrast(1.1)' },
    warm: { label: 'Warm', css: 'sepia(0.25) saturate(1.3) hue-rotate(-10deg)' },
    cool: { label: 'Cool', css: 'saturate(1.1) hue-rotate(15deg) brightness(1.05)' },
    vintage: { label: 'Vintage', css: 'sepia(0.5) contrast(0.9) brightness(1.05)' },
    bw: { label: 'B&W', css: 'grayscale(1) contrast(1.15)' },
    fade: { label: 'Fade', css: 'contrast(0.8) brightness(1.1) saturate(0.8)' },
    drama: { label: 'Drama', css: 'contrast(1.4) saturate(0.9) brightness(0.9)' },
    dream: { label: 'Dream', css: 'blur(0.6px) brightness(1.15) saturate(1.2)' },
    // Cinematic / LUT-style render filters.
    cinematic: { label: 'Cinematic', css: 'contrast(1.2) saturate(1.1) brightness(0.95) sepia(0.08)' },
    teal: { label: 'Teal & Orange', css: 'saturate(1.35) contrast(1.15) hue-rotate(-6deg) brightness(1.02)' },
    noir: { label: 'Noir', css: 'grayscale(1) contrast(1.5) brightness(0.85)' },
    golden: { label: 'Golden Hour', css: 'sepia(0.35) saturate(1.4) brightness(1.08) hue-rotate(-8deg)' },
    matte: { label: 'Matte', css: 'contrast(0.85) saturate(0.9) brightness(1.08)' },
    moody: { label: 'Moody', css: 'contrast(1.25) saturate(0.75) brightness(0.88) hue-rotate(8deg)' },
    cyber: { label: 'Cyberpunk', css: 'saturate(1.6) contrast(1.3) hue-rotate(185deg) brightness(1.05)' },
    infrared: { label: 'Infrared', css: 'saturate(2) hue-rotate(260deg) contrast(1.2)' },
    polaroid: { label: 'Polaroid', css: 'sepia(0.3) saturate(1.1) contrast(0.95) brightness(1.1)' },
    vhs: { label: 'VHS', css: 'saturate(1.3) contrast(1.1) brightness(1.05) hue-rotate(-3deg) blur(0.3px)' },
    clean: { label: 'Clean', css: 'contrast(1.05) saturate(1.05) brightness(1.03)' },
    mono: { label: 'Mono Blue', css: 'grayscale(0.8) sepia(0.2) hue-rotate(170deg) contrast(1.2)' },
};

export const TRANSITIONS = {
    none: 'None',
    fade: 'Dissolve',
    black: 'Fade to black',
    white: 'Flash',
    slide: 'Slide',
    zoom: 'Zoom in',
    wipeLeft: 'Wipe left',
    wipeRight: 'Wipe right',
    wipeUp: 'Wipe up',
    wipeDown: 'Wipe down',
    circle: 'Iris',
    spin: 'Spin',
    flip: 'Flip',
    blur: 'Blur dissolve',
    pixelate: 'Pixelate',
    glitch: 'Glitch',
};

// Camera movement templates applied over a clip's own duration (Ken
// Burns-style pans/zooms), independent of the cut transition above.
export const MOTIONS = {
    none: 'None',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    pushIn: 'Push in (fast)',
    pullOut: 'Pull out (fast)',
    kenBurns: 'Ken Burns',
    panLeft: 'Pan left',
    panRight: 'Pan right',
    panUp: 'Pan up',
    panDown: 'Pan down',
    shake: 'Handheld shake',
    orbit: 'Orbit',
    driftTilt: 'Drift tilt',
};

export const TEXT_STYLES = {
    classic: { label: 'Classic', color: '#ffffff', bg: '', outline: '#000000' },
    box: { label: 'Box', color: '#000000', bg: '#ffffff', outline: '' },
    neon: { label: 'Neon', color: '#7df9ff', bg: '', outline: '', glow: '#00e5ff' },
    bold: { label: 'Bold', color: '#fff200', bg: '', outline: '#000000' },
    tiktok: { label: 'Pop', color: '#ffffff', bg: '#fe2c55', outline: '' },
};

export const TEXT_ANIMS = { none: 'None', fade: 'Fade', pop: 'Pop', slide: 'Slide up', type: 'Typewriter' };

let counter = Date.now();
export const uid = (p) => `${p}_${(counter++).toString(36)}`;

export function newProject() {
    return { id: uid('reel'), name: 'My reel', clips: [], texts: [], audios: [] };
}

export function loadProject() {
    try {
        const p = JSON.parse(localStorage.getItem(PROJECT_KEY));
        if (p?.clips) return { texts: [], audios: [], ...p };
    } catch { /* fall through */ }
    return newProject();
}

export function saveProject(project) {
    try { localStorage.setItem(PROJECT_KEY, JSON.stringify(project)); } catch { /* quota */ }
}

export function makeClip(media, extra = {}) {
    const dur = media.kind === 'image' ? 3 : media.duration || 3;
    return {
        id: uid('clip'), mediaId: media.id, kind: media.kind,
        in: 0, out: dur, speed: 1, volume: 1, filter: 'none',
        adjust: { brightness: 0, contrast: 0, saturation: 0 },
        transition: 'none', motion: 'none', fit: 'cover', ...extra,
    };
}

export const clipDuration = (c) => Math.max(0.1, (c.out - c.in) / c.speed);

// Start time of every clip on the timeline, plus the total length.
export function layout(project) {
    let t = 0;
    const starts = project.clips.map(c => { const s = t; t += clipDuration(c); return s; });
    return { starts, total: t };
}

// ---------- Media (IndexedDB) ----------

let dbPromise = null;
function db() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbPromise;
}

function tx(mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r?.result);
        t.onerror = () => reject(t.error);
    }));
}

export const putMedia = (rec) => tx('readwrite', s => s.put(rec));
export const getMedia = (id) => tx('readonly', s => s.get(id));
export const deleteMedia = (id) => tx('readwrite', s => s.delete(id));

// Reads duration and size of a video/audio/image blob.
export function probe(blob) {
    const url = URL.createObjectURL(blob);
    const type = blob.type || '';
    return new Promise((resolve, reject) => {
        if (type.startsWith('image/')) {
            const img = new Image();
            img.onload = () => { resolve({ kind: 'image', width: img.naturalWidth, height: img.naturalHeight, duration: 3 }); URL.revokeObjectURL(url); };
            img.onerror = () => reject(new Error('Unreadable image'));
            img.src = url;
            return;
        }
        const el = document.createElement(type.startsWith('audio/') ? 'audio' : 'video');
        el.preload = 'metadata';
        el.muted = true;
        el.onloadedmetadata = async () => {
            let d = el.duration;
            // MediaRecorder WebM files report Infinity until seeked to the end.
            if (!isFinite(d)) {
                el.currentTime = 1e9;
                await new Promise(r => { el.onseeked = r; setTimeout(r, 3000); });
                d = isFinite(el.duration) ? el.duration : el.currentTime;
            }
            resolve({ kind: el.tagName === 'AUDIO' || !el.videoWidth ? 'audio' : 'video', width: el.videoWidth, height: el.videoHeight, duration: d || 1 });
            URL.revokeObjectURL(url);
        };
        el.onerror = () => reject(new Error('Unreadable media file'));
        el.src = url;
    });
}

export async function addMedia(blob, name = 'media') {
    const info = await probe(blob);
    const rec = { id: uid('m'), name, blob, ...info };
    await putMedia(rec);
    return rec;
}
