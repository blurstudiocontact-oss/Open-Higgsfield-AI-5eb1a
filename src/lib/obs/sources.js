// Runtime side of sources: the media elements, streams and drawables behind
// each persisted source. Persisted settings live in store.js; anything that
// cannot survive a reload (streams, object URLs) lives here.

import { clipFetchUrl } from './minimax.js';
import { startSession } from '../daydream.js';

export class SourceRuntime {
    constructor(source, audio) {
        this.source = source;
        this.audio = audio;
        this.drawable = null;    // HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
        this.stream = null;
        this.objectUrl = null;
        this.mediaBlob = null;   // file behind a media source, reusable as an edit source
        this.session = null;     // Daydream Scope WebRTC session
        this.feed = null;        // { stream, timer } feeding frames to Scope
        this.resolveInput = () => null; // looks up another source's runtime by id
        this.status = 'idle';    // idle | needs-activation | ready | error
        this.error = '';
        this.textDirty = true;
        this.onChange = () => {};
    }

    get naturalSize() {
        const d = this.drawable;
        const s = this.source.settings;
        if (this.source.type === 'color') return { w: +s.width || 1, h: +s.height || 1 };
        if (!d) return { w: 0, h: 0 };
        if (d instanceof HTMLVideoElement) return { w: d.videoWidth, h: d.videoHeight };
        if (d instanceof HTMLImageElement) return { w: d.naturalWidth, h: d.naturalHeight };
        return { w: d.width, h: d.height };
    }

    // Size after the item's crop is applied.
    croppedSize(crop) {
        const { w, h } = this.naturalSize;
        return {
            w: Math.max(0, w - crop.left - crop.right),
            h: Math.max(0, h - crop.top - crop.bottom),
        };
    }

    async init() {
        const { type } = this.source;
        if (type === 'text') return this.renderText();
        if (type === 'color') { this.status = 'ready'; return; }
        // Needs a running Scope server, so it only starts from its properties.
        if (type === 'daydream') { this.status = 'needs-activation'; this.onChange(); return; }
        if (type === 'image') return this.loadImage();
        if (type === 'video_capture' || type === 'audio_input') return this.activate().catch(() => {});
        // Generated clips are re-downloaded from their URL.
        if (type === 'media' && this.source.settings.url) return this.activate();
        // Display capture and local media files need a user gesture / file pick after a reload.
        this.status = 'needs-activation';
        this.onChange();
    }

    async activate(file) {
        const { type, settings } = this.source;
        this.teardownMedia();
        try {
            if (type === 'display_capture') {
                const stream = await navigator.mediaDevices.getDisplayMedia({
                    video: { frameRate: 60 },
                    audio: settings.captureAudio,
                });
                stream.getVideoTracks()[0]?.addEventListener('ended', () => {
                    this.status = 'needs-activation';
                    this.audio.detach(this.source.id);
                    this.onChange();
                });
                await this.attachStream(stream, true);
            } else if (type === 'video_capture') {
                const [w, h] = settings.resolution.split('x').map(Number);
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        deviceId: settings.deviceId ? { exact: settings.deviceId } : undefined,
                        width: { ideal: w }, height: { ideal: h },
                    },
                    audio: false,
                });
                await this.attachStream(stream, true);
            } else if (type === 'audio_input') {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: settings.deviceId ? { exact: settings.deviceId } : undefined },
                    video: false,
                });
                this.stream = stream;
                this.audio.attachStream(this.source, stream);
                this.status = 'ready';
            } else if (type === 'media') {
                if (file) {
                    settings.fileName = file.name;
                    settings.url = '';
                } else if (settings.url) {
                    // Downloaded into a blob so the canvas stays untainted for recording.
                    const res = await fetch(clipFetchUrl(settings.url));
                    if (!res.ok) throw new Error(`Could not download clip (${res.status})`);
                    file = await res.blob();
                } else {
                    this.status = 'needs-activation';
                    this.onChange();
                    return;
                }
                this.mediaBlob = file;
                this.objectUrl = URL.createObjectURL(file);
                const video = document.createElement('video');
                video.src = this.objectUrl;
                video.loop = settings.loop;
                video.playsInline = true;
                video.crossOrigin = 'anonymous';
                await waitFor(video, 'loadedmetadata');
                this.drawable = video;
                this.audio.attachElement(this.source, video);
                await video.play().catch(() => {});
                this.status = 'ready';
            } else if (type === 'daydream') {
                await this.startDaydream();
            } else if (type === 'image' && file) {
                settings.dataUrl = await readAsDataUrl(file);
                settings.fileName = file.name;
                await this.loadImage();
                return;
            }
            this.error = '';
        } catch (err) {
            this.status = 'error';
            this.error = err?.message || String(err);
        }
        this.onChange();
    }

    // Frames for Scope: the webcam, a capture source's own stream, or any other
    // source drawn onto a canvas at the pipeline's resolution.
    async daydreamInput() {
        const s = this.source.settings;
        if (s.input === 'camera') {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: s.width }, height: { ideal: s.height }, frameRate: { ideal: s.fps } },
                audio: false,
            });
            return { stream, own: true };
        }
        const rt = this.resolveInput(s.input);
        if (!rt || rt.status !== 'ready') throw new Error('The input source is not active');
        const live = rt.stream?.getVideoTracks().length ? rt.stream : null;
        if (live) return { stream: live, own: false };
        const canvas = document.createElement('canvas');
        canvas.width = s.width;
        canvas.height = s.height;
        const ctx = canvas.getContext('2d');
        const draw = () => {
            const d = rt.drawable;
            const { w, h } = rt.naturalSize;
            if (!d || !w || !h) return;
            // Cover-fit so the pipeline gets a full frame.
            const k = Math.max(canvas.width / w, canvas.height / h);
            ctx.drawImage(d, (canvas.width - w * k) / 2, (canvas.height - h * k) / 2, w * k, h * k);
        };
        draw();
        const timer = setInterval(draw, 1000 / s.fps);
        return { stream: canvas.captureStream(s.fps), own: true, timer };
    }

    async startDaydream() {
        const s = this.source.settings;
        this.feed = await this.daydreamInput();
        this.session = await startSession({ input: this.feed.stream, prompt: s.prompt });
        this.session.channel.addEventListener('message', (e) => {
            let msg = null;
            try { msg = JSON.parse(e.data); } catch { return; }
            if (msg.type === 'stream_stopped') {
                this.status = 'error';
                this.error = msg.error_message || 'Scope stopped the stream';
                this.stopDaydream();
                this.onChange();
            }
        });
        this.session.pc.addEventListener('connectionstatechange', () => {
            if (this.session?.pc.connectionState === 'failed') {
                this.status = 'error';
                this.error = 'WebRTC connection to Scope failed';
                this.stopDaydream();
                this.onChange();
            }
        });
        const output = await this.session.output;
        await this.attachStream(output, true);
    }

    setDaydreamPrompt(text) {
        return this.session?.setPrompt(text, +this.source.settings.transitionSteps || 0) || false;
    }

    stopDaydream() {
        this.session?.close();
        this.session = null;
        if (this.feed) {
            clearInterval(this.feed.timer);
            // Never stop tracks that belong to another source.
            if (this.feed.own) this.feed.stream.getTracks().forEach(t => t.stop());
            this.feed = null;
        }
    }

    async attachStream(stream, withVideo) {
        this.stream = stream;
        if (withVideo && stream.getVideoTracks().length) {
            const video = document.createElement('video');
            video.muted = true; // audio is routed through the mixer instead
            video.playsInline = true;
            video.srcObject = stream;
            await video.play().catch(() => {});
            if (!video.videoWidth) await waitFor(video, 'loadedmetadata');
            this.drawable = video;
        }
        if (stream.getAudioTracks().length) this.audio.attachStream(this.source, stream);
        this.status = 'ready';
    }

    async loadImage() {
        const { dataUrl } = this.source.settings;
        if (!dataUrl) { this.status = 'needs-activation'; this.onChange(); return; }
        const img = new Image();
        img.src = dataUrl;
        try {
            await img.decode();
            this.drawable = img;
            this.status = 'ready';
        } catch {
            this.status = 'error';
            this.error = 'Could not decode image';
        }
        this.onChange();
    }

    // Text sources are pre-rendered to their own canvas, like OBS's text plugins.
    renderText() {
        const s = this.source.settings;
        const canvas = this.drawable instanceof HTMLCanvasElement ? this.drawable : document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size}px "${s.font}"`;
        ctx.font = font;
        const lines = String(s.text).split('\n');
        const lineHeight = Math.ceil(s.size * 1.2);
        const pad = s.outline ? s.outlineSize : 0;
        const width = Math.max(1, ...lines.map(l => Math.ceil(ctx.measureText(l).width))) + pad * 2;
        canvas.width = width;
        canvas.height = Math.max(1, lines.length * lineHeight + pad * 2);
        ctx.font = font; // resizing resets context state
        ctx.textBaseline = 'top';
        if (s.backgroundOpacity > 0) {
            ctx.globalAlpha = s.backgroundOpacity / 100;
            ctx.fillStyle = s.background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
        }
        lines.forEach((line, i) => {
            const lw = ctx.measureText(line).width;
            const x = s.align === 'center' ? (width - lw) / 2 : s.align === 'right' ? width - pad - lw : pad;
            const y = pad + i * lineHeight + (lineHeight - s.size) / 2;
            if (s.outline) {
                ctx.lineJoin = 'round';
                ctx.lineWidth = s.outlineSize * 2;
                ctx.strokeStyle = s.outlineColor;
                ctx.strokeText(line, x, y);
            }
            ctx.fillStyle = s.color;
            ctx.fillText(line, x, y);
        });
        this.drawable = canvas;
        this.status = 'ready';
        this.onChange();
    }

    teardownMedia() {
        this.stopDaydream();
        this.audio.detach(this.source.id);
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
        if (this.drawable instanceof HTMLVideoElement) {
            this.drawable.pause();
            this.drawable.srcObject = null;
            this.drawable.removeAttribute('src');
        }
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
        this.mediaBlob = null;
        if (!(this.drawable instanceof HTMLCanvasElement)) this.drawable = null;
    }

    destroy() {
        this.teardownMedia();
        this.drawable = null;
    }
}

function waitFor(el, event) {
    return new Promise((resolve, reject) => {
        el.addEventListener(event, resolve, { once: true });
        el.addEventListener('error', () => reject(new Error('Media failed to load')), { once: true });
    });
}

function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
