import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      lib: {
        entry: 'src/main/index.ts'
      },
      rollupOptions: {
        // #272: node-pty is an optionalDependency (native binding may
        // not compile on every CI). Externalize so the bundler doesn't
        // try to resolve it at build time; the runtime loader
        // (`tryLoadNodePty` in terminalSession.ts) handles the
        // missing-binding case gracefully.
        external: ['node-pty']
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: 'src/preload/index.ts',
        formats: ['cjs']
      },
      rollupOptions: {
        output: {
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
