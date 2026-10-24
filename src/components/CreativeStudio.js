// Creative: a reconstruction of ElevenLabs Creative's Flows canvas. Nodes
// generate or process media, edges carry a node's selected output into
// another node's input port. See docs/elevenlabs-creative-reconstruction.md.

import { NODE_TYPES, GROUPS, MODALITY, IMAGE_OPS, nodeOutputModality, modelOf } from '../lib/creative/catalog.js';
import {
    listFlows, newFlow, loadFlow, saveFlow, deleteFlow, makeNode, addEdge, removeNodes, duplicateNodes,
    selectedOutput, putMedia, listMedia, deleteMedia, mediaUrl, outputUrl, kindOfMime, uid,
    listBrandKits, saveBrandKits,
} from '../lib/creative/store.js';
import { runNode, runWithUpstream, saveVoiceOutput } from '../lib/creative/runner.js';
import { getElevenKey, setElevenKey, listVoices } from '../lib/creative/elevenlabs.js';
import { getMinimaxKey, setMinimaxKey, listSystemVoices, chat } from '../lib/minimax.js';
import { askAgent } from '../lib/creative/agent.js';
import { klingStatus, getKlingToken, setKlingToken } from '../lib/kling.js';

const NODE_W = 264;
const HEADER_H = 38;
const PORT_GAP = 24;
const LAST_FLOW = 'creative_last_flow';
// New nodes land on a 40 px grid and cascade by one cell when the cell is
// taken; focusing a selection never zooms past 1.5× (observed in the bundle).
const PLACE_GRID = 40;
const FOCUS_MAX_ZOOM = 1.5;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const ICONS = {
    text: '<path d="M4 6h16M4 12h10M4 18h7"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m22 8-6 4 6 4z"/>',
    audio: '<path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h-0"/>',
    voice: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
};
const icon = (m, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[m] || ICONS.text}</svg>`;

export function CreativeStudio() {
    const root = h('div', 'cr-root');
    root.tabIndex = 0;

    // ---------- State ----------
    let flow = loadFlow(localStorage.getItem(LAST_FLOW)) || loadFlow(listFlows()[0]?.id) || newFlow();
    localStorage.setItem(LAST_FLOW, flow.id);
    let selection = new Set();
    let selectedEdge = null;
    let voiceCache = null;
    const save = () => { saveFlow(flow); };

    // ---------- Layout ----------
    const topbar = h('div', 'cr-topbar');
    const body = h('div', 'cr-body');
    const palette = h('aside', 'cr-palette');
    const stage = h('div', 'cr-stage');
    const world = h('div', 'cr-world');
    const edgesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    edgesSvg.classList.add('cr-edges');
    const nodesLayer = h('div', 'cr-nodes');
    world.append(edgesSvg, nodesLayer);
    stage.append(world);
    const inspector = h('aside', 'cr-inspector');
    const zoomBar = h('div', 'cr-zoombar');
    const empty = h('div', 'cr-empty', `
        <div class="cr-empty-title">Start a flow</div>
        <div class="cr-empty-sub">Add a node from the left, drop files on the canvas, or start from a template.</div>
        <div class="cr-empty-actions">
            <button data-tpl="ugc">UGC Kling (style Arcads)</button>
            <button data-tpl="ad">Product ad with voiceover</button>
            <button data-tpl="podcast">Podcast intro</button>
            <button data-tpl="storyboard">Script → storyboard</button>
        </div>`);
    const agentPanel = h('div', 'cr-agent');
    agentPanel.hidden = true;
    stage.append(zoomBar, empty, agentPanel);
    body.append(palette, stage, inspector);
    root.append(topbar, body);

    // ---------- Top bar ----------
    function renderTopbar() {
        topbar.innerHTML = `
            <div class="cr-brand"><span class="cr-logo">II</span> Creative <span class="cr-sep">/</span></div>
            <input class="cr-flow-name" value="${esc(flow.name)}" spellcheck="false" />
            <button class="cr-btn" data-act="flows">Flows ▾</button>
            <div class="cr-spacer"></div>
            <button class="cr-btn" data-act="assets">Assets</button>
            <button class="cr-btn" data-act="brand">Brand kits</button>
            <button class="cr-btn" data-act="settings">Settings</button>
            <button class="cr-btn ${agentPanel.hidden ? '' : 'cr-on'}" data-act="agent">✦ Agent</button>
            <button class="cr-btn cr-primary" data-act="runall">▶ Run all</button>`;
        const name = topbar.querySelector('.cr-flow-name');
        name.onchange = () => { flow.name = name.value.trim() || 'Untitled flow'; save(); };
        name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); };
        topbar.querySelectorAll('[data-act]').forEach(b => b.onclick = (e) => {
            const a = b.dataset.act;
            if (a === 'flows') flowsMenu(e.currentTarget);
            else if (a === 'assets') assetsDrawer();
            else if (a === 'brand') brandKitsModal();
            else if (a === 'settings') settingsModal();
            else if (a === 'agent') toggleAgent();
            else if (a === 'runall') runAll();
        });
    }

    function flowsMenu(anchor) {
        const items = [{ label: '+ New flow', act: () => switchFlow(newFlow()) }, null,
            ...listFlows().map(f => ({
                label: `${f.id === flow.id ? '● ' : ''}${f.name} <span class="cr-dim">${f.nodeCount} nodes · ${new Date(f.updatedAt).toLocaleDateString()}</span>`,
                act: () => switchFlow(loadFlow(f.id) || newFlow()),
                del: f.id === flow.id ? null : () => { deleteFlow(f.id); },
            }))];
        popMenu(anchor, items);
    }

    function switchFlow(f) {
        flow = f;
        localStorage.setItem(LAST_FLOW, flow.id);
        selection.clear(); selectedEdge = null;
        renderTopbar(); applyViewport(); renderAll();
        if (!agentPanel.hidden) renderAgent();
    }

    // ---------- Palette ----------
    let paletteTab = 'nodes';
    function renderPalette() {
        palette.innerHTML = '';
        const tabs = h('div', 'cr-tabs', `<button data-t="nodes" class="${paletteTab === 'nodes' ? 'on' : ''}">Nodes</button><button data-t="structure" class="${paletteTab === 'structure' ? 'on' : ''}">Structure</button>`);
        tabs.querySelectorAll('button').forEach(b => b.onclick = () => { paletteTab = b.dataset.t; renderPalette(); });
        palette.append(tabs);
        if (paletteTab === 'structure') return renderStructure();
        for (const g of GROUPS) {
            palette.append(h('div', 'cr-pal-group', esc(g)));
            for (const [type, def] of Object.entries(NODE_TYPES)) {
                if (def.group !== g || type === 'asset') continue;
                const m = def.output || 'image';
                const it = h('div', 'cr-pal-item', `<span class="cr-pal-icon" style="color:${MODALITY[m]?.color}">${icon(m)}</span>${esc(def.label)}`);
                it.draggable = true;
                it.ondragstart = (e) => e.dataTransfer.setData('application/x-cr-node', type);
                it.onclick = () => {
                    const c = viewCenter();
                    const n = addNode(type, c.x - NODE_W / 2, c.y - 80);
                    if (type === 'voice') voicePicker(n);
                };
                palette.append(it);
            }
        }
        const up = h('div', 'cr-pal-item', `<span class="cr-pal-icon">${icon('image')}</span>Upload file…`);
        up.onclick = () => pickFiles(files => addFiles(files, viewCenter()));
        palette.insertBefore(up, palette.children[3]);
    }

    // Structure: groups with their members, then ungrouped nodes.
    function renderStructure() {
        const groups = flow.nodes.filter(n => n.type === 'flow-group');
        const inGroup = new Set();
        const row = (n, depth = 0) => {
            const m = nodeOutputModality(n) || (n.type === 'comment' ? 'text' : 'image');
            const it = h('div', `cr-pal-item cr-struct ${selection.has(n.id) ? 'on' : ''}`, `<span class="cr-pal-icon" style="color:${MODALITY[m]?.color}">${icon(m)}</span><span class="cr-struct-label">${esc(n.label)}</span><span class="cr-status cr-st-${n.run?.status || (selectedOutput(n) ? 'completed' : 'idle')}"></span>`);
            it.style.paddingLeft = `${8 + depth * 14}px`;
            it.onclick = () => { selection = new Set([n.id]); selectedEdge = null; renderAll(); focusNodes([n.id]); };
            palette.append(it);
        };
        for (const g of groups) {
            palette.append(h('div', 'cr-pal-group', esc(g.label)));
            row(g);
            groupMembers(g).forEach(m => { inGroup.add(m.id); row(m, 1); });
        }
        const rest = flow.nodes.filter(n => n.type !== 'flow-group' && !inGroup.has(n.id));
        if (rest.length) palette.append(h('div', 'cr-pal-group', groups.length ? 'Ungrouped' : 'Nodes'));
        rest.forEach(n => row(n));
        if (!flow.nodes.length) palette.append(h('div', 'cr-dim cr-pad', 'This flow is empty.'));
    }

    // ---------- Viewport ----------
    const vp = () => flow.viewport ||= { x: 0, y: 0, zoom: 1 };
    function applyViewport() {
        const v = vp();
        world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
        stage.style.backgroundPosition = `${v.x}px ${v.y}px`;
        stage.style.backgroundSize = `${24 * v.zoom}px ${24 * v.zoom}px`;
        zoomBar.innerHTML = `<button data-z="-">−</button><span>${Math.round(v.zoom * 100)}%</span><button data-z="+">+</button><button data-z="fit">Fit</button>`;
        zoomBar.querySelectorAll('button').forEach(b => b.onclick = () => {
            if (b.dataset.z === 'fit') return fitView();
            const r = stage.getBoundingClientRect();
            zoomAt(r.width / 2, r.height / 2, b.dataset.z === '+' ? 1.2 : 1 / 1.2);
        });
    }
    function toWorld(clientX, clientY) {
        const r = stage.getBoundingClientRect(), v = vp();
        return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
    }
    function viewCenter() {
        const r = stage.getBoundingClientRect();
        return toWorld(r.left + r.width / 2, r.top + r.height / 2);
    }
    function zoomAt(sx, sy, factor) {
        const v = vp();
        const z = Math.min(2.5, Math.max(0.15, v.zoom * factor));
        v.x = sx - (sx - v.x) * (z / v.zoom);
        v.y = sy - (sy - v.y) * (z / v.zoom);
        v.zoom = z;
        applyViewport(); saveSoon();
    }
    // World-space box of a node, measured from its element when rendered.
    function nodeBox(n) {
        const el = nodeEls.get(n.id);
        return { x: n.x, y: n.y, w: n.w || el?.offsetWidth || NODE_W, h: n.h || el?.offsetHeight || 300 };
    }
    function focusNodes(ids, maxZoom = FOCUS_MAX_ZOOM) {
        const boxes = flow.nodes.filter(n => ids.includes(n.id)).map(nodeBox);
        if (!boxes.length) { flow.viewport = { x: 0, y: 0, zoom: 1 }; return applyViewport(); }
        const pad = 60;
        const minX = Math.min(...boxes.map(b => b.x)) - pad, minY = Math.min(...boxes.map(b => b.y)) - pad;
        const maxX = Math.max(...boxes.map(b => b.x + b.w)) + pad, maxY = Math.max(...boxes.map(b => b.y + b.h)) + pad;
        const r = stage.getBoundingClientRect();
        // Keep the floating agent panel from covering the focused nodes.
        const usableW = r.width - (agentPanel.hidden ? 0 : agentPanel.offsetWidth + 16);
        const z = Math.max(0.15, Math.min(maxZoom, usableW / (maxX - minX), r.height / (maxY - minY)));
        flow.viewport = { zoom: z, x: (usableW - (maxX - minX) * z) / 2 - minX * z, y: (r.height - (maxY - minY) * z) / 2 - minY * z };
        applyViewport(); saveSoon();
    }
    const fitView = () => focusNodes(flow.nodes.map(n => n.id), 1.2);
    let saveTimer;
    const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); };

    // ---------- Nodes ----------
    function addNode(type, x, y, extra) {
        // Cascade one grid cell at a time instead of stacking nodes.
        const cell = (a, b) => `${Math.round(a / PLACE_GRID)},${Math.round(b / PLACE_GRID)}`;
        const taken = new Set(flow.nodes.map(o => cell(o.x, o.y)));
        while (taken.has(cell(x, y))) { x += PLACE_GRID; y += PLACE_GRID; }
        const n = makeNode(type, Math.round(x), Math.round(y), extra);
        flow.nodes.push(n);
        selection = new Set([n.id]);
        save(); renderAll();
        return n;
    }

    const nodeEls = new Map();

    // Top of input row i, relative to the ports block under the header.
    const portY = (i) => 8 + i * PORT_GAP;

    function renderNode(n) {
        const def = NODE_TYPES[n.type];
        const m = nodeOutputModality(n);
        let el = nodeEls.get(n.id);
        if (!el) {
            el = h('div', 'cr-node');
            el.dataset.id = n.id;
            // Groups sit behind every node.
            if (n.type === 'flow-group') nodesLayer.prepend(el); else nodesLayer.append(el);
            nodeEls.set(n.id, el);
        }
        if (def.decor) return renderDecor(n, el);
        el.style.transform = `translate(${n.x}px, ${n.y}px)`;
        el.style.width = `${NODE_W}px`;
        el.classList.toggle('selected', selection.has(n.id));
        const status = n.run?.status || (selectedOutput(n) ? 'completed' : 'idle');
        el.dataset.status = status;
        const model = modelOf(n);
        const outCount = n.result?.outputs?.length || 0;

        const ports = def.inputs.map((p, i) => {
            const wired = flow.edges.some(e => e.to === n.id && e.toPort === p.key);
            const color = MODALITY[p.accepts[0]]?.color;
            return `<div class="cr-port-row" style="top:${portY(i)}px">
                <span class="cr-port cr-in ${wired ? 'wired' : ''}" data-port="${p.key}" style="--pc:${color}"></span>
                <span class="cr-port-label">${esc(p.label)}${p.multi ? ' +' : ''}</span></div>`;
        }).join('');
        const portsH = def.inputs.length ? 12 + def.inputs.length * PORT_GAP : 0;

        el.innerHTML = `
            <div class="cr-node-head" style="--mc:${MODALITY[m]?.color || '#fff'}">
                <span class="cr-node-icon">${icon(m)}</span>
                <span class="cr-node-title">${esc(n.label)}</span>
                <span class="cr-status cr-st-${status}" title="${status}"></span>
                ${!def.source || n.type === 'text' ? `<button class="cr-node-run" title="Run (Ctrl+Enter)">▶</button>` : ''}
            </div>
            ${m ? `<span class="cr-port cr-out" data-out="1" style="--pc:${MODALITY[m]?.color}; top:${HEADER_H / 2 - 7}px"></span>` : ''}
            <div class="cr-node-ports" style="height:${portsH}px">${ports}</div>
            <div class="cr-node-body">
                ${model && !def.source ? `<div class="cr-node-model">${esc(model.name)}${outCount > 1 ? ` · ${outCount} results` : ''}</div>` : ''}
                <div class="cr-node-preview"></div>
                ${n.type !== 'asset' && n.type !== 'text' && n.prompt ? `<div class="cr-node-prompt">${esc(n.prompt.slice(0, 140))}</div>` : ''}
                ${n.run?.status === 'running' ? `<div class="cr-node-stage"><span class="cr-spin"></span>${esc(n.run.stage || 'Running')}</div>` : ''}
                ${n.run?.status === 'failed' ? `<div class="cr-node-error">${esc(n.run.error)}</div>` : ''}
            </div>`;
        fillPreview(el.querySelector('.cr-node-preview'), n, { compact: true });
        el.querySelector('.cr-node-run')?.addEventListener('click', (e) => { e.stopPropagation(); run(n); });
    }

    function renderDecor(n, el) {
        el.className = `cr-node ${n.type === 'comment' ? 'cr-comment' : 'cr-group'} ${selection.has(n.id) ? 'selected' : ''}`;
        el.style.transform = `translate(${n.x}px, ${n.y}px)`;
        el.style.width = `${n.w || 240}px`;
        if (n.type === 'flow-group') {
            el.style.height = `${n.h}px`;
            el.style.setProperty('--gc', n.color || '#6366f1');
            el.innerHTML = `<div class="cr-group-head">${esc(n.label)}</div><div class="cr-group-resize" data-resize="1"></div>`;
            return;
        }
        el.innerHTML = `<div class="cr-comment-head">Comment</div>`;
        const ta = h('textarea', 'cr-comment-text');
        ta.placeholder = 'Write a note…';
        ta.value = n.prompt || '';
        // Grow with the note so nothing is clipped.
        ta.rows = Math.max(4, ta.value.split('\n').length + 1);
        ta.oninput = () => { n.prompt = ta.value; ta.rows = Math.max(4, ta.value.split('\n').length + 1); saveSoon(); };
        el.append(ta);
    }

    // Nodes whose centre lies inside a group's frame.
    function groupMembers(g) {
        return flow.nodes.filter(n => {
            if (n.id === g.id || n.type === 'flow-group') return false;
            const b = nodeBox(n);
            const cx = b.x + b.w / 2, cy = b.y + Math.min(b.h, 120) / 2;
            return cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h;
        });
    }

    function groupSelection(label = 'Group') {
        const members = flow.nodes.filter(n => selection.has(n.id) && n.type !== 'flow-group');
        if (!members.length) return null;
        const boxes = members.map(nodeBox);
        const pad = 40, head = 36;
        const x = Math.min(...boxes.map(b => b.x)) - pad, y = Math.min(...boxes.map(b => b.y)) - pad - head;
        const w = Math.max(...boxes.map(b => b.x + b.w)) + pad - x, hgt = Math.max(...boxes.map(b => b.y + b.h)) + pad - y;
        const g = makeNode('flow-group', Math.round(x), Math.round(y), { label, w: Math.round(w), h: Math.round(hgt) });
        flow.nodes.unshift(g);
        selection = new Set([g.id]);
        save(); renderAll();
        return g;
    }

    async function fillPreview(box, n, { compact } = {}) {
        if (n.type === 'text') {
            box.innerHTML = `<div class="cr-text-out">${esc(n.prompt || 'Empty text')}</div>`;
            return;
        }
        const out = selectedOutput(n);
        if (!out) {
            box.innerHTML = compact ? `<div class="cr-placeholder">${icon(nodeOutputModality(n) || 'image', 22)}</div>` : '';
            return;
        }
        box.innerHTML = '';
        box.append(await mediaEl(out, compact));
    }

    async function mediaEl(out, compact) {
        if (out.kind === 'text') return h('div', 'cr-text-out', esc(compact ? out.text.slice(0, 400) : out.text));
        if (out.kind === 'voice') {
            const wrap = h('div', 'cr-voice-out', `${icon('voice', 16)} <span>${esc(out.name || 'Voice')}</span>${out.voiceId ? '' : '<em>preview – save to use</em>'}`);
            if (out.previewMediaId) {
                const a = document.createElement('audio');
                a.controls = true; a.src = await mediaUrl(out.previewMediaId);
                wrap.append(a);
            }
            return wrap;
        }
        const url = await outputUrl(out);
        if (!url) return h('div', 'cr-placeholder', 'Missing media');
        if (out.kind === 'image') { const i = new Image(); i.src = url; i.draggable = false; return i; }
        if (out.kind === 'video') {
            const v = document.createElement('video');
            v.src = url; v.muted = compact; v.loop = compact; v.playsInline = true; v.controls = !compact;
            if (compact) { v.onmouseenter = () => v.play().catch(() => {}); v.onmouseleave = () => v.pause(); }
            return v;
        }
        const a = document.createElement('audio');
        a.controls = true; a.src = url;
        return a;
    }

    function renderNodes() {
        const ids = new Set(flow.nodes.map(n => n.id));
        for (const [id, el] of nodeEls) if (!ids.has(id)) { el.remove(); nodeEls.delete(id); }
        flow.nodes.forEach(renderNode);
        empty.style.display = flow.nodes.length ? 'none' : '';
    }

    // ---------- Edges ----------
    function portPos(n, key) {
        if (key === 'out') return { x: n.x + NODE_W, y: n.y + HEADER_H / 2 };
        const i = NODE_TYPES[n.type].inputs.findIndex(p => p.key === key);
        return { x: n.x, y: n.y + HEADER_H + portY(Math.max(0, i)) + 10 };
    }
    const curve = (a, b) => {
        const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
        return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
    };
    function renderEdges(temp) {
        let svg = '';
        for (const e of flow.edges) {
            const a = flow.nodes.find(n => n.id === e.from), b = flow.nodes.find(n => n.id === e.to);
            if (!a || !b) continue;
            const color = MODALITY[nodeOutputModality(a)]?.color || '#888';
            const d = curve(portPos(a, 'out'), portPos(b, e.toPort));
            svg += `<path class="cr-edge-hit" data-edge="${e.id}" d="${d}"/>`;
            svg += `<path class="cr-edge ${selectedEdge === e.id ? 'selected' : ''}" d="${d}" stroke="${color}"/>`;
        }
        if (temp) svg += `<path class="cr-edge cr-edge-temp" d="${curve(temp.a, temp.b)}" stroke="${temp.color}"/>`;
        edgesSvg.innerHTML = svg;
    }

    function renderAll() {
        renderNodes(); renderEdges(); renderInspector();
        if (paletteTab === 'structure') renderPalette();
    }

    // ---------- Pointer interaction ----------
    let drag = null;

    stage.addEventListener('pointerdown', (e) => {
        if (e.button === 1 || (e.button === 0 && (e.target === stage || e.target === world || e.target === nodesLayer || e.target === edgesSvg))) {
            drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: vp().x, vy: vp().y };
            if (e.button === 0 && !e.shiftKey) { selection.clear(); selectedEdge = null; renderAll(); }
            e.preventDefault(); root.focus();
            stage.setPointerCapture(e.pointerId);
            return;
        }
        const edgeHit = e.target.closest?.('[data-edge]');
        if (edgeHit) {
            selectedEdge = edgeHit.dataset.edge; selection.clear();
            renderAll(); root.focus();
            return;
        }
        const nodeEl = e.target.closest('.cr-node');
        if (!nodeEl) return;
        const id = nodeEl.dataset.id;
        const n = flow.nodes.find(x => x.id === id);
        if (e.target.closest('[data-out]')) {
            drag = { kind: 'wire', from: n };
            stage.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }
        if (e.target.closest('[data-resize]')) {
            selection = new Set([id]);
            drag = { kind: 'resize', n, start: toWorld(e.clientX, e.clientY), w: n.w, h: n.h };
            stage.setPointerCapture(e.pointerId);
            e.preventDefault(); renderAll();
            return;
        }
        if (e.target.closest('button, audio, video[controls], input, textarea, select')) return;
        if (e.shiftKey) { selection.has(id) ? selection.delete(id) : selection.add(id); }
        else if (!selection.has(id)) selection = new Set([id]);
        selectedEdge = null;
        const p = toWorld(e.clientX, e.clientY);
        e.preventDefault();
        // Moving a group carries the nodes inside it.
        const moving = new Set(selection);
        flow.nodes.filter(g => g.type === 'flow-group' && selection.has(g.id)).forEach(g => groupMembers(g).forEach(m => moving.add(m.id)));
        drag = { kind: 'move', start: p, moved: false, origin: [...moving].map(sid => { const s = flow.nodes.find(x => x.id === sid); return { n: s, x: s.x, y: s.y }; }) };
        stage.setPointerCapture(e.pointerId);
        renderAll(); root.focus();
    });

    stage.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (drag.kind === 'pan') {
            vp().x = drag.vx + e.clientX - drag.sx;
            vp().y = drag.vy + e.clientY - drag.sy;
            applyViewport();
        } else if (drag.kind === 'move') {
            const p = toWorld(e.clientX, e.clientY);
            const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
            drag.origin.forEach(o => {
                o.n.x = Math.round(o.x + dx); o.n.y = Math.round(o.y + dy);
                const el = nodeEls.get(o.n.id);
                if (el) el.style.transform = `translate(${o.n.x}px, ${o.n.y}px)`;
            });
            renderEdges();
        } else if (drag.kind === 'resize') {
            const p = toWorld(e.clientX, e.clientY);
            drag.n.w = Math.max(200, Math.round(drag.w + p.x - drag.start.x));
            drag.n.h = Math.max(120, Math.round(drag.h + p.y - drag.start.y));
            renderNode(drag.n);
        } else if (drag.kind === 'wire') {
            const a = portPos(drag.from, 'out');
            renderEdges({ a, b: toWorld(e.clientX, e.clientY), color: MODALITY[nodeOutputModality(drag.from)]?.color || '#fff' });
            highlightTargets(drag.from, e);
        }
    });

    stage.addEventListener('pointerup', (e) => {
        if (!drag) return;
        const d = drag; drag = null;
        if (d.kind === 'pan') { saveSoon(); return; }
        if (d.kind === 'move' || d.kind === 'resize') { if (d.moved !== false) save(); if (paletteTab === 'structure') renderPalette(); return; }
        if (d.kind === 'wire') {
            nodesLayer.querySelectorAll('.cr-in').forEach(p => p.classList.remove('ok', 'bad'));
            const target = document.elementFromPoint(e.clientX, e.clientY);
            const portEl = target?.closest?.('.cr-in') || target?.closest?.('.cr-port-row')?.querySelector('.cr-in');
            const nodeEl = target?.closest?.('.cr-node');
            if (portEl && nodeEl) {
                connect(d.from, flow.nodes.find(n => n.id === nodeEl.dataset.id), portEl.dataset.port);
            } else if (nodeEl && nodeEl.dataset.id !== d.from.id) {
                // Dropped on a node body: use its first compatible port.
                const to = flow.nodes.find(n => n.id === nodeEl.dataset.id);
                const p = compatiblePorts(d.from, to)[0];
                if (p) connect(d.from, to, p.key); else toast('Those nodes cannot be connected');
            } else if (!nodeEl) {
                quickAdd(e.clientX, e.clientY, d.from);
            }
            renderEdges();
        }
    });

    function compatiblePorts(from, to) {
        const m = nodeOutputModality(from);
        return NODE_TYPES[to.type].inputs.filter(p => p.accepts.includes(m));
    }

    function highlightTargets(from, e) {
        const m = nodeOutputModality(from);
        nodesLayer.querySelectorAll('.cr-node').forEach(el => {
            const n = flow.nodes.find(x => x.id === el.dataset.id);
            el.querySelectorAll('.cr-in').forEach(p => {
                const def = NODE_TYPES[n.type].inputs.find(i => i.key === p.dataset.port);
                p.classList.toggle('ok', n.id !== from.id && def.accepts.includes(m));
                p.classList.toggle('bad', n.id === from.id || !def.accepts.includes(m));
            });
        });
    }

    function connect(from, to, portKey) {
        if (!to || from.id === to.id) return;
        const p = NODE_TYPES[to.type].inputs.find(i => i.key === portKey);
        const m = nodeOutputModality(from);
        if (!p || !p.accepts.includes(m)) { toast(`${p?.label || 'This port'} takes ${p?.accepts.join(' or ')}, not ${m}`); return; }
        if (!addEdge(flow, from.id, to.id, portKey)) { toast('That connection would create a loop'); return; }
        save(); renderAll();
    }

    // Quick add after dropping a wire on empty canvas: compatible nodes only.
    function quickAdd(cx, cy, from) {
        const m = nodeOutputModality(from);
        const opts = Object.entries(NODE_TYPES).filter(([, d]) => d.inputs.some(p => p.accepts.includes(m)));
        const pos = toWorld(cx, cy);
        popMenu({ getBoundingClientRect: () => ({ left: cx, bottom: cy, top: cy }) }, opts.map(([type, d]) => ({
            label: d.label,
            act: () => {
                const n = addNode(type, pos.x, pos.y - 20);
                const p = d.inputs.find(i => i.accepts.includes(m));
                connect(from, n, p.key);
            },
        })));
    }

    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
        else { vp().x -= e.deltaX; vp().y -= e.deltaY; applyViewport(); saveSoon(); }
    }, { passive: false });

    stage.addEventListener('dragover', (e) => e.preventDefault());
    stage.addEventListener('drop', (e) => {
        e.preventDefault();
        const p = toWorld(e.clientX, e.clientY);
        const type = e.dataTransfer.getData('application/x-cr-node');
        if (type) return addNode(type, p.x - NODE_W / 2, p.y - 20);
        const assetId = e.dataTransfer.getData('application/x-cr-asset');
        if (assetId) return addAssetNode(JSON.parse(assetId), p);
        if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files], p);
    });

    root.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea, select, [contenteditable]')) return;
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedEdge) { flow.edges = flow.edges.filter(x => x.id !== selectedEdge); selectedEdge = null; }
            else if (selection.size) { removeNodes(flow, [...selection]); selection.clear(); }
            else return;
            e.preventDefault(); save(); renderAll();
        } else if (mod && e.key.toLowerCase() === 'd' && selection.size) {
            e.preventDefault();
            selection = new Set(duplicateNodes(flow, [...selection]));
            save(); renderAll();
        } else if (mod && e.key.toLowerCase() === 'g' && selection.size) {
            e.preventDefault(); groupSelection();
        } else if (mod && e.key === 'Enter' && selection.size) {
            e.preventDefault();
            [...selection].forEach(id => run(flow.nodes.find(n => n.id === id)));
        } else if (mod && e.key.toLowerCase() === 'a') {
            e.preventDefault(); selection = new Set(flow.nodes.map(n => n.id)); renderAll();
        } else if (e.key === 'Escape') {
            selection.clear(); selectedEdge = null; renderAll();
        } else if (e.key === 'f' && !mod) {
            fitView();
        }
    });

    // ---------- Files & assets ----------
    function pickFiles(cb) {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,video/*,audio/*';
        inp.onchange = () => cb([...inp.files]);
        inp.click();
    }

    async function addFiles(files, at) {
        let y = at.y;
        for (const f of files) {
            const kind = kindOfMime(f.type);
            if (!kind) { toast(`${f.name}: unsupported file`); continue; }
            const mediaId = await putMedia(f, { kind, name: f.name, uploaded: true });
            addAssetNode({ kind, mediaId, name: f.name }, { x: at.x, y });
            y += 300;
        }
    }

    function addAssetNode(asset, at, label) {
        const out = { id: uid('out'), createdAt: Date.now(), ...asset };
        return addNode('asset', at.x - NODE_W / 2, at.y - 20, { label: label || asset.name || `${MODALITY[asset.kind]?.label} asset`, asset, result: { outputs: [out], selected: 0 } });
    }

    // ---------- Running ----------
    const hooks = {
        onChange: (n) => { if (flow.nodes.includes(n)) { renderNode(n); if (selection.has(n.id)) renderInspector(); } },
        onSave: () => { save(); renderAll(); },
    };

    // Kling keys live on the server; the page only learns whether the relay
    // is configured and whether it needs the passcode.
    let kling = null;
    const refreshKling = async () => { kling = await klingStatus(); return kling; };

    // Why a node cannot run yet, or null.
    function blocker(n) {
        const be = modelOf(n)?.backend;
        if (be === 'minimax' && !getMinimaxKey()) return 'Add your MiniMax API key to run this node.';
        if (be === 'elevenlabs' && !getElevenKey()) return 'Add your ElevenLabs API key to run this node.';
        if (be === 'kling') {
            if (kling && !kling.configured) return kling.error || 'Kling is not configured on the server: set KLING_API_KEY (or KLING_ACCESS_KEY and KLING_SECRET_KEY).';
            if (kling?.passcode_required && !getKlingToken()) return 'Enter the Kling passcode (KLING_PROXY_TOKEN) to run Kling nodes.';
        }
        return null;
    }

    function run(n) {
        if (!n) return;
        const reason = blocker(n);
        if (reason) { settingsModal(reason); return; }
        runWithUpstream(flow, n, hooks);
    }

    async function runAll() {
        const order = topoOrder().filter(n => !NODE_TYPES[n.type].source);
        if (!order.length) return toast('Nothing to run');
        if (!confirm(`Run ${order.length} node${order.length > 1 ? 's' : ''}? Generation uses your API credits.`)) return;
        const reason = order.map(blocker).find(Boolean);
        if (reason) return settingsModal(reason);
        for (const n of order) {
            await runNode(flow, n, hooks);
            if (n.run?.status === 'failed') { toast(`Stopped: ${n.label} failed`); break; }
        }
    }

    function topoOrder() {
        const indeg = new Map(flow.nodes.map(n => [n.id, 0]));
        flow.edges.forEach(e => indeg.set(e.to, (indeg.get(e.to) || 0) + 1));
        const queue = flow.nodes.filter(n => !indeg.get(n.id));
        const out = [];
        while (queue.length) {
            const n = queue.shift();
            out.push(n);
            flow.edges.filter(e => e.from === n.id).forEach(e => {
                indeg.set(e.to, indeg.get(e.to) - 1);
                if (!indeg.get(e.to)) queue.push(flow.nodes.find(x => x.id === e.to));
            });
        }
        return out;
    }

    // ---------- Inspector ----------
    function renderInspector() {
        inspector.innerHTML = '';
        if (selection.size !== 1) {
            inspector.innerHTML = selection.size
                ? `<div class="cr-insp-empty">${selection.size} nodes selected<br><span class="cr-dim">Ctrl+G groups, Ctrl+D duplicates, Delete removes, Ctrl+Enter runs them.</span><br><br><button class="cr-btn cr-wide" data-group="1">Group selection</button></div>`
                : `<div class="cr-insp-empty">Select a node to edit it.<br><br><span class="cr-dim">Drag from a node's right-hand port to another node's input to connect them. Drop a wire on empty canvas to add a connected node.<br><br>Scroll to pan, Ctrl+scroll to zoom, F to fit, Shift+click to multi-select, Ctrl+G to group.</span></div>`;
            const gb = inspector.querySelector('[data-group]');
            if (gb) gb.onclick = () => groupSelection();
            return;
        }
        const n = flow.nodes.find(x => x.id === [...selection][0]);
        if (!n) return;
        const def = NODE_TYPES[n.type];

        const sec = (title) => { const s = h('div', 'cr-insp-sec'); if (title) s.append(h('div', 'cr-insp-label', esc(title))); inspector.append(s); return s; };

        const head = sec();
        const label = h('input', 'cr-input cr-insp-title');
        label.value = n.label;
        label.onchange = () => { n.label = label.value.trim() || def.label; save(); renderNode(n); };
        head.append(label, h('div', 'cr-dim', esc(def.label)));

        if (def.models.length > 1) {
            const s = sec('Model');
            const selEl = h('select', 'cr-input');
            selEl.innerHTML = def.models.map(m => `<option value="${m.id}" ${m.id === n.model ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
            selEl.onchange = () => { n.model = selEl.value; save(); renderAll(); };
            s.append(selEl);
        } else if (def.models.length === 1) {
            sec('Model').append(h('div', 'cr-dim', esc(def.models[0].name)));
        }

        if (n.type === 'flow-group') {
            const s = sec('Colour');
            const c = h('input', 'cr-input');
            c.type = 'color'; c.value = n.color || '#6366f1';
            c.oninput = () => { n.color = c.value; saveSoon(); renderNode(n); };
            const members = groupMembers(n);
            s.append(c, h('div', 'cr-hint', `${members.length} node${members.length === 1 ? '' : 's'} inside. Moving the group moves them.`));
            if (members.some(m => !NODE_TYPES[m.type].source)) {
                const rb = h('button', 'cr-btn cr-wide', '▶ Run group');
                rb.onclick = () => members.filter(m => !NODE_TYPES[m.type].source).forEach(run);
                s.append(rb);
            }
        }

        if (def.prompt || n.type === 'llm') {
            const s = sec(n.type === 'text' ? 'Text' : n.type === 'llm' ? 'Instruction' : 'Prompt');
            const ta = h('textarea', 'cr-input cr-textarea');
            ta.placeholder = def.prompt || '';
            ta.value = n.prompt || '';
            ta.oninput = () => { n.prompt = ta.value; saveSoon(); renderNode(n); };
            s.append(ta);
            if (!def.source && n.type !== 'llm') {
                const imp = h('button', 'cr-btn cr-small-btn', '✦ Improve prompt');
                imp.title = 'Rewrite this prompt to be more specific (MiniMax M2)';
                imp.onclick = async () => {
                    if (!ta.value.trim()) return toast('Write a prompt first');
                    if (!getMinimaxKey()) return settingsModal('Add your MiniMax API key to improve prompts.');
                    imp.disabled = true; imp.innerHTML = '<span class="cr-spin"></span> Improving';
                    try {
                        ta.value = await chat({
                            model: 'MiniMax-M2', temperature: 0.6,
                            messages: [
                                { role: 'system', content: `Rewrite the user's prompt for a ${def.label} model. Keep their intent and language; make it concrete and specific (subject, setting, style, camera or sound as relevant). Reply with the prompt only, no quotes.` },
                                { role: 'user', content: ta.value },
                            ],
                        });
                        n.prompt = ta.value; save(); renderNode(n);
                    } catch (err) { toast(err.message); }
                    imp.disabled = false; imp.textContent = '✦ Improve prompt';
                };
                s.append(imp);
            }
            if (def.inputs.some(p => p.key === 'prompt')) s.append(h('div', 'cr-hint', 'Text wired into the Prompt port is placed before this prompt.'));
            if (['image-generation', 'video-generation', 'music'].includes(n.type)) {
                const kits = listBrandKits();
                if (kits.length) {
                    const ks = h('select', 'cr-input');
                    ks.innerHTML = `<option value="">No brand kit</option>` + kits.map(k => `<option value="${k.id}" ${k.id === n.brandKitId ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
                    ks.onchange = () => { n.brandKitId = ks.value || null; save(); };
                    s.append(ks);
                }
            }
        }

        if (def.params.length) {
            const s = sec('Settings');
            def.params.forEach(pd => s.append(paramField(n, pd)));
        }

        if (n.type === 'image-transform') opsEditor(n, sec('Edit steps'));
        if (n.type === 'composition') tracksEditor(n, sec('Tracks'));

        if (!def.source || n.type === 'text') {
            const s = sec();
            const btn = h('button', 'cr-btn cr-primary cr-wide', n.run?.status === 'running' ? `<span class="cr-spin"></span> ${esc(n.run.stage || 'Running')}` : '▶ Run node');
            btn.disabled = n.run?.status === 'running';
            btn.onclick = () => run(n);
            s.append(btn);
            if (n.run?.status === 'failed') s.append(h('div', 'cr-node-error', esc(n.run.error)));
        }

        const outs = n.result?.outputs || [];
        if (outs.length && n.type !== 'text') {
            const s = sec(`Results (${outs.length})`);
            const grid = h('div', 'cr-results');
            outs.forEach((o, i) => {
                const card = h('div', `cr-result ${i === (n.result.selected ?? 0) ? 'active' : ''}`);
                const media = h('div', 'cr-result-media');
                mediaEl(o, false).then(m => media.append(m));
                const bar = h('div', 'cr-result-bar');
                const pick = h('button', '', i === (n.result.selected ?? 0) ? '✓ Used downstream' : 'Use this');
                pick.onclick = () => { n.result.selected = i; save(); renderAll(); };
                const pin = h('button', '', 'Pin as asset');
                pin.title = 'Copy this variation into its own Asset node';
                pin.onclick = () => {
                    const { id, createdAt, ...asset } = o;
                    addAssetNode(asset, { x: n.x + NODE_W + 220, y: n.y + i * 40 }, `${n.label} #${outs.length - i}`);
                };
                const dl = h('button', '', '↓');
                dl.title = 'Download';
                dl.onclick = () => download(o, `${n.label}-${i + 1}`);
                const del = h('button', '', '✕');
                del.title = 'Remove result';
                del.onclick = () => {
                    outs.splice(i, 1);
                    n.result.selected = Math.min(n.result.selected ?? 0, Math.max(0, outs.length - 1));
                    save(); renderAll();
                };
                bar.append(pick);
                if (o.kind !== 'text' && o.kind !== 'voice' && n.type !== 'asset') bar.append(pin);
                if (o.kind === 'voice' && !o.voiceId && o.generatedVoiceId) {
                    const sv = h('button', '', 'Save voice');
                    sv.onclick = async () => {
                        const name = prompt('Voice name', o.name);
                        if (!name) return;
                        try { await saveVoiceOutput(o, name); voiceCache = null; save(); renderAll(); toast('Voice saved to your ElevenLabs library'); }
                        catch (err) { toast(err.message); }
                    };
                    bar.append(sv);
                }
                if (o.kind !== 'voice') bar.append(dl);
                if (n.type !== 'asset') bar.append(del);
                card.append(media, bar);
                grid.append(card);
            });
            s.append(grid);
        }

        const danger = sec();
        const rm = h('button', 'cr-btn cr-danger cr-wide', 'Delete node');
        rm.onclick = () => { removeNodes(flow, [n.id]); selection.clear(); save(); renderAll(); };
        danger.append(rm);
    }

    function paramField(n, pd) {
        const row = h('label', 'cr-field');
        row.append(h('span', '', esc(pd.label || pd.name)));
        const val = n.params[pd.name];
        const set = (v) => { if (v === '' || v == null || Number.isNaN(v)) delete n.params[pd.name]; else n.params[pd.name] = v; saveSoon(); renderNode(n); };
        let input;
        if (pd.type === 'select') {
            input = h('select', 'cr-input');
            input.innerHTML = pd.options.map(o => `<option value="${o}" ${String(o) === String(val ?? '') ? 'selected' : ''}>${o === '' ? 'None' : esc(String(o).replace(/_/g, ' '))}</option>`).join('');
            input.onchange = () => set(typeof pd.options.find(o => o !== '') === 'number' ? +input.value : input.value);
        } else if (pd.type === 'number') {
            input = h('input', 'cr-input');
            input.type = 'number';
            Object.assign(input, { min: pd.min, max: pd.max, step: pd.step || 'any' });
            input.value = val ?? '';
            input.onchange = () => set(input.value === '' ? null : Math.min(pd.max, Math.max(pd.min, +input.value)));
        } else if (pd.type === 'boolean') {
            input = h('input');
            input.type = 'checkbox'; input.checked = !!val;
            input.onchange = () => set(input.checked);
            row.classList.add('cr-check');
        } else if (pd.type === 'textarea') {
            input = h('textarea', 'cr-input cr-textarea cr-small');
            input.value = val || '';
            input.oninput = () => set(input.value);
        } else if (pd.type === 'voice') {
            input = h('button', 'cr-input cr-voice-btn', val ? esc(n.params.voice_name || val) : 'Choose a voice…');
            input.onclick = (e) => { e.preventDefault(); voicePicker(n); };
            if (flow.edges.some(e => e.to === n.id && e.toPort === 'voice')) row.append(h('div', 'cr-hint', 'A wired Voice input overrides this.'));
        } else {
            input = h('input', 'cr-input');
            input.value = val || ''; input.placeholder = pd.placeholder || '';
            input.onchange = () => set(input.value.trim());
        }
        row.append(input);
        return row;
    }

    function opsEditor(n, s) {
        n.ops ||= [];
        n.ops.forEach((o, i) => {
            const card = h('div', 'cr-op');
            const top = h('div', 'cr-op-head', `<b>${esc(IMAGE_OPS[o.op]?.label || o.op)}</b>`);
            const rm = h('button', '', '✕');
            rm.onclick = () => { n.ops.splice(i, 1); save(); renderInspector(); };
            top.append(rm);
            card.append(top);
            for (const [k, def] of Object.entries(IMAGE_OPS[o.op].fields)) {
                const f = h('label', 'cr-field cr-op-field');
                f.append(h('span', '', esc(k.replace(/_/g, ' '))));
                const inp = h('input', 'cr-input');
                if (typeof def === 'boolean') { inp.type = 'checkbox'; inp.checked = !!o[k]; inp.onchange = () => { o[k] = inp.checked; saveSoon(); }; f.classList.add('cr-check'); }
                else if (typeof def === 'number') { inp.type = 'number'; inp.step = k === 'rotate' ? 90 : k === 'weight' ? 100 : 'any'; inp.value = o[k] ?? def; inp.onchange = () => { o[k] = +inp.value; saveSoon(); }; }
                else if (k === 'color') { inp.type = 'color'; inp.value = o[k] || def; inp.oninput = () => { o[k] = inp.value; saveSoon(); }; }
                else { inp.value = o[k] ?? def; inp.oninput = () => { o[k] = inp.value; saveSoon(); }; }
                f.append(inp);
                card.append(f);
            }
            s.append(card);
        });
        const add = h('select', 'cr-input');
        add.innerHTML = `<option value="">+ Add step…</option>` + Object.entries(IMAGE_OPS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
        add.onchange = () => { if (!add.value) return; n.ops.push({ op: add.value, ...IMAGE_OPS[add.value].fields }); save(); renderInspector(); };
        s.append(add, h('div', 'cr-hint', 'Coordinates are fractions of the picture (0–1). Steps run as: crop, rotate/flip, layers, then adjustments.'));
    }

    function tracksEditor(n, s) {
        n.tracks ||= {};
        const edges = flow.edges.filter(e => e.to === n.id);
        if (!edges.length) { s.append(h('div', 'cr-hint', 'Wire video and audio nodes into Clips. Videos play in wire order; each audio clip gets its own track.')); return; }
        edges.forEach((e, i) => {
            const src = flow.nodes.find(x => x.id === e.from);
            const t = n.tracks[e.id] ||= { volume: 1, muted: false };
            const row = h('div', 'cr-track', `<span style="color:${MODALITY[nodeOutputModality(src)]?.color}">${icon(nodeOutputModality(src))}</span><span class="cr-track-name">${i + 1}. ${esc(src.label)}</span>`);
            const vol = h('input');
            vol.type = 'range'; vol.min = 0; vol.max = 2; vol.step = 0.05; vol.value = t.volume;
            vol.oninput = () => { t.volume = +vol.value; saveSoon(); };
            const mute = h('button', `cr-mini ${t.muted ? 'on' : ''}`, 'M');
            mute.title = 'Mute';
            mute.onclick = () => { t.muted = !t.muted; save(); renderInspector(); };
            row.append(vol, mute);
            s.append(row);
        });
    }

    async function download(o, name) {
        if (o.kind === 'text') {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([o.text], { type: 'text/plain' }));
            a.download = `${name}.txt`; a.click();
            return;
        }
        const url = await outputUrl(o);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.target = '_blank'; a.click();
    }

    // ---------- Voice picker ----------
    async function voicePicker(n) {
        const model = modelOf(n);
        const backend = model.backend;
        const m = modal(`Choose a voice <span class="cr-dim">· ${backend === 'minimax' ? 'MiniMax' : 'ElevenLabs'} voices for ${esc(model.name)}</span>`);
        const search = h('input', 'cr-input');
        search.placeholder = 'Search voices…';
        const list = h('div', 'cr-voice-list', '<div class="cr-dim">Loading voices…</div>');
        m.body.append(search, list);
        let voices = [];
        try {
            voiceCache ||= {};
            if (!voiceCache[backend]) voiceCache[backend] = backend === 'minimax' ? await listSystemVoices() : await listVoices();
            voices = voiceCache[backend];
        } catch (err) {
            list.innerHTML = `<div class="cr-node-error">${esc(err.message)}</div>`;
            return;
        }
        let player;
        const draw = () => {
            const q = search.value.toLowerCase();
            list.innerHTML = '';
            voices.filter(v => !q || `${v.name} ${v.description}`.toLowerCase().includes(q)).slice(0, 200).forEach(v => {
                const row = h('div', 'cr-voice-row', `<div><b>${esc(v.name)}</b><div class="cr-dim">${esc(v.description || v.category || '')}</div></div>`);
                if (v.preview) {
                    const play = h('button', 'cr-mini', '▶');
                    play.onclick = (e) => { e.stopPropagation(); player?.pause(); player = new Audio(v.preview); player.play(); };
                    row.append(play);
                }
                row.onclick = () => {
                    n.params.voice_id = `${backend}:${v.id}`;
                    n.params.voice_name = v.name;
                    if (n.type === 'voice') {
                        n.label = v.name;
                        n.result = { outputs: [{ id: uid('out'), createdAt: Date.now(), kind: 'voice', voiceId: v.id, voiceBackend: backend, name: v.name }], selected: 0 };
                    }
                    player?.pause(); save(); m.close(); renderAll();
                };
                list.append(row);
            });
            if (!list.children.length) list.innerHTML = '<div class="cr-dim">No voices match.</div>';
        };
        search.oninput = draw;
        draw();
        search.focus();
    }

    // ---------- Assets drawer ----------
    async function assetsDrawer() {
        const m = modal('Assets <span class="cr-dim">· stored in this browser</span>', 'cr-wide-modal');
        const up = h('button', 'cr-btn', 'Upload files');
        up.onclick = () => pickFiles(async files => { for (const f of files) { const k = kindOfMime(f.type); if (k) await putMedia(f, { kind: k, name: f.name, uploaded: true }); } draw(); });
        const grid = h('div', 'cr-assets');
        m.body.append(up, grid);
        const draw = async () => {
            const items = await listMedia();
            grid.innerHTML = items.length ? '' : '<div class="cr-dim">No assets yet. Uploads and generations appear here.</div>';
            for (const it of items) {
                const card = h('div', 'cr-asset');
                card.draggable = true;
                const asset = { kind: it.kind, mediaId: it.id, name: it.name };
                card.ondragstart = (e) => e.dataTransfer.setData('application/x-cr-asset', JSON.stringify(asset));
                const media = await mediaEl({ kind: it.kind, mediaId: it.id }, true);
                card.append(media, h('div', 'cr-asset-name', esc(it.name || it.kind)));
                const bar = h('div', 'cr-result-bar');
                const use = h('button', '', 'Add to canvas');
                use.onclick = () => { addAssetNode(asset, viewCenter()); m.close(); };
                const del = h('button', '', '✕');
                del.onclick = async () => {
                    const used = flow.nodes.some(nd => nd.result?.outputs?.some(o => o.mediaId === it.id));
                    if (used && !confirm('A node in this flow uses this asset. Delete it anyway?')) return;
                    await deleteMedia(it.id); draw();
                };
                bar.append(use, del);
                card.append(bar);
                grid.append(card);
            }
        };
        draw();
    }

    // ---------- Brand kits ----------
    function brandKitsModal() {
        const m = modal('Brand kits');
        const draw = () => {
            m.body.innerHTML = '';
            const kits = listBrandKits();
            kits.forEach((k, i) => {
                const card = h('div', 'cr-op');
                card.innerHTML = `
                    <label class="cr-field"><span>Name</span><input class="cr-input" data-k="name" value="${esc(k.name)}"></label>
                    <label class="cr-field"><span>Colours (comma separated)</span><input class="cr-input" data-k="colors" value="${esc((k.colors || []).join(', '))}"></label>
                    <label class="cr-field"><span>Typography</span><input class="cr-input" data-k="fonts" value="${esc(k.fonts || '')}"></label>
                    <label class="cr-field"><span>Style &amp; tone</span><textarea class="cr-input cr-textarea cr-small" data-k="style">${esc(k.style || '')}</textarea></label>
                    <div class="cr-swatches">${(k.colors || []).map(c => `<span style="background:${esc(c)}"></span>`).join('')}</div>`;
                card.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
                    const key = inp.dataset.k;
                    k[key] = key === 'colors' ? inp.value.split(',').map(s => s.trim()).filter(Boolean) : inp.value;
                    saveBrandKits(kits); draw();
                });
                const del = h('button', 'cr-btn cr-danger', 'Delete kit');
                del.onclick = () => { kits.splice(i, 1); saveBrandKits(kits); draw(); };
                card.append(del);
                m.body.append(card);
            });
            const add = h('button', 'cr-btn cr-primary', '+ New brand kit');
            add.onclick = () => { kits.push({ id: uid('kit'), name: 'My brand', colors: ['#000000', '#ffffff'], fonts: '', style: '' }); saveBrandKits(kits); draw(); };
            m.body.append(add, h('div', 'cr-hint', 'Pick a kit on an Image, Video or Music node: its colours, typography and tone are added to the prompt.'));
        };
        draw();
    }

    // ---------- Settings ----------
    function settingsModal(reason) {
        const m = modal('Settings');
        m.body.innerHTML = `
            ${reason ? `<div class="cr-node-error">${esc(reason)}</div>` : ''}
            <label class="cr-field"><span>MiniMax API key <span class="cr-dim">· image, video, LLM, MiniMax speech/music</span></span>
                <input class="cr-input" type="password" id="cr-mm" value="${esc(getMinimaxKey())}" placeholder="sk-…"></label>
            <a class="cr-link" href="https://platform.minimax.io" target="_blank" rel="noopener">Get a key at platform.minimax.io →</a>
            <label class="cr-field"><span>ElevenLabs API key <span class="cr-dim">· speech, sound effects, music, voices, dubbing, STT</span></span>
                <input class="cr-input" type="password" id="cr-el" value="${esc(getElevenKey())}" placeholder="sk_…"></label>
            <a class="cr-link" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener">Create a key in ElevenLabs →</a>
            <div class="cr-hint">Keys stay in this browser's localStorage and are only sent to their own API.</div>
            <div class="cr-insp-label" style="margin-top:8px">Kling</div>
            <div class="cr-dim" id="cr-kl-status">Checking the Kling relay…</div>
            <label class="cr-field"><span>Kling passcode <span class="cr-dim">· the KLING_PROXY_TOKEN set on the server</span></span>
                <input class="cr-input" type="password" id="cr-kl" value="${esc(getKlingToken())}" placeholder="passcode"></label>
            <div class="cr-hint">Kling keys never go in the browser. Put KLING_API_KEY (or KLING_ACCESS_KEY + KLING_SECRET_KEY) and KLING_PROXY_TOKEN in the site's environment variables on Netlify, or in a local <code>.env</code> file for <code>npm run dev</code>.</div>
            <a class="cr-link" href="https://app.klingai.com/global/dev" target="_blank" rel="noopener">Get Kling API keys →</a>`;
        refreshKling().then(st => {
            const el = m.body.querySelector('#cr-kl-status');
            if (!el) return;
            el.textContent = st.configured
                ? `Relay ready (${st.auth === 'api_key' ? 'API key' : 'access key + secret'})${st.passcode_required ? ', passcode required' : ''}.`
                : (st.error || 'Relay reachable but no Kling key is set on the server.');
            el.style.color = st.configured ? '#4ade80' : '#f87171';
        });
        const btn = h('button', 'cr-btn cr-primary cr-wide', 'Save');
        btn.onclick = () => {
            setMinimaxKey(m.body.querySelector('#cr-mm').value.trim());
            setElevenKey(m.body.querySelector('#cr-el').value.trim());
            setKlingToken(m.body.querySelector('#cr-kl').value.trim());
            voiceCache = null;
            m.close(); toast('Keys saved');
        };
        m.body.append(btn);
    }

    // ---------- Templates ----------
    empty.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => template(b.dataset.tpl));

    function template(kind) {
        const c = viewCenter();
        const at = (dx, dy) => ({ x: c.x - 500 + dx, y: c.y - 200 + dy });
        const place = (type, dx, dy, extra) => { const p = at(dx, dy); const n = makeNode(type, p.x, p.y, extra); flow.nodes.push(n); return n; };
        const wire = (a, b, port) => addEdge(flow, a.id, b.id, port);
        if (kind === 'ugc') return ugcTemplate(place, wire);
        if (kind === 'ad') {
            const img = place('image-generation', 0, 0, { label: 'Product shot', prompt: 'Studio product photo of a matte black wireless speaker on a stone plinth, soft rim light, 85mm' });
            const vid = place('video-generation', 340, 0, { label: 'Hero clip', prompt: 'Slow orbit around the speaker, light sweeps across the surface' });
            const vo = place('tts', 340, 380, { label: 'Voiceover', prompt: 'Sound that fills the room. Design that disappears into it.' });
            const mus = place('music', 0, 380, { label: 'Bed', prompt: 'Minimal ambient electronic, warm pads, 90 bpm', params: { duration_seconds: 15, lyrics_type: 'instrumental' } });
            const comp = place('composition', 700, 120, { label: 'Final ad' });
            wire(img, vid, 'start_frame'); wire(vid, comp, 'clips'); wire(vo, comp, 'clips'); wire(mus, comp, 'clips');
        } else if (kind === 'podcast') {
            const script = place('llm', 0, 0, { label: 'Intro script', prompt: 'Write a 3-sentence upbeat intro for a tech podcast called "Open Source Hour".' });
            const host = place('tts', 340, 0, { label: 'Host' });
            const jingle = place('music', 340, 340, { label: 'Jingle', prompt: 'Short upbeat podcast jingle, synth bass, claps', params: { duration_seconds: 10, lyrics_type: 'instrumental' } });
            const fx = place('audio-effects', 680, 0, { label: 'Studio room', params: { environment_id: 'small_room', distance: 0.1 } });
            const mix = place('composition', 1000, 120, { label: 'Intro mix' });
            wire(script, host, 'prompt'); wire(host, fx, 'source'); wire(fx, mix, 'clips'); wire(jingle, mix, 'clips');
        } else {
            const script = place('llm', 0, 0, { label: 'Scene', prompt: 'Describe, in one vivid sentence, the opening shot of a sci-fi short film set in a flooded city.' });
            ['Wide', 'Close-up', 'Aerial'].forEach((v, i) => {
                const img = place('image-generation', 380, i * 320, { label: `${v} frame`, prompt: `${v} shot, cinematic, anamorphic` , params: { aspect_ratio: '21:9', count: 2 } });
                wire(script, img, 'prompt');
            });
        }
        save(); renderAll(); fitView();
    }

    // ---------- Agent ----------
    const agentChats = new Map();
    let agentBusy = false;

    function toggleAgent() {
        agentPanel.hidden = !agentPanel.hidden;
        renderTopbar();
        if (!agentPanel.hidden) renderAgent();
    }

    function renderAgent() {
        const history = agentChats.get(flow.id) || [];
        agentPanel.innerHTML = `
            <div class="cr-agent-head"><b>✦ Agent</b><span class="cr-dim">builds and edits this flow</span><button class="cr-mini" data-x>✕</button></div>
            <div class="cr-agent-log"></div>
            <form class="cr-agent-form"><textarea class="cr-input" rows="2" placeholder="e.g. Make a 3-shot storyboard for a coffee ad, then a voiceover"></textarea><button class="cr-btn cr-primary" type="submit">Send</button></form>`;
        agentPanel.querySelector('[data-x]').onclick = toggleAgent;
        const log = agentPanel.querySelector('.cr-agent-log');
        if (!history.length) log.append(h('div', 'cr-dim cr-pad', 'Describe what you want to make. The agent adds, wires, edits and runs nodes on the canvas. Uses your MiniMax key.'));
        history.forEach(m => {
            const b = h('div', `cr-msg cr-msg-${m.role}`, esc(m.display ?? m.content));
            if (m.ops?.length) b.append(h('div', 'cr-msg-ops', m.ops.map(o => `<span>${esc(o)}</span>`).join('')));
            log.append(b);
        });
        if (agentBusy) log.append(h('div', 'cr-msg cr-msg-assistant', '<span class="cr-spin"></span> Thinking…'));
        log.scrollTop = log.scrollHeight;
        const form = agentPanel.querySelector('form');
        const input = form.querySelector('textarea');
        input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
        form.onsubmit = async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text || agentBusy) return;
            if (!getMinimaxKey()) return settingsModal('Add your MiniMax API key to use the agent.');
            const chatFlow = flow;
            const hist = agentChats.get(chatFlow.id) || [];
            agentChats.set(chatFlow.id, hist);
            hist.push({ role: 'user', content: text });
            agentBusy = true; renderAgent();
            try {
                const { reply, ops } = await askAgent(chatFlow, hist.slice(0, -1), text);
                const applied = chatFlow === flow ? await applyOps(ops) : [];
                hist.push({ role: 'assistant', content: JSON.stringify({ reply, ops }), display: reply || 'Done.', ops: applied });
            } catch (err) {
                hist.push({ role: 'assistant', content: `Error: ${err.message}`, display: `Error: ${err.message}` });
            }
            agentBusy = false;
            if (!agentPanel.hidden) renderAgent();
        };
        input.focus();
    }

    // Applies agent operations; returns one short line per applied op.
    async function applyOps(ops) {
        const refs = new Map();
        const idOf = (r) => refs.get(r) || r;
        const done = [];
        const added = [];
        let toRun = [];
        const rightmost = flow.nodes.length ? Math.max(...flow.nodes.map(n => n.x + (n.w || NODE_W))) + 80 : viewCenter().x - 300;
        let col = 0;
        for (const o of ops) {
            try {
                if (o.op === 'add_node' && NODE_TYPES[o.type] && !NODE_TYPES[o.type].decor) {
                    const def = NODE_TYPES[o.type];
                    const x = Number.isFinite(o.x) ? o.x : rightmost + (col++ % 4) * 340;
                    const y = Number.isFinite(o.y) ? o.y : viewCenter().y - 150;
                    const extra = { label: o.label || def.label };
                    if (o.prompt) extra.prompt = String(o.prompt);
                    if (def.models.some(m => m.id === o.model)) extra.model = o.model;
                    const n = makeNode(o.type, Math.round(x), Math.round(y), extra);
                    Object.assign(n.params, cleanParams(o.type, o.params));
                    flow.nodes.push(n);
                    if (o.ref) refs.set(o.ref, n.id);
                    added.push(n.id);
                    done.push(`+ ${n.label}`);
                } else if (o.op === 'add_edges') {
                    for (const e of o.edges || []) {
                        const from = flow.nodes.find(n => n.id === idOf(e.from)), to = flow.nodes.find(n => n.id === idOf(e.to));
                        if (!from || !to) continue;
                        const port = NODE_TYPES[to.type].inputs.find(p => p.key === e.port && p.accepts.includes(nodeOutputModality(from))) || compatiblePorts(from, to)[0];
                        if (port && addEdge(flow, from.id, to.id, port.key)) done.push(`${from.label} → ${to.label}`);
                    }
                } else if (o.op === 'update_node') {
                    const n = flow.nodes.find(x => x.id === idOf(o.id));
                    if (!n) continue;
                    if (o.label) n.label = String(o.label);
                    if (o.prompt != null) n.prompt = String(o.prompt);
                    if (NODE_TYPES[n.type].models.some(m => m.id === o.model)) n.model = o.model;
                    Object.assign(n.params, cleanParams(n.type, o.params));
                    done.push(`✎ ${n.label}`);
                } else if (o.op === 'remove_elements') {
                    const ids = (o.ids || []).map(idOf).filter(id => flow.nodes.some(n => n.id === id));
                    if (ids.length) { removeNodes(flow, ids); done.push(`− ${ids.length} node${ids.length > 1 ? 's' : ''}`); }
                } else if (o.op === 'add_group') {
                    renderNodes();
                    selection = new Set((o.ids || []).map(idOf));
                    const g = groupSelection(o.label || 'Group');
                    if (g) done.push(`▢ ${g.label}`);
                } else if (o.op === 'run_nodes') {
                    toRun = toRun.concat((o.ids || []).map(idOf));
                }
            } catch (err) {
                console.warn('Agent op failed', o, err);
            }
        }
        if (added.length) selection = new Set(added);
        save(); renderAll();
        if (added.length) requestAnimationFrame(() => focusNodes(flow.nodes.map(n => n.id), 1.2));
        const runnable = toRun.map(id => flow.nodes.find(n => n.id === id)).filter(n => n && !NODE_TYPES[n.type].source);
        if (runnable.length && confirm(`The agent wants to run ${runnable.length} node${runnable.length > 1 ? 's' : ''}. Generation uses your API credits. Run now?`)) {
            runnable.forEach(run);
            done.push(`▶ ${runnable.length} run`);
        }
        return done;
    }

    // Keeps only parameters the node type declares, with allowed values.
    function cleanParams(type, params) {
        const out = {};
        for (const pd of NODE_TYPES[type].params) {
            const v = params?.[pd.name];
            if (v == null || pd.type === 'voice') continue;
            if (pd.options && !pd.options.map(String).includes(String(v))) continue;
            out[pd.name] = pd.type === 'number' || typeof pd.options?.[1] === 'number' ? +v : v;
        }
        return out;
    }

    // UGC face-cam video in the style of Arcads, following the Kling method:
    // step 1 a 9:16 smartphone-style portrait, step 2 either Avatar (photo +
    // voice) or Image to Video (5 s) followed by Lip Sync.
    function ugcTemplate(place, wire) {
        const note = place('comment', -40, -300, { w: 460, prompt: 'UGC Kling\n1. Run « Visage UGC » and pick the best face (Results → Use this).\n2. Write the script; the voice reads it (ElevenLabs or MiniMax).\n3. Option A: Avatar = photo + voice, fastest.\n   Option B: 5 s Image to Video, then Lip Sync with the voice.\nKeep the script to about 5 s (12–15 words) for option B, or set the video to 10 s.' });
        const face = place('kling-image', 0, 0, {
            label: 'Visage UGC',
            prompt: 'Candid iPhone selfie photo of a 22-year-old French woman speaking directly to the camera, wearing a casual hoodie, indoors living room background, natural soft indoor light, ultra-realistic skin texture, authentic UGC style, 9:16 aspect ratio.',
            params: { aspect_ratio: '9:16', n: 4, resolution: '1k', image_reference: 'face', negative_prompt: 'studio lighting, airbrushed skin, plastic look, watermark, text' },
        });
        const script = place('text', 0, 420, { label: 'Script', prompt: 'J\'ai testé ce sérum pendant sept jours, et honnêtement, ma peau n\'a jamais été aussi douce.' });
        const voice = place('tts', 380, 420, { label: 'Voix', model: 'eleven_multilingual_v2', params: { count: 1 } });
        const avatar = place('kling-avatar', 780, -40, { label: 'Option A · Avatar', params: { mode: 'std' } });
        const i2v = place('kling-video', 780, 360, { label: 'Option B · Image to Video', prompt: 'She looks at the camera, blinks softly, moves her head slightly while talking', params: { duration: 5, mode: 'std', cfg_scale: 0.5 } });
        const sync = place('kling-lipsync', 1160, 360, { label: 'Option B · Lip Sync' });
        wire(script, voice, 'prompt');
        wire(face, avatar, 'image'); wire(voice, avatar, 'audio');
        wire(face, i2v, 'start_frame');
        wire(i2v, sync, 'video'); wire(voice, sync, 'audio');
        save(); renderAll();
        selection = new Set([face.id]); groupSelection('Étape 1 · Visage');
        selection = new Set([avatar.id]); groupSelection('Option A · Avatar');
        selection = new Set([i2v.id, sync.id]); groupSelection('Option B · Image to Video + Lip Sync');
        selection = new Set([note.id]);
        save(); renderAll(); fitView();
    }

    // ---------- Small UI helpers ----------
    function modal(title, extra = '') {
        const overlay = h('div', 'cr-overlay');
        const box = h('div', `cr-modal ${extra}`);
        const head = h('div', 'cr-modal-head', `<div>${title}</div>`);
        const x = h('button', 'cr-mini', '✕');
        head.append(x);
        const bodyEl = h('div', 'cr-modal-body');
        box.append(head, bodyEl);
        overlay.append(box);
        root.append(overlay);
        const close = () => overlay.remove();
        x.onclick = close;
        overlay.onpointerdown = (e) => { if (e.target === overlay) close(); };
        box.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); };
        return { body: bodyEl, close };
    }

    function popMenu(anchor, items) {
        root.querySelector('.cr-menu')?.remove();
        const r = anchor.getBoundingClientRect();
        const rr = root.getBoundingClientRect();
        const menu = h('div', 'cr-menu');
        menu.style.left = `${Math.min(r.left - rr.left, rr.width - 280)}px`;
        menu.style.top = `${r.bottom - rr.top + 4}px`;
        items.forEach(it => {
            if (!it) { menu.append(h('div', 'cr-menu-sep')); return; }
            const row = h('div', 'cr-menu-item', `<span>${it.label}</span>`);
            row.onclick = () => { menu.remove(); it.act(); };
            if (it.del) {
                const d = h('button', 'cr-mini', '✕');
                d.onclick = (e) => { e.stopPropagation(); if (confirm('Delete this flow?')) { it.del(); row.remove(); } };
                row.append(d);
            }
            menu.append(row);
        });
        root.append(menu);
        setTimeout(() => document.addEventListener('pointerdown', function off(e) {
            if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', off); }
        }), 0);
    }

    function toast(msg) {
        const t = h('div', 'cr-toast', esc(msg));
        root.append(t);
        setTimeout(() => t.remove(), 3500);
    }

    // ---------- Init ----------
    renderTopbar();
    renderPalette();
    refreshKling();
    requestAnimationFrame(() => { applyViewport(); renderAll(); });
    root._cleanup = () => { clearTimeout(saveTimer); save(); };
    return root;
}
