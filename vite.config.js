import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  optimizeDeps: {
    // Avoid Vite pre-bundling MapLibre's split worker entry (causes blank maps)
    exclude: ['maplibre-gl'],
  },
  worker: {
    format: 'es',
  },
  server: {
    proxy: {
      // OpenSky blocks browser CORS — proxy through Vite in dev
      '/api/opensky': {
        target: 'https://opensky-network.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/opensky/, '/api'),
      },
    },
  },
})
