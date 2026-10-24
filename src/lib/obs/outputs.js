// Outputs: local recording (MediaRecorder) and streaming over WHIP, the
// WebRTC ingest protocol OBS exposes as its "WHIP" streaming service.

const FORMATS = [
    { id: 'mp4', mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4', label: 'MP4 (H.264/AAC)' },
    { id: 'webm-vp9', mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM (VP9/Opus)' },
    { id: 'webm-vp8', mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM (VP8/Opus)' },
    { id: 'webm', mime: 'video/webm', ext: 'webm', label: 'WebM' },
];

export function supportedFormats() {
    if (typeof MediaRecorder === 'undefined') return [];
    return FORMATS.filter(f => MediaRecorder.isTypeSupported(f.mime));
}

function pickFormat(id) {
    const supported = supportedFormats();
    return supported.find(f => f.id === id) || supported.find(f => f.id.startsWith('webm')) || supported[0];
}

// OBS's default filename format: "%CCYY-%MM-%DD %hh-%mm-%ss".
export function obsFilename(ext, date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}.${ext}`;
}

export class Recorder {
    constructor() {
        this.recorder = null;
        this.chunks = [];
        this.bytes = 0;
        this.startedAt = 0;
        this.pausedTotal = 0;
        this.pausedAt = 0;
        this.format = null;
        this.last = null; // { blob, name } of the most recent recording
    }

    get state() {
        return this.recorder?.state || 'inactive';
    }

    get elapsed() {
        if (!this.recorder) return 0;
        const now = this.pausedAt || performance.now();
        return now - this.startedAt - this.pausedTotal;
    }

    start(stream, { recFormat, videoBitrate, audioBitrate }) {
        this.format = pickFormat(recFormat);
        if (!this.format) throw new Error('This browser cannot record media');
        this.chunks = [];
        this.bytes = 0;
        this.recorder = new MediaRecorder(stream, {
            mimeType: this.format.mime,
            videoBitsPerSecond: videoBitrate * 1000,
            audioBitsPerSecond: audioBitrate * 1000,
        });
        this.recorder.ondataavailable = (e) => {
            if (e.data.size) { this.chunks.push(e.data); this.bytes += e.data.size; }
        };
        this.recorder.start(1000);
        this.startedAt = performance.now();
        this.pausedTotal = 0;
        this.pausedAt = 0;
    }

    togglePause() {
        if (!this.recorder) return;
        if (this.recorder.state === 'recording') {
            this.recorder.pause();
            this.pausedAt = performance.now();
        } else if (this.recorder.state === 'paused') {
            this.recorder.resume();
            this.pausedTotal += performance.now() - this.pausedAt;
            this.pausedAt = 0;
        }
    }

    stop() {
        const rec = this.recorder;
        if (!rec) return Promise.resolve(null);
        return new Promise((resolve) => {
            rec.onstop = () => {
                const blob = new Blob(this.chunks, { type: this.format.mime.split(';')[0] });
                const name = obsFilename(this.format.ext);
                this.last = { blob, name };
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 10000);
                this.recorder = null;
                this.chunks = [];
                resolve(name);
            };
            rec.stop();
        });
    }
}

export class WhipStreamer {
    constructor() {
        this.pc = null;
        this.resourceUrl = null;
        this.token = '';
        this.startedAt = 0;
        this.lastBytes = 0;
        this.lastStatsAt = 0;
        this.kbps = 0;
        this.onStateChange = () => {};
    }

    get active() {
        return !!this.pc;
    }

    get state() {
        return this.pc?.connectionState || 'disconnected';
    }

    async start(stream, { whipUrl, whipToken, videoBitrate }) {
        if (!whipUrl) throw new Error('Set a WHIP server URL in Settings → Stream');
        this.token = whipToken;
        const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
        this.pc = pc;
        pc.onconnectionstatechange = () => this.onStateChange(pc.connectionState);
        for (const track of stream.getTracks()) {
            const tx = pc.addTransceiver(track, { direction: 'sendonly' });
            if (track.kind === 'video') {
                const params = tx.sender.getParameters();
                params.encodings = [{ maxBitrate: videoBitrate * 1000 }];
                tx.sender.setParameters(params).catch(() => {});
            }
        }
        await pc.setLocalDescription(await pc.createOffer());
        await iceGatheringComplete(pc);
        const headers = { 'Content-Type': 'application/sdp' };
        if (whipToken) headers.Authorization = `Bearer ${whipToken}`;
        const res = await fetch(whipUrl, { method: 'POST', headers, body: pc.localDescription.sdp });
        if (!res.ok) {
            this.close();
            throw new Error(`WHIP server answered ${res.status} ${res.statusText}`);
        }
        const location = res.headers.get('Location');
        this.resourceUrl = location ? new URL(location, whipUrl).toString() : null;
        await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
        this.startedAt = performance.now();
    }

    async sampleBitrate() {
        if (!this.pc) return 0;
        const stats = await this.pc.getStats();
        let bytes = 0;
        stats.forEach(r => { if (r.type === 'outbound-rtp') bytes += r.bytesSent || 0; });
        const now = performance.now();
        if (this.lastStatsAt) this.kbps = ((bytes - this.lastBytes) * 8) / (now - this.lastStatsAt);
        this.lastBytes = bytes;
        this.lastStatsAt = now;
        return this.kbps;
    }

    async stop() {
        const url = this.resourceUrl;
        const headers = this.token ? { Authorization: `Bearer ${this.token}` } : {};
        this.close();
        if (url) await fetch(url, { method: 'DELETE', headers }).catch(() => {});
    }

    close() {
        this.pc?.close();
        this.pc = null;
        this.resourceUrl = null;
        this.lastStatsAt = 0;
        this.kbps = 0;
    }
}

function iceGatheringComplete(pc, timeout = 2000) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
        const check = () => { if (pc.iceGatheringState === 'complete') done(); };
        pc.addEventListener('icegatheringstatechange', check);
        setTimeout(done, timeout);
    });
}
