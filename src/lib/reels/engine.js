// Reel playback and export. Clips play back to back on a 9:16 canvas; one
// media element per source file is seeked and played as the playhead moves.
// Audio from clips and audio tracks is mixed in a WebAudio graph that feeds
// both the speakers and the export recorder.

import { REEL, FILTERS, TEXT_STYLES, clipDuration, layout, getMedia } from './store.js';

const TRANSITION_SECONDS = 0.5;

// Camera movement templates: given progress p (0..1) through the clip,
// return a transform { x, y, scale, rotate } in canvas-fraction units,
// applied around the frame center (Ken Burns-style pans/zooms).
const MOTION_FX = {
    none: () => ({}),
    zoomIn: (p) => ({ scale: 1 + 0.18 * p }),
    zoomOut: (p) => ({ scale: 1.18 - 0.18 * p }),
    pushIn: (p) => ({ scale: 1 + 0.35 * p }),
    pullOut: (p) => ({ scale: 1.35 - 0.35 * p }),
    kenBurns: (p) => ({ scale: 1.08 + 0.14 * p, x: 0.045 * (1 - p), y: -0.035 * (1 - p) }),
    panLeft: (p) => ({ scale: 1.14, x: 0.07 - 0.14 * p }),
    panRight: (p) => ({ scale: 1.14, x: -0.07 + 0.14 * p }),
    panUp: (p) => ({ scale: 1.14, y: 0.07 - 0.14 * p }),
    panDown: (p) => ({ scale: 1.14, y: -0.07 + 0.14 * p }),
    shake: (p) => ({
        scale: 1.05,
        x: 0.012 * Math.sin(p * 47) + 0.006 * Math.sin(p * 101 + 1.3),
        y: 0.012 * Math.cos(p * 53 + 0.7) + 0.006 * Math.sin(p * 89 + 2.1),
        rotate: 0.01 * Math.sin(p * 37 + 0.4),
    }),
    orbit: (p) => ({ scale: 1.16, x: 0.05 * Math.cos(p * Math.PI * 2), y: 0.05 * Math.sin(p * Math.PI * 2) }),
    driftTilt: (p) => ({ scale: 1.1, rotate: (p - 0.5) * 0.035 }),
};

export class ReelEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        canvas.width = REEL.width;
        canvas.height = REEL.height;
        this.project = null;
        this.media = new Map();   // mediaId -> { rec, el, url, gain }
        this.t = 0;
        this.playing = false;
        this.onTime = () => {};
        this.onEnded = () => {};
        this.prevFrame = document.createElement('canvas');
        this.prevFrame.width = REEL.width;
        this.prevFrame.height = REEL.height;
        this.audio = null;
        this.clock = new Worker(URL.createObjectURL(new Blob(
            ['let t=null;onmessage=e=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),e.data)}'],
            { type: 'text/javascript' })));
        this.clock.onmessage = () => this.tick();
    }

    ensureAudio() {
        if (this.audio) return this.audio;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const master = ctx.createGain();
        const dest = ctx.createMediaStreamDestination();
        master.connect(ctx.destination);
        master.connect(dest);
        this.audio = { ctx, master, dest };
        this.media.forEach((m) => this.routeAudio(m));
        return this.audio;
    }

    routeAudio(m) {
        if (!this.audio || m.gain || m.rec.kind === 'image') return;
        const src = this.audio.ctx.createMediaElementSource(m.el);
        m.gain = this.audio.ctx.createGain();
        src.connect(m.gain);
        m.gain.connect(this.audio.master);
    }

    // Loads media elements for every file the project references.
    async setProject(project) {
        this.project = project;
        const ids = new Set([...project.clips.map(c => c.mediaId), ...project.audios.map(a => a.mediaId)]);
        for (const id of ids) {
            if (this.media.has(id)) continue;
            const rec = await getMedia(id);
            if (!rec) continue;
            const url = URL.createObjectURL(rec.blob);
            let el;
            if (rec.kind === 'image') {
                el = new Image();
                el.src = url;
                await el.decode().catch(() => {});
            } else {
                el = document.createElement(rec.kind === 'audio' ? 'audio' : 'video');
                el.src = url;
                el.preload = 'auto';
                el.playsInline = true;
                el.crossOrigin = 'anonymous';
                await new Promise(r => { el.onloadeddata = r; el.onerror = r; setTimeout(r, 4000); });
            }
            const m = { rec, el, url, gain: null };
            this.media.set(id, m);
            this.routeAudio(m);
        }
        for (const [id, m] of this.media) {
            if (!ids.has(id)) { this.release(m); this.media.delete(id); }
        }
        this.t = Math.min(this.t, this.duration);
        this.seek(this.t);
    }

    release(m) {
        if (m.el.pause) m.el.pause();
        m.gain?.disconnect();
        URL.revokeObjectURL(m.url);
    }

    get duration() {
        return this.project ? layout(this.project).total : 0;
    }

    clipAt(t) {
        const { starts } = layout(this.project);
        for (let i = this.project.clips.length - 1; i >= 0; i--) {
            if (t >= starts[i]) return { clip: this.project.clips[i], index: i, start: starts[i] };
        }
        return null;
    }

    // ---------- Transport ----------

    play() {
        if (!this.project?.clips.length) return;
        this.ensureAudio().ctx.resume();
        if (this.t >= this.duration - 0.05) this.t = 0;
        this.playing = true;
        this.wallStart = performance.now() - this.t * 1000;
        this.clock.postMessage(1000 / REEL.fps);
    }

    pause() {
        this.playing = false;
        this.clock.postMessage(0);
        this.media.forEach(m => m.el.pause && m.el.pause());
        this.render(this.t);
    }

    seek(t) {
        this.t = Math.max(0, Math.min(t, this.duration));
        if (this.playing) this.wallStart = performance.now() - this.t * 1000;
        this.syncMedia(true);
        this.render(this.t);
        this.onTime(this.t);
    }

    tick() {
        if (!this.playing) return;
        this.t = (performance.now() - this.wallStart) / 1000;
        if (this.t >= this.duration) {
            this.t = this.duration;
            this.pause();
            this.onTime(this.t);
            this.onEnded();
            return;
        }
        this.syncMedia(false);
        this.render(this.t);
        this.onTime(this.t);
    }

    // Puts every media element where the playhead says it should be.
    syncMedia(force) {
        const p = this.project;
        if (!p) return;
        const at = this.clipAt(this.t);
        const activeMedia = new Set();
        if (at) {
            const m = this.media.get(at.clip.mediaId);
            if (m && m.rec.kind !== 'image') {
                activeMedia.add(at.clip.mediaId);
                const local = at.clip.in + (this.t - at.start) * at.clip.speed;
                m.el.playbackRate = at.clip.speed;
                if (m.gain) m.gain.gain.value = at.clip.volume;
                if (force || Math.abs(m.el.currentTime - local) > 0.3) {
                    m.el.currentTime = local;
                    if (!this.playing) m.el.addEventListener('seeked', () => this.render(this.t), { once: true });
                }
                if (this.playing && m.el.paused) m.el.play().catch(() => {});
            }
        }
        for (const a of p.audios) {
            const m = this.media.get(a.mediaId);
            if (!m) continue;
            const len = a.out - a.in;
            const inside = this.t >= a.start && this.t < a.start + len;
            if (!inside) continue;
            activeMedia.add(a.mediaId);
            const local = a.in + (this.t - a.start);
            if (m.gain) m.gain.gain.value = a.volume;
            m.el.playbackRate = 1;
            if (force || Math.abs(m.el.currentTime - local) > 0.3) m.el.currentTime = local;
            if (this.playing && m.el.paused) m.el.play().catch(() => {});
        }
        this.media.forEach((m, id) => { if (!activeMedia.has(id) && m.el.pause && !m.el.paused) m.el.pause(); });
    }

    // ---------- Rendering ----------

    // `elapsed` is seconds since this clip started (drives its camera
    // motion template). `transform` is an extra transition-specific
    // transform composed on top of the clip's own motion.
    drawClip(ctx, clip, alpha = 1, elapsed = 0, transform = null, extraFilter = '') {
        const m = this.media.get(clip.mediaId);
        if (!m) return;
        const el = m.el;
        const w = el.videoWidth || el.naturalWidth;
        const h = el.videoHeight || el.naturalHeight;
        if (!w || !h) return;
        const W = REEL.width, H = REEL.height;
        const k = clip.fit === 'contain' ? Math.min(W / w, H / h) : Math.max(W / w, H / h);
        const a = clip.adjust || {};
        const parts = [FILTERS[clip.filter]?.css || ''];
        if (a.brightness) parts.push(`brightness(${1 + a.brightness / 100})`);
        if (a.contrast) parts.push(`contrast(${1 + a.contrast / 100})`);
        if (a.saturation) parts.push(`saturate(${1 + a.saturation / 100})`);
        if (extraFilter) parts.push(extraFilter);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.filter = parts.join(' ').trim() || 'none';
        if (transform) transform(ctx);
        this.applyMotion(ctx, clip, elapsed, W, H);
        if (clip.fit === 'contain') {
            // Blurred fill behind letterboxed media, as reel editors do.
            const kc = Math.max(W / w, H / h);
            ctx.save();
            ctx.filter = 'blur(40px) brightness(0.6)';
            ctx.drawImage(el, (W - w * kc) / 2, (H - h * kc) / 2, w * kc, h * kc);
            ctx.restore();
        }
        ctx.drawImage(el, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
        ctx.restore();
    }

    // Camera movement template (Ken Burns pan/zoom, shake, orbit, ...).
    applyMotion(ctx, clip, elapsed, W, H) {
        const fn = MOTION_FX[clip.motion];
        if (!fn) return;
        const dur = clipDuration(clip);
        const p = dur > 0 ? Math.max(0, Math.min(1, elapsed / dur)) : 0;
        const { x = 0, y = 0, scale = 1, rotate = 0 } = fn(p) || {};
        if (!x && !y && scale === 1 && !rotate) return;
        ctx.translate(W / 2, H / 2);
        ctx.translate(x * W, y * H);
        ctx.rotate(rotate);
        ctx.scale(scale, scale);
        ctx.translate(-W / 2, -H / 2);
    }

    // Renders a clip at a given elapsed time into an offscreen full-frame
    // canvas, for transitions that need pixel access to the incoming clip
    // (pixelate, glitch).
    renderClipToTemp(clip, elapsed) {
        if (!this.tmpFrame) {
            this.tmpFrame = document.createElement('canvas');
            this.tmpFrame.width = REEL.width;
            this.tmpFrame.height = REEL.height;
        }
        const tctx = this.tmpFrame.getContext('2d');
        tctx.clearRect(0, 0, REEL.width, REEL.height);
        this.drawClip(tctx, clip, 1, elapsed);
        return this.tmpFrame;
    }

    // Downsamples then upscales `src` without smoothing, for a blocky
    // pixelation whose strength is `amt` (0 = sharp, 1 = coarsest).
    drawPixelated(ctx, src, amt) {
        const W = REEL.width, H = REEL.height;
        if (amt < 0.03) { ctx.drawImage(src, 0, 0); return; }
        const cell = Math.max(1, Math.round(amt * 48));
        const sw = Math.max(1, Math.round(W / cell)), sh = Math.max(1, Math.round(H / cell));
        if (!this.pixelTmp) this.pixelTmp = document.createElement('canvas');
        const t = this.pixelTmp;
        t.width = sw; t.height = sh;
        const tctx = t.getContext('2d');
        tctx.imageSmoothingEnabled = true;
        tctx.drawImage(src, 0, 0, sw, sh);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(t, 0, 0, W, H);
        ctx.restore();
    }

    render(t) {
        const ctx = this.ctx;
        const W = REEL.width, H = REEL.height;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        if (!this.project) return;
        const at = this.clipAt(t);
        if (at) {
            const local = t - at.start;
            const inTransition = at.index > 0 && at.clip.transition !== 'none' && local < TRANSITION_SECONDS;
            if (inTransition) {
                this.drawTransition(ctx, at.clip, local / TRANSITION_SECONDS, local);
            } else {
                this.drawClip(ctx, at.clip, 1, local);
                // Keep the latest frame for the next clip's transition.
                this.prevFrame.getContext('2d').drawImage(this.canvas, 0, 0);
            }
        }
        for (const text of this.project.texts) {
            if (t >= text.start && t < text.end) this.drawText(ctx, text, t - text.start, text.end - text.start);
        }
    }

    drawTransition(ctx, clip, p, elapsed) {
        const W = REEL.width, H = REEL.height;
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const prev = this.prevFrame;
        switch (clip.transition) {
            case 'fade':
                ctx.drawImage(prev, 0, 0);
                this.drawClip(ctx, clip, e, elapsed);
                break;
            case 'black':
            case 'white':
                if (p < 0.5) ctx.drawImage(prev, 0, 0); else this.drawClip(ctx, clip, 1, elapsed);
                ctx.globalAlpha = p < 0.5 ? p * 2 : (1 - p) * 2;
                ctx.fillStyle = clip.transition === 'black' ? '#000' : '#fff';
                ctx.fillRect(0, 0, W, H);
                ctx.globalAlpha = 1;
                break;
            case 'slide':
                ctx.drawImage(prev, -W * e, 0);
                this.drawClip(ctx, clip, 1, elapsed, (c) => c.translate(W * (1 - e), 0));
                break;
            case 'zoom':
                ctx.drawImage(prev, 0, 0);
                this.drawClip(ctx, clip, e, elapsed, (c) => {
                    const s = 1.3 - 0.3 * e;
                    c.translate(W / 2, H / 2);
                    c.scale(s, s);
                    c.translate(-W / 2, -H / 2);
                });
                break;
            case 'wipeLeft':
            case 'wipeRight':
            case 'wipeUp':
            case 'wipeDown': {
                ctx.drawImage(prev, 0, 0);
                ctx.save();
                ctx.beginPath();
                if (clip.transition === 'wipeLeft') ctx.rect(0, 0, W * p, H);
                else if (clip.transition === 'wipeRight') ctx.rect(W - W * p, 0, W * p, H);
                else if (clip.transition === 'wipeUp') ctx.rect(0, H - H * p, W, H * p);
                else ctx.rect(0, 0, W, H * p);
                ctx.clip();
                this.drawClip(ctx, clip, 1, elapsed);
                ctx.restore();
                break;
            }
            case 'circle': {
                ctx.drawImage(prev, 0, 0);
                ctx.save();
                ctx.beginPath();
                ctx.arc(W / 2, H / 2, p * Math.hypot(W, H) / 1.6, 0, Math.PI * 2);
                ctx.clip();
                this.drawClip(ctx, clip, 1, elapsed);
                ctx.restore();
                break;
            }
            case 'spin':
                ctx.drawImage(prev, 0, 0);
                this.drawClip(ctx, clip, e, elapsed, (c) => {
                    c.translate(W / 2, H / 2);
                    c.rotate((1 - e) * Math.PI * 0.5);
                    c.scale(0.4 + 0.6 * e, 0.4 + 0.6 * e);
                    c.translate(-W / 2, -H / 2);
                });
                break;
            case 'flip': {
                const half = p < 0.5;
                const q = half ? p * 2 : (p - 0.5) * 2;
                const scaleX = Math.max(0.02, half ? 1 - q : q);
                ctx.save();
                ctx.translate(W / 2, 0);
                ctx.scale(scaleX, 1);
                ctx.translate(-W / 2, 0);
                if (half) ctx.drawImage(prev, 0, 0); else this.drawClip(ctx, clip, 1, elapsed);
                ctx.restore();
                break;
            }
            case 'blur': {
                ctx.save();
                ctx.filter = `blur(${e * 14}px)`;
                ctx.globalAlpha = 1 - e;
                ctx.drawImage(prev, 0, 0);
                ctx.restore();
                this.drawClip(ctx, clip, e, elapsed, null, `blur(${(1 - e) * 14}px)`);
                break;
            }
            case 'pixelate': {
                const amt = p < 0.5 ? p * 2 : (1 - p) * 2;
                const src = p < 0.5 ? prev : this.renderClipToTemp(clip, elapsed);
                this.drawPixelated(ctx, src, amt);
                break;
            }
            case 'glitch': {
                const amt = Math.sin(p * Math.PI);
                const src = p < 0.5 ? prev : this.renderClipToTemp(clip, elapsed);
                ctx.drawImage(src, 0, 0);
                if (amt > 0.05) {
                    const slices = 10, sliceH = H / slices;
                    for (let i = 0; i < slices; i++) {
                        const y = i * sliceH;
                        const dx = Math.sin(i * 12.9 + p * 40) * amt * 40;
                        ctx.drawImage(src, 0, y, W, sliceH, dx, y, W, sliceH);
                    }
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighten';
                    ctx.globalAlpha = amt * 0.5;
                    ctx.drawImage(src, amt * 10, 0);
                    ctx.restore();
                }
                break;
            }
            default:
                this.drawClip(ctx, clip, 1, elapsed);
        }
    }

    drawText(ctx, text, local, len) {
        const W = REEL.width, H = REEL.height;
        const style = TEXT_STYLES[text.style] || TEXT_STYLES.classic;
        const size = text.size || 72;
        let alpha = 1, scale = 1, dy = 0;
        let content = text.text;
        const inT = Math.min(1, local / 0.35);
        const outT = Math.min(1, (len - local) / 0.25);
        switch (text.anim) {
            case 'fade': alpha = Math.min(inT, outT); break;
            case 'pop': scale = inT < 1 ? 0.6 + 0.55 * Math.sin(inT * Math.PI * 0.75) : 1; alpha = outT; break;
            case 'slide': dy = (1 - inT) * 120; alpha = Math.min(inT, outT); break;
            case 'type': content = content.slice(0, Math.ceil(content.length * Math.min(1, local / Math.max(0.5, len * 0.5)))); break;
        }
        const lines = content.split('\n');
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `800 ${size}px "Inter", "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cx = (text.x ?? 0.5) * W;
        const cy = (text.y ?? 0.5) * H + dy;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        const lh = size * 1.2;
        const top = -((lines.length - 1) * lh) / 2;
        lines.forEach((line, i) => {
            const y = top + i * lh;
            const tw = ctx.measureText(line).width;
            if (style.bg && line) {
                ctx.fillStyle = style.bg;
                const pad = size * 0.25;
                roundRect(ctx, -tw / 2 - pad, y - lh / 2, tw + pad * 2, lh, size * 0.2);
                ctx.fill();
            }
            if (style.glow) { ctx.shadowColor = style.glow; ctx.shadowBlur = size * 0.5; }
            if (style.outline) {
                ctx.lineJoin = 'round';
                ctx.lineWidth = size * 0.14;
                ctx.strokeStyle = style.outline;
                ctx.strokeText(line, 0, y);
            }
            ctx.fillStyle = text.color || style.color;
            ctx.fillText(line, 0, y);
            ctx.shadowBlur = 0;
        });
        ctx.restore();
    }

    // ---------- Export ----------

    // Plays the reel from the start in real time while recording the canvas
    // and the audio mix. Resolves with the finished file.
    exportReel({ mime, videoBitsPerSecond = 8_000_000, onProgress = () => {} }) {
        const { dest, ctx } = this.ensureAudio();
        ctx.resume();
        const stream = new MediaStream([
            ...this.canvas.captureStream(REEL.fps).getVideoTracks(),
            ...dest.stream.getAudioTracks(),
        ]);
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond, audioBitsPerSecond: 192_000 });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        return new Promise((resolve, reject) => {
            const prevTime = this.onTime;
            const prevEnded = this.onEnded;
            const restore = () => { this.onTime = prevTime; this.onEnded = prevEnded; this.cancelExport = null; };
            this.cancelExport = () => { this.pause(); if (rec.state !== 'inactive') rec.stop(); restore(); reject(new Error('Export cancelled')); };
            this.onTime = (t) => { prevTime(t); onProgress(t / this.duration); };
            this.onEnded = () => {
                rec.onstop = () => {
                    restore();
                    stream.getVideoTracks().forEach(t => t.stop());
                    resolve(new Blob(chunks, { type: mime.split(';')[0] }));
                };
                // Let the last frames reach the recorder.
                setTimeout(() => rec.stop(), 250);
            };
            this.pause();
            this.seek(0);
            rec.start(500);
            this.play();
        });
    }

    destroy() {
        this.pause();
        this.clock.terminate();
        this.media.forEach(m => this.release(m));
        this.media.clear();
        this.audio?.ctx.close();
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Small frames for the timeline strip.
export async function thumbnails(rec, count = 6, height = 96) {
    const url = URL.createObjectURL(rec.blob);
    const out = [];
    try {
        if (rec.kind === 'image') {
            const img = new Image();
            img.src = url;
            await img.decode();
            out.push(frameUrl(img, img.naturalWidth, img.naturalHeight, height));
            return Array(count).fill(out[0]);
        }
        const v = document.createElement('video');
        v.muted = true;
        v.src = url;
        await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 4000); });
        for (let i = 0; i < count; i++) {
            v.currentTime = Math.min(rec.duration - 0.05, (rec.duration * (i + 0.5)) / count);
            await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
            out.push(frameUrl(v, v.videoWidth, v.videoHeight, height));
        }
    } catch { /* thumbnails are cosmetic */ }
    URL.revokeObjectURL(url);
    return out;
}

function frameUrl(el, w, h, height) {
    if (!w || !h) return '';
    const c = document.createElement('canvas');
    c.height = height;
    c.width = Math.round(height * 9 / 16);
    const k = Math.max(c.width / w, c.height / h);
    c.getContext('2d').drawImage(el, (c.width - w * k) / 2, (c.height - h * k) / 2, w * k, h * k);
    return c.toDataURL('image/jpeg', 0.6);
}

export function exportFormats() {
    if (typeof MediaRecorder === 'undefined') return [];
    return [
        { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4', label: 'MP4' },
        { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM (VP9)' },
        { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM (VP8)' },
    ].filter(f => MediaRecorder.isTypeSupported(f.mime));
}

export { clipDuration };
