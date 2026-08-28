/**
 * GET/POST /api/mood-quote-profiles — 관리자 전용 업체별 차량 견적 프로필.
 *
 * 기존 MOOD 예약 가격/잔액과 분리된 견적서 설정이다. 각 저장은 current 문서와
 * versions 하위 문서, 전역 audit 문서를 같은 Firestore transaction 에 기록한다.
 */
import { randomUUID } from 'node:crypto';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';
import {
  BUILT_IN_MOOD_QUOTE_PROFILE,
  normalizeVehicleQuoteProfile,
} from './_shared/vehicle-quote.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const METHODS = 'GET, POST, OPTIONS';
const COLLECTION = 'mood_quote_profiles';
const AUDIT_COLLECTION = 'mood_quote_profile_audit';
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,49}$/;

function jsonHeaders(req) {
  return {
    'Cache-Control': 'no-store',
    ...buildAdminJsonCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' }),
  };
}

function send(res, status, headers, payload) {
  res.writeHead(status, headers);
  return res.end(JSON.stringify(payload));
}

function parseBody(req) {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return body && typeof body === 'object' ? body : {};
}

function generatedProfileId() {
  return `company-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function versionDocId(version) {
  return `v${String(version).padStart(6, '0')}`;
}

function expectedVersionInput(body) {
  const provided = Object.prototype.hasOwnProperty.call(body, 'expectedVersion');
  if (!provided) return { ok: true, provided: false, value: null };
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
    return { ok: false, provided: true, value: null, error: 'INVALID_EXPECTED_VERSION' };
  }
  return { ok: true, provided: true, value: body.expectedVersion };
}

function normalizePersistedProfile(profileId, data) {
  const normalized = normalizeVehicleQuoteProfile({ ...data, id: profileId }, {
    fallback: profileId === BUILT_IN_MOOD_QUOTE_PROFILE.id
      ? BUILT_IN_MOOD_QUOTE_PROFILE
      : data,
  });
  if (!normalized.ok) return { ok: false, error: normalized.error };

  if (Object.prototype.hasOwnProperty.call(data, 'currentVersion')
    && (!Number.isSafeInteger(data.currentVersion)
      || data.currentVersion !== normalized.profile.version)) {
    return { ok: false, error: 'INVALID_CURRENT_VERSION' };
  }
  return normalized;
}

function auditProfileState(profile) {
  return {
    id: profile.id,
    version: profile.version,
    currentVersion: profile.version,
    builtIn: profile.builtIn === true,
    archived: profile.archived === true,
    companyName: profile.companyName,
    logoUrl: profile.logoUrl,
    contact: profile.contact,
    currency: profile.currency,
    timezone: profile.timezone,
    hourlyRateKRW: profile.hourlyRateKRW,
    minMinutes: profile.minMinutes,
    maxMinutes: profile.maxMinutes,
    billingIncrementMinutes: profile.billingIncrementMinutes,
    distanceThresholdMeters: profile.distanceThresholdMeters,
    distanceRateKRWPerKm: profile.distanceRateKRWPerKm,
    distanceBillingMode: profile.distanceBillingMode,
    vatBasisPoints: profile.vatBasisPoints,
    tollPolicy: profile.tollPolicy,
    parkingPolicy: profile.parkingPolicy,
    overtimeRateKRW: profile.overtimeRateKRW,
    overtimeIncludesVat: profile.overtimeIncludesVat,
    documentTitle: profile.documentTitle,
    footer: profile.footer,
    createdAt: Number(profile.createdAt) || null,
    createdByEmail: String(profile.createdByEmail || ''),
    updatedAt: Number(profile.updatedAt) || null,
    updatedByEmail: String(profile.updatedByEmail || ''),
  };
}

async function requireMoodAdmin(req, db) {
  const auth = await verifyUserToken(req);
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error, code: 'AUTH_REQUIRED' };
  if (!auth.emailVerified) {
    return { ok: false, status: 403, error: '이메일 미검증', code: 'EMAIL_UNVERIFIED' };
  }
  const allowlist = await getMoodAllowlist(db);
  if (!isAdminEmail(allowlist, auth.email)) {
    return { ok: false, status: 403, error: '권한 없음 (관리자 전용)', code: 'ADMIN_ONLY' };
  }
  return { ok: true, email: auth.email, uid: auth.uid || '' };
}

function normalizeStoredProfile(doc) {
  const data = doc.data() || {};
  const normalized = normalizePersistedProfile(doc.id, data);
  if (!normalized.ok) {
    throw new Error(`INVALID_STORED_PROFILE:${doc.id}:${normalized.error}`);
  }
  return {
    ...normalized.profile,
    builtIn: doc.id === BUILT_IN_MOOD_QUOTE_PROFILE.id,
    createdAt: Number(data.createdAt) || null,
    createdByEmail: String(data.createdByEmail || ''),
    updatedAt: Number(data.updatedAt) || null,
    updatedByEmail: String(data.updatedByEmail || ''),
  };
}

async function listProfiles(db) {
  const snap = await db.collection(COLLECTION).get();
  const stored = [];
  for (const doc of snap.docs) {
    const profile = normalizeStoredProfile(doc);
    if (!profile.archived) stored.push(profile);
  }
  const byId = new Map(stored.map((profile) => [profile.id, profile]));
  if (!byId.has(BUILT_IN_MOOD_QUOTE_PROFILE.id)) {
    byId.set(BUILT_IN_MOOD_QUOTE_PROFILE.id, { ...BUILT_IN_MOOD_QUOTE_PROFILE });
  }
  return [...byId.values()].sort((a, b) => {
    if (a.id === BUILT_IN_MOOD_QUOTE_PROFILE.id) return -1;
    if (b.id === BUILT_IN_MOOD_QUOTE_PROFILE.id) return 1;
    return a.companyName.localeCompare(b.companyName, 'ko');
  });
}

async function saveProfile(db, body, auth) {
  const rawProfile = body.profile && typeof body.profile === 'object' ? body.profile : {};
  if (Object.prototype.hasOwnProperty.call(rawProfile, 'id')
    && typeof rawProfile.id !== 'string') {
    return { ok: false, status: 400, error: 'INVALID_PROFILE_ID' };
  }
  const requestedProfileId = typeof rawProfile.id === 'string' ? rawProfile.id.toLowerCase().trim() : '';
  const profileId = requestedProfileId || generatedProfileId();
  if (!PROFILE_ID_RE.test(profileId)) {
    return { ok: false, status: 400, error: 'INVALID_PROFILE_ID' };
  }
  const expectedVersion = expectedVersionInput(body);
  if (!expectedVersion.ok) {
    return { ok: false, status: 400, error: expectedVersion.error };
  }
  const profileRef = db.collection(COLLECTION).doc(profileId);
  const auditRef = db.collection(AUDIT_COLLECTION).doc();

  return db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(profileRef);
    const existingData = existingSnap.exists ? existingSnap.data() || {} : null;
    const isBuiltIn = profileId === BUILT_IN_MOOD_QUOTE_PROFILE.id;
    const profileExists = Boolean(existingData) || isBuiltIn;
    let existingProfile = isBuiltIn ? { ...BUILT_IN_MOOD_QUOTE_PROFILE } : null;
    if (existingData) {
      const persisted = normalizePersistedProfile(profileId, existingData);
      if (!persisted.ok) {
        return { ok: false, status: 500, error: 'INVALID_STORED_PROFILE' };
      }
      existingProfile = persisted.profile;
    }
    const existingVersion = existingProfile ? existingProfile.version : 0;

    if (existingProfile && existingProfile.archived) {
      return { ok: false, status: 409, error: 'PROFILE_ARCHIVED', currentVersion: existingVersion };
    }

    if (profileExists && !expectedVersion.provided) {
      return { ok: false, status: 400, error: 'EXPECTED_VERSION_REQUIRED' };
    }
    if (expectedVersion.provided && expectedVersion.value !== existingVersion) {
      return { ok: false, status: 409, error: 'PROFILE_VERSION_CONFLICT', currentVersion: existingVersion };
    }

    const nextVersion = existingVersion + 1;
    const fallback = existingProfile || {
      ...BUILT_IN_MOOD_QUOTE_PROFILE,
      ...rawProfile,
      id: profileId,
      version: 1,
      builtIn: profileId === BUILT_IN_MOOD_QUOTE_PROFILE.id,
    };
    const normalized = normalizeVehicleQuoteProfile({
      ...fallback,
      ...rawProfile,
      id: profileId,
      version: nextVersion,
      builtIn: profileId === BUILT_IN_MOOD_QUOTE_PROFILE.id,
      archived: false,
    }, { fallback });
    if (!normalized.ok) return { ok: false, status: 400, error: normalized.error };

    const now = Date.now();
    const stored = {
      ...normalized.profile,
      currentVersion: nextVersion,
      createdAt: existingData ? Number(existingData.createdAt) || now : now,
      createdByEmail: existingData ? String(existingData.createdByEmail || auth.email) : auth.email,
      updatedAt: now,
      updatedByEmail: auth.email,
    };
    const versionRef = profileRef.collection('versions').doc(versionDocId(nextVersion));
    tx.set(profileRef, stored);
    tx.create(versionRef, {
      ...normalized.profile,
      savedAt: now,
      savedByEmail: auth.email,
    });
    tx.set(auditRef, {
      action: profileExists ? 'profile_updated' : 'profile_created',
      profileId,
      previousVersion: existingVersion,
      newVersion: nextVersion,
      before: existingProfile ? auditProfileState({
        ...existingProfile,
        createdAt: existingData ? existingData.createdAt : null,
        createdByEmail: existingData ? existingData.createdByEmail : '',
        updatedAt: existingData ? existingData.updatedAt : null,
        updatedByEmail: existingData ? existingData.updatedByEmail : '',
      }) : null,
      after: auditProfileState(stored),
      byEmail: auth.email,
      byUid: auth.uid,
      at: now,
    });
    return { ok: true, profile: stored };
  });
}

async function archiveProfile(db, body, auth) {
  if (typeof body.profileId !== 'string') {
    return { ok: false, status: 400, error: 'INVALID_PROFILE_ID' };
  }
  const profileId = body.profileId.toLowerCase().trim();
  if (profileId === BUILT_IN_MOOD_QUOTE_PROFILE.id) {
    return { ok: false, status: 400, error: 'BUILT_IN_PROFILE_CANNOT_BE_ARCHIVED' };
  }
  if (!PROFILE_ID_RE.test(profileId)) {
    return { ok: false, status: 400, error: 'INVALID_PROFILE_ID' };
  }
  const expectedVersion = expectedVersionInput(body);
  if (!expectedVersion.provided) {
    return { ok: false, status: 400, error: 'EXPECTED_VERSION_REQUIRED' };
  }
  if (!expectedVersion.ok) {
    return { ok: false, status: 400, error: expectedVersion.error };
  }
  const ref = db.collection(COLLECTION).doc(profileId);
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, status: 404, error: 'PROFILE_NOT_FOUND' };
    const data = snap.data() || {};
    const persisted = normalizePersistedProfile(profileId, data);
    if (!persisted.ok) return { ok: false, status: 500, error: 'INVALID_STORED_PROFILE' };
    const currentProfile = persisted.profile;
    const currentVersion = currentProfile.version;
    if (currentProfile.archived) {
      return { ok: false, status: 409, error: 'PROFILE_ALREADY_ARCHIVED', currentVersion };
    }
    if (expectedVersion.value !== currentVersion) {
      return { ok: false, status: 409, error: 'PROFILE_VERSION_CONFLICT', currentVersion };
    }
    const nextVersion = currentVersion + 1;
    const now = Date.now();
    const archivedProfile = {
      ...currentProfile,
      version: nextVersion,
      archived: true,
    };
    const stored = {
      ...archivedProfile,
      currentVersion: nextVersion,
      createdAt: Number(data.createdAt) || now,
      createdByEmail: String(data.createdByEmail || auth.email),
      updatedAt: now,
      updatedByEmail: auth.email,
    };
    const versionRef = ref.collection('versions').doc(versionDocId(nextVersion));
    tx.set(ref, stored);
    tx.create(versionRef, {
      ...archivedProfile,
      savedAt: now,
      savedByEmail: auth.email,
      changeType: 'archive',
    });
    tx.set(auditRef, {
      action: 'profile_archived',
      profileId,
      previousVersion: currentVersion,
      newVersion: nextVersion,
      before: auditProfileState({
        ...currentProfile,
        createdAt: data.createdAt,
        createdByEmail: data.createdByEmail,
        updatedAt: data.updatedAt,
        updatedByEmail: data.updatedByEmail,
      }),
      after: auditProfileState(stored),
      byEmail: auth.email,
      byUid: auth.uid,
      at: now,
    });
    return { ok: true, profileId, profile: stored };
  });
}

export default async function handler(req, res) {
  const headers = jsonHeaders(req);
  if (req.method === 'OPTIONS') return send(res, 200, headers, {});
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, headers, { ok: false, error: 'GET/POST only', code: 'METHOD_NOT_ALLOWED' });
  }

  const db = initAdminDb('mood-quote-profiles');
  if (!db) return send(res, 500, headers, { ok: false, error: 'Firestore unavailable', code: 'DB_UNAVAILABLE' });

  let auth;
  try {
    auth = await requireMoodAdmin(req, db);
  } catch (error) {
    await captureError(error, { route: '/api/mood-quote-profiles', phase: 'auth' });
    return send(res, 500, headers, { ok: false, error: '서버 오류', code: 'INTERNAL_ERROR' });
  }
  if (!auth.ok) return send(res, auth.status, headers, auth);

  try {
    if (req.method === 'GET') {
      const profiles = await listProfiles(db);
      return send(res, 200, headers, {
        ok: true,
        data: { profiles, builtInProfileId: BUILT_IN_MOOD_QUOTE_PROFILE.id },
      });
    }
    const body = parseBody(req);
    const action = String(body.action || 'save').trim();
    if (action !== 'save' && action !== 'archive') {
      return send(res, 400, headers, { ok: false, error: 'INVALID_ACTION', code: 'INVALID_ACTION' });
    }
    const result = action === 'archive'
      ? await archiveProfile(db, body, auth)
      : await saveProfile(db, body, auth);
    if (!result.ok) {
      return send(res, result.status || 400, headers, {
        ok: false,
        error: result.error,
        code: result.error,
        ...(result.currentVersion !== undefined ? { currentVersion: result.currentVersion } : {}),
      });
    }
    return send(res, 200, headers, { ok: true, data: result });
  } catch (error) {
    console.error('[mood-quote-profiles] failed:', error.message);
    await captureError(error, { route: '/api/mood-quote-profiles', email: auth.email });
    return send(res, 500, headers, { ok: false, error: '서버 오류', code: 'INTERNAL_ERROR' });
  }
}
