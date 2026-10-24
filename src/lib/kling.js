// Kling API client. Calls go through the app's own relay (/api/kling), which
// holds the Kling keys server-side (server/kling-proxy.mjs). Tasks are
// asynchronous: create, then poll GET <route>/<task_id> until `succeed`.

const TOKEN_KEY = 'kling_app_token';

export const getKlingToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
export const setKlingToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } };

export const ROUTES = {
    image: '/v1/images/generations',
    image2video: '/v1/videos/image2video',
    lipsync: '/v1/videos/lip-sync',
    avatar: '/v1/videos/avatar/image2video',
};

async function call(path, init = {}) {
    const res = await fetch(`/api/kling${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'x-app-token': getKlingToken(), ...(init.headers || {}) },
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (res.status === 404 && !data) throw new Error('Relais Kling introuvable : lance l\'app avec `npm run dev` ou déploie-la sur Netlify.');
    if (!res.ok) throw new Error(data?.message || `Kling ${res.status}: ${text.slice(0, 160)}`);
    // Kling answers HTTP 200 with a non-zero `code` on business errors.
    if (data && typeof data.code === 'number' && data.code !== 0) throw new Error(`Kling ${data.code}: ${data.message || 'erreur'}`);
    return data;
}

export async function klingStatus() {
    try { return await call('/status'); } catch (err) { return { configured: false, error: err.message }; }
}

async function create(route, body) {
    const data = await call(route, { method: 'POST', body: JSON.stringify(body) });
    const id = data?.data?.task_id;
    if (!id) throw new Error('Kling n\'a renvoyé aucune tâche');
    return id;
}

const STAGE = { submitted: 'En file d\'attente chez Kling', processing: 'Rendu Kling en cours' };

export async function waitFor(route, taskId, onStage = () => {}, { interval = 6000, timeout = 30 * 60 * 1000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const d = (await call(`${route}/${encodeURIComponent(taskId)}`)).data || {};
        if (d.task_status === 'succeed') return d.task_result || {};
        if (d.task_status === 'failed') throw new Error(d.task_status_msg || 'Kling : la tâche a échoué');
        const s = Math.floor((Date.now() - start) / 1000);
        onStage(`${STAGE[d.task_status] || 'Kling'} (${s} s)`);
        await new Promise(r => setTimeout(r, interval));
    }
    throw new Error('Kling : abandon après 30 minutes');
}

// Kling takes an image as an https URL or as raw base64 (no data: prefix).
export const imageField = (src) => (typeof src === 'string' && /^https?:/.test(src)) ? src : String(src).replace(/^data:[^,]+,/, '');

export async function generateImage({ prompt, negative, model, aspectRatio, n, resolution, reference, referenceKind, onStage }) {
    const body = { model_name: model, prompt, aspect_ratio: aspectRatio, n: n || 1 };
    if (negative) body.negative_prompt = negative;
    if (resolution) body.resolution = resolution;
    if (reference) {
        body.image = imageField(reference);
        if (referenceKind) body.image_reference = referenceKind;
    }
    const id = await create(ROUTES.image, body);
    const r = await waitFor(ROUTES.image, id, onStage);
    return (r.images || []).map(i => i.url).filter(Boolean);
}

export async function imageToVideo({ image, imageTail, prompt, negative, model, mode, duration, cfgScale, onStage }) {
    const body = { model_name: model, image: imageField(image), prompt, mode: mode || 'std', duration: String(duration || 5) };
    if (imageTail) body.image_tail = imageField(imageTail);
    if (negative) body.negative_prompt = negative;
    if (cfgScale != null) body.cfg_scale = cfgScale;
    const id = await create(ROUTES.image2video, body);
    const r = await waitFor(ROUTES.image2video, id, onStage);
    return (r.videos || []).map(v => ({ url: v.url, id: v.id, duration: v.duration }));
}

// Lip sync onto a Kling video (video_id) or a public video URL, driven by an
// audio file (base64, at most 5 MB) or a public audio URL.
export async function lipSync({ videoId, videoUrl, audioBase64, audioUrl, onStage }) {
    const input = { mode: 'audio2video' };
    if (videoId) input.video_id = videoId; else input.video_url = videoUrl;
    if (audioUrl) { input.audio_type = 'url'; input.audio_url = audioUrl; }
    else { input.audio_type = 'file'; input.audio_file = audioBase64; }
    const id = await create(ROUTES.lipsync, { input });
    const r = await waitFor(ROUTES.lipsync, id, onStage);
    return (r.videos || []).map(v => ({ url: v.url, id: v.id, duration: v.duration }));
}

// Avatar: a photo plus a voice track becomes a talking video.
export async function avatar({ image, soundFile, prompt, mode, onStage }) {
    const body = { image: imageField(image), sound_file: soundFile, mode: mode || 'std' };
    if (prompt) body.prompt = prompt;
    const id = await create(ROUTES.avatar, body);
    const r = await waitFor(ROUTES.avatar, id, onStage);
    return (r.videos || []).map(v => ({ url: v.url, id: v.id, duration: v.duration }));
}
