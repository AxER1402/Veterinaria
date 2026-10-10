import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, /api se manda al gateway (certificado autofirmado en local).
    proxy: {
      '/api': { target: process.env.API_PROXY || 'https://localhost:8443', changeOrigin: true, secure: false },
    },
  },
})
