// MiniMax model catalog, in the shape the studio pages read: each model has
// an `id`, a display `name` and an `inputs` schema whose enums drive the
// aspect ratio, duration and resolution pickers.

const IMAGE_RATIOS = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'];
const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const VIDEO_INPUTS = {
    prompt: { type: 'string', title: 'Prompt', name: 'prompt', description: 'Scene, action, camera and sound.' },
    duration: { type: 'int', title: 'Duration', name: 'duration', enum: [5, 10, 15], default: 5 },
    resolution: { type: 'string', title: 'Resolution', name: 'resolution', enum: ['768P', '2K'], default: '768P' },
};

// ==========================================
// Text-to-Image Models
// ==========================================
export const t2iModels = [
    {
        id: 'minimax-image-01',
        name: 'MiniMax Image-01',
        apiModel: 'image-01',
        inputs: {
            prompt: { type: 'string', title: 'Prompt', name: 'prompt', description: 'Up to 1500 characters.' },
            aspect_ratio: { type: 'string', title: 'Aspect Ratio', name: 'aspect_ratio', enum: IMAGE_RATIOS, default: '1:1' },
        },
    },
];

export const getModelById = (id) => t2iModels.find(m => m.id === id);

export const getAspectRatiosForModel = (modelId) => getModelById(modelId)?.inputs?.aspect_ratio?.enum || ['1:1'];

// ==========================================
// Text-to-Video Models
// ==========================================
export const t2vModels = [
    {
        id: 'minimax-h3',
        name: 'MiniMax H3',
        inputs: {
            ...VIDEO_INPUTS,
            aspect_ratio: { type: 'string', title: 'Aspect Ratio', name: 'aspect_ratio', enum: VIDEO_RATIOS, default: '16:9' },
        },
    },
];

export const getVideoModelById = (id) => t2vModels.find(m => m.id === id);

export const getAspectRatiosForVideoModel = (modelId) => getVideoModelById(modelId)?.inputs?.aspect_ratio?.enum || ['16:9'];

export const getDurationsForModel = (modelId) => getVideoModelById(modelId)?.inputs?.duration?.enum || [];

export const getResolutionsForVideoModel = (modelId) => getVideoModelById(modelId)?.inputs?.resolution?.enum || [];

// ==========================================
// Image-to-Image Models (subject reference)
// ==========================================
export const i2iModels = [
    {
        id: 'minimax-image-01-subject',
        name: 'MiniMax Image-01 Subject Reference',
        apiModel: 'image-01',
        family: 'minimax',
        hasPrompt: true,
        maxImages: 1,
        inputs: {
            prompt: { type: 'string', title: 'Prompt', name: 'prompt', description: 'Describe a new scene for the person in the reference portrait.' },
            aspect_ratio: { type: 'string', title: 'Aspect Ratio', name: 'aspect_ratio', enum: IMAGE_RATIOS, default: '1:1' },
        },
    },
    {
        id: 'minimax-image-01-live',
        name: 'MiniMax Image-01 Live',
        apiModel: 'image-01-live',
        family: 'minimax',
        hasPrompt: true,
        maxImages: 1,
        inputs: {
            prompt: { type: 'string', title: 'Prompt', name: 'prompt', description: 'Describe a new scene for the person in the reference portrait.' },
            aspect_ratio: { type: 'string', title: 'Aspect Ratio', name: 'aspect_ratio', enum: IMAGE_RATIOS, default: '1:1' },
        },
    },
];

// ==========================================
// Image-to-Video Models
// ==========================================
export const i2vModels = [
    {
        id: 'minimax-h3-i2v',
        name: 'MiniMax H3 (first frame)',
        family: 'minimax-h3',
        imageField: 'image_url',
        hasPrompt: true,
        inputs: {
            ...VIDEO_INPUTS,
            aspect_ratio: { type: 'string', title: 'Aspect Ratio', name: 'aspect_ratio', enum: ['adaptive', ...VIDEO_RATIOS], default: 'adaptive' },
        },
    },
];

export const getI2IModelById = (id) => i2iModels.find(m => m.id === id);
export const getI2VModelById = (id) => i2vModels.find(m => m.id === id);

export const getAspectRatiosForI2IModel = (modelId) => getI2IModelById(modelId)?.inputs?.aspect_ratio?.enum || ['1:1'];

export const getAspectRatiosForI2VModel = (modelId) => getI2VModelById(modelId)?.inputs?.aspect_ratio?.enum || ['adaptive'];

export const getDurationsForI2VModel = (modelId) => getI2VModelById(modelId)?.inputs?.duration?.enum || [];

export const getResolutionsForI2VModel = (modelId) => getI2VModelById(modelId)?.inputs?.resolution?.enum || [];

// image-01 has no quality or resolution setting.
export const getResolutionsForI2IModel = () => [];
export const getQualityFieldForModel = () => null;
export const getResolutionsForModel = () => [];
export const getQualityFieldForI2IModel = () => null;

export const getMaxImagesForI2IModel = (modelId) => getI2IModelById(modelId)?.maxImages || 1;
