// Coverage for api/_shared/firebase-admin.js — initAdminDb credential resolution.
// firebase-admin/app + firestore mocked; we don't actually init firebase.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const initializeAppMock = vi.fn();
const certMock = vi.fn((arg) => ({ __cert: arg }));
const getAppsMock = vi.fn(() => [] as Array<{ name: string }>);
const settingsMock = vi.fn();
const fakeDb = { settings: settingsMock, __isMock: true };
const getFirestoreMock = vi.fn(() => fakeDb);

vi.mock('firebase-admin/app', () => ({
  initializeApp: initializeAppMock,
  cert: certMock,
  getApps: getAppsMock,
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: getFirestoreMock,
}));

// Silence logger output during tests
vi.mock('../../api/_shared/log.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('api/_shared/firebase-admin — initAdminDb', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    initializeAppMock.mockReset();
    certMock.mockClear();
    getAppsMock.mockReset().mockReturnValue([]);
    settingsMock.mockReset();
    getFirestoreMock.mockReset().mockReturnValue(fakeDb);
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.resetModules();
  });

  it('returns null when no credentials configured', async () => {
    const { initAdminDb } = await import('../../api/_shared/firebase-admin.js');
    expect(initAdminDb()).toBeNull();
    expect(initializeAppMock).not.toHaveBeenCalled();
  });

  it('initializes via individual env vars and returns db', async () => {
    process.env.FIREBASE_PROJECT_ID = 'proj-x';
    process.env.FIREBASE_CLIENT_EMAIL = 'sa@proj-x.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----\n';

    const { initAdminDb } = await import('../../api/_shared/firebase-admin.js');
    const db = initAdminDb('test');

    expect(db).toBe(fakeDb);
    expect(certMock).toHaveBeenCalledTimes(1);
    const certArg = certMock.mock.calls[0][0] as { projectId: string; clientEmail: string; privateKey: string };
    expect(certArg.projectId).toBe('proj-x');
    expect(certArg.clientEmail).toBe('sa@proj-x.iam.gserviceaccount.com');
    expect(certArg.privateKey).toMatch(/-----BEGIN PRIVATE KEY-----/);
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
    expect(settingsMock).toHaveBeenCalledWith({ ignoreUndefinedProperties: true });
  });

  it('reuses existing app when getApps() is non-empty', async () => {
    process.env.FIREBASE_PROJECT_ID = 'proj-x';
    process.env.FIREBASE_CLIENT_EMAIL = 'sa@x.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nXYZ\n-----END PRIVATE KEY-----\n';
    getAppsMock.mockReturnValue([{ name: '[DEFAULT]' }]);

    const { initAdminDb } = await import('../../api/_shared/firebase-admin.js');
    initAdminDb();

    // initializeApp must NOT be called when an app already exists
    expect(initializeAppMock).not.toHaveBeenCalled();
    expect(getFirestoreMock).toHaveBeenCalledWith({ name: '[DEFAULT]' });
  });

  it('normalizes \\n-escaped private key (env var artifact)', async () => {
    process.env.FIREBASE_PROJECT_ID = 'proj-x';
    process.env.FIREBASE_CLIENT_EMAIL = 'sa@x.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n';

    const { initAdminDb } = await import('../../api/_shared/firebase-admin.js');
    initAdminDb();

    const certArg = certMock.mock.calls[0][0] as { privateKey: string };
    // After normalization, escaped \n must become real newlines
    expect(certArg.privateKey).toContain('\n');
    expect(certArg.privateKey).not.toContain('\\n');
  });

  it('falls back to GOOGLE_SERVICE_ACCOUNT_KEY (base64 JSON) when individual vars missing', async () => {
    const sa = { project_id: 'proj-fallback', client_email: 'sa@fb.com', private_key: 'KEY' };
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = Buffer.from(JSON.stringify(sa)).toString('base64');

    const { initAdminDb } = await import('../../api/_shared/firebase-admin.js');
    const db = initAdminDb('fallback-test');

    expect(db).toBe(fakeDb);
    expect(certMock).toHaveBeenCalledTimes(1);
    expect(certMock.mock.calls[0][0]).toEqual(sa);
  });

  it('returns null when GOOGLE_SERVICE_ACCOUNT_KEY base64 fails to parse', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'not-valid-base64-or-json';

    const { initAdminDb } = await import('../../api/_shared/firebase-admin.js');
    const db = initAdminDb();
    // Parse failed → no credential set → returns null
    expect(db).toBeNull();
    expect(initializeAppMock).not.toHaveBeenCalled();
  });

  it('returns null when initializeApp throws', async () => {
    process.env.FIREBASE_PROJECT_ID = 'p';
    process.env.FIREBASE_CLIENT_EMAIL = 'e';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nK\n-----END PRIVATE KEY-----\n';
    initializeAppMock.mockImplementation(() => { throw new Error('init failed'); });

    const { initAdminDb } = await import('../../api/_shared/firebase-admin.js');
    expect(initAdminDb()).toBeNull();
  });
});
