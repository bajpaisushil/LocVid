/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Hosts the app may contact besides its own origin. These are only used for
 * optional, user-initiated AI model downloads (Hugging Face model hub + its CDN).
 * Everything else — media, projects, rendering, export — never leaves the device.
 */
const MODEL_HOSTS = ['https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co']

/**
 * Injects a Content-Security-Policy into production builds. It enforces the
 * local-first promise at the browser level: scripts, workers and network
 * requests are restricted to the app's own origin, blob/data URLs, and the
 * model hosts above. (Dev mode is excluded because Vite's HMR uses inline scripts.)
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' blob: data: ${MODEL_HOSTS.join(' ')}`,
    "img-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
  return {
    name: 'locvid-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      )
    },
  }
}

export default defineConfig({
  // Relative base so the static build works from any sub-path (e.g. GitHub Pages).
  base: process.env.VITE_BASE ?? './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // FFmpeg.wasm spawns its own worker via `new URL(..., import.meta.url)`,
    // which breaks if Vite pre-bundles it.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
