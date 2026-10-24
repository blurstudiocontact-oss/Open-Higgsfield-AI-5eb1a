// MiniMax H3 jobs for the OBS page: edit a video (Ref2VA with the clip as
// `reference_video`), animate a studio frame, or generate from text. The HTTP
// side lives in the shared client, src/lib/minimax.js.

import { H3, submitVideo, waitForVideo, uploadToMinimax, clipFetchUrl } from '../minimax.js';

export { H3, clipFetchUrl };
export { waitForVideo as h3Wait };

const PENDING_STORAGE = 'minimax_pending_tasks';

// Ref2VA editing prompt: name the inputs, then state the edit.
export function buildEditPrompt(instruction, hasReferenceImage) {
    const lines = ['<Video 1> is the source video for the editing task.'];
    if (hasReferenceImage) lines.push('<Picture 1> is a reference image for the edit.');
    lines.push('', `The target video is an edited version of <Video 1>. ${instruction.trim()}`);
    return lines.join('\n');
}

// Submitted tasks are remembered so a reload can resume waiting for them.
export function pendingTasks() {
    try { return JSON.parse(localStorage.getItem(PENDING_STORAGE)) || []; } catch { return []; }
}
function setPending(list) {
    try { localStorage.setItem(PENDING_STORAGE, JSON.stringify(list)); } catch { /* ignore */ }
}
export const rememberTask = (task) => setPending([...pendingTasks().filter(t => t.taskId !== task.taskId), task]);
export const forgetTask = (taskId) => setPending(pendingTasks().filter(t => t.taskId !== taskId));

export function frameToFile(canvas, name = 'frame') {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) { reject(new Error('Could not capture frame')); return; }
            resolve(new File([blob], `${name}.jpg`, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.92);
    });
}

// Copies a drawable (video, image, canvas) into a canvas at its own size.
export function snapshotDrawable(drawable, w, h, crop = { left: 0, top: 0, right: 0, bottom: 0 }) {
    const sw = w - crop.left - crop.right;
    const sh = h - crop.top - crop.bottom;
    if (sw <= 0 || sh <= 0) throw new Error('Source has no visible frame');
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(drawable, crop.left, crop.top, sw, sh, 0, 0, sw, sh);
    return canvas;
}

// Runs one job end to end and resolves with the finished clip's URL.
// `onTask` receives the task id as soon as it exists, so it can be resumed.
export async function runMinimaxJob({ mode, prompt, resolution, duration, ratio, frame, sourceVideo, referenceImage }, onStage, onTask = () => {}) {
    const req = { resolution, duration, ratio, prompt };
    if (mode === 'edit') {
        onStage('Uploading source video');
        req.sourceVideo = await uploadToMinimax(sourceVideo);
        if (referenceImage) {
            onStage('Uploading reference image');
            req.referenceImages = [await uploadToMinimax(referenceImage)];
        }
        req.prompt = buildEditPrompt(prompt, !!referenceImage);
    } else if (mode === 'i2v') {
        onStage('Uploading frame');
        req.firstFrame = await uploadToMinimax(frame);
    }
    onStage('Submitting to MiniMax H3');
    const taskId = await submitVideo(req);
    onTask(taskId);
    return waitForVideo(taskId, onStage);
}
