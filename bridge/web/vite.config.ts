import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // Relative asset URLs resolve against <base href> in index.html, so the panel also works
  // when a proxy mounts it under a sub-path (src/lib/basePath.ts).
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 9821,
    proxy: {
      '/api': {
        target: 'http://localhost:9820',
        changeOrigin: true,
        timeout: 45000,
      },
      '/bridge': {
        target: 'http://localhost:9810',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
