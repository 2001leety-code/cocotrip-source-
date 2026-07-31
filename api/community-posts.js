/**
 * Vercel API Route: Community Posts
 *   GET  /api/community-posts?sort=latest|popular&limit=30   — 공개 피드 (active 만)
 *   GET  /api/community-posts?id=<postId>                    — 단건 + 댓글
 *   POST /api/community-posts                                — 글 작성 (로그인 필수)
 *
 * GET 은 **선택적 인증**이다. 토큰이 있으면 검증해 `isOwn`(내 글인가) 만 계산하고, 없거나
 * 틀리면 비로그인 응답을 준다(거부하지 않는다). 응답 필드는 두 경우 모두 동일하게 공개 필드뿐.
 *
 * 2026-07-12 UIUX 가이드 P9 실전화 — 디자인 셸(CommunityPage.tsx)의 가짜 POSTS 를
 * 실 Firestore(community_posts)로 교체하는 백엔드 1/3.
 *
 * 안전 설계:
 *   - 작성 = Firebase ID token 필수(verifyUserToken) + uid 기준 rate limit(시간당 5건)
 *     + IP rate limit(시간당 10건) 이중.
 *   - 연락처 유도(텔레그램/왓츠앱/전화번호 등) 감지 시 status='review' — 공개 피드 미노출,
 *     운영자 텔레그램 알림 후 어드민 검토. (가이드 p.9 Safety Check)
 *   - 읽기는 status=='active' 만. where+orderBy 복합 인덱스 회피를 위해 최신 60건
 *     조회 후 메모리 필터(MVP 규모 — 트래픽 증가 시 인덱스 추가).
 *   - authorName 은 표시용(클라이언트 제공, 30자 sanitize) — 신원은 authorUid(검증됨).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './_shared/notify.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { detectLanguage } from './_shared/translator.js';
import { publicImagePaths } from './_shared/community-media.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const POST_TYPES = new Set(['question', 'tip', 'buddy', 'itinerary']);
const CATEGORIES = new Set(['seoul', 'tips', 'buddies', 'living']);

// 연락처 유도 감지 — 매칭 시 자동 공개 대신 운영자 검토(review)로.
// 오탐(가격·시간 숫자)을 줄이기 위해 "연속 9자리+ 숫자" 또는 메신저 키워드만 잡는다.
const CONTACT_RE = /(telegram|whats\s*app|kakao\s*talk|카카오톡|카톡|위챗|wechat|line\s*id|instagram\s*dm|\+?\d[\d\s().-]{8,}\d)/i;

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}
const _ok = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

function sanitizeName(raw) {
  const s = String(raw || '').replace(/https?:\/\/\S+/gi, '').replace(/[<>]/g, '').trim();
  return (s || 'Traveler').slice(0, 30);
}

/**
 * 앱 자체 Storage 버킷 화이트리스트 (핫링크·외부버킷 주입 차단, 2026-07-13 리뷰 fix).
 * 프로젝트 버킷은 `{projectId}.appspot.com`(레거시) 또는 `{projectId}.firebasestorage.app`(신규).
 * FIREBASE_STORAGE_BUCKET 명시값도 허용. 하나도 못 구하면 fail-closed(빈 set → 전 이미지 거부).
 */
function allowedBuckets() {
  const set = new Set();
  const pid = (process.env.FIREBASE_PROJECT_ID || '').trim();
  if (pid) { set.add(`${pid}.appspot.com`); set.add(`${pid}.firebasestorage.app`); }
  const explicit = (process.env.FIREBASE_STORAGE_BUCKET || '').trim();
  if (explicit) set.add(explicit);
  return set;
}

/**
 * 사진 첨부 검증 (UIUX P9, 2026-07-13) — 본인 Firebase Storage community/{uid}/ 경로의
 * 다운로드 URL 만 허용. 임의 외부 URL(핫링크·피싱 이미지)·타인 경로·타 프로젝트 버킷 주입 차단.
 * 다운로드 URL 형식: https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedPath>?...
 * ⚠️ 버킷 세그먼트를 반드시 앱 자체 버킷과 대조(리뷰 fix): firebasestorage.googleapis.com 은
 *    전 세계 Firebase 프로젝트 공용 호스트라 host 만 검사하면 공격자 버킷 이미지가 통과됨.
 */
export function sanitizeImages(rawImages, uid) {
  if (!Array.isArray(rawImages)) return [];
  const buckets = allowedBuckets();
  if (buckets.size === 0) return []; // 버킷 확인 불가 = fail-closed
  const out = [];
  for (const raw of rawImages.slice(0, 3)) {
    if (typeof raw !== 'string') continue;
    let url;
    try { url = new URL(raw); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com') continue;
    const m = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!m) continue;
    if (!buckets.has(m[1])) continue; // 앱 자체 버킷만
    let objectPath;
    try { objectPath = decodeURIComponent(m[2]); } catch { continue; }
    if (!objectPath.startsWith(`community/${uid}/`)) continue;
    out.push(raw);
  }
  return out;
}

/**
 * 공개 응답 직렬화.
 *
 * 🔴 2026-07-30: 이전에는 `authorUid`(Firebase uid)를 그대로 내려보냈다. 주석은 "공개 프로필
 *   정보 아님" 이라고 적혀 있었지만, 이 응답은 **비로그인 누구나** 받는 공개 피드다. 즉
 *   글 목록만 긁으면 작성자 Firebase uid 전체를 수집할 수 있었다. uid 는 Storage 경로
 *   (`community/{uid}/`)·규칙·다른 컬렉션 문서 키에 쓰이는 내부 식별자다.
 *   화면에 필요한 것은 uid 가 아니라 "이 글이 내 글인가" 한 가지뿐 →
 *   **서버가 인증된 요청자를 기준으로** `isOwn` 만 계산해 준다. uid 는 응답에서 사라진다.
 *
 * @param {string} id 문서 ID
 * @param {object} d Firestore 문서 데이터
 * @param {string|null} viewerUid 검증된 요청자 uid (비로그인 = null). 절대 클라이언트 입력 금지.
 */
export function serializePost(id, d, viewerUid = null) {
  return {
    id,
    title: d.title,
    body: d.body,
    lang: d.lang,
    type: d.type,
    category: d.category,
    authorName: d.authorName,
    isOwn: !!viewerUid && d.authorUid === viewerUid,
    likeCount: d.likeCount || 0,
    replyCount: d.replyCount || 0,
    createdAt: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : null,
    translations: d.translations || {},
    // 🔴 2026-07-30: 이전에는 Firebase Storage 다운로드 URL 을 그대로 내보냈다. 그 URL 의 경로가
    //   `community/{uid}/...` 라서, `authorUid` 를 지워 놓고도 **사진 한 장이면 uid 가 샜다**.
    //   이제 되돌릴 수 없는 토큰 경로만 준다(api/_shared/community-media.js). 파일은 그대로 둔다.
    images: publicImagePaths(id, d.images),
  };
}

/** 댓글 공개 직렬화 — 위와 같은 이유로 `authorUid` 대신 `isOwn`. */
export function serializeReply(id, rd, viewerUid = null) {
  return {
    id,
    body: rd.body,
    lang: rd.lang,
    authorName: rd.authorName,
    isOwn: !!viewerUid && rd.authorUid === viewerUid,
    createdAt: rd.createdAt && rd.createdAt.toMillis ? rd.createdAt.toMillis() : null,
    translations: rd.translations || {},
  };
}

/**
 * 읽기 요청의 **선택적** 인증. 토큰이 없거나 틀렸으면 비로그인으로 본다(공개 피드이므로 거부 아님).
 * 여기서 나온 uid 만 `isOwn` 계산에 쓴다 — 클라이언트가 보낸 uid 는 신뢰하지 않는다.
 */
async function resolveViewerUid(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  if (!/^Bearer\s+.+$/.test(String(authHeader))) return null;
  try {
    const auth = await verifyUserToken(req);
    return auth.ok ? auth.uid : null;
  } catch {
    return null;   // 검증 인프라 문제로 공개 피드가 죽지 않게 한다
  }
}

async function handleGet(req, res, db) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  const viewerUid = await resolveViewerUid(req);

  if (id) {
    const doc = await db.collection('community_posts').doc(id).get();
    if (!doc.exists || doc.data().status !== 'active') {
      // 없는 글·검토 대기·숨긴 글 모두 같은 404 — 존재 여부가 새어 나가지 않는다.
      return json(res, 404, _err('Post not found', 'NOT_FOUND'));
    }
    const repliesSnap = await db.collection('community_posts').doc(id)
      .collection('replies').orderBy('createdAt', 'asc').limit(100).get();
    const replies = repliesSnap.docs
      .filter((r) => r.data().status === 'active')
      .map((r) => serializeReply(r.id, r.data(), viewerUid));
    return json(res, 200, _ok({ post: serializePost(doc.id, doc.data(), viewerUid), replies }));
  }

  const sort = url.searchParams.get('sort') === 'popular' ? 'popular' : 'latest';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 50);
  // 복합 인덱스 회피: createdAt 최신 60건 → 메모리에서 active 필터 (MVP 규모)
  const snap = await db.collection('community_posts').orderBy('createdAt', 'desc').limit(60).get();
  let posts = snap.docs
    .filter((doc) => doc.data().status === 'active')
    .map((doc) => serializePost(doc.id, doc.data(), viewerUid));
  if (sort === 'popular') posts = posts.sort((a, b) => b.likeCount - a.likeCount);
  return json(res, 200, _ok({ posts: posts.slice(0, limit) }));
}

async function handlePost(req, res, db) {
  const auth = await verifyUserToken(req);
  if (!auth.ok) return json(res, auth.status, _err(auth.error, 'AUTH_REQUIRED'));

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  const type = String(body.type || 'question');
  const category = String(body.category || 'tips');
  const authorName = sanitizeName(body.authorName);

  if (!title || title.length > 100) return json(res, 400, _err('title required (max 100)', 'INVALID_TITLE'));
  if (!text || text.length > 2000) return json(res, 400, _err('body required (max 2000)', 'INVALID_BODY'));
  if (!POST_TYPES.has(type)) return json(res, 400, _err('invalid type', 'INVALID_TYPE'));
  if (!CATEGORIES.has(category)) return json(res, 400, _err('invalid category', 'INVALID_CATEGORY'));

  // 이중 rate limit: uid(시간당 5건) + IP(시간당 10건)
  const uidCheck = await checkIpRateLimit({
    db, ip: `uid:${auth.uid}`, collection: 'community_rate_limits', maxRequests: 5, errorLabel: 'community posts',
  });
  if (!uidCheck.ok) return json(res, uidCheck.status, _err(uidCheck.error, 'RATE_LIMITED'));
  const ipCheck = await checkIpRateLimit({
    db, ip: getClientIp(req), collection: 'community_rate_limits', maxRequests: 10, errorLabel: 'community posts',
  });
  if (!ipCheck.ok) return json(res, ipCheck.status, _err(ipCheck.error, 'RATE_LIMITED'));

  const combined = `${title}\n${text}`;
  const needsReview = CONTACT_RE.test(combined);
  const lang = await detectLanguage(combined);
  // 사진 첨부 (UIUX P9): 본인 community/{uid}/ Storage 경로만 최대 3장
  const images = sanitizeImages(body.images, auth.uid);

  const docRef = await db.collection('community_posts').add({
    title,
    body: text,
    lang: ['ko', 'en', 'ja', 'zh'].includes(lang) ? lang : 'en',
    type,
    category,
    authorUid: auth.uid,
    authorEmail: auth.email, // 어드민 조회용 — 클라이언트 직렬화에 미포함
    authorName,
    likeCount: 0,
    replyCount: 0,
    status: needsReview ? 'review' : 'active',
    createdAt: FieldValue.serverTimestamp(),
    translations: {},
    images,
  });

  if (needsReview) {
    void notify('booking',
      `🛡️ <b>커뮤니티 글 검토 대기</b>\n연락처 유도 감지 — 공개 보류\n` +
      `제목: ${title.slice(0, 80)}\n작성자: ${auth.email}\n` +
      `→ Firestore <code>community_posts/${docRef.id}</code>`
    ).catch(() => {});
  }

  return json(res, 200, _ok({ postId: docRef.id, status: needsReview ? 'review' : 'active' }));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  try {
    const db = initAdminDb('community-posts');
    if (!db) return json(res, 500, _err('Firestore unavailable', 'DB_UNAVAILABLE'));
    if (req.method === 'GET') return await handleGet(req, res, db);
    if (req.method === 'POST') return await handlePost(req, res, db);
    return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  } catch (err) {
    console.error('[community-posts]', err);
    return json(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
