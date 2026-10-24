import {
    SOURCE_TYPES, TRANSITIONS, DEFAULT_FILTERS, loadCollection, saveCollection,
    createSource, createItem, defaultTransform, uniqueName, uniqueSceneName, uid,
} from '../lib/obs/store.js';
import { SourceRuntime } from '../lib/obs/sources.js';
import { AudioMixer, MIN_DB, sliderToMul, mulToSlider, mulToDb } from '../lib/obs/audio.js';
import { renderScene, itemBounds, Transitioner } from '../lib/obs/compositor.js';
import { Recorder, WhipStreamer, supportedFormats } from '../lib/obs/outputs.js';
import { MINIMAX_MODELS, modelOptions, frameToFile, snapshotDrawable, runMinimaxJob } from '../lib/obs/minimax.js';
import { AuthModal } from './AuthModal.js';

const ICONS = {
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-7 0-11-7-11-7a19 19 0 0 1 5.1-5.9M9.9 4.2A10 10 0 0 1 12 4c7 0 11 7 11 7a19 19 0 0 1-2.2 3.2M1 1l22 22"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    up: '<path d="M18 15l-6-6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    speaker: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    mute: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/>',
    headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
};
const icon = (name, size = 14) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const HANDLE = 8;
const SNAP = 10;
const PLACEHOLDER = { w: 640, h: 360 };

export function ObsStudio() {
    const col = loadCollection();
    const audio = new AudioMixer();
    const runtimes = new Map();
    const transitioner = new Transitioner();
    const recorder = new Recorder();
    const streamer = new WhipStreamer();
    let studioMode = false;
    let selectedItemId = null;
    let micStream = null;
    let saveTimer = null;

    const programCanvas = document.createElement('canvas');
    const programCtx = programCanvas.getContext('2d');
    const previewCanvas = document.createElement('canvas');
    const previewCtx = previewCanvas.getContext('2d');
    let programStream = null;

    const save = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveCollection(col), 300);
    };
    const sceneById = (id) => col.scenes.find(s => s.id === id);
    const editScene = () => sceneById(studioMode ? col.previewScene : col.programScene) || col.scenes[0];
    const selectedItem = () => editScene().items.find(i => i.id === selectedItemId);

    // ---------- Layout ----------
    const root = document.createElement('div');
    root.className = 'obs-root';
    root.tabIndex = 0;
    root.innerHTML = `
        <div class="obs-main">
            <div class="obs-display-wrap" data-role="preview-wrap">
                <div class="obs-display-label" data-role="preview-label">Preview</div>
                <canvas class="obs-display" data-role="display-left"></canvas>
            </div>
            <div class="obs-studio-center" data-role="studio-center">
                <button class="obs-btn" data-action="transition">Transition</button>
                <div class="obs-tbar-wrap"><input type="range" min="0" max="1000" value="0" class="obs-tbar" data-role="tbar" title="T-Bar"></div>
            </div>
            <div class="obs-display-wrap" data-role="program-wrap">
                <div class="obs-display-label">Program</div>
                <canvas class="obs-display" data-role="display-right"></canvas>
            </div>
        </div>
        <div class="obs-docks">
            <section class="obs-dock"><header>Scenes</header><ul class="obs-list" data-role="scenes"></ul>
                <footer class="obs-toolbar">
                    <button title="Add scene" data-action="scene-add">${icon('plus')}</button>
                    <button title="Remove scene" data-action="scene-remove">${icon('minus')}</button>
                    <span class="obs-spacer"></span>
                    <button title="Move up" data-action="scene-up">${icon('up')}</button>
                    <button title="Move down" data-action="scene-down">${icon('down')}</button>
                </footer>
            </section>
            <section class="obs-dock"><header>Sources</header><ul class="obs-list" data-role="sources"></ul>
                <footer class="obs-toolbar">
                    <button title="Add source" data-action="source-add">${icon('plus')}</button>
                    <button title="Remove source" data-action="source-remove">${icon('minus')}</button>
                    <button title="Properties" data-action="source-props">${icon('gear')}</button>
                    <span class="obs-spacer"></span>
                    <button title="Move up" data-action="source-up">${icon('up')}</button>
                    <button title="Move down" data-action="source-down">${icon('down')}</button>
                </footer>
            </section>
            <section class="obs-dock obs-dock-wide"><header>Audio Mixer</header><div class="obs-mixer" data-role="mixer"></div></section>
            <section class="obs-dock"><header>Scene Transitions</header><div class="obs-form" data-role="transitions"></div></section>
            <section class="obs-dock"><header>Controls</header>
                <div class="obs-controls">
                    <button class="obs-btn" data-action="stream">Start Streaming</button>
                    <div class="obs-row">
                        <button class="obs-btn obs-grow" data-action="record">Start Recording</button>
                        <button class="obs-btn obs-pause" data-action="pause" title="Pause recording" hidden>❚❚</button>
                    </div>
                    <button class="obs-btn" data-action="studio">Studio Mode</button>
                    <button class="obs-btn" data-action="projector">Windowed Projector</button>
                    <button class="obs-btn" data-action="minimax">Minimax AI</button>
                    <button class="obs-btn" data-action="settings">Settings</button>
                </div>
            </section>
        </div>
        <div class="obs-status">
            <span data-role="stat-live">LIVE: 00:00:00</span>
            <span data-role="stat-rec">REC: 00:00:00</span>
            <span data-role="stat-render">Render: 0.0 ms</span>
            <span data-role="stat-fps">0.00 / 30.00 FPS</span>
        </div>
    `;
    const $ = (role) => root.querySelector(`[data-role="${role}"]`);
    const $a = (action) => root.querySelector(`[data-action="${action}"]`);
    const displayLeft = $('display-left');
    const displayRight = $('display-right');
    const dctxLeft = displayLeft.getContext('2d');
    const dctxRight = displayRight.getContext('2d');

    // ---------- Sources runtime ----------
    function ensureRuntime(source) {
        let rt = runtimes.get(source.id);
        if (rt) return rt;
        rt = new SourceRuntime(source, audio);
        rt.onChange = () => {
            fitNewItems(source.id);
            renderSources();
            renderMixer();
            save();
        };
        runtimes.set(source.id, rt);
        rt.init();
        return rt;
    }

    // New items start at their natural size in the top-left corner, scaled
    // down to fit when larger than the canvas.
    function fitNewItems(sourceId) {
        const rt = runtimes.get(sourceId);
        if (!rt || rt.status !== 'ready') return;
        const { baseWidth: W, baseHeight: H } = col.settings;
        for (const scene of col.scenes) {
            for (const item of scene.items) {
                if (item.sourceId !== sourceId || item.transform.fitted) continue;
                const { w, h } = rt.naturalSize;
                if (!w || !h) continue;
                const s = Math.min(1, W / w, H / h);
                item.transform.scaleX = item.transform.scaleY = s;
                item.transform.fitted = true;
            }
        }
    }

    function boundsFor(item) {
        const rt = runtimes.get(item.sourceId);
        const b = itemBounds(item, rt);
        if (rt?.status === 'ready' && b.w && b.h) return b;
        return { ...b, w: PLACEHOLDER.w, h: PLACEHOLDER.h, placeholder: true };
    }

    function removeSourceIfOrphan(sourceId) {
        const used = col.scenes.some(s => s.items.some(i => i.sourceId === sourceId));
        if (used) return;
        runtimes.get(sourceId)?.destroy();
        runtimes.delete(sourceId);
        delete col.sources[sourceId];
    }

    // ---------- Scenes dock ----------
    function renderScenes() {
        const list = $('scenes');
        list.innerHTML = '';
        col.scenes.forEach(scene => {
            const li = document.createElement('li');
            li.textContent = scene.name;
            const current = studioMode ? col.previewScene : col.programScene;
            if (scene.id === current) li.classList.add('selected');
            if (studioMode && scene.id === col.programScene) li.classList.add('on-air');
            li.onclick = () => selectScene(scene.id);
            li.ondblclick = async () => {
                const name = await promptModal('Rename Scene', scene.name);
                if (name) { scene.name = name; renderScenes(); save(); }
            };
            li.oncontextmenu = (e) => {
                e.preventDefault();
                selectScene(scene.id);
                showMenu(e.clientX, e.clientY, [
                    { label: 'Rename', action: () => li.ondblclick() },
                    { label: 'Duplicate', action: () => duplicateScene(scene) },
                    { label: 'Remove', action: () => removeScene(scene.id), disabled: col.scenes.length < 2 },
                ]);
            };
            list.appendChild(li);
        });
    }

    function selectScene(id) {
        selectedItemId = null;
        if (studioMode) {
            col.previewScene = id;
        } else if (id !== col.programScene) {
            transitioner.start(col.programScene, id, col.transition);
            col.programScene = id;
            col.previewScene = id;
        }
        renderScenes();
        renderSources();
        renderMixer();
        save();
    }

    function duplicateScene(scene) {
        const copy = {
            id: uid('scene'),
            name: uniqueSceneName(col, `${scene.name} 2`),
            items: scene.items.map(i => ({ ...structuredClone(i), id: uid('item') })),
        };
        col.scenes.splice(col.scenes.indexOf(scene) + 1, 0, copy);
        selectScene(copy.id);
    }

    function removeScene(id) {
        if (col.scenes.length < 2) return;
        const idx = col.scenes.findIndex(s => s.id === id);
        const [removed] = col.scenes.splice(idx, 1);
        removed.items.forEach(i => removeSourceIfOrphan(i.sourceId));
        const fallback = col.scenes[Math.max(0, idx - 1)].id;
        if (col.programScene === id) col.programScene = fallback;
        if (col.previewScene === id) col.previewScene = fallback;
        renderAll();
        save();
    }

    // ---------- Sources dock ----------
    function renderSources() {
        const list = $('sources');
        list.innerHTML = '';
        const scene = editScene();
        if (!scene.items.length) {
            list.innerHTML = '<li class="obs-empty">No sources. Click + below<br>or right-click here to add one.</li>';
        }
        scene.items.forEach(item => {
            const source = col.sources[item.sourceId];
            if (!source) return;
            const rt = runtimes.get(source.id);
            const li = document.createElement('li');
            if (item.id === selectedItemId) li.classList.add('selected');
            const warn = rt && rt.status !== 'ready' ? `<span class="obs-warn" title="${rt.status === 'error' ? rt.error : 'Open properties to activate'}">!</span>` : '';
            li.innerHTML = `
                <span class="obs-src-type">${typeGlyph(source.type)}</span>
                <span class="obs-src-name"></span>${warn}
                <button class="obs-icon-btn" data-k="vis" title="Show/Hide">${icon(item.visible ? 'eye' : 'eyeOff')}</button>
                <button class="obs-icon-btn" data-k="lock" title="Lock">${icon(item.locked ? 'lock' : 'unlock')}</button>`;
            li.querySelector('.obs-src-name').textContent = source.name;
            if (!item.visible) li.classList.add('hidden-item');
            li.onclick = (e) => {
                const k = e.target.closest('button')?.dataset.k;
                if (k === 'vis') { item.visible = !item.visible; renderMixer(); save(); }
                if (k === 'lock') { item.locked = !item.locked; save(); }
                selectedItemId = item.id;
                renderSources();
            };
            li.ondblclick = (e) => { if (!e.target.closest('button')) openProperties(source, item); };
            li.oncontextmenu = (e) => {
                e.preventDefault();
                selectedItemId = item.id;
                renderSources();
                showMenu(e.clientX, e.clientY, itemMenu(item));
            };
            list.appendChild(li);
        });
    }
    $('sources').addEventListener('contextmenu', (e) => {
        if (e.target.closest('li:not(.obs-empty)')) return;
        e.preventDefault();
        showMenu(e.clientX, e.clientY, addSourceMenuItems());
    });

    function typeGlyph(type) {
        return { display_capture: '🖥', video_capture: '📷', audio_input: '🎙', image: '🖼', media: '🎞', text: 'T', color: '■' }[type] || '?';
    }

    function addSourceMenuItems() {
        return Object.entries(SOURCE_TYPES).map(([type, def]) => ({ label: def.label, action: () => addSource(type) }));
    }

    async function addSource(type) {
        const existing = Object.values(col.sources).filter(s => s.type === type);
        const result = await addSourceModal(type, existing);
        if (!result) return;
        let source;
        if (result.existingId) {
            source = col.sources[result.existingId];
        } else {
            source = createSource(type, result.name);
            col.sources[source.id] = source;
        }
        const item = createItem(source.id);
        editScene().items.unshift(item);
        selectedItemId = item.id;
        const rt = ensureRuntime(source);
        // Screen capture must start from the click that confirmed the dialog.
        if (!result.existingId && type === 'display_capture') rt.activate();
        if (rt.status === 'ready') fitNewItems(source.id);
        renderSources();
        renderMixer();
        save();
        if (!result.existingId) openProperties(source, item);
    }

    function removeItem(item) {
        const scene = editScene();
        scene.items = scene.items.filter(i => i !== item);
        if (selectedItemId === item.id) selectedItemId = null;
        removeSourceIfOrphan(item.sourceId);
        renderSources();
        renderMixer();
        save();
    }

    function moveItem(item, where) {
        const items = editScene().items;
        const idx = items.indexOf(item);
        items.splice(idx, 1);
        const target = { up: idx - 1, down: idx + 1, top: 0, bottom: items.length }[where];
        items.splice(Math.max(0, Math.min(items.length, target)), 0, item);
        renderSources();
        save();
    }

    function itemMenu(item) {
        const source = col.sources[item.sourceId];
        return [
            { label: 'Rename', action: async () => {
                const name = await promptModal('Rename Source', source.name);
                if (name) { source.name = name; renderSources(); renderMixer(); save(); }
            } },
            { label: 'Remove', action: () => removeItem(item) },
            { separator: true },
            { label: 'Order: Move Up', action: () => moveItem(item, 'up') },
            { label: 'Order: Move Down', action: () => moveItem(item, 'down') },
            { label: 'Order: Move to Top', action: () => moveItem(item, 'top') },
            { label: 'Order: Move to Bottom', action: () => moveItem(item, 'bottom') },
            { separator: true },
            { label: 'Transform: Reset', action: () => transformAction(item, 'reset') },
            { label: 'Transform: Fit to screen', action: () => transformAction(item, 'fit') },
            { label: 'Transform: Stretch to screen', action: () => transformAction(item, 'stretch') },
            { label: 'Transform: Center to screen', action: () => transformAction(item, 'center') },
            { label: 'Transform: Rotate 90° CW', action: () => transformAction(item, 'cw') },
            { label: 'Transform: Rotate 90° CCW', action: () => transformAction(item, 'ccw') },
            { label: 'Transform: Flip Horizontal', action: () => transformAction(item, 'flipH') },
            { label: 'Transform: Flip Vertical', action: () => transformAction(item, 'flipV') },
            { separator: true },
            { label: 'Reanimate with Minimax', action: () => openMinimax({ frameSource: `item:${item.id}` }) },
            { label: 'Filters', action: () => openProperties(source, item, 'filters') },
            { label: 'Properties', action: () => openProperties(source, item) },
        ];
    }

    function transformAction(item, op) {
        const t = item.transform;
        const rt = runtimes.get(item.sourceId);
        const { baseWidth: W, baseHeight: H } = col.settings;
        const size = rt ? rt.croppedSize(t.crop) : { w: 0, h: 0 };
        const swap = () => t.rotation % 180 !== 0;
        const dims = () => (swap() ? { w: size.h, h: size.w } : size);
        if (op === 'reset') {
            Object.assign(t, defaultTransform(), { fitted: true });
        } else if (op === 'cw' || op === 'ccw') {
            const b = itemBounds(item, rt);
            const cx = t.x + b.w / 2, cy = t.y + b.h / 2;
            t.rotation = (t.rotation + (op === 'cw' ? 90 : 270)) % 360;
            const nb = itemBounds(item, rt);
            t.x = cx - nb.w / 2;
            t.y = cy - nb.h / 2;
        } else if (op === 'flipH' || op === 'flipV') {
            t[op] = !t[op];
        } else if (size.w && size.h) {
            const d = dims();
            if (op === 'fit') {
                const s = Math.min(W / d.w, H / d.h);
                t.scaleX = t.scaleY = s;
                t.x = (W - d.w * s) / 2;
                t.y = (H - d.h * s) / 2;
            } else if (op === 'stretch') {
                const sx = W / d.w, sy = H / d.h;
                t.scaleX = swap() ? sy : sx;
                t.scaleY = swap() ? sx : sy;
                t.x = 0;
                t.y = 0;
            } else if (op === 'center') {
                const b = itemBounds(item, rt);
                t.x = (W - b.w) / 2;
                t.y = (H - b.h) / 2;
            }
        }
        save();
    }

    // ---------- Audio mixer dock ----------
    let meterEls = [];
    function audioChannels() {
        const out = [];
        if (audio.has('mic')) out.push({ id: 'mic', name: 'Mic/Aux', state: col.mixer.mic });
        const seen = new Set();
        const scenes = [editScene(), sceneById(col.programScene)];
        for (const scene of scenes) {
            for (const item of scene?.items || []) {
                const source = col.sources[item.sourceId];
                if (!source || seen.has(source.id) || !audio.has(source.id)) continue;
                seen.add(source.id);
                out.push({ id: source.id, name: source.name, state: source });
            }
        }
        return out;
    }

    function renderMixer() {
        const mixer = $('mixer');
        mixer.innerHTML = '';
        meterEls = [];
        const channels = audioChannels();
        if (!channels.length) {
            mixer.innerHTML = '<div class="obs-empty">No audio sources. Enable Mic/Aux in Settings → Audio, or add a capture or media source.</div>';
            return;
        }
        for (const ch of channels) {
            const row = document.createElement('div');
            row.className = 'obs-channel';
            row.innerHTML = `
                <div class="obs-ch-head"><span class="obs-ch-name"></span><span class="obs-ch-db"></span></div>
                <div class="obs-meter"><div class="obs-meter-fill"></div><div class="obs-meter-mask"></div><div class="obs-meter-hold"></div></div>
                <div class="obs-ch-ctrl">
                    <input type="range" min="0" max="1000" class="obs-fader">
                    <button class="obs-icon-btn" data-k="mute" title="Mute"></button>
                    <button class="obs-icon-btn" data-k="monitor" title="Audio monitoring"></button>
                </div>`;
            row.querySelector('.obs-ch-name').textContent = ch.name;
            const fader = row.querySelector('.obs-fader');
            const dbLabel = row.querySelector('.obs-ch-db');
            const muteBtn = row.querySelector('[data-k="mute"]');
            const monBtn = row.querySelector('[data-k="monitor"]');
            const sync = () => {
                const db = mulToDb(ch.state.volume);
                dbLabel.textContent = db === -Infinity ? '-inf dB' : `${db.toFixed(1)} dB`;
                muteBtn.innerHTML = icon(ch.state.muted ? 'mute' : 'speaker');
                muteBtn.classList.toggle('active', ch.state.muted);
                monBtn.innerHTML = icon('headphones');
                monBtn.classList.toggle('active', ch.state.monitor);
                row.classList.toggle('muted', ch.state.muted);
            };
            fader.value = Math.round(mulToSlider(ch.state.volume) * 1000);
            fader.oninput = () => { ch.state.volume = sliderToMul(fader.value / 1000); sync(); save(); };
            muteBtn.onclick = () => { ch.state.muted = !ch.state.muted; sync(); save(); };
            monBtn.onclick = () => { ch.state.monitor = !ch.state.monitor; sync(); save(); };
            sync();
            meterEls.push({
                id: ch.id,
                mask: row.querySelector('.obs-meter-mask'),
                hold: row.querySelector('.obs-meter-hold'),
            });
            mixer.appendChild(row);
        }
    }

    const dbToPct = (db) => Math.max(0, Math.min(100, ((db - MIN_DB) / -MIN_DB) * 100));
    function updateMeters() {
        for (const m of meterEls) {
            const lvl = audio.level(m.id);
            const peak = lvl ? lvl.peak : MIN_DB;
            m.mask.style.left = `${dbToPct(peak)}%`;
            m.hold.style.left = `${dbToPct(lvl ? lvl.hold : MIN_DB)}%`;
        }
    }

    let lastAudioKey = '';
    function updateAudioRouting(onAirScenes) {
        const active = new Set();
        for (const id of onAirScenes) {
            sceneById(id)?.items.forEach(i => { if (i.visible) active.add(i.sourceId); });
        }
        const key = [...active].join(',') + JSON.stringify(col.mixer) +
            Object.values(col.sources).map(s => `${s.id}${s.volume}${s.muted}${s.monitor}`).join();
        if (key === lastAudioKey) return;
        lastAudioKey = key;
        Object.values(col.sources).forEach(s => audio.update(s.id, s, active.has(s.id)));
        audio.update('mic', col.mixer.mic, true);
    }

    async function setMic(enabled) {
        micStream?.getTracks().forEach(t => t.stop());
        micStream = null;
        audio.detach('mic');
        if (enabled) {
            try {
                const id = col.settings.micDeviceId;
                micStream = await navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true });
                audio.attachStream({ id: 'mic' }, micStream);
                lastAudioKey = '';
            } catch (err) {
                toast(`Mic/Aux unavailable: ${err.message}`);
            }
        }
        renderMixer();
    }

    // ---------- Transitions dock ----------
    function renderTransitions() {
        const el = $('transitions');
        const tr = col.transition;
        el.innerHTML = `
            <label>Transition<select data-k="type">${Object.entries(TRANSITIONS).map(([k, v]) => `<option value="${k}" ${k === tr.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <label>Duration<span class="obs-row"><input type="number" min="50" max="20000" step="50" data-k="duration" value="${tr.duration}"> ms</span></label>
            <label data-k="color-row" ${tr.type === 'fade_to_color' ? '' : 'hidden'}>Color<input type="color" data-k="color" value="${tr.color}"></label>`;
        el.querySelector('[data-k="type"]').onchange = (e) => { tr.type = e.target.value; renderTransitions(); save(); };
        el.querySelector('[data-k="duration"]').onchange = (e) => { tr.duration = Math.max(0, +e.target.value || 0); save(); };
        el.querySelector('[data-k="color"]').oninput = (e) => { tr.color = e.target.value; save(); };
        el.querySelector('[data-k="duration"]').disabled = tr.type === 'cut';
    }

    // ---------- Studio mode ----------
    function setStudioMode(on) {
        studioMode = on;
        if (on) col.previewScene = col.programScene;
        root.classList.toggle('studio', on);
        $a('studio').classList.toggle('active', on);
        $('preview-label').hidden = !on;
        selectedItemId = null;
        renderAll();
    }

    function doTransition() {
        if (!studioMode || col.previewScene === col.programScene) return;
        const prev = col.programScene;
        transitioner.start(prev, col.previewScene, col.transition);
        col.programScene = col.previewScene;
        // Like OBS, the old program scene swaps into preview.
        col.previewScene = prev;
        selectedItemId = null;
        renderAll();
        save();
    }
    $a('transition').onclick = doTransition;

    // T-Bar: manual transition progress; releasing past the end commits it.
    const tbar = $('tbar');
    tbar.oninput = () => {
        if (!studioMode || col.previewScene === col.programScene) { tbar.value = 0; return; }
        const p = tbar.value / 1000;
        transitioner.active = {
            fromId: col.programScene, toId: col.previewScene, type: col.transition.type === 'cut' ? 'fade' : col.transition.type,
            color: col.transition.color, duration: 1e9, start: performance.now() - p * 1e9, manual: true,
        };
    };
    tbar.onchange = () => {
        if (+tbar.value >= 1000 && studioMode) {
            transitioner.active = null;
            const prev = col.programScene;
            col.programScene = col.previewScene;
            col.previewScene = prev;
            renderAll();
            save();
        } else {
            transitioner.active = null;
        }
        tbar.value = 0;
    };

    // ---------- Display interaction ----------
    function viewFor(canvas) {
        const { baseWidth: W, baseHeight: H } = col.settings;
        const s = Math.min(canvas.width / W, canvas.height / H);
        return { s, ox: (canvas.width - W * s) / 2, oy: (canvas.height - H * s) / 2 };
    }

    function toBase(e) {
        const r = displayLeft.getBoundingClientRect();
        const dpr = displayLeft.width / r.width;
        const v = viewFor(displayLeft);
        return { x: ((e.clientX - r.left) * dpr - v.ox) / v.s, y: ((e.clientY - r.top) * dpr - v.oy) / v.s, scale: v.s / dpr };
    }

    function handleAt(b, p, scale) {
        const tol = (HANDLE + 4) / scale / 2;
        const xs = { w: b.x, c: b.x + b.w / 2, e: b.x + b.w };
        const ys = { n: b.y, c: b.y + b.h / 2, s: b.y + b.h };
        for (const [vy, y] of Object.entries(ys)) {
            for (const [hx, x] of Object.entries(xs)) {
                if (vy === 'c' && hx === 'c') continue;
                if (Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol) return (vy === 'c' ? '' : vy) + (hx === 'c' ? '' : hx);
            }
        }
        return null;
    }

    const contains = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

    let drag = null;
    displayLeft.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        root.focus();
        audio.ensureContext();
        audio.resume();
        const p = toBase(e);
        const sel = selectedItem();
        if (sel && !sel.locked) {
            const handle = handleAt(boundsFor(sel), p, p.scale);
            if (handle) {
                drag = { mode: 'resize', item: sel, handle, start: p, orig: { ...boundsFor(sel) }, origT: structuredClone(sel.transform) };
                displayLeft.setPointerCapture(e.pointerId);
                return;
            }
        }
        const hit = editScene().items.find(i => i.visible && contains(boundsFor(i), p));
        selectedItemId = hit?.id || null;
        renderSources();
        if (hit && !hit.locked) {
            drag = { mode: 'move', item: hit, start: p, origT: structuredClone(hit.transform) };
            displayLeft.setPointerCapture(e.pointerId);
        }
    });

    displayLeft.addEventListener('pointermove', (e) => {
        const p = toBase(e);
        if (!drag) {
            const sel = selectedItem();
            const h = sel && !sel.locked ? handleAt(boundsFor(sel), p, p.scale) : null;
            displayLeft.style.cursor = h ? cursorFor(h) : 'default';
            return;
        }
        const { baseWidth: W, baseHeight: H } = col.settings;
        const t = drag.item.transform;
        const snapTol = SNAP / p.scale;
        if (drag.mode === 'move') {
            const b = boundsFor(drag.item);
            let x = drag.origT.x + (p.x - drag.start.x);
            let y = drag.origT.y + (p.y - drag.start.y);
            if (!e.altKey) {
                x = snap(x, [0, W - b.w, (W - b.w) / 2], snapTol);
                y = snap(y, [0, H - b.h, (H - b.h) / 2], snapTol);
            }
            t.x = Math.round(x);
            t.y = Math.round(y);
        } else {
            resizeItem(drag, p, e.shiftKey, snapTol);
        }
    });

    const endDrag = () => { if (drag) { drag = null; save(); } };
    displayLeft.addEventListener('pointerup', endDrag);
    displayLeft.addEventListener('pointercancel', endDrag);
    displayLeft.addEventListener('dblclick', (e) => {
        const p = toBase(e);
        const hit = editScene().items.find(i => i.visible && contains(boundsFor(i), p));
        if (hit) openProperties(col.sources[hit.sourceId], hit);
    });
    displayLeft.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // Right-click selects whatever is under the cursor, as in OBS.
        const p = toBase(e);
        const hit = editScene().items.find(i => i.visible && contains(boundsFor(i), p));
        selectedItemId = hit?.id || null;
        renderSources();
        const items = hit ? itemMenu(hit) : [];
        if (items.length) items.push({ separator: true });
        items.push({ label: 'Add', submenu: addSourceMenuItems() });
        showMenu(e.clientX, e.clientY, items);
    });

    function snap(v, targets, tol) {
        for (const t of targets) if (Math.abs(v - t) < tol) return t;
        return v;
    }

    function cursorFor(h) {
        return { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }[h];
    }

    // Corner handles keep the aspect ratio unless Shift is held, as in OBS.
    function resizeItem(d, p, free, snapTol) {
        const { baseWidth: W, baseHeight: H } = col.settings;
        const o = d.orig;
        const h = d.handle;
        let left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
        if (h.includes('w')) left = snap(p.x, [0], snapTol);
        if (h.includes('e')) right = snap(p.x, [W], snapTol);
        if (h.includes('n')) top = snap(p.y, [0], snapTol);
        if (h.includes('s')) bottom = snap(p.y, [H], snapTol);
        let w = Math.max(2, right - left);
        let hh = Math.max(2, bottom - top);
        if (h.length === 2 && !free) {
            const ratio = o.w / o.h;
            if (w / hh > ratio) hh = w / ratio; else w = hh * ratio;
        }
        const t = d.item.transform;
        const sw = d.origT.rotation % 180 !== 0;
        const fx = w / o.w, fy = hh / o.h;
        t.scaleX = d.origT.scaleX * (sw ? fy : fx);
        t.scaleY = d.origT.scaleY * (sw ? fx : fy);
        t.x = h.includes('w') ? o.x + o.w - w : o.x;
        t.y = h.includes('n') ? o.y + o.h - hh : o.y;
    }

    root.addEventListener('keydown', (e) => {
        if (e.target.closest('input, select, textarea')) return;
        const sel = selectedItem();
        if (!sel) return;
        const step = e.shiftKey ? 10 : 1;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key] && !sel.locked) {
            e.preventDefault();
            sel.transform.x += moves[e.key][0];
            sel.transform.y += moves[e.key][1];
            save();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            removeItem(sel);
        }
    });

    // ---------- Display drawing ----------
    function sizeDisplay(canvas) {
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(r.width * dpr));
        const h = Math.max(1, Math.round(r.height * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    function blit(dctx, canvas, src) {
        const v = viewFor(canvas);
        const { baseWidth: W, baseHeight: H } = col.settings;
        dctx.fillStyle = '#16171d';
        dctx.fillRect(0, 0, canvas.width, canvas.height);
        dctx.drawImage(src, v.ox, v.oy, W * v.s, H * v.s);
        return v;
    }

    function drawOverlay(v) {
        const dpr = window.devicePixelRatio || 1;
        const scene = editScene();
        dctxLeft.save();
        dctxLeft.translate(v.ox, v.oy);
        for (const item of scene.items) {
            const b = boundsFor(item);
            if (!item.visible || !b.placeholder) continue;
            const source = col.sources[item.sourceId];
            dctxLeft.setLineDash([6 * dpr, 4 * dpr]);
            dctxLeft.strokeStyle = 'rgba(255,255,255,0.35)';
            dctxLeft.lineWidth = dpr;
            dctxLeft.strokeRect(b.x * v.s, b.y * v.s, b.w * v.s, b.h * v.s);
            dctxLeft.setLineDash([]);
            dctxLeft.fillStyle = 'rgba(255,255,255,0.6)';
            dctxLeft.font = `${12 * dpr}px sans-serif`;
            dctxLeft.fillText(`${source?.name || ''} — double-click to set up`, b.x * v.s + 8 * dpr, b.y * v.s + 18 * dpr);
        }
        const sel = selectedItem();
        if (sel && sel.visible) {
            const b = boundsFor(sel);
            const x = b.x * v.s, y = b.y * v.s, w = b.w * v.s, h = b.h * v.s;
            dctxLeft.strokeStyle = sel.locked ? '#9ca3af' : '#ff3b3b';
            dctxLeft.lineWidth = 1.5 * dpr;
            dctxLeft.strokeRect(x, y, w, h);
            if (!sel.locked) {
                const hs = HANDLE * dpr;
                dctxLeft.fillStyle = '#ff3b3b';
                for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) {
                    dctxLeft.fillRect(x + w * hx - hs / 2, y + h * hy - hs / 2, hs, hs);
                }
            }
        }
        dctxLeft.restore();
    }

    // ---------- Render loop ----------
    // A worker-driven clock keeps rendering (and recording) steady even when
    // the tab is in the background, where requestAnimationFrame is paused.
    const clock = new Worker(URL.createObjectURL(new Blob([
        'let t=null;onmessage=e=>{clearInterval(t);t=setInterval(()=>postMessage(Date.now()),e.data)}',
    ], { type: 'text/javascript' })));
    let frames = 0, fpsWindowStart = performance.now(), fps = 0, renderMs = 0, lastMeter = 0;
    let lagged = 0, totalTicks = 0;

    function setClock() {
        clock.postMessage(1000 / col.settings.fps);
    }

    function ensureBaseSize() {
        const { baseWidth: W, baseHeight: H } = col.settings;
        for (const c of [programCanvas, previewCanvas]) {
            if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        }
    }

    function tick() {
        const t0 = performance.now();
        ensureBaseSize();
        const onAir = transitioner.render(programCtx, col, runtimes, col.programScene);
        updateAudioRouting(onAir);
        if (!document.hidden) {
            sizeDisplay(displayLeft);
            if (studioMode) {
                renderScene(previewCtx, sceneById(col.previewScene), col, runtimes);
                drawOverlay(blit(dctxLeft, displayLeft, previewCanvas));
                sizeDisplay(displayRight);
                blit(dctxRight, displayRight, programCanvas);
            } else {
                drawOverlay(blit(dctxLeft, displayLeft, programCanvas));
            }
            if (t0 - lastMeter > 33) { updateMeters(); lastMeter = t0; }
        }
        renderMs = renderMs * 0.9 + (performance.now() - t0) * 0.1;
        frames++;
        if (t0 - fpsWindowStart >= 1000) {
            fps = (frames * 1000) / (t0 - fpsWindowStart);
            frames = 0;
            fpsWindowStart = t0;
            updateStatus();
        }
    }
    // Ticks that arrive after the next one was due are dropped instead of
    // queueing up behind a slow frame (OBS's "missed due to rendering lag").
    clock.onmessage = (e) => {
        totalTicks++;
        if (Date.now() - e.data > 1000 / col.settings.fps) { lagged++; return; }
        tick();
    };

    // ---------- Outputs ----------
    function outputStream() {
        if (!programStream) programStream = programCanvas.captureStream(col.settings.fps);
        const tracks = [...programStream.getVideoTracks(), ...audio.outputStream.getAudioTracks()];
        return new MediaStream(tracks);
    }

    function resetProgramStream() {
        if (recorder.state !== 'inactive' || streamer.active) return;
        programStream?.getTracks().forEach(t => t.stop());
        programStream = null;
    }

    $a('record').onclick = async () => {
        audio.ensureContext();
        audio.resume();
        if (recorder.state === 'inactive') {
            try {
                recorder.start(outputStream(), col.settings);
                toast(`Recording started (${recorder.format.label})`);
            } catch (err) {
                toast(err.message);
            }
        } else {
            const name = await recorder.stop();
            if (name) toast(`Recording saved: ${name}`);
        }
        updateOutputButtons();
    };
    $a('pause').onclick = () => { recorder.togglePause(); updateOutputButtons(); };

    $a('stream').onclick = async () => {
        audio.ensureContext();
        audio.resume();
        const btn = $a('stream');
        if (streamer.active) {
            await streamer.stop();
            updateOutputButtons();
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        try {
            await streamer.start(outputStream(), col.settings);
            toast('Streaming started');
        } catch (err) {
            toast(`Could not start streaming: ${err.message}`);
        }
        btn.disabled = false;
        updateOutputButtons();
    };
    streamer.onStateChange = (state) => {
        if (state === 'failed' || state === 'closed') {
            streamer.close();
            toast('Stream disconnected');
        }
        updateOutputButtons();
    };

    function updateOutputButtons() {
        const rec = recorder.state;
        $a('record').textContent = rec === 'inactive' ? 'Start Recording' : 'Stop Recording';
        $a('record').classList.toggle('live', rec !== 'inactive');
        $a('pause').hidden = rec === 'inactive';
        $a('pause').classList.toggle('active', rec === 'paused');
        $a('stream').textContent = streamer.active ? 'Stop Streaming' : 'Start Streaming';
        $a('stream').classList.toggle('live', streamer.active);
        updateStatus();
    }

    const hms = (ms) => {
        const s = Math.floor(ms / 1000);
        const p = (n) => String(n).padStart(2, '0');
        return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
    };

    async function updateStatus() {
        const live = $('stat-live');
        if (streamer.active) {
            const kbps = await streamer.sampleBitrate();
            live.textContent = `LIVE: ${hms(performance.now() - streamer.startedAt)}  ${Math.round(kbps)} kb/s`;
            live.classList.add('on');
        } else {
            live.textContent = 'LIVE: 00:00:00';
            live.classList.remove('on');
        }
        const rec = $('stat-rec');
        const recording = recorder.state !== 'inactive';
        rec.textContent = `REC: ${hms(recorder.elapsed)}${recorder.state === 'paused' ? ' (Paused)' : ''}${recording ? `  ${(recorder.bytes / 1048576).toFixed(1)} MB` : ''}`;
        rec.classList.toggle('on', recording);
        $('stat-render').textContent = `Render: ${renderMs.toFixed(1)} ms  Lagged: ${lagged} (${totalTicks ? ((lagged / totalTicks) * 100).toFixed(1) : '0.0'}%)`;
        $('stat-fps').textContent = `${fps.toFixed(2)} / ${col.settings.fps.toFixed(2)} FPS`;
    }

    $a('studio').onclick = () => setStudioMode(!studioMode);

    $a('projector').onclick = () => {
        const win = window.open('', 'obs-projector', 'width=960,height=540');
        if (!win) { toast('Allow pop-ups to open a projector'); return; }
        win.document.title = 'Windowed Projector (Program)';
        win.document.body.style.cssText = 'margin:0;background:#000;display:flex;height:100vh';
        win.document.body.innerHTML = '';
        const video = win.document.createElement('video');
        video.style.cssText = 'width:100%;height:100%;object-fit:contain';
        video.muted = true;
        video.autoplay = true;
        if (!programStream) programStream = programCanvas.captureStream(col.settings.fps);
        video.srcObject = new MediaStream(programStream.getVideoTracks());
        win.document.body.appendChild(video);
        video.ondblclick = () => win.document.fullscreenElement ? win.document.exitFullscreen() : video.requestFullscreen();
    };

    $a('settings').onclick = () => openSettings();
    $a('minimax').onclick = () => openMinimax();

    root.querySelector('.obs-docks').addEventListener('click', (e) => {
        const action = e.target.closest('button')?.dataset.action;
        const sel = selectedItem();
        const scene = editScene();
        const idx = col.scenes.indexOf(scene);
        switch (action) {
            case 'scene-add':
                promptModal('Add Scene', uniqueSceneName(col)).then(name => {
                    if (!name) return;
                    const s = { id: uid('scene'), name, items: [] };
                    col.scenes.splice(idx + 1, 0, s);
                    selectScene(s.id);
                });
                break;
            case 'scene-remove': removeScene(scene.id); break;
            case 'scene-up':
            case 'scene-down': {
                const to = idx + (action === 'scene-up' ? -1 : 1);
                if (to < 0 || to >= col.scenes.length) break;
                col.scenes.splice(to, 0, col.scenes.splice(idx, 1)[0]);
                renderScenes();
                save();
                break;
            }
            case 'source-add': {
                const r = e.target.closest('button').getBoundingClientRect();
                showMenu(r.left, r.top, addSourceMenuItems(), true);
                break;
            }
            case 'source-remove': if (sel) removeItem(sel); break;
            case 'source-props': if (sel) openProperties(col.sources[sel.sourceId], sel); break;
            case 'source-up': if (sel) moveItem(sel, 'up'); break;
            case 'source-down': if (sel) moveItem(sel, 'down'); break;
        }
    });

    // ---------- Properties / Filters / Transform modal ----------
    function openProperties(source, item, tab = 'properties') {
        const rt = ensureRuntime(source);
        const s = source.settings;
        const modal = openModal(`Properties for '${source.name}'`);
        const tabs = document.createElement('div');
        tabs.className = 'obs-tabs';
        const body = document.createElement('div');
        body.className = 'obs-form';
        modal.body.append(tabs, body);
        const tabNames = { properties: 'Properties', filters: 'Filters', ...(item ? { transform: 'Transform' } : {}) };
        Object.entries(tabNames).forEach(([k, label]) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.onclick = () => show(k);
            b.dataset.tab = k;
            tabs.appendChild(b);
        });

        const changed = (rerenderText) => {
            if (rerenderText && source.type === 'text') rt.renderText();
            save();
        };

        function show(k) {
            tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === k));
            body.innerHTML = '';
            if (k === 'properties') propertiesTab();
            if (k === 'filters') filtersTab();
            if (k === 'transform') transformTab();
        }

        function field(label, input) {
            const l = document.createElement('label');
            l.append(label, input);
            body.appendChild(l);
            return input;
        }
        function input(type, value, oninput, attrs = {}) {
            const el = document.createElement(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
            if (type !== 'textarea' && type !== 'select') el.type = type;
            Object.assign(el, attrs);
            if (type === 'checkbox') el.checked = value; else el.value = value;
            el.addEventListener(type === 'checkbox' || type === 'select' ? 'change' : 'input', () => oninput(type === 'checkbox' ? el.checked : el.value));
            return el;
        }
        function select(options, value, onchange) {
            const el = input('select', '', onchange);
            options.forEach(([v, l]) => {
                const o = document.createElement('option');
                o.value = v;
                o.textContent = l;
                el.appendChild(o);
            });
            el.value = value;
            return el;
        }
        function status() {
            const p = document.createElement('p');
            p.className = 'obs-note';
            p.textContent = rt.status === 'ready' ? `Active — ${rt.naturalSize.w}×${rt.naturalSize.h}` :
                rt.status === 'error' ? `Error: ${rt.error}` : 'Inactive';
            body.appendChild(p);
        }
        function button(label, onclick) {
            const b = document.createElement('button');
            b.className = 'obs-btn';
            b.textContent = label;
            b.onclick = onclick;
            body.appendChild(b);
            return b;
        }
        function filePicker(accept) {
            const f = document.createElement('input');
            f.type = 'file';
            f.accept = accept;
            f.onchange = async () => {
                if (!f.files[0]) return;
                await rt.activate(f.files[0]);
                show('properties');
            };
            f.click();
        }

        async function deviceOptions(kind) {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                return [['', 'Default'], ...devices.filter(d => d.kind === kind).map((d, i) => [d.deviceId, d.label || `Device ${i + 1}`])];
            } catch {
                return [['', 'Default']];
            }
        }

        async function propertiesTab() {
            switch (source.type) {
                case 'display_capture':
                    field('Capture audio (if the browser offers it)', input('checkbox', s.captureAudio, v => { s.captureAudio = v; save(); }));
                    status();
                    button(rt.status === 'ready' ? 'Select another screen / window' : 'Select screen / window', async () => { await rt.activate(); show('properties'); });
                    break;
                case 'video_capture': {
                    const opts = await deviceOptions('videoinput');
                    field('Device', select(opts, s.deviceId, async v => { s.deviceId = v; save(); await rt.activate(); show('properties'); }));
                    field('Resolution', select([['640x480', '640x480'], ['1280x720', '1280x720'], ['1920x1080', '1920x1080'], ['3840x2160', '3840x2160']], s.resolution,
                        async v => { s.resolution = v; save(); await rt.activate(); show('properties'); }));
                    status();
                    if (rt.status !== 'ready') button('Activate', async () => { await rt.activate(); show('properties'); });
                    break;
                }
                case 'audio_input': {
                    const opts = await deviceOptions('audioinput');
                    field('Device', select(opts, s.deviceId, async v => { s.deviceId = v; save(); await rt.activate(); renderMixer(); show('properties'); }));
                    status();
                    if (rt.status !== 'ready') button('Activate', async () => { await rt.activate(); renderMixer(); show('properties'); });
                    break;
                }
                case 'image':
                    status();
                    button(s.fileName ? `Image file: ${s.fileName} — Browse…` : 'Browse…', () => filePicker('image/*'));
                    break;
                case 'media': {
                    field('Loop', input('checkbox', s.loop, v => { s.loop = v; if (rt.drawable) rt.drawable.loop = v; save(); }));
                    status();
                    button(s.fileName ? `Local file: ${s.fileName} — Browse…` : 'Browse…', () => filePicker('video/*,audio/*'));
                    if (rt.status === 'ready') {
                        const v = rt.drawable;
                        button('Play / Pause', () => (v.paused ? v.play() : v.pause()));
                        button('Restart', () => { v.currentTime = 0; v.play(); });
                    }
                    break;
                }
                case 'text':
                    field('Text', input('textarea', s.text, v => { s.text = v; changed(true); }, { rows: 3 }));
                    field('Font', select([['Arial', 'Arial'], ['Helvetica', 'Helvetica'], ['Georgia', 'Georgia'], ['Impact', 'Impact'], ['Courier New', 'Courier New'], ['Verdana', 'Verdana'], ['Trebuchet MS', 'Trebuchet MS']], s.font, v => { s.font = v; changed(true); }));
                    field('Size', input('number', s.size, v => { s.size = Math.max(4, +v || 4); changed(true); }, { min: 4, max: 1024 }));
                    field('Bold', input('checkbox', s.bold, v => { s.bold = v; changed(true); }));
                    field('Italic', input('checkbox', s.italic, v => { s.italic = v; changed(true); }));
                    field('Alignment', select([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], s.align, v => { s.align = v; changed(true); }));
                    field('Color', input('color', s.color, v => { s.color = v; changed(true); }));
                    field('Background color', input('color', s.background, v => { s.background = v; changed(true); }));
                    field('Background opacity', input('range', s.backgroundOpacity, v => { s.backgroundOpacity = +v; changed(true); }, { min: 0, max: 100 }));
                    field('Outline', input('checkbox', s.outline, v => { s.outline = v; changed(true); }));
                    field('Outline size', input('number', s.outlineSize, v => { s.outlineSize = Math.max(1, +v || 1); changed(true); }, { min: 1, max: 20 }));
                    field('Outline color', input('color', s.outlineColor, v => { s.outlineColor = v; changed(true); }));
                    break;
                case 'color':
                    field('Color', input('color', s.color, v => { s.color = v; save(); }));
                    field('Width', input('number', s.width, v => { s.width = Math.max(1, +v || 1); save(); }, { min: 1 }));
                    field('Height', input('number', s.height, v => { s.height = Math.max(1, +v || 1); save(); }, { min: 1 }));
                    break;
            }
        }

        function filtersTab() {
            const f = source.filters;
            const slider = (label, key, min, max, step = 1) =>
                field(`${label}`, input('range', f[key], v => { f[key] = +v; save(); }, { min, max, step }));
            const h = (text) => { const el = document.createElement('h4'); el.textContent = text; body.appendChild(el); };
            h('Color Correction');
            slider('Opacity', 'opacity', 0, 100);
            slider('Brightness', 'brightness', -100, 100);
            slider('Contrast', 'contrast', -100, 100);
            slider('Saturation', 'saturation', -100, 100);
            slider('Hue Shift', 'hue', -180, 180);
            h('Chroma Key');
            field('Enabled', input('checkbox', f.chroma, v => { f.chroma = v; save(); }));
            field('Key color', input('color', f.chromaColor, v => { f.chromaColor = v; save(); }));
            slider('Similarity (1-1000)', 'similarity', 1, 1000);
            slider('Smoothness (1-1000)', 'smoothness', 1, 1000);
            button('Reset filters', () => { Object.assign(f, DEFAULT_FILTERS); save(); show('filters'); });
        }

        function transformTab() {
            const t = item.transform;
            const num = (label, get, set, attrs = {}) => field(label, input('number', +get().toFixed(3), v => { set(+v || 0); save(); }, { step: 'any', ...attrs }));
            num('Position X', () => t.x, v => { t.x = v; });
            num('Position Y', () => t.y, v => { t.y = v; });
            num('Scale X', () => t.scaleX, v => { t.scaleX = v; });
            num('Scale Y', () => t.scaleY, v => { t.scaleY = v; });
            field('Rotation', select([['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']], String(t.rotation), v => { t.rotation = +v; save(); }));
            ['left', 'top', 'right', 'bottom'].forEach(side =>
                num(`Crop ${side}`, () => t.crop[side], v => { t.crop[side] = Math.max(0, Math.round(v)); }, { min: 0, step: 1 }));
            const row = document.createElement('div');
            row.className = 'obs-row obs-wrap';
            [['reset', 'Reset'], ['fit', 'Fit to screen'], ['stretch', 'Stretch'], ['center', 'Center']].forEach(([op, label]) => {
                const b = document.createElement('button');
                b.className = 'obs-btn';
                b.textContent = label;
                b.onclick = () => { transformAction(item, op); show('transform'); };
                row.appendChild(b);
            });
            body.appendChild(row);
        }

        show(tab);
    }

    // ---------- Settings modal ----------
    function openSettings() {
        const st = col.settings;
        const modal = openModal('Settings');
        const formats = supportedFormats();
        modal.body.innerHTML = `
            <div class="obs-form">
                <h4>Video</h4>
                <label>Base (Canvas) Resolution<select data-k="res">
                    ${['1280x720', '1920x1080', '2560x1440', '3840x2160', '1080x1920'].map(r => `<option ${r === `${st.baseWidth}x${st.baseHeight}` ? 'selected' : ''}>${r}</option>`).join('')}
                </select></label>
                <label>Common FPS Values<select data-k="fps">${[24, 25, 30, 48, 50, 60].map(f => `<option ${f === st.fps ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
                <h4>Output</h4>
                <label>Recording Format<select data-k="recFormat">
                    <option value="auto">Automatic</option>
                    ${formats.map(f => `<option value="${f.id}" ${f.id === st.recFormat ? 'selected' : ''}>${f.label}</option>`).join('')}
                </select></label>
                <label>Video Bitrate (Kbps)<input type="number" min="500" max="100000" step="100" data-k="videoBitrate" value="${st.videoBitrate}"></label>
                <label>Audio Bitrate (Kbps)<select data-k="audioBitrate">${[64, 96, 128, 160, 192, 256, 320].map(b => `<option ${b === st.audioBitrate ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
                <h4>Stream</h4>
                <label>Service<select disabled><option>WHIP</option></select></label>
                <label>Server<input type="url" data-k="whipUrl" placeholder="https://example.com/whip/endpoint"></label>
                <label>Bearer Token<input type="password" data-k="whipToken" autocomplete="off"></label>
                <p class="obs-note">Browsers cannot speak RTMP, so streaming uses WHIP (WebRTC-HTTP ingest), which OBS also offers as a service.</p>
                <h4>Audio</h4>
                <label>Mic/Auxiliary Audio<select data-k="mic"><option value="">Disabled</option></select></label>
            </div>`;
        const q = (k) => modal.body.querySelector(`[data-k="${k}"]`);
        if (recorder.state !== 'inactive' || streamer.active) {
            q('res').disabled = q('fps').disabled = true;
            q('res').title = q('fps').title = 'Stop outputs to change video settings';
        }
        q('recFormat').value = formats.some(f => f.id === st.recFormat) ? st.recFormat : 'auto';
        q('whipUrl').value = st.whipUrl;
        q('whipToken').value = st.whipToken;
        q('res').onchange = (e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            st.baseWidth = w;
            st.baseHeight = h;
            resetProgramStream();
            save();
        };
        q('fps').onchange = (e) => { st.fps = +e.target.value; setClock(); resetProgramStream(); save(); };
        q('recFormat').onchange = (e) => { st.recFormat = e.target.value; save(); };
        q('videoBitrate').onchange = (e) => { st.videoBitrate = Math.max(500, +e.target.value || 6000); save(); };
        q('audioBitrate').onchange = (e) => { st.audioBitrate = +e.target.value; save(); };
        q('whipUrl').oninput = (e) => { st.whipUrl = e.target.value.trim(); save(); };
        q('whipToken').oninput = (e) => { st.whipToken = e.target.value; save(); };
        const mic = q('mic');
        navigator.mediaDevices?.enumerateDevices().then(devices => {
            devices.filter(d => d.kind === 'audioinput').forEach((d, i) => {
                const o = document.createElement('option');
                o.value = d.deviceId || 'default';
                o.textContent = d.label || `Microphone ${i + 1}`;
                mic.appendChild(o);
            });
            mic.value = st.micEnabled ? (st.micDeviceId || mic.options[1]?.value || '') : '';
        }).catch(() => {});
        mic.onchange = () => {
            st.micEnabled = !!mic.value;
            st.micDeviceId = mic.value === 'default' ? '' : mic.value;
            audio.ensureContext();
            setMic(st.micEnabled);
            save();
        };
    }

    // ---------- Minimax AI (Hailuo 2.3 through Muapi) ----------
    const jobs = [];
    let renderJobs = () => {};

    // Still frame from the chosen studio source, as a canvas at native size.
    async function captureFrame(frameSource, recordingVideo) {
        const { baseWidth: W, baseHeight: H } = col.settings;
        if (frameSource === 'program') return snapshotDrawable(programCanvas, W, H);
        if (frameSource === 'preview') {
            renderScene(previewCtx, sceneById(col.previewScene), col, runtimes);
            return snapshotDrawable(previewCanvas, W, H);
        }
        if (frameSource === 'recording') {
            const v = recordingVideo;
            if (!v?.videoWidth) throw new Error('Recording not loaded yet');
            return snapshotDrawable(v, v.videoWidth, v.videoHeight);
        }
        const item = editScene().items.find(i => `item:${i.id}` === frameSource);
        if (!item) throw new Error('Source is no longer in this scene');
        const source = col.sources[item.sourceId];
        const rt = runtimes.get(source.id);
        if (!rt || rt.status !== 'ready') throw new Error(`'${source.name}' is not active`);
        if (source.type === 'color') {
            const c = document.createElement('canvas');
            c.width = +source.settings.width;
            c.height = +source.settings.height;
            const ctx = c.getContext('2d');
            ctx.fillStyle = source.settings.color;
            ctx.fillRect(0, 0, c.width, c.height);
            return c;
        }
        if (!rt.drawable) throw new Error(`'${source.name}' has no video`);
        const { w, h } = rt.naturalSize;
        return snapshotDrawable(rt.drawable, w, h, item.transform.crop);
    }

    function addGeneratedClip(sceneId, url, prompt) {
        const scene = sceneById(sceneId) || editScene();
        const short = prompt ? prompt.slice(0, 24) + (prompt.length > 24 ? '…' : '') : 'clip';
        const source = createSource('media', uniqueName(col, `Hailuo: ${short}`));
        source.settings.url = url;
        source.settings.fileName = 'Hailuo 2.3 clip';
        col.sources[source.id] = source;
        const item = createItem(source.id);
        scene.items.unshift(item);
        selectedItemId = item.id;
        ensureRuntime(source);
        renderSources();
        renderMixer();
        save();
    }

    async function startJob(opts) {
        const job = { id: uid('job'), label: opts.prompt || '(no prompt)', stage: 'Starting', error: '', url: '' };
        jobs.unshift(job);
        renderJobs();
        try {
            job.url = await runMinimaxJob(opts, (stage) => { job.stage = stage; renderJobs(); });
            job.stage = 'Adding to scene';
            renderJobs();
            addGeneratedClip(opts.sceneId, job.url, opts.prompt);
            job.stage = 'Done';
            toast('Minimax clip added to the scene');
        } catch (err) {
            job.stage = 'Failed';
            job.error = err.message;
            toast(`Minimax: ${err.message}`);
        }
        renderJobs();
    }

    function openMinimax(preset = {}) {
        const state = {
            mode: preset.mode || 'i2v',
            frameSource: preset.frameSource || 'program',
            prompt: preset.prompt || '',
            model: preset.model || MINIMAX_MODELS.i2v[0]?.id,
            duration: preset.duration,
            recordingTime: 0,
        };
        const modal = openModal('Minimax AI — Hailuo 2.3');
        modal.body.innerHTML = `
            <div class="obs-tabs">
                <button data-mode="i2v">Reanimate a frame</button>
                <button data-mode="t2v">Generate from text</button>
            </div>
            <div class="obs-form">
                <div data-k="frame-block">
                    <label>Start frame<select data-k="frameSource"></select></label>
                    <div data-k="recording-block" hidden>
                        <video data-k="recVideo" class="obs-mm-rec" muted playsinline></video>
                        <label>Frame time<input type="range" data-k="recTime" min="0" max="1000" value="0"></label>
                    </div>
                    <canvas data-k="thumb" class="obs-mm-thumb"></canvas>
                    <button class="obs-btn" data-k="refresh">Refresh frame</button>
                </div>
                <label>Prompt<textarea data-k="prompt" rows="3" placeholder="Describe the motion: camera move, action, mood…"></textarea></label>
                <label>Model<select data-k="model"></select></label>
                <label data-k="duration-row">Duration<select data-k="duration"></select></label>
                <button class="obs-btn obs-primary" data-k="generate">Generate</button>
                <p class="obs-note">The clip is added to the current scene as a Media Source when it is ready. Generation can take several minutes and uses your Muapi credits.</p>
                <h4>Jobs</h4>
                <ul class="obs-mm-jobs" data-k="jobs"></ul>
            </div>`;
        const q = (k) => modal.body.querySelector(`[data-k="${k}"]`);
        const sceneId = editScene().id;
        const recVideo = q('recVideo');
        let frameCanvas = null;
        let recUrl = null;

        if (recorder.last) {
            recUrl = URL.createObjectURL(recorder.last.blob);
            recVideo.src = recUrl;
        }

        function fillFrameSources() {
            const sel = q('frameSource');
            const opts = [['program', 'Program output']];
            if (studioMode) opts.push(['preview', 'Preview scene']);
            editScene().items.forEach(i => {
                const src = col.sources[i.sourceId];
                if (src && SOURCE_TYPES[src.type].video) opts.push([`item:${i.id}`, `Source: ${src.name}`]);
            });
            if (recorder.last) opts.push(['recording', `Last recording (${recorder.last.name})`]);
            sel.innerHTML = '';
            opts.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); });
            if (!opts.some(([v]) => v === state.frameSource)) state.frameSource = 'program';
            sel.value = state.frameSource;
        }

        function fillModels() {
            const sel = q('model');
            const list = MINIMAX_MODELS[state.mode];
            if (!list.some(m => m.id === state.model)) state.model = list[0]?.id;
            sel.innerHTML = '';
            list.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; sel.appendChild(o); });
            sel.value = state.model;
            const { durations, defaultDuration } = modelOptions(state.mode, state.model);
            q('duration-row').hidden = !durations.length;
            const dsel = q('duration');
            dsel.innerHTML = durations.map(d => `<option value="${d}">${d} s</option>`).join('');
            if (!durations.includes(state.duration)) state.duration = defaultDuration;
            if (durations.length) dsel.value = state.duration;
        }

        async function refreshFrame() {
            const thumb = q('thumb');
            const ctx = thumb.getContext('2d');
            try {
                frameCanvas = await captureFrame(state.frameSource, recVideo);
                thumb.width = 320;
                thumb.height = Math.round(320 * frameCanvas.height / frameCanvas.width);
                ctx.drawImage(frameCanvas, 0, 0, thumb.width, thumb.height);
            } catch (err) {
                frameCanvas = null;
                thumb.width = 320;
                thumb.height = 180;
                ctx.fillStyle = '#16171d';
                ctx.fillRect(0, 0, 320, 180);
                ctx.fillStyle = '#9a9ca5';
                ctx.font = '13px sans-serif';
                ctx.fillText(err.message, 12, 92);
            }
        }

        async function seekRecording() {
            if (!recVideo.duration || !isFinite(recVideo.duration)) {
                // MediaRecorder WebM files report no duration until seeked to the end.
                recVideo.currentTime = 1e9;
                await new Promise(r => recVideo.addEventListener('seeked', r, { once: true }));
            }
            recVideo.currentTime = (q('recTime').value / 1000) * (recVideo.duration || 0);
            await new Promise(r => recVideo.addEventListener('seeked', r, { once: true }));
            refreshFrame();
        }

        function sync() {
            modal.body.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
            q('frame-block').hidden = state.mode !== 'i2v';
            q('recording-block').hidden = state.frameSource !== 'recording';
            fillModels();
        }

        renderJobs = () => {
            const list = q('jobs');
            if (!list?.isConnected) return;
            list.innerHTML = jobs.length ? '' : '<li class="obs-empty">No jobs yet</li>';
            jobs.forEach(j => {
                const li = document.createElement('li');
                li.className = j.stage === 'Failed' ? 'failed' : j.stage === 'Done' ? 'done' : 'running';
                li.innerHTML = '<span class="obs-mm-job-label"></span><span class="obs-mm-job-stage"></span>';
                li.querySelector('.obs-mm-job-label').textContent = j.label;
                li.querySelector('.obs-mm-job-stage').textContent = j.error ? `Failed: ${j.error}` : j.stage;
                if (j.url) {
                    const a = document.createElement('a');
                    a.href = j.url;
                    a.target = '_blank';
                    a.rel = 'noopener';
                    a.textContent = 'Open clip';
                    li.appendChild(a);
                }
                list.appendChild(li);
            });
        };

        modal.body.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { state.mode = b.dataset.mode; sync(); }; });
        q('frameSource').onchange = (e) => {
            state.frameSource = e.target.value;
            sync();
            if (state.frameSource === 'recording') seekRecording(); else refreshFrame();
        };
        q('recTime').onchange = seekRecording;
        q('refresh').onclick = () => (state.frameSource === 'recording' ? seekRecording() : refreshFrame());
        q('prompt').value = state.prompt;
        q('prompt').oninput = (e) => { state.prompt = e.target.value; };
        q('model').onchange = (e) => { state.model = e.target.value; fillModels(); };
        q('duration').onchange = (e) => { state.duration = +e.target.value; };
        q('generate').onclick = async () => {
            const prompt = state.prompt.trim();
            if (state.mode === 't2v' && !prompt) { toast('Write a prompt first'); return; }
            if (state.mode === 'i2v' && !frameCanvas) { toast('No start frame captured'); return; }
            if (!localStorage.getItem('muapi_key')) {
                // The key dialog sits under OBS modals, so close this one and come back after.
                modal.close();
                AuthModal(() => openMinimax(state));
                return;
            }
            const { resolutions } = modelOptions(state.mode, state.model);
            startJob({
                mode: state.mode,
                model: state.model,
                prompt,
                duration: q('duration-row').hidden ? undefined : state.duration,
                resolution: resolutions[0],
                frame: state.mode === 'i2v' ? await frameToFile(frameCanvas, 'obs-frame') : null,
                sceneId,
            });
        };
        const observer = new MutationObserver(() => {
            if (!modal.body.isConnected) {
                if (recUrl) URL.revokeObjectURL(recUrl);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true });

        fillFrameSources();
        sync();
        renderJobs();
        if (state.frameSource === 'recording') recVideo.addEventListener('loadedmetadata', seekRecording, { once: true });
        else refreshFrame();
    }

    // ---------- Generic UI helpers ----------
    let openMenu = null;
    function closeMenu() { openMenu?.remove(); openMenu = null; }
    function showMenu(x, y, items, above = false) {
        closeMenu();
        const menu = document.createElement('div');
        menu.className = 'obs-menu';
        const build = (container, list) => {
            for (const it of list) {
                if (it.separator) { container.appendChild(Object.assign(document.createElement('hr'))); continue; }
                const el = document.createElement('div');
                el.className = 'obs-menu-item' + (it.disabled ? ' disabled' : '');
                el.textContent = it.label;
                if (it.submenu) {
                    el.classList.add('has-sub');
                    const sub = document.createElement('div');
                    sub.className = 'obs-menu obs-submenu';
                    build(sub, it.submenu);
                    el.appendChild(sub);
                } else if (!it.disabled) {
                    el.onclick = (e) => { e.stopPropagation(); closeMenu(); it.action(); };
                }
                container.appendChild(el);
            }
        };
        build(menu, items);
        document.body.appendChild(menu);
        const r = menu.getBoundingClientRect();
        const top = above ? y - r.height : y;
        menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
        menu.style.top = `${Math.max(4, Math.min(top, window.innerHeight - r.height - 4))}px`;
        openMenu = menu;
    }
    const onDocDown = (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); };
    document.addEventListener('pointerdown', onDocDown, true);

    const openModals = new Set();
    function openModal(title) {
        const backdrop = document.createElement('div');
        backdrop.className = 'obs-modal-backdrop';
        backdrop.innerHTML = `<div class="obs-modal"><header><span></span><button class="obs-icon-btn" title="Close">✕</button></header><div class="obs-modal-body"></div></div>`;
        backdrop.querySelector('header span').textContent = title;
        const close = () => { backdrop.remove(); openModals.delete(backdrop); renderSources(); renderMixer(); };
        backdrop.querySelector('header button').onclick = close;
        backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(); });
        document.body.appendChild(backdrop);
        openModals.add(backdrop);
        return { body: backdrop.querySelector('.obs-modal-body'), close };
    }

    function promptModal(title, value) {
        return new Promise((resolve) => {
            const modal = openModal(title);
            modal.body.innerHTML = '<form class="obs-form"><input type="text" required><div class="obs-row obs-end"><button type="button" class="obs-btn" data-k="cancel">Cancel</button><button class="obs-btn obs-primary">OK</button></div></form>';
            const input = modal.body.querySelector('input');
            input.value = value;
            setTimeout(() => input.select(), 0);
            modal.body.querySelector('[data-k="cancel"]').onclick = () => { modal.close(); resolve(null); };
            modal.body.querySelector('form').onsubmit = (e) => {
                e.preventDefault();
                modal.close();
                resolve(input.value.trim() || null);
            };
        });
    }

    function addSourceModal(type, existing) {
        return new Promise((resolve) => {
            const modal = openModal(`Create/Select Source — ${SOURCE_TYPES[type].label}`);
            modal.body.innerHTML = `
                <form class="obs-form">
                    <label class="obs-radio"><input type="radio" name="mode" value="new" checked> Create new</label>
                    <input type="text" data-k="name" required>
                    <label class="obs-radio"><input type="radio" name="mode" value="existing" ${existing.length ? '' : 'disabled'}> Add existing</label>
                    <select data-k="existing" size="4" ${existing.length ? '' : 'disabled'}></select>
                    <div class="obs-row obs-end"><button type="button" class="obs-btn" data-k="cancel">Cancel</button><button class="obs-btn obs-primary">OK</button></div>
                </form>`;
            const name = modal.body.querySelector('[data-k="name"]');
            name.value = uniqueName(col, SOURCE_TYPES[type].label);
            const sel = modal.body.querySelector('[data-k="existing"]');
            existing.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); });
            sel.onfocus = () => { modal.body.querySelector('[value="existing"]').checked = true; name.required = false; };
            name.onfocus = () => { modal.body.querySelector('[value="new"]').checked = true; name.required = true; };
            setTimeout(() => name.select(), 0);
            modal.body.querySelector('[data-k="cancel"]').onclick = () => { modal.close(); resolve(null); };
            modal.body.querySelector('form').onsubmit = (e) => {
                e.preventDefault();
                const mode = modal.body.querySelector('[name="mode"]:checked').value;
                if (mode === 'existing' && sel.value) { modal.close(); resolve({ existingId: sel.value }); return; }
                if (!name.value.trim()) return;
                modal.close();
                resolve({ name: uniqueName(col, name.value.trim()) });
            };
        });
    }

    function toast(msg) {
        const el = document.createElement('div');
        el.className = 'obs-toast';
        el.textContent = msg;
        root.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    function renderAll() {
        renderScenes();
        renderSources();
        renderMixer();
        renderTransitions();
    }

    // ---------- Boot ----------
    Object.values(col.sources).forEach(ensureRuntime);
    // The AudioContext can only start after a user gesture.
    root.addEventListener('pointerdown', () => { audio.ensureContext(); audio.resume(); }, { once: true });
    if (col.settings.micEnabled) root.addEventListener('pointerdown', () => setMic(true), { once: true });
    setStudioMode(false);
    setClock();
    updateOutputButtons();

    root._cleanup = () => {
        if (recorder.state !== 'inactive') recorder.stop();
        if (streamer.active) streamer.stop();
        clock.terminate();
        clearTimeout(saveTimer);
        saveCollection(col);
        closeMenu();
        openModals.forEach(m => m.remove());
        document.removeEventListener('pointerdown', onDocDown, true);
        micStream?.getTracks().forEach(t => t.stop());
        programStream?.getTracks().forEach(t => t.stop());
        runtimes.forEach(rt => rt.destroy());
        audio.destroy();
    };

    return root;
}
