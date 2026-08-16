import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST

// https://tauri.app/develop/#frontend
export default defineConfig({
  plugins: [react(), tailwindcss()],

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
  },
})
