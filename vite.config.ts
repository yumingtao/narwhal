/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        preview: resolve(__dirname, 'src/renderer/preview.html'),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    open: '/preview.html',
  },
  test: {
    // Tests are pure-logic specs under src/ (shared + main); the renderer
    // root above is only for the app build.
    root: __dirname,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
})
