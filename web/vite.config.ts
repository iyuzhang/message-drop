import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const port = Number(process.env.VITE_DEV_PORT || process.env.PORT || '5173')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Keep output compatible with older Android WebView engines.
    target: 'es2019',
  },
  server: {
    port,
    strictPort: true,
  },
})
