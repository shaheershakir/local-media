import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Electron production loads index.html from disk; relative assets keep that working.
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // Support streaming / chunked transfer for video
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward Range headers for video seeking
            if (req.headers.range) {
              proxyReq.setHeader('range', req.headers.range)
            }
          })
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
