/**
 * 커뮤니티 공개 응답의 개인정보 + 숨김 글의 댓글 (2026-07-30, P1-3).
 *
 * 🔴 고친 문제 1 — 사진 한 장이면 uid 가 샜다.
 *   `serializePost` 는 `authorUid` 를 지웠지만 `images` 는 Firebase Storage **다운로드 URL**
 *   그대로였고, 그 경로가 `community/{uid}/...` 다. 즉 uid 제거는 절반만 된 상태였다.
 *   기존 테스트(`community-public-privacy.test.ts`)는 `images: []` 인 문서만 봐서 통과했다 —
 *   **비어 있지 않은 실제 형태**를 넣으면 바로 드러난다. 이 파일이 그 케이스를 잠근다.
 *
 * 🔴 고친 문제 2 — 숨긴 글의 댓글은 계속 읽혔다.
 *   `community-translate` 가 댓글 문서의 status 만 봤다. 부모 글이 신고로 숨겨지거나 삭제돼도
 *   댓글은 active 로 남으므로, replyId 만 알면 숨겨진 대화를 계속 꺼낼 수 있었다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { serializePost, serializeReply } from '../../api/community-posts.js';
import {
  communityMediaToken,
  publicImagePaths,
  resolveStoredImage,
  isFetchableCommunityImage,
} from '../../api/_shared/community-media.js';

const UID = 'AbCdEf1234567890UserUid';
const EMAIL = 'traveler@example.com';
const BUCKET = 'cocotrip-test.firebasestorage.app';

/** 운영에 실제로 저장돼 있는 형태의 다운로드 URL. */
function storageUrl(uid, name) {
  const path = encodeURIComponent(`community/${uid}/${name}`);
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${path}?alt=media&token=9f1c2b7a-0000-4a11-9c3d-abcdef123456`;
}

const POST_DOC = {
  title: '서울 3일 코스 추천',
  body: '명동 근처 숙소로 잡았습니다.',
  lang: 'ko',
  type: 'question',
  category: 'seoul',
  authorName: 'Traveler',
  authorUid: UID,
  authorEmail: EMAIL,
  likeCount: 2,
  replyCount: 1,
  status: 'active',
  createdAt: { toMillis: () => 1_753_800_000_000 },
  translations: { en: { title: 'Seoul 3-day course', body: 'Stayed near Myeongdong.' } },
  images: [storageUrl(UID, 'photo-1.webp'), storageUrl(UID, 'photo-2.webp')],
};

/** 응답 안의 **모든 중첩 문자열**을 모은다 — 눈에 보이는 필드만 보면 이번 사고를 또 놓친다. */
function allStrings(value, out = []) {
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { for (const v of value) allStrings(v, out); return out; }
  if (value && typeof value === 'object') { for (const v of Object.values(value)) allStrings(v, out); return out; }
  return out;
}

describe('공개 응답 — 이미지가 있어도 uid·이메일 0건', () => {
  it('🔴 images 가 비어 있지 않은 실제 형태에서도 uid 가 없다', () => {
    const pub = serializePost('post-1', POST_DOC, null);
    expect(pub.images).toHaveLength(2);
    const joined = allStrings(pub).join('\n');
    expect(joined, 'uid 가 응답 어딘가에 남아 있다').not.toContain(UID);
    expect(joined, '이메일이 응답 어딘가에 남아 있다').not.toContain(EMAIL);
  });

  it('원본 저장 경로(community/{uid}/) 자체가 나가지 않는다', () => {
    const pub = serializePost('post-1', POST_DOC, null);
    const joined = allStrings(pub).join('\n');
    expect(joined).not.toContain('community/');
    expect(joined).not.toContain('firebasestorage.googleapis.com');
    // Storage 다운로드 토큰도 함께 사라져야 한다.
    expect(joined).not.toContain('9f1c2b7a');
  });

  it('공개 이미지 경로는 불투명 토큰 형태다', () => {
    const pub = serializePost('post-1', POST_DOC, null);
    for (const p of pub.images) {
      expect(p).toMatch(/^\/api\/community-image\?p=post-1&m=[a-f0-9]{32}$/);
    }
  });

  it('로그인 뷰어여도 uid 는 안 나가고 isOwn 만 알려 준다', () => {
    const mine = serializePost('post-1', POST_DOC, UID);
    const other = serializePost('post-1', POST_DOC, 'someone-else');
    expect(mine.isOwn).toBe(true);
    expect(other.isOwn).toBe(false);
    expect(allStrings(mine).join('\n')).not.toContain(UID);
    expect(mine).not.toHaveProperty('authorUid');
    expect(mine).not.toHaveProperty('authorEmail');
  });

  it('댓글 응답도 uid·이메일 0건', () => {
    const reply = serializeReply('reply-1', {
      body: '저도 명동 추천합니다',
      lang: 'ko',
      authorName: 'Guide',
      authorUid: UID,
      authorEmail: EMAIL,
      createdAt: { toMillis: () => 1_753_800_000_000 },
    }, null);
    const joined = allStrings(reply).join('\n');
    expect(joined).not.toContain(UID);
    expect(joined).not.toContain(EMAIL);
  });
});

describe('미디어 토큰 — 되돌릴 수 없고 레거시도 그대로 동작', () => {
  it('같은 (글, 파일)이면 항상 같은 토큰 — 파일을 옮기지 않아도 된다', () => {
    const url = storageUrl(UID, 'photo-1.webp');
    expect(communityMediaToken('post-1', url)).toBe(communityMediaToken('post-1', url));
  });

  it('글이 다르면 토큰도 다르다 (다른 글에서 재사용 불가)', () => {
    const url = storageUrl(UID, 'photo-1.webp');
    expect(communityMediaToken('post-1', url)).not.toBe(communityMediaToken('post-2', url));
  });

  it('토큰에서 uid·경로를 복원할 수 없다', () => {
    const token = communityMediaToken('post-1', storageUrl(UID, 'photo-1.webp'));
    expect(token).not.toContain(UID);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it('토큰 → 원본 URL 역인덱스는 그 글의 이미지 안에서만 찾는다', () => {
    const images = POST_DOC.images;
    const token = communityMediaToken('post-1', images[1]);
    expect(resolveStoredImage('post-1', images, token)).toBe(images[1]);
    // 다른 글의 토큰으로는 못 찾는다.
    expect(resolveStoredImage('post-2', images, token)).toBeNull();
    expect(resolveStoredImage('post-1', images, 'z'.repeat(32))).toBeNull();
    expect(resolveStoredImage('post-1', images, 'short')).toBeNull();
  });

  it('images 가 비었거나 이상해도 throw 하지 않는다', () => {
    expect(publicImagePaths('p', undefined)).toEqual([]);
    expect(publicImagePaths('p', null)).toEqual([]);
    expect(publicImagePaths('p', [123, null, ''])).toEqual([]);
  });

  it('최대 3장까지만 노출한다 (작성 시 제한과 동일)', () => {
    const many = Array.from({ length: 7 }, (_, i) => storageUrl(UID, `p${i}.webp`));
    expect(publicImagePaths('post-1', many)).toHaveLength(3);
  });
});

describe('프록시 SSRF 가드 — 우리 버킷의 community/ 경로만 가져온다', () => {
  const prev = { ...process.env };
  afterAll(() => { process.env = prev; });

  it('다른 호스트·다른 버킷·다른 경로는 거부', () => {
    process.env.FIREBASE_STORAGE_BUCKET = BUCKET;
    expect(isFetchableCommunityImage(storageUrl(UID, 'x.webp'))).toBe(true);
    expect(isFetchableCommunityImage('https://evil.example.com/x.webp')).toBe(false);
    expect(isFetchableCommunityImage(
      `https://firebasestorage.googleapis.com/v0/b/attacker.appspot.com/o/${encodeURIComponent('community/x/y.webp')}?alt=media`,
    )).toBe(false);
    expect(isFetchableCommunityImage(
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent('private/secrets.json')}?alt=media`,
    )).toBe(false);
    expect(isFetchableCommunityImage('not-a-url')).toBe(false);
  });

  it('버킷 확인 불가 = fail-closed (전부 거부)', () => {
    delete process.env.FIREBASE_STORAGE_BUCKET;
    delete process.env.FIREBASE_PROJECT_ID;
    expect(isFetchableCommunityImage(storageUrl(UID, 'x.webp'))).toBe(false);
  });
});

describe('숨김·삭제된 부모 글의 댓글은 번역되지 않는다', () => {
  const code = readFileSync(join(process.cwd(), 'api/community-translate.js'), 'utf8');

  it('replyId 요청은 부모 글 status 를 **먼저** 확인한다', () => {
    const parentCheck = code.indexOf("parent.data().status !== 'active'");
    const replyFetch = code.indexOf('postRef.collection(\'replies\').doc(replyId)');
    expect(parentCheck).toBeGreaterThan(-1);
    expect(parentCheck, '부모 확인이 댓글 조회보다 뒤에 있으면 의미가 없다').toBeLessThan(replyFetch);
  });

  it('부모가 없거나 active 가 아니면 404 로 끝낸다', () => {
    expect(code).toMatch(/if \(!parent\.exists \|\| parent\.data\(\)\.status !== 'active'\) \{[\s\S]{0,160}NOT_FOUND/);
  });

  it('원문 언어 요청(d.lang === targetLang) 조기 반환보다 앞에 있다', () => {
    const parentCheck = code.indexOf("parent.data().status !== 'active'");
    // 주석에도 같은 문자열이 있으므로 **코드 형태**로 찾는다.
    const sameLangShortcut = code.indexOf('if (d.lang === targetLang)');
    expect(sameLangShortcut).toBeGreaterThan(-1);
    expect(parentCheck).toBeLessThan(sameLangShortcut);
  });

  it('이미지 프록시도 숨김 글이면 404', () => {
    const proxy = readFileSync(join(process.cwd(), 'api/community-image.js'), 'utf8');
    expect(proxy).toMatch(/if \(d\.status !== 'active'\) return fail\(res, 404/);
  });
});
