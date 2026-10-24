// Client for Daydream Scope, the open-source real-time AI video server
// (github.com/daydreamlive/scope). Scope runs on the user's GPU machine (or
// a cloud box) and exposes an HTTP API plus WebRTC streaming; its plugin
// system adds pipelines (models, effects) that show up in the same API.
//
// Endpoint shapes follow Scope v0.2.5 (docs/api/*.md and
// src/scope/server/app.py). The server allows any CORS origin.

const BASE_STORAGE = 'daydream_scope_url';
export const DEFAULT_SCOPE_URL = 'http://localhost:8000';

export const getScopeUrl = () => (localStorage.getItem(BASE_STORAGE) || DEFAULT_SCOPE_URL).replace(/\/+$/, '');
export const setScopeUrl = (url) => (url ? localStorage.setItem(BASE_STORAGE, url) : localStorage.removeItem(BASE_STORAGE));

async function call(path, init = {}) {
    let res;
    try {
        res = await fetch(`${getScopeUrl()}${path}`, init);
    } catch {
        throw new Error(`Cannot reach Daydream Scope at ${getScopeUrl()}. Is the server running?`);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    if (!res.ok) {
        const detail = data?.detail;
        const msg = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : text.slice(0, 160);
        throw new Error(`Scope ${res.status}: ${msg || res.statusText}`);
    }
    return data;
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const health = () => call('/health');

// ---------- Pipelines ----------

// Every pipeline the server knows, built-in or added by a plugin.
export async function listPipelines() {
    const data = await call('/api/v1/pipelines/schemas');
    return Object.entries(data?.pipelines || {}).map(([id, p]) => ({
        id,
        name: p.name || id,
        description: p.description || '',
        modes: p.supported_modes || [],
        defaultMode: p.default_mode,
        usage: p.usage || [],
        requiresModels: !!p.requires_models,
        vramGb: p.estimated_vram_gb,
        supportsPrompts: p.supports_prompts !== false,
    }));
}

export const pipelineStatus = () => call('/api/v1/pipeline/status');

export const modelStatus = (pipelineId) => call(`/api/v1/models/status?pipeline_id=${encodeURIComponent(pipelineId)}`);

export const downloadModels = (pipelineId) => call('/api/v1/models/download', json('POST', { pipeline_id: pipelineId }));

// Loading is asynchronous: start it, then poll the status until it settles.
export async function loadPipeline(pipelineIds, loadParams = {}, onStage = () => {}, timeout = 10 * 60 * 1000) {
    await call('/api/v1/pipeline/load', json('POST', { pipeline_ids: pipelineIds, load_params: loadParams }));
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const s = await pipelineStatus();
        if (s.status === 'loaded') return s;
        if (s.status === 'error') throw new Error(`Pipeline failed to load: ${s.error}`);
        onStage(`Loading ${pipelineIds.join(' → ')}…`);
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Timed out waiting for the pipeline to load');
}

// ---------- Plugins ----------

export async function listPlugins() {
    const data = await call('/api/v1/plugins');
    return { plugins: data?.plugins || [], failed: data?.failed_plugins || [] };
}

// Plugin changes need a server restart so Python reloads its modules.
async function restartAndWait(onStage) {
    onStage('Restarting Scope…');
    await call('/api/v1/restart', { method: 'POST' }).catch(() => {});
    const start = Date.now();
    await new Promise(r => setTimeout(r, 1500));
    while (Date.now() - start < 120000) {
        try { await health(); return; } catch { await new Promise(r => setTimeout(r, 1500)); }
    }
    throw new Error('Scope did not come back after restarting');
}

// `spec` is a git URL (optionally @ref), a PyPI name, or a local path.
export async function installPlugin(spec, { upgrade = false } = {}, onStage = () => {}) {
    onStage(`Installing ${spec}…`);
    const res = await call('/api/v1/plugins', json('POST', { package: spec, upgrade }));
    if (res && res.success === false) throw new Error(res.message || 'Install failed');
    await restartAndWait(onStage);
    return res;
}

export async function uninstallPlugin(name, onStage = () => {}) {
    onStage(`Uninstalling ${name}…`);
    await call(`/api/v1/plugins/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await restartAndWait(onStage);
}

// ---------- Streaming ----------

// Opens a video-to-video session: `input` frames go to Scope, the transformed
// stream comes back. `text` mode needs no input (receive-only).
export async function startSession({ input, prompt, mode = 'video', params = {} }) {
    const { iceServers } = await call('/api/v1/webrtc/ice-servers');
    const pc = new RTCPeerConnection({ iceServers });
    const channel = pc.createDataChannel('parameters', { ordered: true });
    let sessionId = null;
    const queued = [];

    const sendCandidates = (candidates) => call(`/api/v1/webrtc/offer/${sessionId}`, json('PATCH', {
        candidates: candidates.map(c => ({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex })),
    })).catch(() => {});
    pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        if (sessionId) sendCandidates([e.candidate]); else queued.push(e.candidate);
    };

    if (mode === 'video' && input) {
        input.getVideoTracks().forEach(t => pc.addTrack(t, input));
    } else {
        pc.addTransceiver('video', { direction: 'recvonly' });
    }
    const output = new Promise((resolve) => {
        pc.ontrack = (e) => resolve(e.streams[0] || new MediaStream([e.track]));
    });

    await pc.setLocalDescription(await pc.createOffer());
    const answer = await call('/api/v1/webrtc/offer', json('POST', {
        sdp: pc.localDescription.sdp,
        type: pc.localDescription.type,
        initialParameters: {
            input_mode: mode,
            prompts: [{ text: prompt, weight: 1.0 }],
            ...params,
        },
    }));
    sessionId = answer.sessionId;
    await pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
    if (queued.length) sendCandidates(queued.splice(0));

    return {
        pc,
        channel,
        output,
        sessionId,
        // Smoothly blends to the new prompt over `steps` generation steps.
        setPrompt(text, steps = 8) {
            if (channel.readyState !== 'open') return false;
            channel.send(JSON.stringify(steps > 0
                ? { transition: { target_prompts: [{ text, weight: 1.0 }], num_steps: steps } }
                : { prompts: [{ text, weight: 1.0 }] }));
            return true;
        },
        close() {
            try { channel.close(); } catch { /* already closed */ }
            pc.close();
        },
    };
}
