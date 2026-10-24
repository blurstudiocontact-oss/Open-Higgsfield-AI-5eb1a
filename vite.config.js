import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        tailwindcss(),
    ],
    server: {
        proxy: {
            // MiniMax API and its result CDN, to avoid CORS during development.
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
