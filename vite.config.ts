import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/Friends-Apartment/',
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 4096,
  },
})
