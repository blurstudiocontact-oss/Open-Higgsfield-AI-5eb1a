// Scene compositor and transitions. Scene items are stored top-first (the
// order shown in the Sources dock), so they are painted in reverse.

const keyCanvas = document.createElement('canvas');
const keyCtx = keyCanvas.getContext('2d', { willReadFrequently: true });
// Keying runs on the CPU, so it works on a downscaled copy of the source.
const KEY_MAX_WIDTH = 960;

// Axis-aligned box the item occupies on the canvas, after crop, scale and rotation.
export function itemBounds(item, rt) {
    const t = item.transform;
    const { w, h } = rt ? rt.croppedSize(t.crop) : { w: 0, h: 0 };
    const sw = w * t.scaleX;
    const sh = h * t.scaleY;
    const swap = t.rotation % 180 !== 0;
    return { x: t.x, y: t.y, w: swap ? sh : sw, h: swap ? sw : sh, contentW: sw, contentH: sh };
}

function filterString(f) {
    const parts = [];
    if (f.brightness) parts.push(`brightness(${(100 + +f.brightness) / 100})`);
    if (f.contrast) parts.push(`contrast(${(100 + +f.contrast) / 100})`);
    if (f.saturation) parts.push(`saturate(${(100 + +f.saturation) / 100})`);
    if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
    return parts.length ? parts.join(' ') : 'none';
}

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Chroma distance in CbCr space, shaped like OBS's chroma key filter
// (similarity and smoothness both on a 1..1000 scale).
function chromaKey(drawable, sx, sy, sw, sh, f) {
    const scale = Math.min(1, KEY_MAX_WIDTH / sw);
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    if (keyCanvas.width !== w || keyCanvas.height !== h) {
        keyCanvas.width = w;
        keyCanvas.height = h;
    }
    keyCtx.clearRect(0, 0, w, h);
    keyCtx.drawImage(drawable, sx, sy, sw, sh, 0, 0, w, h);
    const img = keyCtx.getImageData(0, 0, w, h);
    const d = img.data;
    const [kr, kg, kb] = hexToRgb(f.chromaColor);
    const kcb = -0.168736 * kr - 0.331264 * kg + 0.5 * kb;
    const kcr = 0.5 * kr - 0.418688 * kg - 0.081312 * kb;
    const similarity = (f.similarity / 1000) * 255;
    const smoothness = Math.max(1, (f.smoothness / 1000) * 255);
    for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
        const dist = Math.hypot(cb - kcb, cr - kcr) * 2;
        const mask = Math.min(1, Math.max(0, (dist - similarity) / smoothness));
        d[i + 3] = d[i + 3] * Math.pow(mask, 1.5);
    }
    keyCtx.putImageData(img, 0, 0);
    return keyCanvas;
}

export function drawItem(ctx, item, source, rt) {
    if (!item.visible || !rt || rt.status !== 'ready') return;
    const t = item.transform;
    const f = source.filters;
    if (source.type === 'color') {
        const b = itemBounds(item, rt);
        ctx.save();
        ctx.globalAlpha = f.opacity / 100;
        ctx.fillStyle = source.settings.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.restore();
        return;
    }
    const d = rt.drawable;
    if (!d) return;
    const { w: nw, h: nh } = rt.naturalSize;
    const sw = nw - t.crop.left - t.crop.right;
    const sh = nh - t.crop.top - t.crop.bottom;
    if (sw <= 0 || sh <= 0) return;
    const b = itemBounds(item, rt);
    ctx.save();
    ctx.globalAlpha = f.opacity / 100;
    ctx.filter = filterString(f);
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
    if (f.chroma) {
        const keyed = chromaKey(d, t.crop.left, t.crop.top, sw, sh, f);
        ctx.drawImage(keyed, -b.contentW / 2, -b.contentH / 2, b.contentW, b.contentH);
    } else {
        ctx.drawImage(d, t.crop.left, t.crop.top, sw, sh, -b.contentW / 2, -b.contentH / 2, b.contentW, b.contentH);
    }
    ctx.restore();
}

export function renderScene(ctx, scene, col, runtimes) {
    const { baseWidth: W, baseHeight: H } = col.settings;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!scene) return;
    for (let i = scene.items.length - 1; i >= 0; i--) {
        const item = scene.items[i];
        const source = col.sources[item.sourceId];
        if (source) drawItem(ctx, item, source, runtimes.get(source.id));
    }
}

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class Transitioner {
    constructor() {
        this.active = null; // { fromId, toId, start, duration, type, color }
        this.bufA = document.createElement('canvas');
        this.bufB = document.createElement('canvas');
    }

    start(fromId, toId, { type, duration, color }) {
        if (type === 'cut' || fromId === toId || duration <= 0) {
            this.active = null;
            return false;
        }
        this.active = { fromId, toId, start: performance.now(), duration, type, color };
        return true;
    }

    get running() {
        return !!this.active;
    }

    // Renders the program output. Returns the scene ids currently on air.
    render(ctx, col, runtimes, programId) {
        const { baseWidth: W, baseHeight: H } = col.settings;
        const tr = this.active;
        const find = (id) => col.scenes.find(s => s.id === id);
        if (!tr) {
            renderScene(ctx, find(programId), col, runtimes);
            return [programId];
        }
        const p = Math.min(1, (performance.now() - tr.start) / tr.duration);
        const e = easeInOut(p);
        for (const buf of [this.bufA, this.bufB]) {
            if (buf.width !== W || buf.height !== H) { buf.width = W; buf.height = H; }
        }
        renderScene(this.bufA.getContext('2d'), find(tr.fromId), col, runtimes);
        renderScene(this.bufB.getContext('2d'), find(tr.toId), col, runtimes);
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        switch (tr.type) {
            case 'fade':
                ctx.drawImage(this.bufA, 0, 0);
                ctx.globalAlpha = e;
                ctx.drawImage(this.bufB, 0, 0);
                break;
            case 'fade_to_color': {
                // First half fades out to the colour, second half fades in the new scene.
                const first = e < 0.5;
                ctx.drawImage(first ? this.bufA : this.bufB, 0, 0);
                ctx.globalAlpha = first ? e * 2 : (1 - e) * 2;
                ctx.fillStyle = tr.color;
                ctx.fillRect(0, 0, W, H);
                break;
            }
            case 'swipe':
                ctx.drawImage(this.bufA, 0, 0);
                ctx.drawImage(this.bufB, W * (1 - e), 0);
                break;
            case 'slide':
                ctx.drawImage(this.bufA, -W * e, 0);
                ctx.drawImage(this.bufB, W * (1 - e), 0);
                break;
            default:
                ctx.drawImage(this.bufB, 0, 0);
        }
        ctx.restore();
        if (p >= 1) this.active = null;
        return [tr.fromId, tr.toId];
    }
}
