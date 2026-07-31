/**
 * 커뮤니티 사진의 **공개 식별자** (2026-07-30, P1-3).
 *
 * 🔴 고친 문제: 공개 피드 응답에서 `authorUid` 는 지웠는데, 같은 응답의 `images` 는
 *   Firebase Storage **다운로드 URL** 이었다. 그 URL 의 경로가 `community/{uid}/...` 라서
 *   사진이 한 장이라도 붙은 글은 작성자 Firebase uid 를 그대로 흘리고 있었다.
 *   uid 는 Storage 규칙·다른 컬렉션 문서 키에 쓰는 내부 식별자다. 즉 uid 제거는 절반만 된 상태였다.
 *   (게다가 다운로드 URL 에는 Storage 다운로드 토큰까지 들어 있다.)
 *
 * 해결: 공개 응답에는 원본 URL 대신 **불투명 토큰**을 준다.
 *   `/api/community-image?p=<postId>&m=<token>`
 *   `token = sha256(postId + '|' + 원본URL).slice(0, 32)`
 *
 * 왜 이 방식인가
 *   - 되돌릴 수 없다: 토큰만 보고 uid 나 경로를 복원할 수 없다(해시 입력에 uid 경로+다운로드
 *     토큰이 들어가므로 추측도 불가).
 *   - **기존 파일을 옮기지 않아도 된다**: 레거시 글의 이미지도 같은 규칙으로 토큰이 나온다.
 *     프록시는 글 문서의 이미지들을 훑어 토큰이 맞는 것을 찾는다(글당 최대 3장).
 *   - 신규 업로드도 같은 경로를 쓴다 — 업로드 규칙(`community/{uid}/`)은 본인 소유 검증에
 *     쓰이므로 유지하고, **밖으로 나가는 식별자만** 바꾼다.
 */
import { createHash } from 'node:crypto';

/** 글 1건에 허용되는 최대 사진 수 (작성 시 sanitizeImages 와 동일). */
export const MAX_COMMUNITY_IMAGES = 3;

/**
 * 공개 미디어 토큰. 같은 (글, 원본URL) 쌍이면 항상 같은 값이 나온다(레거시 호환).
 * @param {string} postId
 * @param {string} storedUrl Firestore 에 저장된 원본 다운로드 URL
 */
export function communityMediaToken(postId, storedUrl) {
  return createHash('sha256')
    .update(`${String(postId)}|${String(storedUrl)}`)
    .digest('hex')
    .slice(0, 32);
}

/** 공개 응답에 넣을 상대 경로. 절대 URL 을 쓰지 않는다(환경별 도메인에 의존하지 않게). */
export function communityMediaPath(postId, storedUrl) {
  return `/api/community-image?p=${encodeURIComponent(String(postId))}&m=${communityMediaToken(postId, storedUrl)}`;
}

/**
 * 저장된 이미지 목록 → 공개 경로 목록. 배열이 아니거나 문자열이 아닌 값은 버린다.
 * @param {string} postId
 * @param {unknown} storedImages
 */
export function publicImagePaths(postId, storedImages) {
  if (!Array.isArray(storedImages)) return [];
  const out = [];
  for (const raw of storedImages.slice(0, MAX_COMMUNITY_IMAGES)) {
    if (typeof raw !== 'string' || !raw) continue;
    out.push(communityMediaPath(postId, raw));
  }
  return out;
}

/**
 * 토큰에 해당하는 원본 URL 찾기. 없으면 null.
 * @param {string} postId
 * @param {unknown} storedImages
 * @param {string} token
 */
export function resolveStoredImage(postId, storedImages, token) {
  if (!Array.isArray(storedImages) || typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) return null;
  for (const raw of storedImages.slice(0, MAX_COMMUNITY_IMAGES)) {
    if (typeof raw !== 'string' || !raw) continue;
    if (communityMediaToken(postId, raw) === token) return raw;
  }
  return null;
}

/**
 * 앱 자체 Storage 버킷 화이트리스트. `community-posts.js` 의 작성 시 검증과 같은 규칙 —
 * 프록시가 **읽을 때도** 다시 본다(레거시 문서에 검증 이전 값이 남아 있을 수 있으므로 SSRF 방어).
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
 * 이 URL 을 서버가 대신 받아 와도 되는가. 우리 프로젝트 버킷의 `community/` 경로만 허용.
 * @param {string} rawUrl
 * @returns {boolean}
 */
export function isFetchableCommunityImage(rawUrl) {
  const buckets = allowedBuckets();
  if (buckets.size === 0) return false;   // 버킷 확인 불가 = fail-closed
  let url;
  try { url = new URL(String(rawUrl)); } catch { return false; }
  if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com') return false;
  const m = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
  if (!m) return false;
  if (!buckets.has(m[1])) return false;
  let objectPath;
  try { objectPath = decodeURIComponent(m[2]); } catch { return false; }
  return objectPath.startsWith('community/');
}
