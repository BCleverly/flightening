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
})
