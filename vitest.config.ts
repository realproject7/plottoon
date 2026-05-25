import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environmentMatchGlobs: [['**/src/renderer/**', 'jsdom']],
    // #272: xterm calls `window.matchMedia` at construction time; jsdom
    // does not implement it. Shim once globally so any renderer test
    // that mounts the agent terminal (directly or via App) doesn't crash.
    setupFiles: ['./vitest.setup.ts']
  }
})
