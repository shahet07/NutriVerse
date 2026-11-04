import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const HTTP_API_PATHS = [
  '/process', '/search', '/health', '/chat', '/chef/', '/config',
  '/auth', '/users', '/api', '/report', '/ai-feedback',
]

export default defineConfig(({ mode }) => {
  // Local backend by default, so development never touches production data.
  const target = loadEnv(mode, '..', '').VITE_PROXY_TARGET || 'http://localhost:8000'
  const httpProxy = {
    target,
    changeOrigin: true,
    // /search is both an API path and a page: a browser navigation gets the app.
    bypass: (req: { headers: { accept?: string } }) =>
      req.headers.accept?.includes('text/html') ? '/index.html' : undefined,
  }
  const wsProxy = { target, changeOrigin: true, ws: true }

  return {
  // Electron loads the SPA via file:// — needs relative asset paths ('./').
  // Azure serves the same SPA at nested routes like /chef-remote (for the
  // phone QR) — needs absolute asset paths ('/') so that nested routes
  // resolve /assets/... correctly. The Dockerfile sets VITE_BASE=/ to
  // switch into server mode; local `npm run build` keeps the Electron default.
  base: process.env.VITE_BASE ?? (mode === 'production' ? './' : '/'),
  // Centralize env in project-root .env
  envDir: '..',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
          dest: './',
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx',
          dest: './',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: './',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      ...Object.fromEntries(HTTP_API_PATHS.map((p) => [p, httpProxy])),
      '/ws/kitchen': wsProxy,
      '/ws/chef-voice': wsProxy,
    },
  },
  }
})
