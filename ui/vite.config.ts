import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const host = process.env.TAURI_DEV_HOST

// https://tauri.app/develop/#frontend
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },

  // Tauri expects a fixed port, fails if occupied.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: {
      // Don't watch the Rust side, Tauri handles that.
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // All three WebViews Tauri targets (WebView2, WKWebView, WebKitGTK) are
    // evergreen enough for a modern baseline - no need to downlevel for
    // Safari 13, which was causing esbuild destructuring-transform failures.
    target: 'es2022',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        // Vite 8 runs on Rolldown, whose chunking knob is `advancedChunks`
        // (not Rollup's `manualChunks`). Splitting these out gives stable
        // vendor chunks so a source edit doesn't invalidate the whole
        // eager bundle for HTTP caching.
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules\/(react|react-dom)\// },
            { name: 'radix', test: /node_modules\/@radix-ui\// },
            { name: 'markdown', test: /node_modules\/(react-markdown|remark-gfm|unified|micromark|mdast|hast|unist|vfile|bail|trough|property-information|space-separated-tokens|comma-separated-tokens|hast-util|mdast-util|remark|rehype)/ },
          ],
        },
      },
    },
  },
})
