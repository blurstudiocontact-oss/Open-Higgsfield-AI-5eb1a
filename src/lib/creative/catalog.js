// Node catalog for the Creative Flows canvas. Node types, display names,
// output modalities, defaults and parameter enums follow what ElevenLabs
// Creative reports for a workspace (see docs/elevenlabs-creative-reconstruction.md).
// Models are limited to what this app can actually run: MiniMax (one key)
// and the public ElevenLabs API (optional key), plus in-browser processing.

export const MODALITY = {
    text: { label: 'Text', color: '#a1a1aa' },
    image: { label: 'Image', color: '#38bdf8' },
    video: { label: 'Video', color: '#f472b6' },
    audio: { label: 'Audio', color: '#d9ff00' },
    voice: { label: 'Voice', color: '#c084fc' },
};

const IMAGE_RATIOS = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'];

const sel = (name, options, def, label) => ({ name, type: 'select', options, default: def, label });
const num = (name, min, max, def, step, label) => ({ name, type: 'number', min, max, default: def, step, label });
const bool = (name, def, label) => ({ name, type: 'boolean', default: def, label });
const text = (name, label, placeholder = '') => ({ name, type: 'text', label, placeholder });

// Ports: `multi` accepts several edges; `accepts` lists modalities.
const port = (key, label, accepts, multi = false) => ({ key, label, accepts, multi });
const PROMPT_PORT = port('prompt', 'Prompt', ['text']);

export const NODE_TYPES = {
    // ---- Sources (not generation nodes) ----
    text: {
        label: 'Text', group: 'Sources', output: 'text', inputs: [],
        source: true, prompt: 'Text', models: [], params: [],
    },
    asset: {
        label: 'Asset', group: 'Sources', output: null, inputs: [],
        source: true, models: [], params: [],
    },

    // ---- Generation ----
    'image-generation': {
        label: 'Image Generation', group: 'Generate', output: 'image', prompt: 'Describe the image',
        inputs: [PROMPT_PORT, port('reference_images', 'Reference', ['image'], true)],
        models: [
            { id: 'image-01', name: 'MiniMax Image-01', backend: 'minimax' },
            { id: 'image-01-live', name: 'MiniMax Image-01 Live', backend: 'minimax' },
        ],
        params: [sel('aspect_ratio', IMAGE_RATIOS, '16:9', 'Aspect ratio'), sel('count', [1, 2, 3, 4], 4, 'Variations')],
    },
    'video-generation': {
        label: 'Video Generation', group: 'Generate', output: 'video', prompt: 'Describe the shot, action and sound',
        inputs: [
            PROMPT_PORT,
            port('start_frame', 'Start frame', ['image']),
            port('reference_images', 'Reference images', ['image'], true),
            port('reference_video', 'Reference video', ['video']),
        ],
        models: [{ id: 'MiniMax-H3', name: 'MiniMax H3', backend: 'minimax' }],
        params: [
            sel('ratio', ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], '16:9', 'Aspect ratio'),
            sel('resolution', ['768P', '2K'], '768P', 'Resolution'),
            sel('duration', [5, 10, 15], 5, 'Duration (s)'),
        ],
    },
    tts: {
        label: 'Text to Speech', group: 'Audio', output: 'audio', prompt: 'Text to speak',
        inputs: [PROMPT_PORT, port('voice', 'Voice', ['voice'])],
        models: [
            { id: 'eleven_v3', name: 'ElevenLabs v3', backend: 'elevenlabs' },
            { id: 'eleven_multilingual_v2', name: 'ElevenLabs Multilingual v2', backend: 'elevenlabs' },
            { id: 'eleven_turbo_v2_5', name: 'ElevenLabs Turbo v2.5', backend: 'elevenlabs' },
            { id: 'eleven_flash_v2_5', name: 'ElevenLabs Flash v2.5', backend: 'elevenlabs' },
            { id: 'speech-02-hd', name: 'MiniMax Speech 02 HD', backend: 'minimax' },
            { id: 'speech-02-turbo', name: 'MiniMax Speech 02 Turbo', backend: 'minimax' },
        ],
        params: [
            { name: 'voice_id', type: 'voice', label: 'Voice' },
            text('language_code', 'Language (BCP-47)', 'auto'),
            sel('count', [1, 2], 2, 'Takes'),
        ],
    },
    sfx: {
        label: 'Sound Effects', group: 'Audio', output: 'audio', prompt: 'Describe the sound',
        inputs: [PROMPT_PORT],
        models: [{ id: 'eleven_text_to_sound_v2', name: 'ElevenLabs Sound Effects v2', backend: 'elevenlabs' }],
        params: [
            num('duration_seconds', 0.5, 30, null, 0.5, 'Duration (s, empty = auto)'),
            num('prompt_influence', 0, 1, 0.3, 0.05, 'Prompt influence'),
            bool('loop', false, 'Seamless loop'),
            sel('count', [1, 2, 3, 4], 2, 'Variations'),
        ],
    },
    music: {
        label: 'Music', group: 'Audio', output: 'audio', prompt: 'Genre, mood, instruments, structure',
        inputs: [PROMPT_PORT, port('lyrics', 'Lyrics', ['text'])],
        models: [
            { id: 'music_v1', name: 'ElevenLabs Music v1', backend: 'elevenlabs' },
            { id: 'music-2.0', name: 'MiniMax Music 2.0', backend: 'minimax' },
        ],
        params: [
            num('duration_seconds', 3, 600, 30, 1, 'Duration (s)'),
            sel('lyrics_type', ['auto', 'custom', 'instrumental'], 'auto', 'Lyrics'),
            { name: 'lyrics', type: 'textarea', label: 'Custom lyrics' },
        ],
    },
    llm: {
        label: 'LLM', group: 'Generate', output: 'text', prompt: 'Instruction',
        inputs: [port('context', 'Context', ['text'], true)],
        models: [
            { id: 'MiniMax-M2', name: 'MiniMax M2', backend: 'minimax' },
            { id: 'MiniMax-M1', name: 'MiniMax M1', backend: 'minimax' },
        ],
        params: [
            num('temperature', 0, 2, 0.7, 0.05, 'Temperature'),
            sel('max_output_tokens', ['auto', 100, 300, 500, 2000], 'auto', 'Length'),
        ],
    },
    'voice-creation': {
        label: 'Voice Creation', group: 'Audio', output: 'voice', prompt: 'Describe the voice (age, accent, tone)',
        inputs: [],
        models: [
            { id: 'eleven_ttv_v3', name: 'ElevenLabs Voice Design v3', backend: 'elevenlabs' },
            { id: 'voice_design', name: 'MiniMax Voice Design', backend: 'minimax' },
        ],
        params: [{ name: 'preview_text', type: 'textarea', label: 'Preview line' }],
    },

    // ---- Edit & process ----
    composition: {
        label: 'Composition', group: 'Edit', output: 'video',
        inputs: [port('clips', 'Clips', ['video', 'audio'], true)],
        models: [{ id: 'eleven_composition', name: 'Composition (in browser)', backend: 'local' }],
        params: [],
    },
    'image-transform': {
        label: 'Image Editor', group: 'Edit', output: 'image',
        inputs: [port('source', 'Source', ['image']), port('overlay', 'Overlay', ['image'])],
        models: [{ id: 'eleven_image_transform', name: 'Image Editor (in browser)', backend: 'local' }],
        params: [
            num('output_width', 1, 8192, null, 1, 'Output width'),
            num('output_height', 1, 8192, null, 1, 'Output height'),
        ],
    },
    'audio-effects': {
        label: 'Audio Effects', group: 'Edit', output: 'audio',
        inputs: [port('source', 'Source', ['audio', 'video'])],
        models: [{ id: 'eleven_audio_effects', name: 'Audio Effects (in browser)', backend: 'local' }],
        params: [
            sel('filter_preset_id', ['', 'old_radio', 'robot', 'cheap_microphone', 'phone', 'low_quality_phone', 'bright_phone'], '', 'Filter'),
            sel('environment_id', ['', 'small_room', 'big_room', 'hall', 'tunnel', 'street', 'valley', 'forest'], '', 'Environment'),
            sel('background_noise_id', ['', 'call_center', 'cafe', 'city', 'keyboard'], '', 'Background noise'),
            num('distance', 0, 1, 0, 0.05, 'Distance'),
        ],
    },
    'voice-changer': {
        label: 'Voice Changer', group: 'Edit', output: 'audio',
        inputs: [port('source', 'Source', ['audio']), port('voice', 'Voice', ['voice'])],
        models: [{ id: 'eleven_multilingual_sts_v2', name: 'ElevenLabs Voice Changer', backend: 'elevenlabs' }],
        params: [{ name: 'voice_id', type: 'voice', label: 'Voice' }],
    },
    'voice-isolator': {
        label: 'Voice Isolator', group: 'Edit', output: 'audio',
        inputs: [port('source', 'Source', ['audio'])],
        models: [{ id: 'audio_isolation', name: 'ElevenLabs Voice Isolator', backend: 'elevenlabs' }],
        params: [],
    },
    'speech-to-text': {
        label: 'Speech to Text', group: 'Edit', output: 'text',
        inputs: [port('source', 'Source', ['audio', 'video'])],
        models: [{ id: 'scribe_v1', name: 'ElevenLabs Scribe', backend: 'elevenlabs' }],
        params: [],
    },
    'dubbing-audio': {
        label: 'Dubbing (Audio)', group: 'Edit', output: 'audio',
        inputs: [port('source', 'Source', ['audio'])],
        models: [{ id: 'dubbing_v2_audio', name: 'ElevenLabs Dubbing', backend: 'elevenlabs' }],
        params: [text('target_language_code', 'Target language', 'es')],
    },
    'dubbing-video': {
        label: 'Dubbing (Video)', group: 'Edit', output: 'video',
        inputs: [port('source', 'Source', ['video'])],
        models: [{ id: 'dubbing_v2_video', name: 'ElevenLabs Dubbing', backend: 'elevenlabs' }],
        params: [text('target_language_code', 'Target language', 'es')],
    },
};

export const GROUPS = ['Sources', 'Generate', 'Audio', 'Edit'];

// Ops the in-browser Image Editor understands, applied in this order.
export const IMAGE_OPS = {
    crop: { label: 'Crop', fields: { x: 0, y: 0, w: 1, h: 1 } },
    rotate_flip: { label: 'Rotate / flip', fields: { rotate: 0, flip_h: false, flip_v: false } },
    adjust: { label: 'Adjust', fields: { brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0, grayscale: 0 } },
    overlay: { label: 'Place overlay', fields: { x: 0.7, y: 0.7, w: 0.25, opacity: 1 } },
    text: { label: 'Text', fields: { text: 'Title', x: 0.5, y: 0.9, size: 0.08, color: '#ffffff', weight: 800 } },
};

export function nodeOutputModality(node) {
    if (node.type === 'asset') return node.asset?.kind || 'image';
    if (node.type === 'composition') return node.result?.outputs?.[0]?.kind || 'video';
    if (node.type === 'audio-effects') return node.result?.outputs?.[0]?.kind || 'audio';
    return NODE_TYPES[node.type]?.output;
}

export function defaultParams(type) {
    const p = {};
    for (const def of NODE_TYPES[type]?.params || []) {
        if (def.default !== undefined && def.default !== null) p[def.name] = def.default;
    }
    return p;
}

export const modelOf = (node) => NODE_TYPES[node.type]?.models.find(m => m.id === node.model) || NODE_TYPES[node.type]?.models[0];
