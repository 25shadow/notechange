import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    define: {
      __NOTECHANGE_LICENSE_SERVER_URL__: JSON.stringify(process.env.NOTECHANGE_LICENSE_SERVER_URL ?? ''),
      __NOTECHANGE_LICENSE_PUBLIC_KEY__: JSON.stringify(process.env.NOTECHANGE_LICENSE_PUBLIC_KEY ?? '')
      , __NOTECHANGE_UPDATE_URL__: JSON.stringify(process.env.NOTECHANGE_UPDATE_URL ?? '')
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/main/preload.ts'),
        output: {
          entryFileNames: 'index.js'
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()]
  }
});
