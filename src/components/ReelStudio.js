import {
    REEL, FILTERS, TRANSITIONS, TEXT_STYLES, TEXT_ANIMS, uid, loadProject, saveProject, newProject,
    makeClip, clipDuration, layout, addMedia, getMedia,
} from '../lib/reels/store.js';
import { ReelEngine, thumbnails, exportFormats } from '../lib/reels/engine.js';
import {
    H3, minimax, submitVideo, waitForVideo, uploadToMinimax, clipFetchUrl, getMinimaxKey,
} from '../lib/minimax.js';
import * as daydream from '../lib/daydream.js';
import { AuthModal } from './AuthModal.js';

const ICON = {
    record: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>',
    import: '<path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3M12 4v12M7 9l5-5 5 5"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    sticker: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2"/><circle cx="9" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    ai: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    split: '<path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5"/>',
    speed: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>',
    volume: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    filter: '<circle cx="9" cy="9" r="6"/><circle cx="15" cy="15" r="6"/>',
    adjust: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    transition: '<rect x="3" y="6" width="7" height="12" rx="1"/><rect x="14" y="6" width="7" height="12" rx="1"/><path d="M10 12h4"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    style: '<path d="M4 20l6-16h4l6 16M7 14h10"/>',
    anim: '<path d="M5 12h3l3-7 4 14 3-7h3"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    flip: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    screen: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
};
const svg = (name, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

const STICKERS = ['🔥', '😂', '😍', '🥹', '😎', '🤯', '💯', '✨', '🎉', '❤️', '👀', '👏', '🙌', '💀', '🚀', '⭐', '🌈', '🍕', '🎵', '📍', '✅', '❌', '👉', '⬇️'];
const TEXT_COLORS = ['#ffffff', '#000000', '#fe2c55', '#25f4ee', '#fff200', '#00e676', '#ff9100', '#b388ff'];
const PENDING_KEY = 'reel_pending_ai';

const fmt = (t) => {
    const s = Math.max(0, t);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export function ReelStudio() {
    let project = loadProject();
    let selected = null; // { type: 'clip'|'text'|'audio', id }
    let pxPerSec = 56;
    const thumbs = new Map();
    const jobs = [];
    let followScroll = false;

    const root = document.createElement('div');
    root.className = 'reel-root';
    root.innerHTML = `
        <div class="reel-top">
            <button class="reel-icon" data-a="new" title="New project">${svg('close', 20)}</button>
            <input class="reel-name" data-r="name" maxlength="40" aria-label="Project name">
            <span class="reel-spacer"></span>
            <button class="reel-pill" data-a="capture">${svg('record', 16)} Record</button>
            <button class="reel-pill reel-accent" data-a="export">Export</button>
        </div>
        <div class="reel-stage" data-r="stage">
            <div class="reel-frame" data-r="frame">
                <canvas class="reel-canvas" data-r="canvas"></canvas>
                <div class="reel-overlay" data-r="overlay"></div>
                <div class="reel-empty" data-r="empty">
                    <div class="reel-empty-title">Create a reel</div>
                    <button class="reel-big" data-a="capture">${svg('record', 28)}<span>Record</span></button>
                    <button class="reel-big reel-ghost" data-a="import">${svg('import', 24)}<span>Import videos & photos</span></button>
                    <button class="reel-big reel-ghost" data-a="ai">${svg('ai', 24)}<span>Generate with AI</span></button>
                </div>
            </div>
        </div>
        <div class="reel-transport">
            <span data-r="time">00:00 / 00:00</span>
            <button class="reel-play" data-a="play" aria-label="Play">${svg('play', 22)}</button>
            <input type="range" min="20" max="200" value="56" data-r="zoom" class="reel-zoom" aria-label="Timeline zoom">
        </div>
        <div class="reel-tl-wrap">
            <div class="reel-timeline" data-r="timeline">
                <div class="reel-tracks" data-r="tracks"></div>
            </div>
            <div class="reel-playhead"></div>
        </div>
        <div class="reel-toolbar" data-r="toolbar"></div>
        <div class="reel-sheet" data-r="sheet" hidden>
            <div class="reel-sheet-head"><span data-r="sheet-title"></span><button class="reel-icon" data-a="sheet-close">${svg('check', 20)}</button></div>
            <div class="reel-sheet-body" data-r="sheet-body"></div>
        </div>
        <input type="file" data-r="file" accept="video/*,image/*" multiple hidden>
        <input type="file" data-r="music" accept="audio/*,video/*" hidden>
    `;
    const $ = (r) => root.querySelector(`[data-r="${r}"]`);
    const canvas = $('canvas');
    const engine = new ReelEngine(canvas);
    const timeline = $('timeline');
    const tracks = $('tracks');
    $('name').value = project.name;
    $('name').onchange = (e) => { project.name = e.target.value.trim() || 'My reel'; persist(); };

    function persist() { saveProject(project); }
    function toast(msg) {
        const el = document.createElement('div');
        el.className = 'reel-toast';
        el.textContent = msg;
        root.appendChild(el);
        setTimeout(() => el.remove(), 3500);
    }

    // Structural changes reload media; property changes just redraw.
    async function refresh(structural = false) {
        persist();
        if (structural) await engine.setProject(project);
        else { engine.project = project; engine.seek(engine.t); }
        $('empty').hidden = project.clips.length > 0;
        renderTimeline();
        renderToolbar();
        renderOverlay();
    }

    // ---------- Timeline ----------
    const sel = (type) => selected?.type === type ? project[`${type}s`].find(x => x.id === selected.id) : null;

    function renderTimeline() {
        const { starts, total } = layout(project);
        const pad = timeline.clientWidth / 2;
        const width = Math.max(total, 1) * pxPerSec;
        tracks.style.width = `${width + pad * 2}px`;
        tracks.style.paddingLeft = tracks.style.paddingRight = `${pad}px`;
        tracks.innerHTML = '';

        const ruler = document.createElement('div');
        ruler.className = 'reel-ruler';
        ruler.style.width = `${width}px`;
        const step = pxPerSec > 90 ? 1 : pxPerSec > 40 ? 2 : 5;
        for (let s = 0; s <= total + 0.01; s += step) {
            const tick = document.createElement('span');
            tick.style.left = `${s * pxPerSec}px`;
            tick.textContent = fmt(s);
            ruler.appendChild(tick);
        }
        tracks.appendChild(ruler);

        const vtrack = track('reel-vtrack');
        project.clips.forEach((c, i) => {
            const el = block(vtrack, 'clip', c, starts[i], clipDuration(c));
            const t = thumbs.get(c.mediaId);
            if (t?.length) el.style.backgroundImage = t.map(u => `url(${u})`).join(',');
            if (t?.length) el.style.backgroundSize = t.map(() => `${Math.max(40, (clipDuration(c) * pxPerSec) / t.length)}px 100%`).join(',');
            if (t?.length) el.style.backgroundPosition = t.map((_, k) => `${(clipDuration(c) * pxPerSec * k) / t.length}px 0`).join(',');
            el.dataset.label = `${clipDuration(c).toFixed(1)}s${c.speed !== 1 ? ` · ${c.speed}x` : ''}`;
            if (i > 0) {
                const tr = document.createElement('button');
                tr.className = 'reel-tr' + (c.transition !== 'none' ? ' on' : '');
                tr.style.left = `${starts[i] * pxPerSec}px`;
                tr.title = `Transition: ${TRANSITIONS[c.transition]}`;
                tr.innerHTML = svg('transition', 12);
                tr.onclick = (e) => { e.stopPropagation(); selected = { type: 'clip', id: c.id }; refresh(); openSheet('transition'); };
                vtrack.appendChild(tr);
            }
        });
        const add = document.createElement('button');
        add.className = 'reel-add';
        add.style.left = `${total * pxPerSec + 8}px`;
        add.textContent = '+';
        add.title = 'Add media';
        add.onclick = () => $('file').click();
        vtrack.appendChild(add);
        tracks.appendChild(vtrack);

        const ttrack = track('reel-ttrack');
        project.texts.forEach(t => {
            const el = block(ttrack, 'text', t, t.start, t.end - t.start);
            el.textContent = t.text.replace(/\n/g, ' ');
        });
        tracks.appendChild(ttrack);

        const atrack = track('reel-atrack');
        project.audios.forEach(a => {
            const el = block(atrack, 'audio', a, a.start, a.out - a.in);
            el.textContent = `${a.kind === 'voice' ? '🎙' : '♪'} ${a.name || 'Audio'}`;
        });
        tracks.appendChild(atrack);
        syncScroll();
    }

    function track(cls) {
        const t = document.createElement('div');
        t.className = `reel-track ${cls}`;
        return t;
    }

    function block(parent, type, item, start, dur) {
        const el = document.createElement('div');
        el.className = `reel-block reel-${type}`;
        if (selected?.type === type && selected.id === item.id) el.classList.add('selected');
        el.style.left = `${start * pxPerSec}px`;
        el.style.width = `${Math.max(8, dur * pxPerSec)}px`;
        el.onclick = (e) => {
            e.stopPropagation();
            selected = selected?.id === item.id ? null : { type, id: item.id };
            closeSheet();
            renderTimeline();
            renderToolbar();
            renderOverlay();
        };
        if (selected?.id === item.id) {
            ['l', 'r'].forEach(side => {
                const h = document.createElement('span');
                h.className = `reel-handle reel-handle-${side}`;
                h.addEventListener('pointerdown', (e) => startTrim(e, type, item, side));
                el.appendChild(h);
            });
            if (type !== 'clip') el.addEventListener('pointerdown', (e) => { if (!e.target.classList.contains('reel-handle')) startMove(e, type, item); });
        }
        parent.appendChild(el);
        return el;
    }

    // Edge handles trim; the delta in pixels maps to timeline seconds.
    function startTrim(e, type, item, side) {
        e.stopPropagation();
        e.preventDefault();
        const x0 = e.clientX;
        const orig = { ...item };
        const mediaDur = type !== 'text' ? engine.media.get(item.mediaId)?.rec.duration ?? Infinity : Infinity;
        const move = (ev) => {
            const d = (ev.clientX - x0) / pxPerSec;
            if (type === 'clip') {
                const ds = d * item.speed;
                if (side === 'l') item.in = Math.min(orig.out - 0.2, Math.max(0, orig.in + ds));
                else item.out = Math.max(orig.in + 0.2, Math.min(item.kind === 'image' ? 600 : mediaDur, orig.out + ds));
            } else if (type === 'text') {
                if (side === 'l') item.start = Math.min(orig.end - 0.2, Math.max(0, orig.start + d));
                else item.end = Math.max(orig.start + 0.2, orig.end + d);
            } else {
                if (side === 'l') {
                    const nd = Math.max(-orig.in, Math.min(orig.out - orig.in - 0.2, d));
                    item.in = orig.in + nd;
                    item.start = orig.start + nd;
                } else item.out = Math.max(orig.in + 0.2, Math.min(mediaDur, orig.out + d));
            }
            renderTimeline();
            engine.seek(engine.t);
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); refresh(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    function startMove(e, type, item) {
        e.preventDefault();
        const x0 = e.clientX;
        const s0 = item.start;
        const len = type === 'text' ? item.end - item.start : 0;
        const move = (ev) => {
            item.start = Math.max(0, s0 + (ev.clientX - x0) / pxPerSec);
            if (type === 'text') item.end = item.start + len;
            renderTimeline();
            engine.seek(engine.t);
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); refresh(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    // The timeline scrolls under a fixed centre playhead, like CapCut.
    function syncScroll() {
        followScroll = true;
        timeline.scrollLeft = engine.t * pxPerSec;
        requestAnimationFrame(() => { followScroll = false; });
    }
    timeline.addEventListener('scroll', () => {
        if (followScroll) return;
        if (engine.playing) engine.pause();
        engine.seek(timeline.scrollLeft / pxPerSec);
    });
    timeline.addEventListener('click', (e) => {
        if (e.target === timeline || e.target === tracks || e.target.classList.contains('reel-track')) {
            selected = null;
            closeSheet();
            renderTimeline();
            renderToolbar();
            renderOverlay();
        }
    });
    $('zoom').oninput = (e) => { pxPerSec = +e.target.value; renderTimeline(); };
    timeline.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        pxPerSec = Math.min(200, Math.max(20, pxPerSec * (e.deltaY < 0 ? 1.1 : 0.9)));
        $('zoom').value = pxPerSec;
        renderTimeline();
    }, { passive: false });

    engine.onTime = (t) => {
        $('time').textContent = `${fmt(t)} / ${fmt(engine.duration)}`;
        if (engine.playing) syncScroll();
    };
    engine.onEnded = () => updatePlay();
    function updatePlay() {
        const b = root.querySelector('[data-a="play"]');
        b.innerHTML = svg(engine.playing ? 'pause' : 'play', 22);
    }

    // ---------- Text dragging on the preview ----------
    function renderOverlay() {
        const ov = $('overlay');
        ov.innerHTML = '';
        const t = sel('text');
        if (!t) return;
        const box = document.createElement('div');
        box.className = 'reel-textbox';
        box.style.left = `${(t.x ?? 0.5) * 100}%`;
        box.style.top = `${(t.y ?? 0.5) * 100}%`;
        box.style.fontSize = `${(t.size || 72) / REEL.width * 100}cqw`;
        box.textContent = t.text;
        box.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const r = ov.getBoundingClientRect();
            const move = (ev) => {
                t.x = Math.min(0.95, Math.max(0.05, (ev.clientX - r.left) / r.width));
                t.y = Math.min(0.95, Math.max(0.05, (ev.clientY - r.top) / r.height));
                box.style.left = `${t.x * 100}%`;
                box.style.top = `${t.y * 100}%`;
                engine.render(engine.t);
            };
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); persist(); };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
        ov.appendChild(box);
    }

    // ---------- Toolbar ----------
    function tools(list) {
        const bar = $('toolbar');
        bar.innerHTML = '';
        list.forEach(([icon, label, fn, cls]) => {
            const b = document.createElement('button');
            b.className = `reel-tool ${cls || ''}`;
            b.innerHTML = `${svg(icon)}<span>${label}</span>`;
            b.onclick = fn;
            bar.appendChild(b);
        });
    }

    function renderToolbar() {
        const clip = sel('clip'), text = sel('text'), audio = sel('audio');
        if (clip) {
            tools([
                ['split', 'Split', splitClip],
                ['speed', 'Speed', () => openSheet('speed')],
                ...(clip.kind !== 'image' ? [['volume', 'Volume', () => openSheet('volume')]] : []),
                ['filter', 'Filters', () => openSheet('filters')],
                ['adjust', 'Adjust', () => openSheet('adjust')],
                ['transition', 'Transition', () => openSheet('transition')],
                ['fit', clip.fit === 'cover' ? 'Fit' : 'Fill', () => { clip.fit = clip.fit === 'cover' ? 'contain' : 'cover'; refresh(); }],
                ['ai', clip.kind === 'image' ? 'Animate' : 'AI edit', () => openAi(clip.kind === 'image' ? 'animate' : 'edit'), 'reel-ai'],
                ['left', 'Move', () => moveClip(-1)],
                ['right', 'Move', () => moveClip(1)],
                ['copy', 'Duplicate', () => { const i = project.clips.indexOf(clip); project.clips.splice(i + 1, 0, { ...structuredClone(clip), id: uid('clip') }); refresh(); }],
                ['trash', 'Delete', () => { project.clips = project.clips.filter(c => c !== clip); selected = null; refresh(true); }],
            ]);
        } else if (text) {
            tools([
                ['edit', 'Edit', () => openSheet('text')],
                ['style', 'Style', () => openSheet('text')],
                ['anim', 'Animation', () => openSheet('textanim')],
                ['copy', 'Duplicate', () => { project.texts.push({ ...structuredClone(text), id: uid('txt'), start: text.end, end: text.end + (text.end - text.start) }); refresh(); }],
                ['trash', 'Delete', () => { project.texts = project.texts.filter(t => t !== text); selected = null; refresh(); }],
            ]);
        } else if (audio) {
            tools([
                ['volume', 'Volume', () => openSheet('audiovol')],
                ['split', 'Split', splitAudio],
                ['trash', 'Delete', () => { project.audios = project.audios.filter(a => a !== audio); selected = null; refresh(true); }],
            ]);
        } else {
            tools([
                ['record', 'Record', openCapture, 'reel-rec'],
                ['import', 'Import', () => $('file').click()],
                ['text', 'Text', () => addText()],
                ['sticker', 'Stickers', () => openSheet('stickers')],
                ['music', 'Music', () => $('music').click()],
                ['mic', 'Voiceover', () => openSheet('voice')],
                ['ai', 'AI', () => openAi('generate'), 'reel-ai'],
            ]);
        }
    }

    function splitClip() {
        const at = engine.clipAt(engine.t);
        if (!at) return;
        const local = at.clip.in + (engine.t - at.start) * at.clip.speed;
        if (local - at.clip.in < 0.15 || at.clip.out - local < 0.15) { toast('Move the playhead inside the clip'); return; }
        const right = { ...structuredClone(at.clip), id: uid('clip'), in: local, transition: 'none' };
        at.clip.out = local;
        project.clips.splice(at.index + 1, 0, right);
        selected = { type: 'clip', id: right.id };
        refresh();
    }

    function splitAudio() {
        const a = sel('audio');
        const local = engine.t - a.start;
        if (local < 0.15 || a.out - a.in - local < 0.15) { toast('Move the playhead inside the audio'); return; }
        const right = { ...structuredClone(a), id: uid('aud'), start: engine.t, in: a.in + local };
        a.out = a.in + local;
        project.audios.push(right);
        refresh();
    }

    function moveClip(dir) {
        const c = sel('clip');
        const i = project.clips.indexOf(c);
        const j = i + dir;
        if (j < 0 || j >= project.clips.length) return;
        project.clips.splice(i, 1);
        project.clips.splice(j, 0, c);
        refresh();
    }

    function addText(text = 'Your text', extra = {}) {
        const len = Math.max(2, Math.min(3, engine.duration - engine.t || 3));
        const t = { id: uid('txt'), text, start: engine.t, end: engine.t + len, style: 'classic', anim: 'pop', size: 80, x: 0.5, y: 0.45, ...extra };
        project.texts.push(t);
        selected = { type: 'text', id: t.id };
        refresh();
        if (!extra.sticker) openSheet('text');
    }

    // ---------- Bottom sheets ----------
    function closeSheet() { $('sheet').hidden = true; }
    function openSheet(kind) {
        const body = $('sheet-body');
        body.innerHTML = '';
        $('sheet').hidden = false;
        const clip = sel('clip'), text = sel('text'), audio = sel('audio');
        const title = (s) => { $('sheet-title').textContent = s; };
        const chips = (items, current, onPick) => {
            const row = document.createElement('div');
            row.className = 'reel-chips';
            items.forEach(([v, label, styleAttr]) => {
                const b = document.createElement('button');
                b.className = 'reel-chip' + (v === current ? ' on' : '');
                b.textContent = label;
                if (styleAttr) b.setAttribute('style', styleAttr);
                b.onclick = () => { onPick(v); row.querySelectorAll('.reel-chip').forEach(x => x.classList.toggle('on', x === b)); };
                row.appendChild(b);
            });
            body.appendChild(row);
            return row;
        };
        const slider = (label, min, max, step, value, fmtV, onInput) => {
            const wrap = document.createElement('label');
            wrap.className = 'reel-slider';
            wrap.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><b></b>`;
            const input = wrap.querySelector('input');
            const out = wrap.querySelector('b');
            out.textContent = fmtV(value);
            input.oninput = () => { out.textContent = fmtV(+input.value); onInput(+input.value); };
            body.appendChild(wrap);
        };
        switch (kind) {
            case 'speed':
                title('Speed');
                chips([[0.25, '0.25x'], [0.5, '0.5x'], [1, '1x'], [1.5, '1.5x'], [2, '2x'], [3, '3x'], [4, '4x']], clip.speed, (v) => { clip.speed = v; refresh(); });
                break;
            case 'volume':
                title('Clip volume');
                slider('Volume', 0, 2, 0.05, clip.volume, v => `${Math.round(v * 100)}%`, v => { clip.volume = v; persist(); });
                break;
            case 'audiovol':
                title('Audio volume');
                slider('Volume', 0, 2, 0.05, audio.volume, v => `${Math.round(v * 100)}%`, v => { audio.volume = v; persist(); });
                break;
            case 'filters':
                title('Filters');
                chips(Object.entries(FILTERS).map(([k, f]) => [k, f.label]), clip.filter, (v) => { clip.filter = v; refresh(); });
                break;
            case 'adjust':
                title('Adjust');
                ['brightness', 'contrast', 'saturation'].forEach(k =>
                    slider(k[0].toUpperCase() + k.slice(1), -100, 100, 1, clip.adjust[k], v => `${v > 0 ? '+' : ''}${v}`, v => { clip.adjust[k] = v; engine.render(engine.t); persist(); }));
                break;
            case 'transition':
                title('Transition into this clip');
                if (project.clips.indexOf(clip) === 0) { body.innerHTML = '<p class="reel-note">The first clip has no transition. Select a later clip.</p>'; break; }
                chips(Object.entries(TRANSITIONS), clip.transition, (v) => { clip.transition = v; refresh(); engine.seek(layout(project).starts[project.clips.indexOf(clip)]); });
                break;
            case 'text': {
                title('Text');
                const ta = document.createElement('textarea');
                ta.className = 'reel-textarea';
                ta.rows = 2;
                ta.value = text.text;
                ta.oninput = () => { text.text = ta.value || ' '; engine.render(engine.t); renderOverlay(); persist(); };
                body.appendChild(ta);
                setTimeout(() => ta.select(), 0);
                chips(Object.entries(TEXT_STYLES).map(([k, s]) => [k, s.label, `color:${s.color};background:${s.bg || '#2a2a2e'}`]), text.style, (v) => { text.style = v; text.color = ''; refresh(); });
                chips(TEXT_COLORS.map(c => [c, ' ', `background:${c};min-width:28px`]), text.color, (v) => { text.color = v; refresh(); });
                slider('Size', 32, 200, 2, text.size, v => `${v}`, v => { text.size = v; engine.render(engine.t); renderOverlay(); persist(); });
                break;
            }
            case 'textanim':
                title('Animation');
                chips(Object.entries(TEXT_ANIMS), text.anim, (v) => { text.anim = v; persist(); engine.seek(text.start); engine.play(); updatePlay(); });
                break;
            case 'stickers': {
                title('Stickers');
                const grid = document.createElement('div');
                grid.className = 'reel-stickers';
                STICKERS.forEach(s => {
                    const b = document.createElement('button');
                    b.textContent = s;
                    b.onclick = () => { closeSheet(); addText(s, { size: 180, anim: 'pop', style: 'classic', sticker: true, y: 0.3 }); };
                    grid.appendChild(b);
                });
                body.appendChild(grid);
                break;
            }
            case 'voice':
                title('Voiceover');
                voiceoverSheet(body);
                break;
        }
    }

    // Records the mic while the reel plays from the playhead, like TikTok.
    function voiceoverSheet(body) {
        body.innerHTML = `<p class="reel-note">Recording starts at the playhead (${fmt(engine.t)}) and plays the reel so you can talk over it.</p>`;
        const b = document.createElement('button');
        b.className = 'reel-big';
        b.innerHTML = `${svg('mic', 24)}<span>Start recording</span>`;
        body.appendChild(b);
        let rec = null, stream = null, start = 0;
        b.onclick = async () => {
            if (rec) { rec.stop(); return; }
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
            } catch (err) { toast(`Microphone unavailable: ${err.message}`); return; }
            const chunks = [];
            rec = new MediaRecorder(stream);
            rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
            rec.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                engine.pause();
                updatePlay();
                const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
                const m = await addMedia(blob, `Voiceover ${project.audios.filter(a => a.kind === 'voice').length + 1}`);
                project.audios.push({ id: uid('aud'), mediaId: m.id, kind: 'voice', name: m.name, start, in: 0, out: m.duration, volume: 1 });
                closeSheet();
                refresh(true);
            };
            start = engine.t;
            rec.start(250);
            if (project.clips.length) { engine.play(); updatePlay(); }
            b.innerHTML = `${svg('pause', 24)}<span>Stop</span>`;
            b.classList.add('reel-live');
        };
    }

    // ---------- Import ----------
    async function importFiles(files) {
        if (!files.length) return;
        toast(`Importing ${files.length} file${files.length > 1 ? 's' : ''}…`);
        for (const f of files) {
            try {
                const m = await addMedia(f, f.name);
                if (m.kind === 'audio') { addAudio(m); continue; }
                project.clips.push(makeClip(m));
                loadThumbs(m);
            } catch (err) { toast(`${f.name}: ${err.message}`); }
        }
        refresh(true);
    }
    $('file').onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };
    $('music').onchange = async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        try { addAudio(await addMedia(f, f.name)); refresh(true); } catch (err) { toast(err.message); }
    };
    function addAudio(m) {
        const room = Math.max(1, (engine.duration || m.duration) - engine.t);
        project.audios.push({ id: uid('aud'), mediaId: m.id, kind: 'music', name: m.name.replace(/\.[^.]+$/, ''), start: engine.t, in: 0, out: Math.min(m.duration, room), volume: 0.8 });
    }
    async function loadThumbs(m) {
        if (thumbs.has(m.id)) return;
        thumbs.set(m.id, []);
        thumbs.set(m.id, await thumbnails(m));
        renderTimeline();
    }

    // ---------- Capture (camera / screen, segments, filters, Daydream AI) ----------
    function openCapture() {
        engine.pause();
        updatePlay();
        const cap = document.createElement('div');
        cap.className = 'reel-capture';
        cap.innerHTML = `
            <div class="reel-cap-stage">
                <canvas class="reel-cap-canvas"></canvas>
                <div class="reel-countdown" hidden></div>
                <div class="reel-cap-progress"><div></div></div>
                <div class="reel-cap-top">
                    <button class="reel-icon" data-c="close">${svg('close')}</button>
                    <span class="reel-spacer"></span>
                    <div class="reel-cap-side">
                        <button class="reel-icon" data-c="flip" title="Flip camera">${svg('flip')}<small>Flip</small></button>
                        <button class="reel-icon" data-c="source" title="Camera or screen">${svg('screen')}<small>Screen</small></button>
                        <button class="reel-icon" data-c="timer" title="Countdown">${svg('timer')}<small>Off</small></button>
                        <button class="reel-icon" data-c="ai" title="Daydream AI effect">${svg('ai')}<small>AI live</small></button>
                    </div>
                </div>
                <div class="reel-cap-ai" hidden>
                    <input type="text" placeholder="AI look, e.g. anime, watercolor, cyberpunk">
                    <button class="reel-pill reel-accent" data-c="ai-go">Apply</button>
                    <p class="reel-note"></p>
                </div>
            </div>
            <div class="reel-cap-filters"></div>
            <div class="reel-cap-bottom">
                <div class="reel-cap-durations"></div>
                <div class="reel-cap-row">
                    <button class="reel-icon" data-c="undo" title="Delete last segment">${svg('undo')}</button>
                    <button class="reel-shutter" data-c="shoot" aria-label="Record"></button>
                    <button class="reel-icon reel-done" data-c="done" title="Done">${svg('check')}</button>
                </div>
            </div>`;
        root.appendChild(cap);
        const q = (k) => cap.querySelector(`[data-c="${k}"]`);
        const cvs = cap.querySelector('.reel-cap-canvas');
        cvs.width = 720;
        cvs.height = 1280;
        const g = cvs.getContext('2d');
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        let camStream = null, micStream = null, facing = 'user', source = 'camera';
        let filter = 'none', countdown = 0, maxDur = 60;
        let ai = null; // Daydream session
        const segments = []; // { blob, duration }
        let recorder = null, recStart = 0, raf = 0;

        const used = () => segments.reduce((s, x) => s + x.duration, 0) + (recorder ? (performance.now() - recStart) / 1000 : 0);

        async function startSource() {
            camStream?.getTracks().forEach(t => t.stop());
            try {
                camStream = source === 'screen'
                    ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 } })
                    : await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 } } });
            } catch (err) { toast(`Camera unavailable: ${err.message}`); return; }
            video.srcObject = camStream;
            await video.play().catch(() => {});
            if (ai) restartAi();
        }
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } }).then(s => { micStream = s; }).catch(() => {});

        // Preview and recording surface: cover-fit to 9:16, mirrored for the selfie camera.
        const draw = () => {
            const src = ai?.video?.videoWidth ? ai.video : video;
            const w = src.videoWidth, h = src.videoHeight;
            g.fillStyle = '#000';
            g.fillRect(0, 0, cvs.width, cvs.height);
            if (w && h) {
                const k = Math.max(cvs.width / w, cvs.height / h);
                g.save();
                g.filter = FILTERS[filter].css || 'none';
                if (source === 'camera' && facing === 'user' && src === video) { g.translate(cvs.width, 0); g.scale(-1, 1); }
                g.drawImage(src, (cvs.width - w * k) / 2, (cvs.height - h * k) / 2, w * k, h * k);
                g.restore();
            }
            const pct = Math.min(1, used() / maxDur);
            cap.querySelector('.reel-cap-progress div').style.width = `${pct * 100}%`;
            if (recorder && used() >= maxDur) stopSegment();
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        startSource();

        const fbar = cap.querySelector('.reel-cap-filters');
        Object.entries(FILTERS).forEach(([k, f]) => {
            const b = document.createElement('button');
            b.className = 'reel-chip' + (k === filter ? ' on' : '');
            b.textContent = f.label;
            b.onclick = () => { filter = k; fbar.querySelectorAll('.reel-chip').forEach(x => x.classList.toggle('on', x === b)); };
            fbar.appendChild(b);
        });
        const dbar = cap.querySelector('.reel-cap-durations');
        [[15, '15s'], [60, '60s'], [180, '3m']].forEach(([v, l]) => {
            const b = document.createElement('button');
            b.className = 'reel-chip' + (v === maxDur ? ' on' : '');
            b.textContent = l;
            b.onclick = () => { if (recorder) return; maxDur = v; dbar.querySelectorAll('.reel-chip').forEach(x => x.classList.toggle('on', x === b)); };
            dbar.appendChild(b);
        });

        function startSegment() {
            if (used() >= maxDur) { toast('Maximum length reached'); return; }
            const tracksOut = [...cvs.captureStream(30).getVideoTracks(), ...(micStream?.getAudioTracks() || [])];
            const fmt0 = exportFormats()[0];
            recorder = new MediaRecorder(new MediaStream(tracksOut), fmt0 ? { mimeType: fmt0.mime } : undefined);
            const chunks = [];
            recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
            const started = performance.now();
            recorder.onstop = () => {
                segments.push({ blob: new Blob(chunks, { type: (recorder?.mimeType || 'video/webm').split(';')[0] }), duration: (performance.now() - started) / 1000 });
                recorder = null;
                q('shoot').classList.remove('on');
            };
            recStart = started;
            recorder.start(250);
            q('shoot').classList.add('on');
        }
        function stopSegment() { recorder?.stop(); }

        q('shoot').onclick = () => {
            if (recorder) { stopSegment(); return; }
            if (!countdown) { startSegment(); return; }
            const el = cap.querySelector('.reel-countdown');
            let n = countdown;
            el.hidden = false;
            el.textContent = n;
            const iv = setInterval(() => {
                n--;
                if (n <= 0) { clearInterval(iv); el.hidden = true; startSegment(); } else el.textContent = n;
            }, 1000);
        };
        q('undo').onclick = () => { if (!recorder) segments.pop(); };
        q('flip').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; source = 'camera'; startSource(); };
        q('source').onclick = () => {
            source = source === 'camera' ? 'screen' : 'camera';
            q('source').querySelector('small').textContent = source === 'camera' ? 'Screen' : 'Camera';
            startSource();
        };
        q('timer').onclick = () => {
            countdown = countdown === 0 ? 3 : countdown === 3 ? 10 : 0;
            q('timer').querySelector('small').textContent = countdown ? `${countdown}s` : 'Off';
        };

        // Daydream Scope: the camera goes through a real-time AI pipeline and
        // the transformed stream is what gets previewed and recorded.
        const aiPanel = cap.querySelector('.reel-cap-ai');
        const aiNote = aiPanel.querySelector('.reel-note');
        q('ai').onclick = async () => {
            aiPanel.hidden = !aiPanel.hidden;
            if (aiPanel.hidden) return;
            aiNote.textContent = `Daydream Scope at ${daydream.getScopeUrl()}…`;
            try {
                const st = await daydream.pipelineStatus();
                aiNote.textContent = st.status === 'loaded'
                    ? `Pipeline ${st.pipeline_id} ready.`
                    : 'No pipeline loaded on Scope. Load one from OBS Studio → Daydream, or in Scope itself.';
            } catch (err) { aiNote.textContent = err.message; }
        };
        async function restartAi() {
            const prompt = aiPanel.querySelector('input').value.trim() || 'cinematic, vivid colors';
            ai?.session.close();
            try {
                const session = await daydream.startSession({ input: camStream, prompt });
                const v = document.createElement('video');
                v.muted = true;
                v.playsInline = true;
                v.srcObject = await session.output;
                await v.play().catch(() => {});
                ai = { session, video: v };
                aiNote.textContent = 'AI effect live. Change the prompt and press Apply again.';
                q('ai').classList.add('on');
            } catch (err) {
                ai = null;
                aiNote.textContent = err.message;
                q('ai').classList.remove('on');
            }
        }
        q('ai-go').onclick = () => {
            const prompt = aiPanel.querySelector('input').value.trim();
            if (ai && prompt && ai.session.setPrompt(prompt)) { aiNote.textContent = 'Prompt updated.'; return; }
            restartAi();
        };

        function closeCapture() {
            cancelAnimationFrame(raf);
            recorder?.stop();
            ai?.session.close();
            camStream?.getTracks().forEach(t => t.stop());
            micStream?.getTracks().forEach(t => t.stop());
            cap.remove();
        }
        q('close').onclick = closeCapture;
        q('done').onclick = async () => {
            if (recorder) { stopSegment(); await new Promise(r => setTimeout(r, 300)); }
            const segs = segments.splice(0);
            closeCapture();
            if (!segs.length) return;
            toast(`Adding ${segs.length} clip${segs.length > 1 ? 's' : ''}…`);
            for (const s of segs) {
                const m = await addMedia(s.blob, `Recording ${new Date().toLocaleTimeString()}`);
                project.clips.push(makeClip(m));
                loadThumbs(m);
            }
            refresh(true);
        };
        root._closeCapture = closeCapture;
    }

    // ---------- AI (MiniMax H3 video, Image-01 images) ----------
    async function addResultClip(url, kind, afterClipId, label) {
        const res = await fetch(kind === 'video' ? clipFetchUrl(url) : url);
        if (!res.ok) throw new Error(`Could not download result (${res.status})`);
        const blob = await res.blob();
        const m = await addMedia(blob, label);
        const clip = makeClip(m);
        const i = project.clips.findIndex(c => c.id === afterClipId);
        if (i >= 0) project.clips.splice(i + 1, 0, clip); else project.clips.push(clip);
        loadThumbs(m);
        selected = { type: 'clip', id: clip.id };
        await refresh(true);
    }

    function pending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; } }
    function setPending(list) { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); }

    async function runJob(job, work) {
        jobs.unshift(job);
        renderJobs();
        try {
            await work((s) => { job.stage = s; renderJobs(); });
            job.stage = 'Done — added to the timeline';
            toast('AI clip added');
        } catch (err) {
            job.stage = `Failed: ${err.message}`;
            toast(`AI: ${err.message}`);
        }
        if (job.taskId) setPending(pending().filter(p => p.taskId !== job.taskId));
        renderJobs();
    }
    let renderJobs = () => {};

    // A video H3 task, remembered so a reload resumes it.
    function startVideoJob(label, afterClipId, makeRequest) {
        runJob({ label, stage: 'Starting' }, async (stage) => {
            const req = await makeRequest(stage);
            stage('Submitting to MiniMax H3');
            const taskId = await submitVideo(req);
            jobs[0].taskId = taskId;
            setPending([...pending(), { taskId, label, afterClipId }]);
            const url = await waitForVideo(taskId, stage);
            stage('Downloading');
            await addResultClip(url, 'video', afterClipId, label);
        });
    }

    function frameFile() {
        return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(new File([b], 'frame.jpg', { type: 'image/jpeg' })) : reject(new Error('No frame'))), 'image/jpeg', 0.92));
    }

    function openAi(mode) {
        if (!getMinimaxKey()) { AuthModal(() => openAi(mode)); return; }
        const sheet = $('sheet');
        const body = $('sheet-body');
        sheet.hidden = false;
        $('sheet-title').textContent = 'AI studio';
        const clip = sel('clip');
        body.innerHTML = `
            <div class="reel-chips" data-k="modes">
                <button class="reel-chip" data-m="edit">Edit clip (H3)</button>
                <button class="reel-chip" data-m="animate">Animate (H3)</button>
                <button class="reel-chip" data-m="generate">Text to video (H3)</button>
                <button class="reel-chip" data-m="image">Text to image</button>
            </div>
            <p class="reel-note" data-k="hint"></p>
            <textarea class="reel-textarea" data-k="prompt" rows="3"></textarea>
            <div class="reel-chips" data-k="opts"></div>
            <button class="reel-big" data-k="go">${svg('ai', 22)}<span>Generate</span></button>
            <ul class="reel-jobs" data-k="jobs"></ul>`;
        const q = (k) => body.querySelector(`[data-k="${k}"]`);
        let opts = { resolution: '768P', duration: 5, ratio: '9:16' };
        const hints = {
            edit: clip && clip.kind === 'video' ? 'Describe the change. H3 rewrites the selected clip and adds the result after it.' : 'Select a video clip in the timeline first.',
            animate: clip?.kind === 'image' ? 'The selected photo becomes the first frame. Describe the motion.' : 'The current preview frame becomes the first frame. Describe the motion.',
            generate: 'Describe the shot: subject, action, camera, mood. The clip is added at the end.',
            image: 'Describe the image (MiniMax Image-01). It is added as a 3 s photo clip.',
        };
        function pick(m) {
            mode = m;
            body.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === m));
            q('hint').textContent = hints[m];
            q('prompt').placeholder = m === 'edit' ? 'e.g. turn the scene into a snowy night, keep the person' : 'e.g. a skateboarder doing a kickflip at sunset, slow motion';
            const o = q('opts');
            o.innerHTML = '';
            if (m === 'image') return;
            [['768P', '768P'], ['2K', '2K']].forEach(([v, l]) => o.appendChild(chip(l, opts.resolution === v, () => { opts.resolution = v; pick(mode); })));
            [5, 10, 15].forEach(d => o.appendChild(chip(`${d}s`, opts.duration === d, () => { opts.duration = d; pick(mode); })));
        }
        function chip(label, on, fn) {
            const b = document.createElement('button');
            b.className = 'reel-chip' + (on ? ' on' : '');
            b.textContent = label;
            b.onclick = fn;
            return b;
        }
        body.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => pick(b.dataset.m); });
        renderJobs = () => {
            const list = q('jobs');
            if (!list?.isConnected) return;
            list.innerHTML = '';
            jobs.forEach(j => {
                const li = document.createElement('li');
                li.innerHTML = '<b></b><span></span>';
                li.querySelector('b').textContent = j.label;
                li.querySelector('span').textContent = j.stage;
                list.appendChild(li);
            });
        };
        q('go').onclick = async () => {
            const prompt = q('prompt').value.trim();
            if (!prompt) { toast('Write a prompt first'); return; }
            if (prompt.length > H3.maxPrompt) { toast(`Prompt is longer than ${H3.maxPrompt} characters`); return; }
            const label = prompt.slice(0, 40);
            if (mode === 'edit') {
                const c = sel('clip');
                if (!c || c.kind !== 'video') { toast('Select a video clip first'); return; }
                const rec = await getMedia(c.mediaId);
                startVideoJob(label, c.id, async (stage) => {
                    stage('Uploading clip');
                    const video = await uploadToMinimax(new File([rec.blob], rec.name || 'clip.webm', { type: rec.blob.type }));
                    return {
                        ...opts,
                        prompt: `<Video 1> is the source video for the editing task.\n\nThe target video is an edited version of <Video 1>. ${prompt}`,
                        sourceVideo: video,
                    };
                });
            } else if (mode === 'animate') {
                const c = sel('clip');
                const file = c?.kind === 'image' ? (await getMedia(c.mediaId)).blob : await frameFile();
                startVideoJob(label, c?.id, async (stage) => {
                    stage('Uploading frame');
                    return { ...opts, ratio: 'adaptive', prompt, firstFrame: await uploadToMinimax(file) };
                });
            } else if (mode === 'generate') {
                startVideoJob(label, null, async () => ({ ...opts, prompt }));
            } else {
                runJob({ label, stage: 'Generating image' }, async (stage) => {
                    const res = await minimax.generateImage({ model: 'minimax-image-01', prompt, aspect_ratio: '9:16' });
                    stage('Downloading');
                    await addResultClip(res.url, 'image', null, label);
                });
            }
        };
        pick(mode === 'edit' && !(clip?.kind === 'video') ? 'generate' : mode);
        renderJobs();
    }

    function resumePending() {
        pending().forEach(p => runJob({ label: p.label, stage: 'Resuming', taskId: p.taskId }, async (stage) => {
            const url = await waitForVideo(p.taskId, stage);
            stage('Downloading');
            await addResultClip(url, 'video', p.afterClipId, p.label);
        }));
    }

    // ---------- Export ----------
    function openExport() {
        if (!project.clips.length) { toast('Add some clips first'); return; }
        const formats = exportFormats();
        if (!formats.length) { toast('This browser cannot export video'); return; }
        selected = null;
        renderOverlay();
        const sheet = $('sheet');
        sheet.hidden = false;
        $('sheet-title').textContent = 'Export';
        const body = $('sheet-body');
        body.innerHTML = `
            <p class="reel-note">1080 × 1920 · ${REEL.fps} fps · ${fmt(engine.duration)}. Export runs in real time; keep this tab open.</p>
            <div class="reel-chips" data-k="fmt"></div>
            <div class="reel-chips" data-k="q"></div>
            <button class="reel-big reel-accent-bg" data-k="go"><span>Export video</span></button>
            <div class="reel-progress" hidden><div></div></div>
            <div data-k="result"></div>`;
        const q = (k) => body.querySelector(`[data-k="${k}"]`);
        let format = formats[0], bitrate = 8_000_000;
        formats.forEach(f => {
            const b = document.createElement('button');
            b.className = 'reel-chip' + (f === format ? ' on' : '');
            b.textContent = f.label;
            b.onclick = () => { format = f; q('fmt').querySelectorAll('.reel-chip').forEach(x => x.classList.toggle('on', x === b)); };
            q('fmt').appendChild(b);
        });
        [[4_000_000, 'Standard'], [8_000_000, 'High'], [16_000_000, 'Max']].forEach(([v, l]) => {
            const b = document.createElement('button');
            b.className = 'reel-chip' + (v === bitrate ? ' on' : '');
            b.textContent = l;
            b.onclick = () => { bitrate = v; q('q').querySelectorAll('.reel-chip').forEach(x => x.classList.toggle('on', x === b)); };
            q('q').appendChild(b);
        });
        q('go').onclick = async () => {
            const go = q('go');
            const bar = body.querySelector('.reel-progress');
            if (engine.cancelExport && go.dataset.running) { engine.cancelExport(); return; }
            go.dataset.running = '1';
            go.querySelector('span').textContent = 'Cancel';
            bar.hidden = false;
            try {
                const blob = await engine.exportReel({
                    mime: format.mime,
                    videoBitsPerSecond: bitrate,
                    onProgress: (p) => { bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; },
                });
                const url = URL.createObjectURL(blob);
                const name = `${project.name.replace(/[^\w-]+/g, '_') || 'reel'}.${format.ext}`;
                q('result').innerHTML = `<video class="reel-result" controls playsinline></video><a class="reel-big reel-accent-bg" download="${name}">Download ${name} (${(blob.size / 1048576).toFixed(1)} MB)</a>`;
                q('result').querySelector('video').src = url;
                q('result').querySelector('a').href = url;
            } catch (err) {
                toast(err.message);
            }
            delete go.dataset.running;
            go.querySelector('span').textContent = 'Export again';
            bar.hidden = true;
            updatePlay();
        };
    }

    // ---------- Wiring ----------
    root.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        if (a === 'play') { engine.playing ? engine.pause() : engine.play(); updatePlay(); }
        if (a === 'capture') openCapture();
        if (a === 'import') $('file').click();
        if (a === 'ai') openAi('generate');
        if (a === 'export') openExport();
        if (a === 'sheet-close') closeSheet();
        if (a === 'new' && confirm('Start a new reel? The current timeline will be cleared.')) {
            project = newProject();
            $('name').value = project.name;
            selected = null;
            refresh(true);
        }
    });
    root.tabIndex = 0;
    root.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea')) return;
        if (e.code === 'Space') { e.preventDefault(); engine.playing ? engine.pause() : engine.play(); updatePlay(); }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
            project[`${selected.type}s`] = project[`${selected.type}s`].filter(x => x.id !== selected.id);
            selected = null;
            refresh(true);
        }
        if (e.key === 's' && sel('clip')) splitClip();
    });

    // Fit the 9:16 frame into the stage.
    const ro = new ResizeObserver(() => {
        const stage = $('stage');
        const h = stage.clientHeight - 8, w = stage.clientWidth - 8;
        const fh = Math.min(h, w * 16 / 9);
        $('frame').style.height = `${fh}px`;
        $('frame').style.width = `${fh * 9 / 16}px`;
        renderTimeline();
    });
    ro.observe(root);

    (async () => {
        for (const c of project.clips) { const m = await getMedia(c.mediaId); if (m) loadThumbs(m); }
        await refresh(true);
        resumePending();
    })();

    root._cleanup = () => {
        root._closeCapture?.();
        engine.cancelExport?.();
        ro.disconnect();
        persist();
        engine.destroy();
    };
    return root;
}
