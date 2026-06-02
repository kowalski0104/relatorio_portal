import { defineConfig } from 'vite'
import { execFileSync } from 'child_process'
import path from 'path'
import react from '@vitejs/plugin-react'

function gitRevision() {
  const candidates = [
    process.env.GIT_BINARY,
    'git',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe') : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Git', 'cmd', 'git.exe') : null,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      return execFileSync(candidate, ['rev-parse', '--short=8', 'HEAD'], {
        cwd: path.resolve(__dirname, '..'),
        encoding: 'utf8',
      }).trim()
    } catch {
      // Tenta o próximo caminho conhecido.
    }
  }

  return 'sem-commit'
}

const appVersion = process.env.VITE_APP_VERSION?.trim() || gitRevision()
const deployedAt = process.env.VITE_DEPLOYED_AT?.trim() || new Date().toISOString()

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
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_DEPLOYED_AT__: JSON.stringify(deployedAt),
  },
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
