import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { handleKling } from './server/kling-proxy.mjs';

// Serves /api/kling/* during `npm run dev` with the same relay the Netlify
// function uses; KLING_* keys come from a local .env file.
function klingDevProxy(env) {
    return {
        name: 'kling-dev-proxy',
        configureServer(server) {
            server.middlewares.use('/api/kling', async (req, res) => {
                const chunks = [];
                for await (const c of req) chunks.push(c);
                const url = `http://${req.headers.host}${req.originalUrl}`;
                const request = new Request(url, {
                    method: req.method,
                    headers: req.headers,
                    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
                });
                try {
                    const out = await handleKling(request, req.url.split('?')[0], env);
                    res.statusCode = out.status;
                    out.headers.forEach((v, k) => res.setHeader(k, v));
                    res.end(Buffer.from(await out.arrayBuffer()));
                } catch (err) {
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ code: 'proxy_error', message: String(err.message || err) }));
                }
            });
        },
    };
}

export default defineConfig(({ mode }) => ({
    plugins: [
        tailwindcss(),
        klingDevProxy(loadEnv(mode, process.cwd(), 'KLING_')),
    ],
}));
