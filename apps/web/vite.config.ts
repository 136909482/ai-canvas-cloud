import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    target: 'chrome120',
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')

          if (normalizedId.includes('/src/components/Toolbar.tsx')) {
            return 'app-toolbar'
          }

          if (!normalizedId.includes('node_modules')) {
            return undefined
          }

          if (normalizedId.includes('/react/') || normalizedId.includes('/react-dom/') || normalizedId.includes('/scheduler/')) {
            return 'vendor-react'
          }

          if (normalizedId.includes('/@xyflow/')) {
            return 'vendor-flow'
          }

          if (
            normalizedId.includes('/@tiptap/')
            || normalizedId.includes('/prosemirror-')
            || normalizedId.includes('/orderedmap/')
            || normalizedId.includes('/rope-sequence/')
          ) {
            return 'vendor-editor'
          }

          if (normalizedId.includes('/three/')) {
            return 'vendor-three'
          }

          if (normalizedId.includes('/@photo-sphere-viewer/')) {
            return 'vendor-panorama'
          }

          if (normalizedId.includes('/lucide-react/')) {
            return 'vendor-icons'
          }

          if (normalizedId.includes('/zustand/')) {
            return 'vendor-state'
          }

          return 'vendor'
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
