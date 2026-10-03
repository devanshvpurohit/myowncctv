import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Inline small assets so the build is truly a self-contained set of static files
    assetsInlineLimit: 4096,
  },
  // Dev-only proxy — uncomment when developing while connected to the ESP32 AP
  // server: {
  //   proxy: {
  //     '/stream':   { target: 'http://192.168.4.1', changeOrigin: true },
  //     '/snapshot': { target: 'http://192.168.4.1', changeOrigin: true },
  //     '/flash':    { target: 'http://192.168.4.1', changeOrigin: true },
  //   },
  // },
})
