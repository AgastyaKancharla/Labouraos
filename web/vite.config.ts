import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The app is served by Nest at the site root (app.laboura.com/ceo …; see
 * src/modules/web-app in the API). In development Vite does the same: a page
 * the browser opens (Accept: text/html) under one of the app's roots gets the
 * app, and every other request — the API calls (/auth, /payments, /ceo/…),
 * which ask for JSON — goes to the Nest API on port 3000. Keep WEB_ROOTS in
 * step with the server's WEB_APP_ROOTS.
 */
const API_TARGET = 'http://localhost:3000';
const WEB_ROOTS = ['login', 'ceo', 'manager', 'team-lead', 'finance', 'call-agent', 'p', 'field-app'];

function isAppPage(url: string | undefined, accept: string | undefined): boolean {
  if (!accept?.includes('text/html')) return false;
  const path = (url ?? '/').split('?')[0];
  return path === '/' || WEB_ROOTS.includes(path.replace(/^\/+/, '').split('/')[0]);
}

export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  server: {
    port: 5173,
    proxy: {
      // Everything except Vite's own files (/@vite, /src, /node_modules, /@fs …) and the public icons.
      '^/(?!@|src/|node_modules/|favicon\\.png|logo-mark\\.png).*': {
        target: API_TARGET,
        changeOrigin: false,
        bypass: (req) => (isAppPage(req.url, req.headers.accept) ? '/index.html' : undefined),
      },
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
