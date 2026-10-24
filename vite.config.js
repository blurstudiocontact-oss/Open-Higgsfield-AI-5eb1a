import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        tailwindcss(),
    ],
    server: {
        proxy: {
            '/api': {
                target: 'https://api.muapi.ai',
                changeOrigin: true,
                secure: false
            },
            // MiniMax API and its result CDN, for the OBS page's H3 integration.
            '/minimax-api': {
                target: 'https://api.minimax.io',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/minimax-api/, '')
            },
            '/minimax-cdn': {
                target: 'https://video-product.cdn.minimax.io',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/minimax-cdn/, '')
            }
        }
    }
});
