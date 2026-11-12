import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Real installed SDK, isolated child process, generated in-memory key only.
// Every network transport fails closed. No project credential or token is read.
describe('Preview Firebase real SDK offline smoke', () => {
  it('supports the inspected credential fields and actual Firestore project ID without networking', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const source = `
      import { createRequire, syncBuiltinESMExports } from 'node:module';
      import { generateKeyPairSync } from 'node:crypto';
      const require = createRequire(import.meta.url);
      let networkCalls = 0;
      const denied = () => { networkCalls++; throw new Error('OFFLINE_TEST_NETWORK_DENIED'); };
      for (const name of ['node:http', 'node:https']) {
        const transport = require(name);
        transport.request = denied;
        transport.get = denied;
      }
      const net = require('node:net');
      net.connect = denied;
      net.createConnection = denied;
      net.Socket.prototype.connect = denied;
      require('node:tls').connect = denied;
      globalThis.fetch = denied;
      syncBuiltinESMExports();
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      process.env.FIREBASE_PRIVATE_KEY = privateKey.export({type:'pkcs8',format:'pem'});
      const m = await import('./api/_shared/firebase-admin.js');
      const app = m.initAdminApp();
      const db = m.initAdminDb();
      const result = {
        projectId: db && db.projectId,
        credentialProject: app && app.options.credential.projectId,
        credentialEmailMatches: !!app && app.options.credential.clientEmail === process.env.FIREBASE_CLIENT_EMAIL,
        repeatedAccessSameDb: m.initAdminDb() === db,
        state: m.previewFirebaseState(),
        networkCalls,
      };
      if (app) await (await import('firebase-admin/app')).deleteApp(app);
      console.log('OFFLINE_RESULT=' + JSON.stringify(result));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: root,
      timeout: 20000,
      encoding: 'utf8',
      env: {
        SystemRoot: process.env.SystemRoot || '',
        PATH: process.env.PATH || '',
        TEMP: process.env.TEMP || '',
        NODE_ENV: 'test',
        VERCEL_ENV: 'preview',
        FIREBASE_PROJECT_ID: 'cocotrip-preview-2026',
        FIREBASE_PRODUCTION_PROJECT_ID: 'planning-with-ai-a0801',
        FIREBASE_CLIENT_EMAIL: 'offline-smoke@cocotrip-preview-2026.iam.gserviceaccount.com',
      },
    });
    const line = output.split(/\r?\n/).find((value) => value.startsWith('OFFLINE_RESULT='));
    expect(line).toBeDefined();
    expect(JSON.parse((line || '').slice('OFFLINE_RESULT='.length))).toEqual({
      projectId: 'cocotrip-preview-2026',
      credentialProject: 'cocotrip-preview-2026',
      credentialEmailMatches: true,
      repeatedAccessSameDb: true,
      state: { isolated: true, projectId: 'cocotrip-preview-2026' },
      networkCalls: 0,
    });
  });
});
