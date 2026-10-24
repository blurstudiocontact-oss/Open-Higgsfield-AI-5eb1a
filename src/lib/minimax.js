// MiniMax API client: H3 video and image-01 images, with one API key.
//
// Video endpoint shapes follow the live-verified notes in
// joeVenner/awesome-minimax-h3 (indexed by
// MiniMax-AI/awesome-minimax-h3-integration): submit on /v2, poll and resolve
// files on /v1. Image generation follows platform.minimax.io's
// /v1/image_generation reference.

import { getModelById, getVideoModelById, getI2IModelById, getI2VModelById } from './models.js';

export const H3 = {
    model: 'MiniMax-H3',
    resolutions: ['768P', '2K'],
    ratios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    minDuration: 5,
    maxDuration: 15,
    maxPrompt: 2000,
    maxSourceSeconds: 120,
};

const KEY_STORAGE = 'minimax_key';
const BASE_STORAGE = 'minimax_base_url';
// The browser talks to the MiniMax API directly. A different base URL can be
// set in OBS Settings → MiniMax.
const DEFAULT_BASE = 'https://api.minimax.io';
// Uploads that come back without a public URL are referenced by file id.
const FILE_SCHEME = 'minimax-file://';

export const getMinimaxKey = () => localStorage.getItem(KEY_STORAGE) || '';
export const setMinimaxKey = (key) => (key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE));
export const getMinimaxBase = () => localStorage.getItem(BASE_STORAGE) || '';
export const setMinimaxBase = (url) => (url ? localStorage.setItem(BASE_STORAGE, url) : localStorage.removeItem(BASE_STORAGE));

function apiBase() {
    const custom = getMinimaxBase().replace(/\/+$/, '');
    return custom || DEFAULT_BASE;
}

// Generated videos are fetched straight from MiniMax's CDN.
export const clipFetchUrl = (url) => url;

async function request(path, init = {}) {
    const key = getMinimaxKey();
    if (!key) throw new Error('MiniMax API key missing. Please set it in Settings.');
    const res = await fetch(`${apiBase()}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) },
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON body, e.g. a plain 404 */ }
    if (!res.ok || !data) {
        const msg = data?.error?.message || data?.base_resp?.status_msg || text.slice(0, 120) || res.statusText;
        throw new Error(`MiniMax ${res.status}: ${msg}`);
    }
    // Some failures come back as HTTP 200 with a non-zero base_resp code.
    if (data.base_resp && data.base_resp.status_code !== 0) {
        throw new Error(`MiniMax error ${data.base_resp.status_code}: ${data.base_resp.status_msg}`);
    }
    return data;
}

const postJson = (path, body) => request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

// Content entry reference for an uploaded or public file.
export function mediaRef(urlOrRef) {
    if (typeof urlOrRef === 'object') return urlOrRef.url ? { url: urlOrRef.url } : { file_id: urlOrRef.file_id };
    return urlOrRef.startsWith(FILE_SCHEME) ? { file_id: urlOrRef.slice(FILE_SCHEME.length) } : { url: urlOrRef };
}

export const isRemoteUrl = (url) => /^https?:\/\//.test(url);

// ---------- Video (H3) ----------

export async function submitVideo({ prompt, resolution, duration, ratio, firstFrame, sourceVideo, referenceImages = [] }) {
    const content = [{ type: 'text', text: prompt }];
    if (sourceVideo) content.push({ type: 'video_url', video_url: mediaRef(sourceVideo), role: 'reference_video' });
    referenceImages.forEach(img => content.push({ type: 'image_url', image_url: mediaRef(img), role: 'reference_image' }));
    if (firstFrame) content.push({ type: 'image_url', image_url: mediaRef(firstFrame), role: 'first_frame' });
    const data = await postJson('/v2/video_generation', {
        model: H3.model,
        content,
        resolution: resolution || H3.resolutions[0],
        duration: duration || H3.minDuration,
        ratio: ratio || 'adaptive',
    });
    if (!data.task_id) throw new Error('MiniMax returned no task id');
    return data.task_id;
}

// Polls until the task succeeds, then exchanges its file_id for a download URL.
export async function waitForVideo(taskId, onStage = () => {}, { interval = 8000, timeout = 60 * 60 * 1000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const q = await request(`/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`);
        if (q.status === 'Success') {
            onStage('Fetching result');
            const r = await request(`/v1/files/retrieve?file_id=${encodeURIComponent(q.file_id)}`);
            const url = r.file?.download_url;
            if (!url) throw new Error('MiniMax returned no download URL');
            return url;
        }
        if (q.status === 'Failed') throw new Error(q.base_resp?.status_msg || 'Generation failed');
        const mins = Math.floor((Date.now() - start) / 60000);
        onStage(`${q.status || 'Waiting'} on MiniMax H3${mins ? ` (${mins} min)` : ''}`);
        await new Promise(r => setTimeout(r, interval));
    }
    throw new Error('Gave up waiting after 60 minutes');
}

// ---------- Images (image-01) ----------

async function generateImages({ model, prompt, aspect_ratio, subjectReference, n = 1 }) {
    const body = { model, prompt, response_format: 'url', n };
    if (aspect_ratio) body.aspect_ratio = aspect_ratio;
    if (subjectReference) {
        if (!isRemoteUrl(subjectReference) && !subjectReference.startsWith('data:')) {
            throw new Error('MiniMax image references need a public URL; this upload only returned a file id');
        }
        body.subject_reference = [{ type: 'character', image_file: subjectReference }];
    }
    const data = await postJson('/v1/image_generation', body);
    const urls = data.data?.image_urls || [];
    if (!urls.length) {
        const blocked = data.metadata?.failed_count;
        throw new Error(+blocked ? 'Image blocked by MiniMax content safety' : 'MiniMax returned no image');
    }
    return { id: data.id, url: urls[0], urls };
}

// ---------- Audio and text (Creative page) ----------
// Shapes follow platform.minimax.io: T2A v2, Music Generation, Voice Design
// and Chat Completion v2. Audio comes back hex-encoded.

const hexToBlob = (hex, type = 'audio/mpeg') => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return new Blob([bytes], { type });
};

export async function synthesizeSpeech({ text, model = 'speech-02-hd', voiceId, languageBoost }) {
    const body = {
        model, text, stream: false,
        voice_setting: { voice_id: voiceId || 'English_expressive_narrator', speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    };
    if (languageBoost) body.language_boost = languageBoost;
    const data = await postJson('/v1/t2a_v2', body);
    if (!data.data?.audio) throw new Error('MiniMax returned no audio');
    return hexToBlob(data.data.audio);
}

export async function generateMusic({ prompt, lyrics, model = 'music-2.0' }) {
    const body = { model, prompt, audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' } };
    if (lyrics) body.lyrics = lyrics;
    const data = await postJson('/v1/music_generation', body);
    if (!data.data?.audio) throw new Error('MiniMax returned no music');
    return hexToBlob(data.data.audio);
}

export async function designVoice({ prompt, previewText }) {
    const data = await postJson('/v1/voice_design', { prompt, preview_text: previewText || 'Hello! This is a preview of my new voice.' });
    if (!data.voice_id) throw new Error('MiniMax returned no voice');
    return { voiceId: data.voice_id, audio: data.trial_audio ? hexToBlob(data.trial_audio) : null };
}

export async function listSystemVoices() {
    const data = await postJson('/v1/get_voice', { voice_type: 'all' });
    const rows = [...(data.system_voice || []), ...(data.voice_generation || []), ...(data.voice_cloning || [])];
    return rows.map(v => ({
        id: v.voice_id,
        name: v.voice_name || v.voice_id,
        description: Array.isArray(v.description) ? v.description.join(' ') : (v.description || ''),
        backend: 'minimax',
    }));
}

export async function chat({ model = 'MiniMax-M2', messages, temperature = 0.7, maxTokens }) {
    const body = { model, messages, temperature };
    if (maxTokens) body.max_tokens = maxTokens;
    const data = await postJson('/v1/text/chatcompletion_v2', body);
    const content = data.choices?.[0]?.message?.content;
    if (content == null) throw new Error('MiniMax returned no text');
    // Reasoning models may prefix their answer with a <think> block.
    return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

export { generateImages };

// ---------- Files ----------

export async function uploadToMinimax(file) {
    const form = new FormData();
    form.append('purpose', 'video_generation');
    form.append('file', file);
    const data = await request('/v1/files/upload', { method: 'POST', body: form });
    const f = data.file || {};
    if (!f.url && !f.file_id) throw new Error('MiniMax upload returned no file');
    return { url: f.url, file_id: f.file_id };
}

// ---------- Studio-facing client (same call shapes the pages use) ----------

export class MinimaxClient {
    getKey() {
        const key = getMinimaxKey();
        if (!key) throw new Error('API Key missing. Please set it in Settings.');
        return key;
    }

    async generateImage(params) {
        const model = getModelById(params.model);
        return generateImages({ model: model?.apiModel || 'image-01', prompt: params.prompt, aspect_ratio: params.aspect_ratio });
    }

    async generateI2I(params) {
        const model = getI2IModelById(params.model);
        const ref = params.images_list?.[0] || params.image_url;
        return generateImages({
            model: model?.apiModel || 'image-01',
            prompt: params.prompt || 'A portrait of the same person',
            aspect_ratio: params.aspect_ratio,
            subjectReference: ref,
        });
    }

    async generateVideo(params) {
        const model = getVideoModelById(params.model);
        const taskId = await submitVideo({
            prompt: params.prompt,
            resolution: params.resolution || model?.inputs?.resolution?.default,
            duration: params.duration || model?.inputs?.duration?.default,
            ratio: params.aspect_ratio,
        });
        return { id: taskId, url: await waitForVideo(taskId, params.onStage) };
    }

    async generateI2V(params) {
        const model = getI2VModelById(params.model);
        const taskId = await submitVideo({
            prompt: params.prompt || 'Bring the image to life with natural motion.',
            resolution: params.resolution || model?.inputs?.resolution?.default,
            duration: params.duration || model?.inputs?.duration?.default,
            ratio: params.aspect_ratio,
            firstFrame: params.image_url,
        });
        return { id: taskId, url: await waitForVideo(taskId, params.onStage) };
    }

    // Returns a URL usable in later requests: the public URL when MiniMax gives
    // one, otherwise a minimax-file:// reference to the uploaded file id.
    async uploadFile(file) {
        const { url, file_id } = await uploadToMinimax(file);
        return url || `${FILE_SCHEME}${file_id}`;
    }
}

export const minimax = new MinimaxClient();
