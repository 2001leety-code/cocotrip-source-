import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const h = vi.hoisted(() => ({ apps: [] as Array<{ name: string; options: { projectId?: string; credential?: { projectId: string; clientEmail: string; privateKey: string } } }>, cert: vi.fn(), init: vi.fn(), db: { projectId: 'cocotrip-preview-2026', settings: vi.fn() }, firestore: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: () => h.apps, cert: h.cert, initializeApp: h.init }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: h.firestore }));
vi.mock('../../api/_shared/log.js', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
const project = 'cocotrip-preview-2026';
const credential = () => ({ projectId: project, clientEmail: `test@${project}.iam.gserviceaccount.com`, privateKey: 'FAKE-KEY' });
const load = () => import('../../api/_shared/firebase-admin.js');
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('FIREBASE_ENV_GUARD', 'warn');
  vi.stubEnv('FIREBASE_PROJECT_ID', project); vi.stubEnv('FIREBASE_PRODUCTION_PROJECT_ID', 'planning-with-ai-a0801');
  vi.stubEnv('FIREBASE_CLIENT_EMAIL', credential().clientEmail); vi.stubEnv('FIREBASE_PRIVATE_KEY', 'FAKE-KEY');
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', '');
  for (const key of ['FIREBASE_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) vi.stubEnv(key, '');
  h.apps=[]; h.db.projectId=project; h.db.settings.mockReset();
  h.cert.mockReset().mockImplementation((c) => c);
  h.init.mockReset().mockImplementation((options) => ({ name:'[DEFAULT]', options }));
  h.firestore.mockReset().mockReturnValue(h.db);
});
afterEach(() => vi.unstubAllEnvs());
describe('Preview actual Firebase isolation', () => {
  it('pins explicit project and verifies actual db, with repeated access without reinitialization', async () => {
    const m=await load(); for(let n=0;n<5;n++) expect(m.initAdminDb()).toBe(h.db);
    expect(m.initAdminApp()?.options.projectId).toBe(project);
    expect(m.previewFirebaseState()).toEqual({isolated:true,projectId:project});
    expect(h.init).toHaveBeenCalledTimes(1); expect(h.firestore).toHaveBeenCalledTimes(1);
  });
  it.each(['', 'planning-with-ai-a0801', 'wrong-preview'])('blocks configured target %s before cert or connection', async target => {
    vi.stubEnv('FIREBASE_PROJECT_ID',target); const m=await load(); expect(m.initAdminDb()).toBeNull();
    expect(h.cert).not.toHaveBeenCalled(); expect(h.firestore).not.toHaveBeenCalled();
  });
  it('blocks production service account disguised with preview project', async () => {
    vi.stubEnv('FIREBASE_CLIENT_EMAIL','test@planning-with-ai-a0801.iam.gserviceaccount.com');
    expect((await load()).initAdminDb()).toBeNull(); expect(h.cert).not.toHaveBeenCalled();
  });
  it('validates fallback service account and pins project', async () => {
    vi.stubEnv('FIREBASE_PRIVATE_KEY',''); const c=credential();
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY',Buffer.from(JSON.stringify({project_id:c.projectId,client_email:c.clientEmail,private_key:c.privateKey})).toString('base64'));
    expect((await load()).initAdminDb()).toBe(h.db);
  });
  it.each(['planning-with-ai-a0801','other-preview',''])('rejects fallback target %s before initialization',async target => {
    vi.stubEnv('FIREBASE_PRIVATE_KEY',''); vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY',Buffer.from(JSON.stringify({...credential(),projectId:target})).toString('base64'));
    expect((await load()).initAdminDb()).toBeNull(); expect(h.init).not.toHaveBeenCalled();
  });
  it('rejects malformed fallback without leaking parsed material', async () => {
    vi.stubEnv('FIREBASE_PRIVATE_KEY','');vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY','bad');
    expect((await load()).initAdminApp()).toBeNull();expect(h.init).not.toHaveBeenCalled();
  });
  it('does not downgrade invalid primary credentials to a fallback',async () => {
    h.cert.mockImplementation(()=>{throw new Error('invalid private material');});
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY',Buffer.from(JSON.stringify(credential())).toString('base64'));
    expect((await load()).initAdminApp()).toBeNull(); expect(h.cert).toHaveBeenCalledTimes(1);
  });
  it('validates a reused default app rather than trusting the first app', async () => {
    h.apps=[{name:'other',options:{projectId:'production'}},{name:'[DEFAULT]',options:{projectId:project,credential:credential()}}];
    expect((await load()).initAdminDb()).toBe(h.db); expect(h.init).not.toHaveBeenCalled();
  });
  it.each(['project','credential','missing'])('blocks reused app %s mismatch before Firestore',async mode => {
    h.apps=[{name:'[DEFAULT]',options:mode==='missing'?{}:{projectId:mode==='project'?'production':project,credential:{...credential(),projectId:mode==='credential'?'production':project}}}];
    expect((await load()).initAdminDb()).toBeNull();expect(h.firestore).not.toHaveBeenCalled();
  });
  it('blocks actual database mismatch and never publishes an app or db',async () => {
    h.db.projectId='planning-with-ai-a0801';const m=await load();expect(m.initAdminDb()).toBeNull();expect(m.initAdminApp()).toBeNull();
    expect(m.previewFirebaseState()).toEqual({isolated:false,projectId:null});expect(h.db.settings).not.toHaveBeenCalled();
  });
  it.each(['FIREBASE_EMULATOR_HOST','FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])('blocks unexpected %s', async key=>{
    vi.stubEnv(key,'remote:8080');expect((await load()).initAdminDb()).toBeNull();expect(h.init).not.toHaveBeenCalled();
  });
  it('fails closed when database settings fail, including repeat accesses',async()=>{
    h.db.settings.mockImplementation(()=>{throw new Error('already initialized');});const m=await load();
    for(let n=0;n<3;n++){expect(m.initAdminDb()).toBeNull();expect(m.initAdminApp()).toBeNull();}
  });
  it('retains production initialization behavior',async()=>{
    vi.stubEnv('VERCEL_ENV','production');vi.stubEnv('FIREBASE_PROJECT_ID','planning-with-ai-a0801');
    expect((await load()).initAdminDb()).toBe(h.db);expect(h.init.mock.calls[0][0]).not.toHaveProperty('projectId');
  });
});
