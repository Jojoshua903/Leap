/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

/** First non-internal IPv4 address, so the QR code points phones at this machine on the LAN. */
function lanIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

const root = fileURLToPath(new URL('.', import.meta.url));

/** joy-con-webhid 0.6.x imports a file it doesn't publish; send that import to a stub (Ring-Con is unused). */
const ringConStub = `${root}src/input/ringConStub.js`;
const isMissingRingCon = (source: string, importer?: string): boolean =>
  source.endsWith('connectRingCon.js') && !!importer?.includes('joy-con-webhid');
const ringConFix: Plugin = {
  name: 'joycon-ringcon-stub',
  enforce: 'pre',
  resolveId: (source, importer) => (isMissingRingCon(source, importer) ? ringConStub : null)
};

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [ringConFix, basicSsl()],
  define: { __LAN_IP__: JSON.stringify(lanIp()) },
  server: {
    host: true,
    port: 5173,
    // The phone page is HTTPS, so it can't open ws:// directly. Vite proxies wss://host:5173/signal to the Node server.
    proxy: { '/signal': { target: 'ws://localhost:8787', ws: true } }
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
    // The dev pre-bundler runs esbuild directly and doesn't see Vite plugins, so it needs the same redirect.
    esbuildOptions: {
      plugins: [{
        name: 'joycon-ringcon-stub',
        setup(b) {
          b.onResolve({ filter: /connectRingCon\.js$/ }, a => (isMissingRingCon(a.path, a.importer) ? { path: ringConStub } : undefined));
        }
      }]
    }
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: `${root}index.html`, phone: `${root}phone.html` } }
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
});
