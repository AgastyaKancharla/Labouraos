import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The app is served by Nest at /app (see src/modules/web-app in the API).
 * In development Vite serves /app itself and forwards every other path —
 * /auth, /payments, /targets … — to the Nest API on port 3000.
 */
const API_TARGET = 'http://localhost:3000';

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  server: {
    port: 5173,
    proxy: {
      '^/(?!app(/|$)).*': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
