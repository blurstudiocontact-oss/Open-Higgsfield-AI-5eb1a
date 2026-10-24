// Runs flow nodes. A node reads the selected output of each upstream node
// wired into its ports, calls its backend, and stores every variation it gets
// back as a node output. Downstream nodes consume the selected variation.

import { NODE_TYPES, modelOf } from './catalog.js';
import { putMedia, outputBlob, outputUrl, selectedOutput, uid, brandKitPrompt, listBrandKits, kindOfMime } from './store.js';
import * as el from './elevenlabs.js';
import { generateImages, submitVideo, waitForVideo, uploadToMinimax, synthesizeSpeech, generateMusic, designVoice as mmDesignVoice, chat } from '../minimax.js';
import { transformImage, applyAudioEffects, compose } from './local.js';
import * as kling from '../kling.js';

// Inputs for a node: { portKey: [output, ...] } in edge order.
export function gatherInputs(flow, node) {
    const inputs = {};
    for (const e of flow.edges.filter(x => x.to === node.id)) {
        const src = flow.nodes.find(n => n.id === e.from);
        // A Text node always offers its current text, run or not.
        const out = src?.type === 'text' ? (src.prompt?.trim() ? { kind: 'text', text: src.prompt } : null) : selectedOutput(src);
        (inputs[e.toPort] ||= []);
        if (out) inputs[e.toPort].push({ ...out, edgeId: e.id, nodeId: src.id });
    }
    return inputs;
}

// Upstream nodes that must run first: wired in, but with nothing to give yet.
function pendingUpstream(flow, node, seen = new Set()) {
    const order = [];
    for (const e of flow.edges.filter(x => x.to === node.id)) {
        const src = flow.nodes.find(n => n.id === e.from);
        if (!src || seen.has(src.id)) continue;
        seen.add(src.id);
        if (!selectedOutput(src) && !NODE_TYPES[src.type].source) {
            order.push(...pendingUpstream(flow, src, seen), src);
        }
    }
    return order;
}

export async function runWithUpstream(flow, node, hooks) {
    for (const up of pendingUpstream(flow, node)) await runNode(flow, up, hooks);
    return runNode(flow, node, hooks);
}

export async function runNode(flow, node, { onChange = () => {}, onSave = () => {} } = {}) {
    if (node.run?.status === 'running') return;
    const set = (patch) => { node.run = { ...node.run, ...patch }; onChange(node); };
    set({ status: 'running', stage: 'Starting', error: null, startedAt: Date.now() });
    try {
        const outputs = await execute(flow, node, gatherInputs(flow, node), (stage) => set({ stage }));
        const stamped = outputs.map(o => ({ id: uid('out'), createdAt: Date.now(), ...o }));
        // Newest run first; the first new variation becomes the selection.
        node.result = { outputs: [...stamped, ...(node.result?.outputs || [])].slice(0, 24), selected: 0 };
        set({ status: 'completed', stage: null, finishedAt: Date.now() });
    } catch (err) {
        console.error(err);
        set({ status: 'failed', stage: null, error: err.message || String(err) });
    }
    onSave();
}

// ---------- Helpers ----------

const textOf = (outs = []) => outs.map(o => o.text).filter(Boolean).join('\n\n');

function promptFor(node, inputs, { required = true } = {}) {
    const parts = [textOf(inputs.prompt), node.prompt?.trim()].filter(Boolean);
    let p = parts.join('\n\n');
    if (node.brandKitId) p += brandKitPrompt(listBrandKits().find(k => k.id === node.brandKitId));
    if (required && !p.trim()) throw new Error('Write a prompt or connect a Text node');
    return p;
}

async function store(blob, meta) {
    const kind = meta.kind || kindOfMime(blob.type) || 'audio';
    return { kind, mediaId: await putMedia(blob, { kind, ...meta }) };
}

// Remote results expire; keep a local copy when the host allows the read.
async function keepRemote(url, kind, meta) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        return await store(await res.blob(), { kind, ...meta });
    } catch {
        return { kind, url };
    }
}

// Kling accepts an image as an https URL or raw base64.
async function klingImage(out) {
    if (out.url && /^https?:/.test(out.url)) return out.url;
    return blobToDataUrl(await outputBlob(out));
}

const AUDIO_LIMIT = 5 * 1024 * 1024;
async function klingAudio(out) {
    const blob = await outputBlob(out);
    if (blob.size > AUDIO_LIMIT) throw new Error(`Audio trop lourd pour Kling (${(blob.size / 1048576).toFixed(1)} Mo, max 5 Mo) : raccourcis le texte`);
    return (await blobToDataUrl(blob)).replace(/^data:[^,]+,/, '');
}

const klingVideos = (videos, meta) => Promise.all(videos.map(async v => ({ ...(await keepRemote(v.url, 'video', meta)), url: v.url, klingVideoId: v.id })));

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
});

// A media reference MiniMax can read: public URL as is, local blobs uploaded.
async function minimaxRef(out, kind) {
    if (out.url && /^https?:/.test(out.url)) return out.url;
    const blob = await outputBlob(out);
    const { url, file_id } = await uploadToMinimax(new File([blob], `input.${kind === 'video' ? 'mp4' : 'png'}`, { type: blob.type }));
    return url || { file_id };
}

function voiceFor(node, inputs) {
    const wired = inputs.voice?.[0];
    if (wired?.voiceId) return { id: wired.voiceId, backend: wired.voiceBackend };
    if (wired) throw new Error('Save the designed voice first (Voice Creation → Save voice)');
    const v = node.params.voice_id;
    if (!v) return null;
    const [backend, ...rest] = v.split(':');
    return rest.length ? { id: rest.join(':'), backend } : { id: v, backend: 'elevenlabs' };
}

const firstSource = (inputs) => {
    const s = inputs.source?.[0];
    if (!s) throw new Error('Connect a source to this node');
    return s;
};

// ---------- Execution per node type ----------

async function execute(flow, node, inputs, stage) {
    const model = modelOf(node);
    const p = node.params || {};
    const meta = { name: node.label, nodeId: node.id };

    switch (node.type) {
    case 'text':
        if (!node.prompt?.trim()) throw new Error('Write some text');
        return [{ kind: 'text', text: node.prompt }];

    case 'image-generation': {
        const prompt = promptFor(node, inputs);
        const ref = inputs.reference_images?.[0];
        let subjectReference;
        if (ref) subjectReference = ref.url && /^https?:/.test(ref.url) ? ref.url : await blobToDataUrl(await outputBlob(ref));
        stage('Generating on MiniMax');
        const { urls } = await generateImages({ model: model.id, prompt, aspect_ratio: p.aspect_ratio, subjectReference, n: +p.count || 1 });
        stage('Saving');
        return Promise.all(urls.map(u => keepRemote(u, 'image', meta)));
    }

    case 'video-generation': {
        const prompt = promptFor(node, inputs);
        stage('Uploading inputs');
        const firstFrame = inputs.start_frame?.[0] ? await minimaxRef(inputs.start_frame[0], 'image') : undefined;
        const referenceImages = await Promise.all((inputs.reference_images || []).map(r => minimaxRef(r, 'image')));
        const sourceVideo = inputs.reference_video?.[0] ? await minimaxRef(inputs.reference_video[0], 'video') : undefined;
        const fullPrompt = sourceVideo ? `<Video 1> is the source video for this editing task. ${prompt}` : prompt;
        stage('Submitting to MiniMax H3');
        const taskId = await submitVideo({
            prompt: fullPrompt, resolution: p.resolution, duration: +p.duration, ratio: firstFrame ? (p.ratio || 'adaptive') : (p.ratio === 'adaptive' ? '16:9' : p.ratio),
            firstFrame, sourceVideo, referenceImages,
        });
        const url = await waitForVideo(taskId, stage);
        stage('Saving');
        return [await keepRemote(url, 'video', meta)];
    }

    case 'tts': {
        const text = promptFor(node, inputs);
        const voice = voiceFor(node, inputs);
        if (!voice) throw new Error('Pick a voice');
        if (voice.backend !== model.backend) throw new Error(`This voice is a ${voice.backend === 'minimax' ? 'MiniMax' : 'ElevenLabs'} voice; pick a matching model`);
        const takes = +p.count || 1;
        const out = [];
        for (let i = 0; i < takes; i++) {
            stage(`Take ${i + 1}/${takes}`);
            const blob = model.backend === 'minimax'
                ? await synthesizeSpeech({ text, model: model.id, voiceId: voice.id })
                : await el.textToSpeech({ voiceId: voice.id, text, model: model.id, languageCode: p.language_code });
            out.push(await store(blob, { kind: 'audio', ...meta }));
        }
        return out;
    }

    case 'sfx': {
        const text = promptFor(node, inputs);
        const n = +p.count || 1;
        const out = [];
        for (let i = 0; i < n; i++) {
            stage(`Variation ${i + 1}/${n}`);
            const blob = await el.soundEffect({ text, durationSeconds: +p.duration_seconds || null, promptInfluence: +p.prompt_influence, loop: p.loop, model: model.id });
            out.push(await store(blob, { kind: 'audio', ...meta }));
        }
        return out;
    }

    case 'music': {
        const prompt = promptFor(node, inputs);
        const lyrics = textOf(inputs.lyrics) || p.lyrics || '';
        const lyricsType = inputs.lyrics?.length ? 'custom' : p.lyrics_type;
        stage('Composing');
        let blob;
        if (model.backend === 'minimax') {
            const mmLyrics = lyricsType === 'instrumental' ? '[Instrumental]' : lyrics;
            if (!mmLyrics) throw new Error('MiniMax Music needs lyrics: write custom lyrics or choose instrumental');
            blob = await generateMusic({ prompt, lyrics: mmLyrics, model: model.id });
        } else {
            blob = await el.composeMusic({ prompt, lyrics, lyricsType, durationSeconds: +p.duration_seconds, model: model.id });
        }
        return [await store(blob, { kind: 'audio', ...meta })];
    }

    case 'llm': {
        const instruction = node.prompt?.trim();
        if (!instruction) throw new Error('Write an instruction');
        const context = textOf(inputs.context);
        const messages = [];
        if (context) messages.push({ role: 'system', content: `Context:\n${context}` });
        messages.push({ role: 'user', content: instruction });
        stage('Thinking');
        const text = await chat({ model: model.id, messages, temperature: +p.temperature, maxTokens: p.max_output_tokens === 'auto' ? undefined : +p.max_output_tokens });
        return [{ kind: 'text', text }];
    }

    case 'voice-creation': {
        const description = promptFor(node, inputs);
        stage('Designing voices');
        if (model.backend === 'minimax') {
            const { voiceId, audio } = await mmDesignVoice({ prompt: description, previewText: p.preview_text });
            const preview = audio ? await store(audio, { kind: 'audio', ...meta }) : {};
            return [{ kind: 'voice', voiceId, voiceBackend: 'minimax', previewMediaId: preview.mediaId, name: description.slice(0, 40) }];
        }
        const previews = await el.designVoice({ description, text: p.preview_text, model: model.id });
        // Previews are not usable voices until saved; save them as a group.
        return Promise.all(previews.map(async (pv, i) => {
            const preview = await store(pv.audio, { kind: 'audio', ...meta });
            return { kind: 'voice', generatedVoiceId: pv.generatedVoiceId, voiceBackend: 'elevenlabs', previewMediaId: preview.mediaId, description, name: `${description.slice(0, 32)} #${i + 1}` };
        }));
    }

    case 'image-transform': {
        const src = firstSource(inputs);
        const overlay = inputs.overlay?.[0];
        stage('Rendering');
        const blob = await transformImage({
            sourceUrl: await outputUrl(src), overlayUrl: overlay ? await outputUrl(overlay) : null,
            ops: node.ops || [], outputWidth: p.output_width, outputHeight: p.output_height,
        });
        return [await store(blob, { kind: 'image', ...meta })];
    }

    case 'audio-effects': {
        const src = firstSource(inputs);
        stage('Processing');
        const blob = await applyAudioEffects(await outputBlob(src), p);
        return [await store(blob, { kind: 'audio', ...meta })];
    }

    case 'composition': {
        const clips = await Promise.all((inputs.clips || []).map(async c => ({
            kind: c.kind, url: await outputUrl(c), ...(node.tracks?.[c.edgeId] || {}),
        })));
        const { blob, kind } = await compose(clips, stage);
        return [await store(blob, { kind, ...meta })];
    }

    case 'voice-changer': {
        const src = firstSource(inputs);
        const voice = voiceFor(node, inputs);
        if (!voice || voice.backend !== 'elevenlabs') throw new Error('Pick an ElevenLabs voice');
        stage('Converting');
        const blob = await el.changeVoice(await outputBlob(src), voice.id, model.id);
        return [await store(blob, { kind: 'audio', ...meta })];
    }

    case 'voice-isolator': {
        const src = firstSource(inputs);
        stage('Isolating');
        return [await store(await el.isolateVoice(await outputBlob(src)), { kind: 'audio', ...meta })];
    }

    case 'speech-to-text': {
        const src = firstSource(inputs);
        stage('Transcribing');
        return [{ kind: 'text', text: await el.speechToText(await outputBlob(src)) }];
    }

    case 'kling-image': {
        const prompt = promptFor(node, inputs);
        const ref = inputs.reference?.[0];
        const urls = await kling.generateImage({
            prompt, model: model.id, aspectRatio: p.aspect_ratio, n: +p.n || 1, resolution: p.resolution,
            negative: p.negative_prompt, reference: ref ? await klingImage(ref) : null, referenceKind: ref ? p.image_reference : null,
            onStage: stage,
        });
        if (!urls.length) throw new Error('Kling n\'a renvoyé aucune image');
        stage('Enregistrement');
        // Keep Kling's public URL too: later Kling calls can pass it instead of base64.
        return Promise.all(urls.map(async u => ({ ...(await keepRemote(u, 'image', meta)), url: u })));
    }

    case 'kling-video': {
        const start = inputs.start_frame?.[0];
        if (!start) throw new Error('Branche une image sur « Start frame »');
        const prompt = promptFor(node, inputs, { required: false });
        stage('Envoi à Kling');
        const videos = await kling.imageToVideo({
            image: await klingImage(start), imageTail: inputs.end_frame?.[0] ? await klingImage(inputs.end_frame[0]) : null,
            prompt, negative: p.negative_prompt, model: model.id, mode: p.mode, duration: p.duration, cfgScale: p.cfg_scale,
            onStage: stage,
        });
        return klingVideos(videos, meta);
    }

    case 'kling-lipsync': {
        const video = inputs.video?.[0], audio = inputs.audio?.[0];
        if (!video) throw new Error('Branche une vidéo Kling sur « Video »');
        if (!audio) throw new Error('Branche une voix (Text to Speech ou fichier audio) sur « Voice audio »');
        const videoUrl = !video.klingVideoId && video.url && /^https?:/.test(video.url) ? video.url : null;
        if (!video.klingVideoId && !videoUrl) throw new Error('Le Lip Sync Kling a besoin d\'une vidéo générée par Kling (ou d\'une vidéo en ligne)');
        stage('Envoi à Kling');
        const videos = await kling.lipSync({ videoId: video.klingVideoId, videoUrl, audioBase64: await klingAudio(audio), onStage: stage });
        return klingVideos(videos, meta);
    }

    case 'kling-avatar': {
        const img = inputs.image?.[0], audio = inputs.audio?.[0];
        if (!img) throw new Error('Branche la photo du visage sur « Face photo »');
        if (!audio) throw new Error('Branche une voix (Text to Speech ou fichier audio) sur « Voice audio »');
        stage('Envoi à Kling');
        const videos = await kling.avatar({ image: await klingImage(img), soundFile: await klingAudio(audio), prompt: node.prompt?.trim(), mode: p.mode, onStage: stage });
        return klingVideos(videos, meta);
    }

    case 'dubbing-audio':
    case 'dubbing-video': {
        const src = firstSource(inputs);
        const lang = (p.target_language_code || '').trim();
        if (!lang) throw new Error('Set a target language code, e.g. es');
        const blob = await el.dub(await outputBlob(src), lang, stage);
        return [await store(blob, { kind: node.type === 'dubbing-video' ? 'video' : 'audio', ...meta })];
    }

    default:
        throw new Error(`${node.type} nodes cannot run`);
    }
}

// Saves an ElevenLabs voice preview as a permanent voice and updates the output.
export async function saveVoiceOutput(out, name) {
    const voiceId = await el.saveDesignedVoice({ name, description: out.description || name, generatedVoiceId: out.generatedVoiceId });
    Object.assign(out, { voiceId, name, saved: true });
    return voiceId;
}
