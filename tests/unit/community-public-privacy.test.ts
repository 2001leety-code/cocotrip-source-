/**
 * 공개 커뮤니티 응답 개인정보 잠금 (2026-07-30).
 *
 * 배경: `serializePost` 가 `authorUid`(Firebase uid) 를 공개 피드에 그대로 내려보냈다.
 * 비로그인 누구나 `/api/community-posts` 를 긁어 작성자 uid 를 수집할 수 있었다.
 * uid 는 Storage 경로(`community/{uid}/`)·보안 규칙·다른 컬렉션 키에 쓰이는 내부 식별자다.
 *
 * 이 테스트는 "키 화이트리스트" 로 잠근다 — 새 필드를 실수로 추가하면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const FAKE_DB = { collection: vi.fn() };
let viewerAuth: { ok: boolean; uid?: string; email?: string } = { ok: false };

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => FAKE_DB }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: vi.fn(async () => ({ ok: true })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('../../api/_shared/translator.js', () => ({ detectLanguage: vi.fn(async () => 'en') }));
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: vi.fn(async () => viewerAuth),
}));

const OWNER_UID = 'firebase-uid-owner-0001';
const OTHER_UID = 'firebase-uid-other-0002';

/** Firestore 문서에 실제로 들어 있는 필드 — 공개돼선 안 되는 것까지 포함해 둔다. */
function postDoc() {
  return {
    title: 'Best day trip from Seoul?',
    body: 'Looking for a DMZ tour recommendation.',
    lang: 'en',
    type: 'question',
    category: 'seoul',
    authorName: 'Traveler',
    authorUid: OWNER_UID,
    authorEmail: 'owner@example.com',
    likeCount: 3,
    replyCount: 1,
    status: 'active',
    createdAt: { toMillis: () => 1785000000000 },
    translations: {},
    images: [],
  };
}

function replyDoc() {
  return {
    body: 'Try the Paju course.',
    lang: 'en',
    authorName: 'Local',
    authorUid: OTHER_UID,
    authorEmail: 'local@example.com',
    status: 'active',
    createdAt: { toMillis: () => 1785000100000 },
    translations: {},
  };
}

const POST_PUBLIC_KEYS = [
  'id', 'title', 'body', 'lang', 'type', 'category', 'authorName', 'isOwn',
  'likeCount', 'replyCount', 'createdAt', 'translations', 'images',
].sort();
const REPLY_PUBLIC_KEYS = ['id', 'body', 'lang', 'authorName', 'isOwn', 'createdAt', 'translations'].sort();

/** 응답 어디에도 특정 문자열이 없는지(중첩 포함) 확인. */
function containsValue(obj: unknown, needle: string): boolean {
  return JSON.stringify(obj).includes(needle);
}

describe('serializePost / serializeReply — 공개 필드 화이트리스트', () => {
  it('글: 공개 키만 존재 (authorUid·authorEmail·status 없음)', async () => {
    const { serializePost } = await import('../../api/community-posts.js');
    const out = serializePost('p1', postDoc(), null);
    expect(Object.keys(out).sort()).toEqual(POST_PUBLIC_KEYS);
  });

  it('글: 비로그인 응답에 uid·이메일 문자열이 0건', async () => {
    const { serializePost } = await import('../../api/community-posts.js');
    const out = serializePost('p1', postDoc(), null);
    expect(containsValue(out, OWNER_UID)).toBe(false);
    expect(containsValue(out, 'owner@example.com')).toBe(false);
    expect(out.isOwn).toBe(false);
  });

  it('글: 작성자 본인 요청이면 isOwn=true, 그래도 uid 는 안 내려간다', async () => {
    const { serializePost } = await import('../../api/community-posts.js');
    const out = serializePost('p1', postDoc(), OWNER_UID);
    expect(out.isOwn).toBe(true);
    expect(containsValue(out, OWNER_UID)).toBe(false);
  });

  it('글: 남의 글이면 isOwn=false', async () => {
    const { serializePost } = await import('../../api/community-posts.js');
    expect(serializePost('p1', postDoc(), OTHER_UID).isOwn).toBe(false);
  });

  it('댓글: 공개 키만 + uid·이메일 0건', async () => {
    const { serializeReply } = await import('../../api/community-posts.js');
    const out = serializeReply('r1', replyDoc(), null);
    expect(Object.keys(out).sort()).toEqual(REPLY_PUBLIC_KEYS);
    expect(containsValue(out, OTHER_UID)).toBe(false);
    expect(containsValue(out, 'local@example.com')).toBe(false);
  });

  it('댓글: 본인 댓글이면 isOwn=true', async () => {
    const { serializeReply } = await import('../../api/community-posts.js');
    expect(serializeReply('r1', replyDoc(), OTHER_UID).isOwn).toBe(true);
  });
});

// ── GET 핸들러 전체 경로 (피드·단건) ──────────────────────────────────────
type JsonResponse = { status: number; body: Record<string, unknown> };

function makeRes(): { res: object; result: () => JsonResponse } {
  let status = 0;
  let raw = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(chunk?: string) { raw = chunk || ''; return res; },
  };
  return { res, result: () => ({ status, body: raw ? JSON.parse(raw) : {} }) };
}

function stubDb() {
  const postSnap = {
    docs: [{ id: 'p1', data: () => postDoc() }],
  };
  const repliesSnap = { docs: [{ id: 'r1', data: () => replyDoc() }] };
  FAKE_DB.collection.mockImplementation(() => ({
    orderBy: () => ({ limit: () => ({ get: async () => postSnap }) }),
    doc: () => ({
      get: async () => ({ exists: true, id: 'p1', data: () => postDoc() }),
      collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => repliesSnap }) }) }),
    }),
  }));
}

describe('GET /api/community-posts — 비로그인 응답 잠금', () => {
  beforeEach(() => {
    viewerAuth = { ok: false };
    FAKE_DB.collection.mockReset();
    stubDb();
  });

  it('피드(비로그인): uid·이메일 0건, isOwn 전부 false', async () => {
    const handler = (await import('../../api/community-posts.js')).default;
    const { res, result } = makeRes();
    await handler({ method: 'GET', url: '/api/community-posts?sort=latest', headers: {} }, res);
    const { status, body } = result();
    expect(status).toBe(200);
    expect(containsValue(body, OWNER_UID)).toBe(false);
    expect(containsValue(body, 'owner@example.com')).toBe(false);
    const posts = (body.data as { posts: Array<{ isOwn: boolean }> }).posts;
    expect(posts.every((p) => p.isOwn === false)).toBe(true);
  });

  it('단건 + 댓글(비로그인): uid 0건', async () => {
    const handler = (await import('../../api/community-posts.js')).default;
    const { res, result } = makeRes();
    await handler({ method: 'GET', url: '/api/community-posts?id=p1', headers: {} }, res);
    const { status, body } = result();
    expect(status).toBe(200);
    expect(containsValue(body, OWNER_UID)).toBe(false);
    expect(containsValue(body, OTHER_UID)).toBe(false);
  });

  it('로그인 요청: 검증된 uid 로 isOwn 이 켜지되 uid 자체는 응답에 없다', async () => {
    viewerAuth = { ok: true, uid: OWNER_UID, email: 'owner@example.com' };
    const handler = (await import('../../api/community-posts.js')).default;
    const { res, result } = makeRes();
    await handler(
      { method: 'GET', url: '/api/community-posts?sort=latest', headers: { authorization: 'Bearer token' } },
      res,
    );
    const { body } = result();
    const posts = (body.data as { posts: Array<{ isOwn: boolean }> }).posts;
    expect(posts[0].isOwn).toBe(true);
    expect(containsValue(body, OWNER_UID)).toBe(false);
  });

  it('토큰이 틀려도 공개 피드는 200 (비로그인으로 취급)', async () => {
    viewerAuth = { ok: false };
    const handler = (await import('../../api/community-posts.js')).default;
    const { res, result } = makeRes();
    await handler(
      { method: 'GET', url: '/api/community-posts?sort=latest', headers: { authorization: 'Bearer bad' } },
      res,
    );
    const { status, body } = result();
    expect(status).toBe(200);
    const posts = (body.data as { posts: Array<{ isOwn: boolean }> }).posts;
    expect(posts[0].isOwn).toBe(false);
  });
});
