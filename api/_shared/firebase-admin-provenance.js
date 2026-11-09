// Pure validation + in-memory provenance registry. No SDK imports, no I/O.
// Registration APIs are for trusted internal callsites only (direct cert()/initializeApp results).

const _credentials = new WeakMap(); // credential -> { projectId, source }
const _apps = new WeakMap(); // app -> { credential, projectId }

const isObj = (x) => x !== null && (typeof x === 'object' || typeof x === 'function');
const clean = (s) => (typeof s === 'string' ? s.trim() : '');
const liveCredProject = (credential) => {
  try {
    const p = credential.projectId;
    return typeof p === 'string' ? p : null;
  } catch (_e) {
    return null;
  }
};

export function validatePreviewProjectConfig(env = {}) {
  if (env.VERCEL_ENV !== 'preview') return { ok: false, reason: 'not-preview' };
  const projectId = clean(env.FIREBASE_PROJECT_ID);
  const prod = clean(env.FIREBASE_PRODUCTION_PROJECT_ID);
  if (!projectId) return { ok: false, reason: 'project-id-missing' };
  if (!prod) return { ok: false, reason: 'production-project-id-missing' };
  if (projectId === prod) return { ok: false, reason: 'preview-on-production-project' };
  return { ok: true, projectId };
}

export function validateServiceAccountProject(saProjectId, expected) {
  const p = clean(saProjectId);
  if (!p) return { ok: false, reason: 'sa-project-missing' };
  if (!clean(expected) || p !== expected) return { ok: false, reason: 'sa-project-mismatch' };
  return { ok: true };
}

export function registerCertCredential(credential, { projectId, source } = {}) {
  if (!isObj(credential)) throw new Error('provenance: invalid credential');
  if (typeof projectId !== 'string' || !clean(projectId)) throw new Error('provenance: projectId required');
  if (liveCredProject(credential) !== projectId) throw new Error('provenance: credential project mismatch');
  const existing = _credentials.get(credential);
  if (existing) {
    if (existing.projectId === projectId) return;
    throw new Error('provenance: credential registered for different project');
  }
  _credentials.set(credential, Object.freeze({ projectId, source: clean(source) || 'unknown' }));
}

export function registerCreatedApp(app, { credential, projectId } = {}) {
  if (!isObj(app)) throw new Error('provenance: invalid app');
  const c = _credentials.get(credential);
  if (!c || c.projectId !== projectId) throw new Error('provenance: credential not registered for project');
  if (liveCredProject(credential) !== projectId) throw new Error('provenance: credential project mismatch');
  let o;
  try { o = app.options || {}; } catch (_e) { throw new Error('provenance: app options unreadable'); }
  if (o.credential !== credential || o.projectId !== projectId) throw new Error('provenance: app options mismatch');
  const existing = _apps.get(app);
  if (existing) {
    if (existing.credential === credential && existing.projectId === projectId) return;
    throw new Error('provenance: app registered with different binding');
  }
  _apps.set(app, Object.freeze({ credential, projectId }));
}

export function verifyPreviewApp(app, expected) {
  if (!isObj(app)) return { ok: false, reason: 'app-invalid' };
  const rec = _apps.get(app);
  if (!rec) return { ok: false, reason: 'app-unregistered' };
  if (!clean(expected) || rec.projectId !== expected) return { ok: false, reason: 'app-project-mismatch' };
  let o;
  try { o = app.options || {}; } catch (_e) { return { ok: false, reason: 'app-options-unreadable' }; }
  if (o.credential !== rec.credential) return { ok: false, reason: 'app-credential-changed' };
  if (o.projectId !== expected) return { ok: false, reason: 'app-options-project-mismatch' };
  const c = _credentials.get(rec.credential);
  if (!c) return { ok: false, reason: 'credential-unregistered' };
  if (c.projectId !== expected) return { ok: false, reason: 'credential-project-mismatch' };
  if (liveCredProject(rec.credential) !== expected) return { ok: false, reason: 'credential-live-project-mismatch' };
  return { ok: true };
}


