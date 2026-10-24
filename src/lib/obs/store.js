// Scene collection model for the OBS reconstruction.
// Mirrors OBS's split between global sources and per-scene items that
// reference them (so one webcam can appear in several scenes).

const STORAGE_KEY = 'obs_scene_collection';

export const SOURCE_TYPES = {
    display_capture: { label: 'Display Capture', video: true, audio: true },
    video_capture: { label: 'Video Capture Device', video: true, audio: false },
    audio_input: { label: 'Audio Input Capture', video: false, audio: true },
    image: { label: 'Image', video: true, audio: false },
    media: { label: 'Media Source', video: true, audio: true },
    text: { label: 'Text', video: true, audio: false },
    color: { label: 'Color Source', video: true, audio: false },
};

export const TRANSITIONS = {
    cut: 'Cut',
    fade: 'Fade',
    fade_to_color: 'Fade to Color',
    swipe: 'Swipe',
    slide: 'Slide',
};

const DEFAULT_SETTINGS = {
    display_capture: { captureAudio: true },
    video_capture: { deviceId: '', resolution: '1280x720' },
    audio_input: { deviceId: '' },
    image: { dataUrl: '', fileName: '' },
    media: { fileName: '', loop: true },
    text: {
        text: 'Text', font: 'Arial', size: 96, color: '#ffffff', bold: false,
        italic: false, background: '#000000', backgroundOpacity: 0,
        outline: false, outlineColor: '#000000', outlineSize: 4, align: 'left',
    },
    color: { color: '#d1d1d1', width: 1920, height: 1080 },
};

export const DEFAULT_FILTERS = {
    opacity: 100, brightness: 0, contrast: 0, saturation: 0, hue: 0,
    chroma: false, chromaColor: '#00ff00', similarity: 400, smoothness: 80,
};

let idCounter = Date.now();
export const uid = (prefix) => `${prefix}_${(idCounter++).toString(36)}`;

export function defaultTransform() {
    return {
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
        flipH: false, flipV: false,
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        fitted: false,
    };
}

function defaultCollection() {
    const sceneId = uid('scene');
    return {
        name: 'Untitled',
        sources: {},
        scenes: [{ id: sceneId, name: 'Scene', items: [] }],
        programScene: sceneId,
        previewScene: sceneId,
        transition: { type: 'fade', duration: 300, color: '#000000' },
        settings: {
            baseWidth: 1920, baseHeight: 1080, fps: 30,
            recFormat: 'auto', videoBitrate: 6000, audioBitrate: 160,
            whipUrl: '', whipToken: '',
            micEnabled: false, micDeviceId: '',
        },
        mixer: {
            // Global audio device ("Mic/Aux"), kept outside scenes like in OBS.
            mic: { volume: 1, muted: false, monitor: false },
        },
    };
}

export function loadCollection() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultCollection();
        const parsed = JSON.parse(raw);
        const base = defaultCollection();
        if (!parsed.scenes?.length) return base;
        return {
            ...base,
            ...parsed,
            settings: { ...base.settings, ...parsed.settings },
            transition: { ...base.transition, ...parsed.transition },
            mixer: { ...base.mixer, ...parsed.mixer },
        };
    } catch {
        return defaultCollection();
    }
}

export function saveCollection(col) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(col));
    } catch (err) {
        // Large embedded images can exceed the quota; drop them rather than lose the layout.
        const slim = JSON.parse(JSON.stringify(col));
        Object.values(slim.sources).forEach(s => { if (s.type === 'image') s.settings.dataUrl = ''; });
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(slim)); } catch { /* give up */ }
    }
}

export function createSource(type, name) {
    return {
        id: uid('src'),
        type,
        name,
        settings: structuredClone(DEFAULT_SETTINGS[type]),
        filters: { ...DEFAULT_FILTERS },
        volume: 1,
        muted: false,
        monitor: false,
    };
}

export function createItem(sourceId) {
    return { id: uid('item'), sourceId, visible: true, locked: false, transform: defaultTransform() };
}

export function uniqueName(col, base) {
    const names = new Set(Object.values(col.sources).map(s => s.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
}

export function uniqueSceneName(col, base = 'Scene') {
    const names = new Set(col.scenes.map(s => s.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
}
