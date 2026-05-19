import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Mantem ngrok liberado para links temporarios e dominios futuros.
    allowedHosts: [
      'cornea-arise-vocation.ngrok-free.dev',
      '.ngrok-free.dev',
      '.ngrok.io',
      '.ngrok-free.app',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          if (!normalizedId.includes('/node_modules/')) return undefined;
          if (normalizedId.includes('/lucide-react/')) return 'icons';
          if (normalizedId.includes('/recharts/')) return 'charts';
          if (
            normalizedId.includes('/d3-') ||
            normalizedId.includes('/lodash/') ||
            normalizedId.includes('/react-smooth/') ||
            normalizedId.includes('/react-transition-group/') ||
            normalizedId.includes('/recharts-scale/') ||
            normalizedId.includes('/victory-vendor/')
          ) return 'chart-vendor';
          if (
            normalizedId.includes('/react/') ||
            normalizedId.includes('/react-dom/') ||
            normalizedId.includes('/scheduler/')
          ) return 'react-vendor';

          return 'vendor';
        },
      },
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
