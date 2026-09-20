import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keep = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT'];
const inherited = Object.fromEntries(keep.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
Object.keys(process.env).forEach((key) => delete process.env[key]);
Object.assign(process.env, inherited, {
  NODE_ENV: 'test',
  PRERENDER: '0',
  VITE_FIREBASE_API_KEY: 'synthetic-charter-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'synthetic-charter.local',
  VITE_FIREBASE_PROJECT_ID: 'synthetic-charter-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'synthetic-charter.local',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:synthetic-charter',
});

const server = await createServer({
  root,
  configFile: false,
  envDir: path.join(root, 'tests', '.empty-env'),
  define: {
    __PRERENDER_BUILD__: 'false',
    __COCOTRIP_BUILD__: JSON.stringify('charter-local-test'),
  },
  resolve: { alias: { '@': path.join(root, 'src') } },
  plugins: [
    {
      name: 'charter-local-pwa-stub',
      resolveId(id) { return id === 'virtual:pwa-register/react' ? '\0charter-local-pwa' : undefined; },
      load(id) {
        if (id !== '\0charter-local-pwa') return undefined;
        return "export function useRegisterSW() { return { needRefresh: [false, () => {}], updateServiceWorker: async () => {} }; }";
      },
    },
    react(),
    {
      name: 'charter-local-api-block',
      configureServer(viteServer) {
        viteServer.middlewares.use((_req, res, next) => {
          res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:4177");
          next();
        });
        viteServer.middlewares.use('/api', (_req, res) => {
          res.statusCode = 418;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'LOCAL_TEST_API_BLOCKED' }));
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 4177, strictPort: true },
});

await server.listen();
process.on('SIGINT', () => void server.close().then(() => process.exit(0)));
process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
