// Public ElevenLabs API client (api.elevenlabs.io), used by the Creative
// page's audio nodes. The key is optional for the rest of the app and is kept
// in localStorage like the MiniMax key; it is only sent to ElevenLabs.

const KEY_STORAGE = 'elevenlabs_key';
const BASE = 'https://api.elevenlabs.io';

export const getElevenKey = () => localStorage.getItem(KEY_STORAGE) || '';
export const setElevenKey = (key) => (key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE));

async function call(path, { method = 'GET', json, form, expect = 'json' } = {}) {
    const key = getElevenKey();
    if (!key) throw new Error('ElevenLabs API key missing. Add it in Creative → Settings.');
    const headers = { 'xi-api-key': key };
    let body;
    if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    const res = await fetch(`${BASE}${path}`, { method, headers, body });
    if (!res.ok) {
        let msg = res.statusText;
        try {
            const d = await res.json();
            msg = d?.detail?.message || (typeof d?.detail === 'string' ? d.detail : JSON.stringify(d.detail || d));
        } catch { /* keep status text */ }
        throw new Error(`ElevenLabs ${res.status}: ${msg}`);
    }
    return expect === 'blob' ? res.blob() : res.json();
}

const MP3 = 'output_format=mp3_44100_128';

// ---------- Voices ----------

export async function listVoices(search = '') {
    const q = new URLSearchParams({ page_size: '100' });
    if (search) q.set('search', search);
    const d = await call(`/v2/voices?${q}`);
    return (d.voices || []).map(v => ({
        id: v.voice_id,
        name: v.name,
        description: [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.descriptive || v.labels?.description, v.labels?.use_case].filter(Boolean).join(' · '),
        category: v.category,
        preview: v.preview_url,
        backend: 'elevenlabs',
    }));
}

// ---------- Generation ----------

export function textToSpeech({ voiceId, text, model, languageCode }) {
    const json = { text, model_id: model };
    if (languageCode && languageCode !== 'auto') json.language_code = languageCode;
    return call(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?${MP3}`, { method: 'POST', json, expect: 'blob' });
}

export function soundEffect({ text, durationSeconds, promptInfluence, loop, model }) {
    const json = { text, model_id: model, prompt_influence: promptInfluence ?? 0.3, loop: !!loop };
    if (durationSeconds) json.duration_seconds = durationSeconds;
    return call(`/v1/sound-generation?${MP3}`, { method: 'POST', json, expect: 'blob' });
}

export function composeMusic({ prompt, lyrics, lyricsType, durationSeconds, model }) {
    let full = prompt;
    if (lyricsType === 'custom' && lyrics) full += `\n\nLyrics:\n${lyrics}`;
    return call(`/v1/music?${MP3}`, {
        method: 'POST',
        json: {
            prompt: full,
            model_id: model,
            music_length_ms: Math.round((durationSeconds || 30) * 1000),
            force_instrumental: lyricsType === 'instrumental',
        },
        expect: 'blob',
    });
}

export async function speechToText(blob) {
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('file', blob, 'source');
    const d = await call('/v1/speech-to-text', { method: 'POST', form });
    return d.text || '';
}

export function isolateVoice(blob) {
    const form = new FormData();
    form.append('audio', blob, 'source');
    return call('/v1/audio-isolation', { method: 'POST', form, expect: 'blob' });
}

export function changeVoice(blob, voiceId, model) {
    const form = new FormData();
    form.append('audio', blob, 'source');
    form.append('model_id', model);
    return call(`/v1/speech-to-speech/${encodeURIComponent(voiceId)}?${MP3}`, { method: 'POST', form, expect: 'blob' });
}

// Returns previews: [{ generatedVoiceId, audio: Blob }] for a voice description.
export async function designVoice({ description, text, model }) {
    const json = { voice_description: description, model_id: model };
    if (text) json.text = text; else json.auto_generate_text = true;
    const d = await call('/v1/text-to-voice/design', { method: 'POST', json });
    return (d.previews || []).map(p => ({
        generatedVoiceId: p.generated_voice_id,
        audio: b64ToBlob(p.audio_base_64, p.media_type || 'audio/mpeg'),
    }));
}

export async function saveDesignedVoice({ name, description, generatedVoiceId }) {
    const d = await call('/v1/text-to-voice', {
        method: 'POST',
        json: { voice_name: name, voice_description: description, generated_voice_id: generatedVoiceId },
    });
    return d.voice_id;
}

// Dubbing is asynchronous: submit, poll, then download the dubbed track.
export async function dub(blob, targetLang, onStage = () => {}) {
    const form = new FormData();
    form.append('file', blob, 'source');
    form.append('target_lang', targetLang);
    form.append('source_lang', 'auto');
    const { dubbing_id: id } = await call('/v1/dubbing', { method: 'POST', form });
    const start = Date.now();
    for (;;) {
        const d = await call(`/v1/dubbing/${id}`);
        if (d.status === 'dubbed') break;
        if (d.status === 'failed') throw new Error(d.error || 'Dubbing failed');
        onStage(`Dubbing (${Math.floor((Date.now() - start) / 1000)} s)`);
        await new Promise(r => setTimeout(r, 5000));
    }
    return call(`/v1/dubbing/${id}/audio/${encodeURIComponent(targetLang)}`, { expect: 'blob' });
}

export function b64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
}
