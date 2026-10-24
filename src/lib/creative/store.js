// Flow model and persistence. A flow (nodes, edges, viewport) is small JSON in
// localStorage; media produced or uploaded in the browser are blobs in
// IndexedDB, referenced by id from node outputs.
//
// Output entry: { id, kind: text|image|video|audio|voice, url?, mediaId?,
//                 text?, voiceId?, voiceBackend?, name?, createdAt }

import { NODE_TYPES, defaultParams } from './catalog.js';

const INDEX_KEY = 'creative_flows';
const FLOW_KEY = (id) => `creative_flow_${id}`;
const BRAND_KEY = 'creative_brand_kits';
const DB_NAME = 'creative-media';
const STORE = 'media';

let counter = Date.now();
export const uid = (p) => `${p}_${(counter++).toString(36)}`;

// ---------- Flows ----------

export function listFlows() {
    try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; } catch { return []; }
}

function writeIndex(list) {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

export function newFlow(name = 'Untitled flow') {
    const flow = { id: uid('flow'), name, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: Date.now() };
    saveFlow(flow);
    return flow;
}

export function loadFlow(id) {
    try {
        const f = JSON.parse(localStorage.getItem(FLOW_KEY(id)));
        if (f?.nodes) return f;
    } catch { /* fall through */ }
    return null;
}

export function saveFlow(flow) {
    flow.updatedAt = Date.now();
    // Running state is transient: a reload can't resume a browser-side job.
    const clean = { ...flow, nodes: flow.nodes.map(({ run, ...n }) => n) };
    try { localStorage.setItem(FLOW_KEY(flow.id), JSON.stringify(clean)); } catch { /* quota */ }
    const list = listFlows().filter(f => f.id !== flow.id);
    list.unshift({ id: flow.id, name: flow.name, updatedAt: flow.updatedAt, nodeCount: flow.nodes.length });
    writeIndex(list);
}

export function deleteFlow(id) {
    localStorage.removeItem(FLOW_KEY(id));
    writeIndex(listFlows().filter(f => f.id !== id));
}

// ---------- Nodes & edges ----------

export function makeNode(type, x, y, extra = {}) {
    const def = NODE_TYPES[type];
    return {
        id: uid('node'), type, x, y,
        label: def.label,
        model: def.models[0]?.id || null,
        prompt: '',
        params: defaultParams(type),
        ops: type === 'image-transform' ? [] : undefined,
        result: { outputs: [], selected: 0 },
        ...extra,
    };
}

export function addEdge(flow, from, to, toPort) {
    // A single-input port holds one edge; a new one replaces it.
    const def = NODE_TYPES[flow.nodes.find(n => n.id === to)?.type];
    const p = def?.inputs.find(i => i.key === toPort);
    if (!p) return null;
    if (from === to || createsCycle(flow, from, to)) return null;
    if (!p.multi) flow.edges = flow.edges.filter(e => !(e.to === to && e.toPort === toPort));
    if (flow.edges.some(e => e.from === from && e.to === to && e.toPort === toPort)) return null;
    const edge = { id: uid('edge'), from, to, toPort };
    flow.edges.push(edge);
    return edge;
}

function createsCycle(flow, from, to) {
    // Adding from→to closes a cycle if `from` is reachable from `to`.
    const seen = new Set();
    const stack = [to];
    while (stack.length) {
        const id = stack.pop();
        if (id === from) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        flow.edges.filter(e => e.from === id).forEach(e => stack.push(e.to));
    }
    return false;
}

export function removeNodes(flow, ids) {
    const set = new Set(ids);
    flow.nodes = flow.nodes.filter(n => !set.has(n.id));
    flow.edges = flow.edges.filter(e => !set.has(e.from) && !set.has(e.to));
}

export function duplicateNodes(flow, ids) {
    const map = new Map();
    for (const id of ids) {
        const n = flow.nodes.find(x => x.id === id);
        if (!n) continue;
        const { run, ...rest } = n;
        const copy = JSON.parse(JSON.stringify(rest));
        copy.id = uid('node');
        copy.x += 40; copy.y += 40;
        map.set(id, copy.id);
        flow.nodes.push(copy);
    }
    // Keep edges between duplicated nodes, and from outside into them.
    for (const e of [...flow.edges]) {
        if (!map.has(e.to)) continue;
        flow.edges.push({ id: uid('edge'), from: map.get(e.from) || e.from, to: map.get(e.to), toPort: e.toPort });
    }
    return [...map.values()];
}

export const selectedOutput = (node) => node?.result?.outputs?.[node.result.selected ?? 0] || node?.result?.outputs?.[0] || null;

// ---------- Media (IndexedDB) ----------

let dbPromise;
function db() {
    dbPromise ||= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
    });
}

const urlCache = new Map();

export async function putMedia(blob, meta = {}) {
    const id = uid('media');
    await tx('readwrite', s => s.put({ blob, ...meta, createdAt: Date.now() }, id));
    urlCache.set(id, URL.createObjectURL(blob));
    return id;
}

export async function getMediaRecord(id) {
    return tx('readonly', s => s.get(id));
}

export async function mediaUrl(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const rec = await getMediaRecord(id);
    if (!rec) return null;
    const url = URL.createObjectURL(rec.blob);
    urlCache.set(id, url);
    return url;
}

export async function listMedia() {
    const d = await db();
    return new Promise((resolve, reject) => {
        const out = [];
        const req = d.transaction(STORE).objectStore(STORE).openCursor();
        req.onsuccess = () => {
            const c = req.result;
            if (!c) return resolve(out.sort((a, b) => b.createdAt - a.createdAt));
            const { blob, ...meta } = c.value;
            out.push({ id: c.key, type: blob.type, size: blob.size, ...meta });
            c.continue();
        };
        req.onerror = () => reject(req.error);
    });
}

export async function deleteMedia(id) {
    await tx('readwrite', s => s.delete(id));
    if (urlCache.has(id)) URL.revokeObjectURL(urlCache.get(id));
    urlCache.delete(id);
}

// Playable/displayable URL for an output entry.
export async function outputUrl(out) {
    if (!out) return null;
    if (out.mediaId) return mediaUrl(out.mediaId);
    return out.url || null;
}

// Blob for an output entry (fetches remote results).
export async function outputBlob(out) {
    if (out.mediaId) return (await getMediaRecord(out.mediaId))?.blob;
    if (!out.url) throw new Error('This output has no media');
    const res = await fetch(out.url);
    if (!res.ok) throw new Error(`Could not fetch result (${res.status})`);
    return res.blob();
}

export const kindOfMime = (type) => type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : null;

// ---------- Brand kits ----------

export function listBrandKits() {
    try { return JSON.parse(localStorage.getItem(BRAND_KEY)) || []; } catch { return []; }
}

export function saveBrandKits(kits) {
    try { localStorage.setItem(BRAND_KEY, JSON.stringify(kits)); } catch { /* quota */ }
}

// Prompt suffix describing a brand kit, appended when a node applies it.
export function brandKitPrompt(kit) {
    if (!kit) return '';
    const parts = [];
    if (kit.colors?.length) parts.push(`brand colours ${kit.colors.join(', ')}`);
    if (kit.fonts) parts.push(`typography: ${kit.fonts}`);
    if (kit.style) parts.push(kit.style);
    return parts.length ? `\n\nBrand guidelines (${kit.name}): ${parts.join('; ')}.` : '';
}
