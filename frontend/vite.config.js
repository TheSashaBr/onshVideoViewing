import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Expose to local network for phones and other devices
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
