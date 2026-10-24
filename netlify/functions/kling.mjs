// Netlify Function: /api/kling/* → Kling API with server-held credentials.
import { handleKling } from '../../server/kling-proxy.mjs';

export default async (request) => {
    const path = new URL(request.url).pathname.replace(/^\/api\/kling/, '') || '/';
    return handleKling(request, path, process.env);
};

export const config = { path: '/api/kling/*' };
