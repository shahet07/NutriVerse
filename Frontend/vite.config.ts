import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig(({ mode }) => ({
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
      '/process': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/search': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/health': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/chat': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/chef/': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/config': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/ws/kitchen': {
        target: 'wss://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
        ws: true,
      },
      '/ws/chef-voice': {
        target: 'wss://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
        ws: true,
      },
      '/auth': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/users': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/api': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/report': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
      '/ai-feedback': {
        target: 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
        changeOrigin: true,
      },
    },
  },
}))
