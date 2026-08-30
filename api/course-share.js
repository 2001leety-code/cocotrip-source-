/**
 * /api/course-share — 코스 빌더 저장형 공유 (2026-07-04)
 *
 * 배경: 기존 공유는 코스를 base64 로 URL 해시에 통째로 실음 — 20곳 코스 ≈ 3,120자로
 * 카톡 등 메신저에서 절단(~2,000자) 위험. 짧은 저장형 주소(/s/{id})로 교체하고,
 * 해시 방식은 오프라인/레이트리밋 폴백으로 유지.
 *
 * POST { course: { v:1, days:[{stops:[...]}] }, title? }
 *   → 서버 sanitize(제목 필수·시간 형식·상한 컷·비문자열 방어 — 프론트
 *     decodeSharedCourse 와 동일 규칙) 후 shared_courses/{id(8자)} 저장.
 *   → { ok, id, url }. 게스트 허용(IP rate-limit 10/h). 인증 있으면 creatorUid 기록.
 * GET ?id=xxxxxxxx
 *   → { ok, data: { v, days, title, createdAt } }. 공개 읽기(코스에 PII 없음 —
 *     장소명/시간/메모만. 메모에 개인정보 넣는 건 작성자 책임 범위).
 *
 * Firestore rules 무접촉 — 읽기/쓰기 모두 Admin SDK 경유라 클라 룰 불필요(잠김 유지).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';

export const maxDuration = 10;
export const config = { runtime: 'nodejs' };

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const MAX_DAYS = 10;
const MAX_STOPS_PER_DAY = 20;
const MAX_TITLE = 80;
const MAX_STOP_TITLE = 120;
const MAX_MEMO = 500;
const MAX_PLACE_KEY = 128;
const ID_RE = /^[a-z0-9]{8}$/;

const _ok = (data) => JSON.stringify({ ok: true, ...data });
const _err = (error, code) => JSON.stringify({ ok: false, error, code });

/** "HH:MM"(24h) 또는 빈 문자열만 허용 — 프론트 courseOps.isValidTime 과 동일. */
function isValidTime(t) {
  return t === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** "HH:MM"(24h), 빈 문자열 불허 — 프론트 courseOps.isValidClock 과 동일(windowEnd 전용). */
function isValidClock(t) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function isValidStayMinutes(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1440;
}

function isValidTimeConstraint(v) {
  return v === 'fixed' || v === 'window';
}

function isValidPlaceSource(v) {
  return v === 'cocotrip-attractions' || v === 'cocotrip-food';
}

/**
 * v1 확장필드 검증 — 프론트 courseOps.isValidStopConstraints 와 동일 규칙(중복 구현,
 * api/ ↔ src/ 상호 import 금지 — 두 벌 + 각자 테스트 가드).필드가 아예 없으면 통과
 * (구버전 payload 호환). "명시적으로 있는데 형식이 틀림"만 malformed 로 잡는다.
 */
function isValidStopConstraints(s) {
  if (!s || typeof s !== 'object') return true;
  if (s.stayMinutes !== undefined && !isValidStayMinutes(s.stayMinutes)) return false;
  if (s.placeKey !== undefined || s.placeSource !== undefined) {
    if (typeof s.placeKey !== 'string' || !s.placeKey.trim() || s.placeKey.length > MAX_PLACE_KEY) return false;
    if (!isValidPlaceSource(s.placeSource)) return false;
  }
  if (s.timeConstraint === undefined) {
    if (s.windowEnd !== undefined) return false;
    return true;
  }
  if (!isValidTimeConstraint(s.timeConstraint)) return false;
  if (!isValidClock(s.time)) return false;
  if (s.timeConstraint === 'window') {
    if (!isValidClock(s.windowEnd)) return false;
    if (s.windowEnd <= s.time) return false;
  } else if (s.windowEnd !== undefined) {
    return false;
  }
  return true;
}

/** sanitizeCourse 가 명시적 malformed constraint/identity 를 만나면 던진다 — 호출부는 400. */
export class CourseValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CourseValidationError';
    this.code = code;
  }
}

/**
 * 코스 sanitize — 신뢰 불가 입력(프론트 courseOps.decodeSharedCourse 와 동일 규칙 + v1 확장).
 * 확장필드가 명시적으로 있는데 형식이 틀리면 조용히 강등(드롭)하지 않고 CourseValidationError
 * 를 던져 전체 요청을 거부한다(fail-closed) — 구버전 payload(필드 없음)는 그대로 통과.
 * @returns {{days: object[]} | null} 유효 stop 이 1개도 없으면 null(빈 코스 — 별개 사유).
 */
export function sanitizeCourse(input) {
  if (!input || input.v !== 1 || !Array.isArray(input.days)) return null;
  const days = input.days.slice(0, MAX_DAYS).map((day) => {
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    return {
      stops: stops.slice(0, MAX_STOPS_PER_DAY).flatMap((s) => {
        const title = typeof s?.title === 'string' ? s.title.trim() : '';
        if (!title) return [];
        if (!isValidStopConstraints(s)) throw new CourseValidationError('BAD_STOP_CONSTRAINTS');
        return [{
          id: typeof s.id === 'string' && s.id ? s.id.slice(0, 24) : `s${Math.random().toString(36).slice(2, 10)}`,
          time: typeof s.time === 'string' && isValidTime(s.time) ? s.time : '',
          title: title.slice(0, MAX_STOP_TITLE),
          category: typeof s.category === 'string' ? s.category.slice(0, 20) : 'etc',
          memo: typeof s.memo === 'string' ? s.memo.slice(0, MAX_MEMO) : '',
          ...(typeof s.lat === 'number' && Number.isFinite(s.lat) ? { lat: s.lat } : {}),
          ...(typeof s.lng === 'number' && Number.isFinite(s.lng) ? { lng: s.lng } : {}),
          ...(s.stayMinutes !== undefined ? { stayMinutes: s.stayMinutes } : {}),
          ...(s.timeConstraint !== undefined ? { timeConstraint: s.timeConstraint } : {}),
          ...(s.windowEnd !== undefined ? { windowEnd: s.windowEnd } : {}),
          ...(s.placeKey !== undefined ? { placeKey: s.placeKey.trim().slice(0, MAX_PLACE_KEY) } : {}),
          ...(s.placeSource !== undefined ? { placeSource: s.placeSource } : {}),
        }];
      }),
    };
  });
  const total = days.reduce((n, d) => n + d.stops.length, 0);
  if (!days.length || total === 0) return null;
  return { days };
}

function genShareId() {
  // 8자 base36 — 충돌 시 1회 재시도 (2.8e12 공간이라 실충돌 무시 가능 수준)
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }

  let db;
  try {
    db = initAdminDb();
  } catch (err) {
    await captureError(err, { route: '/api/course-share', phase: 'init' });
    res.writeHead(500, JSON_HEADERS);
    return res.end(_err('서버 설정 오류', 'SERVER_CONFIG'));
  }

  try {
    // ── GET: 공유 코스 조회 (공개 — PII 없는 장소 리스트) ──
    if (req.method === 'GET') {
      const id = String(req.query?.id || '').trim().toLowerCase();
      if (!ID_RE.test(id)) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(_err('잘못된 공유 주소', 'BAD_ID'));
      }
      const snap = await db.collection('shared_courses').doc(id).get();
      if (!snap.exists) {
        res.writeHead(404, JSON_HEADERS);
        return res.end(_err('공유 코스를 찾을 수 없습니다', 'NOT_FOUND'));
      }
      const d = snap.data() || {};
      res.writeHead(200, { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=300' });
      return res.end(_ok({ data: { v: 1, days: d.days || [], title: d.title || '', createdAt: d.createdAt || null } }));
    }

    if (req.method !== 'POST') {
      res.writeHead(405, JSON_HEADERS);
      return res.end(_err('POST/GET only', 'METHOD_NOT_ALLOWED'));
    }

    // ── POST: 공유 생성 (게스트 허용 + IP rate-limit) ──
    const rl = await checkIpRateLimit({
      db, ip: getClientIp(req),
      collection: 'course_share_rate_limits',
      maxRequests: 10, errorLabel: 'course shares',
    });
    if (!rl.ok) {
      res.writeHead(rl.status, { ...JSON_HEADERS, 'Retry-After': String(rl.retryAfterSec) });
      return res.end(_err(rl.error, 'RATE_LIMITED'));
    }

    const body = typeof req.body === 'object' && req.body ? req.body : {};
    let course;
    try {
      course = sanitizeCourse(body.course);
    } catch (err) {
      if (err instanceof CourseValidationError) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(_err('체류시간/시간제약/장소 식별자 형식이 잘못됨', err.code));
      }
      throw err;
    }
    if (!course) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(_err('코스 내용이 비어있거나 형식이 잘못됨', 'BAD_COURSE'));
    }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';

    // 선택 인증 — 로그인 상태면 작성자 기록(관리/삭제 근거), 게스트는 null.
    let creatorUid = null;
    if (req.headers?.authorization) {
      const auth = await verifyUserToken(req);
      if (auth.ok) creatorUid = auth.uid || null;
    }

    let id = genShareId();
    let ref = db.collection('shared_courses').doc(id);
    if ((await ref.get()).exists) { id = genShareId(); ref = db.collection('shared_courses').doc(id); }

    await ref.set({
      v: 1,
      days: course.days,
      title,
      creatorUid,
      createdAt: Date.now(),
    });

    console.log(`[course-share] created ${id} — days=${course.days.length} uid=${creatorUid || 'guest'}`);
    res.writeHead(200, JSON_HEADERS);
    return res.end(_ok({ id, url: `https://cocotripkr.com/s/${id}` }));
  } catch (err) {
    console.error('[course-share] failed:', err.message);
    await captureError(err, { route: '/api/course-share' });
    res.writeHead(500, JSON_HEADERS);
    return res.end(_err('서버 오류 — 다시 시도하세요', 'INTERNAL_ERROR'));
  }
}
