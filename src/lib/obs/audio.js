// Audio mixer: every audio-producing source gets a channel
// (input -> fader gain -> post-fader analyser) feeding a master bus for the
// outputs, plus an optional monitoring send to the speakers.

export const MIN_DB = -60;

// OBS-style fader curve: slider position maps cubically to amplitude.
export const sliderToMul = (pos) => Math.pow(pos, 3);
export const mulToSlider = (mul) => Math.cbrt(mul);
export const mulToDb = (mul) => (mul <= 0 ? -Infinity : 20 * Math.log10(mul));

export class AudioMixer {
    constructor() {
        this.ctx = null;
        this.channels = new Map();
        this.buffer = null;
    }

    ensureContext() {
        if (this.ctx) return this.ctx;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.destination = ctx.createMediaStreamDestination();
        this.master.connect(this.destination);
        this.monitorBus = ctx.createGain();
        this.monitorBus.connect(ctx.destination);
        // A silent constant source keeps the output track producing samples even
        // when nothing is audible, so recorders don't stall waiting for audio.
        const silence = ctx.createConstantSource();
        silence.offset.value = 0;
        silence.connect(this.master);
        silence.start();
        return ctx;
    }

    resume() {
        if (this.ctx?.state === 'suspended') this.ctx.resume();
    }

    get outputStream() {
        return this.ensureContext() && this.destination.stream;
    }

    attachStream(source, stream) {
        const ctx = this.ensureContext();
        this.attachNode(source, ctx.createMediaStreamSource(stream), stream);
    }

    attachElement(source, element) {
        const ctx = this.ensureContext();
        this.attachNode(source, ctx.createMediaElementSource(element), null);
    }

    attachNode(source, node, stream) {
        this.detach(source.id);
        const ctx = this.ctx;
        const gain = ctx.createGain();
        const monitor = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        node.connect(gain);
        gain.connect(analyser);
        gain.connect(this.master);
        node.connect(monitor);
        monitor.connect(this.monitorBus);
        this.channels.set(source.id, { node, gain, monitor, analyser, stream, peak: MIN_DB, hold: MIN_DB, holdAt: 0 });
        this.resume();
    }

    detach(id) {
        const ch = this.channels.get(id);
        if (!ch) return;
        ch.node.disconnect();
        ch.gain.disconnect();
        ch.monitor.disconnect();
        this.channels.delete(id);
    }

    has(id) {
        return this.channels.has(id);
    }

    // `active` is false when the source isn't on air (OBS deactivates sources
    // that aren't in the program scene, which silences their audio).
    update(id, { volume, muted, monitor }, active) {
        const ch = this.channels.get(id);
        if (!ch) return;
        const t = this.ctx.currentTime;
        const level = muted ? 0 : volume;
        ch.gain.gain.setTargetAtTime(active ? level : 0, t, 0.015);
        ch.monitor.gain.setTargetAtTime(monitor ? level : 0, t, 0.015);
    }

    // Post-fader peak level in dBFS with a 1s peak-hold, smoothed like a VU meter.
    level(id) {
        const ch = this.channels.get(id);
        if (!ch) return null;
        if (!this.buffer || this.buffer.length !== ch.analyser.fftSize) {
            this.buffer = new Float32Array(ch.analyser.fftSize);
        }
        ch.analyser.getFloatTimeDomainData(this.buffer);
        let peak = 0;
        for (let i = 0; i < this.buffer.length; i++) {
            const v = Math.abs(this.buffer[i]);
            if (v > peak) peak = v;
        }
        const db = Math.max(MIN_DB, mulToDb(peak));
        // Instant attack, gradual release.
        ch.peak = db > ch.peak ? db : Math.max(db, ch.peak - 1.2);
        const now = performance.now();
        if (db >= ch.hold || now - ch.holdAt > 1000) { ch.hold = db; ch.holdAt = now; }
        return { peak: ch.peak, hold: ch.hold };
    }

    destroy() {
        [...this.channels.keys()].forEach(id => this.detach(id));
        this.ctx?.close();
        this.ctx = null;
    }
}
