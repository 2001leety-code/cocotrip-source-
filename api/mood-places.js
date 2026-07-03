/**
 * /api/mood-places — MOOD 장소 주소록 CRUD (자주 가는 곳 저장)
 *
 * 용도: 직원 집·이사님 집 등 자주 가는 곳을 이름→주소+좌표로 저장.
 *   - AI 파싱이 "이사님 댁으로 배차" 같은 이름 매칭에 씀.
 *   - isDirector=true 항목은 서비스 판별 기준 (한 명만 존재해야 함).
 *
 * Firestore 컬렉션 `mood_places/{id}`:
 *   { name, address, lat, lng, isDirector, createdAt, updatedAt?, byEmail }
 *
 * 인증: Authorization: Bearer <Firebase ID token> + email_verified.
 *   - GET(조회): allowlist.emails (운영자 + 광고사 직원) — isAllowedEmail.
 *   - POST/DELETE(쓰기): allowlist.admins (운영자만) — isAdminEmail.
 *
 * 메서드:
 *   - GET:    주소록 전체 목록. { ok, places:[...] }.
 *   - POST:   추가/수정. { name, address, isDirector? }.
 *             address 를 geocode 해서 lat/lng 채움(mood-route geocodeAddress 재사용).
 *             geocode 실패면 400 (엉터리 주소 저장 방지).
 *             문서 ID = name 슬러그(+충돌 시 랜덤 접미). 같은 슬러그면 수정(merge).
 *             isDirector=true 는 한 명만 — 트랜잭션으로 기존 director 를 false 로 내려 유일성 보장.
 *   - DELETE: { id } 또는 { name }. 해당 주소록 항목 삭제.
 *
 * geocode 는 좌표만 뽑는 용도라 돈/안전 경계 아님 → mood-topup 4중벽(운영자+검증) 유지하되
 * 실제 위조 위험은 주소 좌표뿐. director 유일성만 트랜잭션으로 강하게 보장.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail, isAllowedEmail } from './_shared/mood-allowlist.js';
import { geocodeAddress } from './_shared/mood-route.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, POST, DELETE, OPTIONS';
const COLLECTION = 'mood_places';

/** 이름 기반 slug. 한글/특수문자는 하이픈으로, 비영문뿐이면 빈 문자열. */
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** 문서 ID 생성 — slug 우선, 비영문이라 slug 가 비면 랜덤. */
function makeDocId(name) {
  const slug = slugify(name);
  if (slug) return slug;
  return `place-${Math.random().toString(36).slice(2, 10)}`;
}

export default async function handler(req, res) {
  const JSON_HEADERS = {
    'Cache-Control': 'no-store',
    ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }),
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }

  const method = (req.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'GET, POST, DELETE only' }));
  }

  // ── 1) 인증 (전 메서드 공통) ────────────────────────────────
  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  const email = auth.email;
  // 미검증 이메일 토큰 차단 (defense-in-depth — mood-topup 동일).
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }

  try {
    const db = initAdminDb('mood-places');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const allowlist = await getMoodAllowlist(db);

    // ── 2) 권한 게이트 ─────────────────────────────────────────
    // GET(조회): 운영자 + 광고사 직원. POST/DELETE(쓰기): 운영자 전용.
    if (method === 'GET') {
      if (!isAllowedEmail(allowlist, email)) {
        res.writeHead(403, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: '조회 권한 없음' }));
      }
      return handleGet(db, res, JSON_HEADERS);
    }

    // POST / DELETE — 운영자(admins) 전용.
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '권한 없음 (운영자 전용)' }));
    }

    if (method === 'POST') {
      return handlePost(db, req, res, JSON_HEADERS, email);
    }
    // DELETE
    return handleDelete(db, req, res, JSON_HEADERS, email);
  } catch (err) {
    console.error('[mood-places] failed:', err.message);
    await captureError(err, { route: '/api/mood-places', email, method });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}

/** GET — 주소록 전체 목록. */
async function handleGet(db, res, JSON_HEADERS) {
  const snap = await db.collection(COLLECTION).get();
  const places = snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      name: data.name || '',
      address: data.address || '',
      lat: typeof data.lat === 'number' ? data.lat : null,
      lng: typeof data.lng === 'number' ? data.lng : null,
      isDirector: data.isDirector === true,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
    };
  });
  // director 먼저, 그 다음 이름순 — 목록에서 이사님 항목이 눈에 띄도록.
  places.sort((a, b) => {
    if (a.isDirector !== b.isDirector) return a.isDirector ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  res.writeHead(200, JSON_HEADERS);
  return res.end(JSON.stringify({ ok: true, places }));
}

/** POST — 추가/수정 + geocode + director 유일성 트랜잭션. */
async function handlePost(db, req, res, JSON_HEADERS, email) {
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const name = String(body.name || '').trim();
  const address = String(body.address || '').trim();
  const isDirector = body.isDirector === true;

  if (!name || name.length > 100) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'name 필수 (100자 이하)' }));
  }
  if (!address || address.length > 200) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'address 필수 (200자 이하)' }));
  }

  // ── geocode — 좌표 못 뽑으면 저장 거부 (엉터리 주소 방지) ──────
  const geo = await geocodeAddress(address);
  if (!geo.ok) {
    // NCP_NOT_CONFIGURED(500) 은 서버 설정 문제, 그 외(빈값/좌표화실패) 는 400.
    const status = geo.error === 'NCP_NOT_CONFIGURED' ? 500 : 400;
    const errMsg = geo.error === 'NCP_NOT_CONFIGURED'
      ? '지오코딩 미설정 (서버 키)'
      : '주소를 좌표로 변환할 수 없습니다 (주소 확인)';
    res.writeHead(status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: errMsg, code: geo.error }));
  }

  const { lat, lng } = geo;

  // 문서 ID — 명시적 id 우선(수정), 없으면 이름 슬러그(같은 이름=수정, 다른 이름=새 항목).
  const explicitId = String(body.id || '').trim();
  const docId = explicitId || makeDocId(name);
  const placeRef = db.collection(COLLECTION).doc(docId);

  // director 유일성: isDirector=true 로 저장 시 기존 director 문서들을 미리 조회 →
  // 트랜잭션 안에서 그들을 false 로 내리고 이 문서만 true 로. (트랜잭션은 read→write 순서 요구.)
  let existingDirectorIds = [];
  if (isDirector) {
    const dirSnap = await db.collection(COLLECTION).where('isDirector', '==', true).get();
    existingDirectorIds = dirSnap.docs.map((d) => d.id).filter((id) => id !== docId);
  }

  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(placeRef);
    const exists = snap.exists;

    // 기존 director 들을 false 로 (이 문서 제외). 트랜잭션 내에서 각 ref 를 다시 read → write.
    if (isDirector && existingDirectorIds.length) {
      for (const id of existingDirectorIds) {
        const ref = db.collection(COLLECTION).doc(id);
        const s = await tx.get(ref);
        if (s.exists && s.data()?.isDirector === true) {
          tx.update(ref, { isDirector: false });
        }
      }
    }

    const docData = {
      name,
      address,
      lat,
      lng,
      isDirector,
      byEmail: email,
      updatedAt: now,
    };
    if (exists) {
      // 수정 — createdAt 은 보존(merge), 나머지 갱신.
      tx.set(placeRef, docData, { merge: true });
    } else {
      docData.createdAt = now;
      tx.set(placeRef, docData);
    }
    return { exists };
  });

  console.log(
    '[mood-places] POST', email, '→', docId, '|', name,
    isDirector ? '(director)' : '', result.exists ? '(수정)' : '(신규)',
    existingDirectorIds.length ? `| 이전 director ${existingDirectorIds.length}건 해제` : ''
  );

  res.writeHead(200, JSON_HEADERS);
  return res.end(JSON.stringify({
    ok: true,
    data: {
      id: docId,
      name,
      address,
      lat,
      lng,
      isDirector,
      updated: result.exists,
      demotedDirectors: existingDirectorIds,
    },
  }));
}

/** DELETE — { id } 또는 { name } 으로 항목 삭제. */
async function handleDelete(db, req, res, JSON_HEADERS, email) {
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const id = String(body.id || '').trim();
  const name = String(body.name || '').trim();

  if (!id && !name) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'id 또는 name 필수' }));
  }

  // id 우선. id 없고 name 만 있으면 name 으로 조회.
  let targetRefs = [];
  if (id) {
    targetRefs = [db.collection(COLLECTION).doc(id)];
  } else {
    const snap = await db.collection(COLLECTION).where('name', '==', name).get();
    if (snap.empty) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'PLACE_NOT_FOUND' }));
    }
    // 동명(同名) 문서가 2개 이상이면 이름 삭제는 모호 → 거부(id 로 특정 삭제 유도).
    // name 은 고유키가 아니라(슬러그 충돌 시 place-xxxx 별도 저장) 이름 삭제가 이사님 문서까지
    // 함께 지울 위험 → 다건이면 후보만 돌려주고 삭제 안 함.
    if (snap.size > 1) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({
        ok: false, error: 'AMBIGUOUS_NAME',
        candidates: snap.docs.map((d) => ({ id: d.id, name: d.data().name, address: d.data().address })),
      }));
    }
    targetRefs = snap.docs.map((d) => d.ref);
  }

  // id 지정인데 문서가 없으면 404.
  if (id) {
    const snap = await targetRefs[0].get();
    if (!snap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'PLACE_NOT_FOUND' }));
    }
  }

  const deletedIds = [];
  for (const ref of targetRefs) {
    await ref.delete();
    deletedIds.push(ref.id);
  }

  console.log('[mood-places] DELETE', email, '→', deletedIds.join(', '));

  res.writeHead(200, JSON_HEADERS);
  return res.end(JSON.stringify({ ok: true, data: { deletedIds } }));
}
