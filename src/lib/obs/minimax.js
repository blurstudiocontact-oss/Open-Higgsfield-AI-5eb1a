// MiniMax video generation for the OBS page.
//
// Two providers:
// - MiniMax H3 through the hosted MiniMax API (own API key). H3 can edit an
//   existing video (Ref2VA with the clip as `reference_video`), animate a
//   frame, or generate from text. Endpoint shapes follow the live-verified
//   notes in joeVenner/awesome-minimax-h3 (indexed by
//   MiniMax-AI/awesome-minimax-h3-integration): submit on /v2, poll and
//   resolve files on /v1.
// - Hailuo 2.3 through Muapi (the app's existing key): frame or text only.

import { muapi } from '../muapi.js';
import { i2vModels, t2vModels } from '../models.js';

// ---------- Hailuo 2.3 (Muapi) ----------

const isHailuo23 = (m) => m.id.startsWith('minimax-hailuo-2.3');

export const HAILUO_MODELS = {
    i2v: i2vModels.filter(isHailuo23),
    t2v: t2vModels.filter(isHailuo23),
};

export function hailuoOptions(mode, id) {
    const model = HAILUO_MODELS[mode].find(m => m.id === id);
    return {
        durations: model?.inputs?.duration?.enum || [],
        defaultDuration: model?.inputs?.duration?.default,
        resolutions: model?.inputs?.resolution?.enum || [],
    };
}

async function runHailuo({ mode, model, prompt, duration, frame }, onStage) {
    const { resolutions } = hailuoOptions(mode, model);
    const params = { model, prompt };
    if (duration) params.duration = duration;
    if (resolutions[0]) params.resolution = resolutions[0];
    let res;
    if (mode === 'i2v') {
        onStage('Uploading frame');
        params.image_url = await muapi.uploadFile(frame);
        onStage('Generating with Hailuo 2.3');
        res = await muapi.generateI2V(params);
    } else {
        onStage('Generating with Hailuo 2.3');
        res = await muapi.generateVideo(params);
    }
    if (!res?.url) throw new Error('No video URL returned by the API');
    return res.url;
}

// ---------- MiniMax H3 (MiniMax API) ----------

export const H3 = {
    resolutions: ['768P', '2K'],
    ratios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    minDuration: 5,
    maxDuration: 15,
    maxPrompt: 2000,
    maxSourceSeconds: 120,
};

const KEY_STORAGE = 'minimax_key';
const BASE_STORAGE = 'minimax_base_url';
const PENDING_STORAGE = 'minimax_pending_tasks';
const DEFAULT_BASE = 'https://api.minimax.io';
// In development Vite proxies these paths, which avoids CORS on the API and CDN.
const DEV_API = '/minimax-api';
const DEV_CDN = { host: 'video-product.cdn.minimax.io', path: '/minimax-cdn' };

export const getMinimaxKey = () => localStorage.getItem(KEY_STORAGE) || '';
export const setMinimaxKey = (key) => (key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE));
export const getMinimaxBase = () => localStorage.getItem(BASE_STORAGE) || '';
export const setMinimaxBase = (url) => (url ? localStorage.setItem(BASE_STORAGE, url) : localStorage.removeItem(BASE_STORAGE));

function apiBase() {
    const custom = getMinimaxBase().replace(/\/+$/, '');
    if (custom) return custom;
    return import.meta.env.DEV ? DEV_API : DEFAULT_BASE;
}

// Generated files are served from MiniMax's CDN; route them through the dev proxy too.
export function clipFetchUrl(url) {
    if (!import.meta.env.DEV || getMinimaxBase()) return url;
    try {
        const u = new URL(url);
        if (u.host === DEV_CDN.host) return `${DEV_CDN.path}${u.pathname}${u.search}`;
    } catch { /* not a URL */ }
    return url;
}

async function h3Fetch(path, init = {}) {
    const key = getMinimaxKey();
    if (!key) throw new Error('MiniMax API key missing (Settings → MiniMax)');
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

async function h3Upload(file) {
    const form = new FormData();
    form.append('purpose', 'video_generation');
    form.append('file', file);
    const data = await h3Fetch('/v1/files/upload', { method: 'POST', body: form });
    const f = data.file || {};
    if (!f.url && !f.file_id) throw new Error('MiniMax upload returned no file');
    return { url: f.url, file_id: f.file_id };
}

const mediaRef = (ref) => (ref.url ? { url: ref.url } : { file_id: ref.file_id });

// Ref2VA editing prompt: name the inputs, then state the edit.
export function buildEditPrompt(instruction, hasReferenceImage) {
    const lines = ['<Video 1> is the source video for the editing task.'];
    if (hasReferenceImage) lines.push('<Picture 1> is a reference image for the edit.');
    lines.push('', `The target video is an edited version of <Video 1>. ${instruction.trim()}`);
    return lines.join('\n');
}

async function h3Submit({ mode, prompt, resolution, duration, ratio, frame, sourceVideo, referenceImage }, onStage) {
    const content = [];
    if (mode === 'edit') {
        onStage('Uploading source video');
        const video = await h3Upload(sourceVideo);
        content.push({ type: 'text', text: buildEditPrompt(prompt, !!referenceImage) });
        content.push({ type: 'video_url', video_url: mediaRef(video), role: 'reference_video' });
        if (referenceImage) {
            onStage('Uploading reference image');
            const img = await h3Upload(referenceImage);
            content.push({ type: 'image_url', image_url: mediaRef(img), role: 'reference_image' });
        }
    } else if (mode === 'i2v') {
        onStage('Uploading frame');
        const img = await h3Upload(frame);
        content.push({ type: 'text', text: prompt });
        content.push({ type: 'image_url', image_url: mediaRef(img), role: 'first_frame' });
    } else {
        content.push({ type: 'text', text: prompt });
    }
    onStage('Submitting to MiniMax H3');
    const data = await h3Fetch('/v2/video_generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'MiniMax-H3', content, resolution, duration, ratio }),
    });
    if (!data.task_id) throw new Error('MiniMax returned no task id');
    return data.task_id;
}

// Polls until the task succeeds, then exchanges its file_id for a download URL.
export async function h3Wait(taskId, onStage, { interval = 8000, timeout = 60 * 60 * 1000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const q = await h3Fetch(`/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`);
        if (q.status === 'Success') {
            onStage('Fetching result');
            const r = await h3Fetch(`/v1/files/retrieve?file_id=${encodeURIComponent(q.file_id)}`);
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

// Submitted H3 tasks are remembered so a reload can resume waiting for them.
export function pendingTasks() {
    try { return JSON.parse(localStorage.getItem(PENDING_STORAGE)) || []; } catch { return []; }
}
function setPending(list) {
    try { localStorage.setItem(PENDING_STORAGE, JSON.stringify(list)); } catch { /* ignore */ }
}
export const rememberTask = (task) => setPending([...pendingTasks().filter(t => t.taskId !== task.taskId), task]);
export const forgetTask = (taskId) => setPending(pendingTasks().filter(t => t.taskId !== taskId));

// ---------- Shared ----------

export function frameToFile(canvas, name = 'frame') {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) { reject(new Error('Could not capture frame')); return; }
            resolve(new File([blob], `${name}.jpg`, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.92);
    });
}

// Copies a drawable (video, image, canvas) into a canvas at its own size.
export function snapshotDrawable(drawable, w, h, crop = { left: 0, top: 0, right: 0, bottom: 0 }) {
    const sw = w - crop.left - crop.right;
    const sh = h - crop.top - crop.bottom;
    if (sw <= 0 || sh <= 0) throw new Error('Source has no visible frame');
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(drawable, crop.left, crop.top, sw, sh, 0, 0, sw, sh);
    return canvas;
}

// Runs one job end to end and resolves with the finished clip's URL.
// `onTask` receives the H3 task id as soon as it exists, so it can be resumed.
export async function runMinimaxJob(opts, onStage, onTask = () => {}) {
    if (opts.provider === 'hailuo') return runHailuo(opts, onStage);
    const taskId = await h3Submit(opts, onStage);
    onTask(taskId);
    return h3Wait(taskId, onStage);
}
