// Server-side relay for the Kling API. The browser calls /api/kling/<path>;
// this adds Kling credentials kept in environment variables and forwards the
// call, so no Kling secret ever reaches the page. Used by the Netlify
// function (netlify/functions/kling.mjs) and by the Vite dev server.
//
// Environment:
//   KLING_API_KEY                      new-style API key, sent as a bearer token
//   KLING_ACCESS_KEY + KLING_SECRET_KEY legacy key pair, signed into a JWT
//   KLING_API_BASE                     default https://api-singapore.klingai.com
//   KLING_PROXY_TOKEN                  passcode the page must send; required
//                                      except for requests from localhost

const DEFAULT_BASE = 'https://api-singapore.klingai.com';

// Only the routes the app uses; anything else is refused.
const ALLOWED = [
    /^\/v1\/images\/generations(\/[\w-]+)?$/,
    /^\/v1\/videos\/image2video(\/[\w-]+)?$/,
    /^\/v1\/videos\/lip-sync(\/[\w-]+)?$/,
    /^\/v1\/videos\/avatar\/image2video(\/[\w-]+)?$/,
];

const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function signJwt(accessKey, secretKey) {
    const now = Math.floor(Date.now() / 1000);
    const enc = new TextEncoder();
    const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const body = b64url(enc.encode(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })));
    const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

async function authHeader(env) {
    if (env.KLING_API_KEY) return `Bearer ${env.KLING_API_KEY}`;
    if (env.KLING_ACCESS_KEY && env.KLING_SECRET_KEY) return `Bearer ${await signJwt(env.KLING_ACCESS_KEY, env.KLING_SECRET_KEY)}`;
    return null;
}

const isLocal = (request) => {
    const host = new URL(request.url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
};

// `path` is the part after /api/kling, e.g. "/v1/videos/lip-sync".
export async function handleKling(request, path, env) {
    const configured = !!(env.KLING_API_KEY || (env.KLING_ACCESS_KEY && env.KLING_SECRET_KEY));
    const tokenSet = !!env.KLING_PROXY_TOKEN;

    if (path === '/status') {
        return json(200, { configured, auth: env.KLING_API_KEY ? 'api_key' : configured ? 'access_key' : null, passcode_required: tokenSet || !isLocal(request) });
    }

    // A deployed relay spends the owner's credits: it must be locked.
    if (tokenSet) {
        if (request.headers.get('x-app-token') !== env.KLING_PROXY_TOKEN) return json(401, { code: 'bad_passcode', message: 'Code d\'accès Kling manquant ou incorrect.' });
    } else if (!isLocal(request)) {
        return json(503, { code: 'proxy_locked', message: 'Relais Kling verrouillé : définis KLING_PROXY_TOKEN dans les variables d\'environnement du site.' });
    }
    if (!configured) return json(503, { code: 'not_configured', message: 'Kling n\'est pas configuré : ajoute KLING_API_KEY (ou KLING_ACCESS_KEY et KLING_SECRET_KEY) aux variables d\'environnement.' });
    if (!ALLOWED.some(re => re.test(path))) return json(404, { code: 'not_allowed', message: `Route Kling non autorisée : ${path}` });
    if (request.method !== 'GET' && request.method !== 'POST') return json(405, { code: 'method', message: 'Méthode non autorisée' });

    const base = (env.KLING_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
    const res = await fetch(`${base}${path}`, {
        method: request.method,
        headers: { Authorization: await authHeader(env), 'Content-Type': 'application/json' },
        body: request.method === 'POST' ? await request.text() : undefined,
    });
    return new Response(await res.text(), {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' },
    });
}
