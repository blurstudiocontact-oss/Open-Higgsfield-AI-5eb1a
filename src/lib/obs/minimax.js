// Minimax Hailuo 2.3 video generation for the OBS page, through Muapi.
// "Reanimate" takes a still frame from the studio (program, preview, a
// source or a recording) and turns it into a clip with an image-to-video
// model; "Generate" makes a clip from a prompt alone.

import { muapi } from '../muapi.js';
import { i2vModels, t2vModels } from '../models.js';

const isHailuo23 = (m) => m.id.startsWith('minimax-hailuo-2.3');

export const MINIMAX_MODELS = {
    i2v: i2vModels.filter(isHailuo23),
    t2v: t2vModels.filter(isHailuo23),
};

export function modelOptions(mode, id) {
    const model = MINIMAX_MODELS[mode].find(m => m.id === id);
    return {
        durations: model?.inputs?.duration?.enum || [],
        defaultDuration: model?.inputs?.duration?.default,
        resolutions: model?.inputs?.resolution?.enum || [],
    };
}

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

// Runs one generation and reports progress through onStage(label).
export async function runMinimaxJob({ mode, model, prompt, duration, resolution, frame }, onStage) {
    const params = { model, prompt };
    if (duration) params.duration = duration;
    if (resolution) params.resolution = resolution;
    let res;
    if (mode === 'i2v') {
        onStage('Uploading frame');
        params.image_url = await muapi.uploadFile(frame);
        onStage('Generating with Hailuo 2.3');
        res = await muapi.generateI2V(params);
    } else {
        onStage('Generating with Hailuo 2.3');
        res = await muapi.generateVideo(params);
    }
    if (!res?.url) throw new Error('No video URL returned by the API');
    return res.url;
}
