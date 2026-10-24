// In-browser processing nodes: Image Editor, Audio Effects and Composition.
// These replace server-side ElevenLabs processing with canvas, Web Audio and
// MediaRecorder equivalents, so their output is an approximation.

const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image (the host may block cross-origin reads)'));
    img.src = url;
});

const canvasBlob = (canvas, type = 'image/png') => new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type));

// ---------- Image Editor ----------

// ops: ordered [{ op, ...fields }]. Geometry ops (crop, rotate_flip) run
// first, then layers (overlay, text), then whole-picture adjustments.
export async function transformImage({ sourceUrl, overlayUrl, ops = [], outputWidth, outputHeight }) {
    let img = await loadImage(sourceUrl);
    let canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);

    const rank = { crop: 0, rotate_flip: 1, overlay: 2, text: 2, adjust: 3 };
    const ordered = [...ops].sort((a, b) => (rank[a.op] ?? 9) - (rank[b.op] ?? 9));
    const overlay = overlayUrl ? await loadImage(overlayUrl) : null;

    for (const o of ordered) {
        const W = canvas.width, H = canvas.height;
        if (o.op === 'crop') {
            const x = clamp01(o.x) * W, y = clamp01(o.y) * H;
            const w = Math.max(1, Math.min(W - x, clamp01(o.w) * W)), h = Math.max(1, Math.min(H - y, clamp01(o.h) * H));
            canvas = redraw(canvas, w, h, (ctx, src) => ctx.drawImage(src, x, y, w, h, 0, 0, w, h));
        } else if (o.op === 'rotate_flip') {
            const turns = ((Math.round((+o.rotate || 0) / 90) % 4) + 4) % 4;
            const w = turns % 2 ? H : W, h = turns % 2 ? W : H;
            canvas = redraw(canvas, w, h, (ctx, src) => {
                ctx.translate(w / 2, h / 2);
                ctx.rotate(turns * Math.PI / 2);
                ctx.scale(o.flip_h ? -1 : 1, o.flip_v ? -1 : 1);
                ctx.drawImage(src, -W / 2, -H / 2);
            });
        } else if (o.op === 'overlay' && overlay) {
            const ctx = canvas.getContext('2d');
            const w = clamp01(o.w) * W, h = w * overlay.naturalHeight / overlay.naturalWidth;
            ctx.globalAlpha = clamp01(o.opacity ?? 1);
            ctx.drawImage(overlay, clamp01(o.x) * W - w / 2, clamp01(o.y) * H - h / 2, w, h);
            ctx.globalAlpha = 1;
        } else if (o.op === 'text' && o.text) {
            const ctx = canvas.getContext('2d');
            const size = Math.max(8, (+o.size || 0.08) * H);
            ctx.font = `${o.weight || 800} ${size}px Inter, system-ui, sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = size / 8; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.strokeText(o.text, clamp01(o.x) * W, clamp01(o.y) * H);
            ctx.fillStyle = o.color || '#fff';
            ctx.fillText(o.text, clamp01(o.x) * W, clamp01(o.y) * H);
        } else if (o.op === 'adjust') {
            const f = `brightness(${o.brightness ?? 1}) contrast(${o.contrast ?? 1}) saturate(${o.saturate ?? 1}) hue-rotate(${o.hue || 0}deg) blur(${o.blur || 0}px) grayscale(${o.grayscale || 0})`;
            canvas = redraw(canvas, W, H, (ctx, src) => { ctx.filter = f; ctx.drawImage(src, 0, 0); });
        }
    }

    if (outputWidth || outputHeight) {
        const w = +outputWidth || Math.round(canvas.width * (+outputHeight / canvas.height));
        const h = +outputHeight || Math.round(canvas.height * (+outputWidth / canvas.width));
        canvas = redraw(canvas, w, h, (ctx, src) => {
            // Cover: keep the picture's proportions and crop the middle.
            const s = Math.max(w / src.width, h / src.height);
            ctx.drawImage(src, (w - src.width * s) / 2, (h - src.height * s) / 2, src.width * s, src.height * s);
        });
    }
    return canvasBlob(canvas);
}

const clamp01 = (v) => Math.min(1, Math.max(0, +v || 0));

function redraw(src, w, h, draw) {
    const c = document.createElement('canvas');
    c.width = Math.round(w); c.height = Math.round(h);
    const ctx = c.getContext('2d');
    draw(ctx, src);
    return c;
}

// ---------- Audio ----------

export async function decodeAudio(blob) {
    const ctx = new AudioContext();
    try { return await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { ctx.close(); }
}

export function encodeWav(buffer) {
    const ch = buffer.numberOfChannels, len = buffer.length, rate = buffer.sampleRate;
    const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
    out.setUint32(24, rate, true); out.setUint32(28, rate * ch * 2, true);
    out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data');
    out.setUint32(40, len * ch * 2, true);
    const chans = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i));
    let o = 44;
    for (let i = 0; i < len; i++) {
        for (let c = 0; c < ch; c++) {
            const s = Math.max(-1, Math.min(1, chans[c][i]));
            out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            o += 2;
        }
    }
    return new Blob([out], { type: 'audio/wav' });
}

const FILTERS = {
    phone: [['highpass', 300], ['lowpass', 3400]],
    bright_phone: [['highpass', 500], ['peaking', 2500, 8], ['lowpass', 4000]],
    low_quality_phone: [['highpass', 400], ['lowpass', 2600]],
    old_radio: [['highpass', 500], ['peaking', 1500, 6], ['lowpass', 3000]],
    cheap_microphone: [['highpass', 200], ['peaking', 3000, 5], ['lowpass', 6000]],
    robot: [],
};
const ROOMS = { small_room: [0.4, 0.25], big_room: [1.2, 0.35], hall: [2.8, 0.45], tunnel: [3.5, 0.6], street: [0.8, 0.15], valley: [4, 0.3], forest: [1.5, 0.2] };
// Synthesised noise beds: [low cut, high cut, level, flutter rate]. The real
// node mixes recorded ambience; these only suggest it.
const NOISES = { call_center: [300, 3000, 0.04, 3], cafe: [200, 4000, 0.05, 1.5], city: [60, 1200, 0.07, 0.3], keyboard: [1500, 8000, 0.03, 9] };

export async function applyAudioEffects(blob, { filter_preset_id: filter, environment_id: env, background_noise_id: noise, distance = 0 }) {
    if (!filter && !env && !noise && !+distance) throw new Error('Pick at least one effect');
    const src = await decodeAudio(blob);
    const rate = src.sampleRate;
    const tail = env ? ROOMS[env][0] : 0;
    const len = Math.ceil((src.duration + tail) * rate);
    const ctx = new OfflineAudioContext(2, len, rate);

    const input = ctx.createBufferSource();
    input.buffer = src;
    let node = input;
    const chain = (n) => { node.connect(n); node = n; };

    for (const [type, freq, gain] of FILTERS[filter] || []) {
        const f = ctx.createBiquadFilter();
        f.type = type; f.frequency.value = freq;
        if (gain) { f.gain.value = gain; f.Q.value = 1.2; }
        chain(f);
    }
    if (filter === 'robot') {
        // Ring modulation with a 50 Hz carrier.
        const ring = ctx.createGain(); ring.gain.value = 0;
        const osc = ctx.createOscillator(); osc.frequency.value = 50;
        osc.connect(ring.gain); osc.start();
        chain(ring);
    }
    if (+distance > 0) {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 12000 - distance * 9000;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 40 + distance * 200;
        const g = ctx.createGain(); g.gain.value = 1 - distance * 0.5;
        chain(lp); chain(hp); chain(g);
    }

    const out = ctx.createGain();
    if (env) {
        const [secs, wet] = ROOMS[env];
        const wetMix = Math.min(0.9, wet + (+distance || 0) * 0.3);
        const conv = ctx.createConvolver();
        conv.buffer = impulse(ctx, secs, env === 'tunnel' ? 1.5 : 3);
        const dry = ctx.createGain(); dry.gain.value = 1 - wetMix;
        const wetG = ctx.createGain(); wetG.gain.value = wetMix * 1.6;
        node.connect(dry).connect(out);
        node.connect(conv).connect(wetG).connect(out);
    } else {
        node.connect(out);
    }

    if (noise) {
        const [lo, hi, level, flutter] = NOISES[noise];
        const nb = ctx.createBufferSource();
        nb.buffer = noiseBuffer(ctx, len);
        const bp1 = ctx.createBiquadFilter(); bp1.type = 'highpass'; bp1.frequency.value = lo;
        const bp2 = ctx.createBiquadFilter(); bp2.type = 'lowpass'; bp2.frequency.value = hi;
        const g = ctx.createGain(); g.gain.value = level;
        const lfo = ctx.createOscillator(); lfo.frequency.value = flutter;
        const lfoG = ctx.createGain(); lfoG.gain.value = level * 0.6;
        lfo.connect(lfoG).connect(g.gain); lfo.start();
        nb.connect(bp1).connect(bp2).connect(g).connect(out);
        nb.start();
    }

    out.connect(ctx.destination);
    input.start();
    return encodeWav(await ctx.startRendering());
}

function impulse(ctx, secs, decay) {
    const len = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
}

function noiseBuffer(ctx, len) {
    // Pink-ish noise (Paul Kellet's economy filter).
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
            d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
        }
    }
    return buf;
}

// ---------- Composition ----------

// clips: [{ kind: 'video'|'audio', url, volume, muted }] in edge order.
// Videos play back to back on one track; every audio clip gets its own track
// starting at 0. With no video the result is a mixed WAV.
export async function compose(clips, onStage = () => {}) {
    const videos = clips.filter(c => c.kind === 'video');
    const audios = clips.filter(c => c.kind === 'audio' && !c.muted);
    if (!videos.length && !audios.length) throw new Error('Connect at least one video or audio clip');

    if (!videos.length) {
        onStage('Mixing audio');
        const bufs = await Promise.all(audios.map(async a => ({ buf: await decodeAudio(await (await fetch(a.url)).blob()), vol: a.volume ?? 1 })));
        const rate = 44100;
        const len = Math.ceil(Math.max(...bufs.map(b => b.buf.duration)) * rate);
        const ctx = new OfflineAudioContext(2, len, rate);
        for (const { buf, vol } of bufs) {
            const s = ctx.createBufferSource(); s.buffer = buf;
            const g = ctx.createGain(); g.gain.value = vol;
            s.connect(g).connect(ctx.destination); s.start();
        }
        return { blob: encodeWav(await ctx.startRendering()), kind: 'audio' };
    }

    // Probe the first video for the output size.
    const first = await loadVideo(videos[0].url);
    const W = first.videoWidth || 1280, H = first.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');

    const ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : {});
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => { rec.onstop = r; });

    const audioEls = [];
    for (const a of audios) {
        const el = new Audio(); el.crossOrigin = 'anonymous'; el.src = a.url;
        await new Promise((res, rej) => { el.oncanplaythrough = res; el.onerror = () => rej(new Error('Could not load an audio clip')); el.load(); });
        const gn = ac.createGain(); gn.gain.value = a.volume ?? 1;
        ac.createMediaElementSource(el).connect(gn).connect(dest);
        audioEls.push(el);
    }

    rec.start(250);
    audioEls.forEach(el => el.play());
    for (let i = 0; i < videos.length; i++) {
        onStage(`Rendering clip ${i + 1}/${videos.length}`);
        const v = i === 0 ? first : await loadVideo(videos[i].url);
        const vg = ac.createGain(); vg.gain.value = videos[i].muted ? 0 : (videos[i].volume ?? 1);
        ac.createMediaElementSource(v).connect(vg).connect(dest);
        await new Promise((resolve) => {
            let raf;
            const draw = () => {
                const s = Math.min(W / v.videoWidth, H / v.videoHeight);
                const w = v.videoWidth * s, h = v.videoHeight * s;
                g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
                g.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
                raf = requestAnimationFrame(draw);
            };
            v.onended = () => { cancelAnimationFrame(raf); resolve(); };
            v.play().then(draw, resolve);
        });
    }
    audioEls.forEach(el => el.pause());
    rec.stop();
    await done;
    ac.close();
    return { blob: new Blob(chunks, { type: rec.mimeType || 'video/webm' }), kind: 'video' };
}

function loadVideo(url) {
    return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous'; v.playsInline = true; v.preload = 'auto';
        v.onloadeddata = () => resolve(v);
        v.onerror = () => reject(new Error('Could not load a video clip'));
        v.src = url;
    });
}
