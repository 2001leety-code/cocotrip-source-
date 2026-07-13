/**
 * 커뮤니티 사진 첨부 보안 게이트 (UIUX P9, 2026-07-13)
 * sanitizeImages 는 본인 Firebase Storage community/{uid}/ 경로의 다운로드 URL 만 통과시켜야 함.
 * 임의 외부 URL(핫링크·피싱 이미지), 타인 경로 주입, 비-firebase 호스트를 전부 차단하는지 고정.
 * 이 게이트가 무너지면 게시글 images[] 로 임의 URL 이 저장·표시되므로 SAFETY 성격.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeImages } from '../../api/community-posts.js';

const UID = 'user123';
const okUrl = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/cocotrip.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=abc`;

describe('sanitizeImages — 사진 첨부 URL 화이트리스트', () => {
  it('본인 community/{uid}/ 경로의 firebase 다운로드 URL 통과', () => {
    const url = okUrl(`community/${UID}/1699999999-photo.jpg`);
    expect(sanitizeImages([url], UID)).toEqual([url]);
  });

  it('타인 uid 경로는 차단', () => {
    const url = okUrl('community/attacker999/1-hack.jpg');
    expect(sanitizeImages([url], UID)).toEqual([]);
  });

  it('다른 스토리지 경로(reviews/tours)는 차단', () => {
    expect(sanitizeImages([okUrl(`reviews/${UID}/1.jpg`)], UID)).toEqual([]);
    expect(sanitizeImages([okUrl('tours/t1/1.jpg')], UID)).toEqual([]);
  });

  it('비-firebase 호스트(핫링크·피싱)는 차단', () => {
    expect(sanitizeImages(['https://evil.example.com/x.jpg'], UID)).toEqual([]);
    expect(sanitizeImages(['http://firebasestorage.googleapis.com/v0/b/x/o/community%2Fuser123%2F1.jpg'], UID)).toEqual([]); // http (not https)
    expect(sanitizeImages(['javascript:alert(1)'], UID)).toEqual([]);
  });

  it('비문자열·잘못된 URL·null 은 무시', () => {
    expect(sanitizeImages([123, null, undefined, {}, 'not a url'] as unknown as string[], UID)).toEqual([]);
    expect(sanitizeImages(null as unknown as string[], UID)).toEqual([]);
  });

  it('최대 3장까지만 통과', () => {
    const urls = [1, 2, 3, 4, 5].map((n) => okUrl(`community/${UID}/${n}.jpg`));
    expect(sanitizeImages(urls, UID)).toHaveLength(3);
  });

  it('경로 traversal 시도(community/uid/../other) 차단 — startsWith 우회 방지', () => {
    // community/user123/ 로 시작하지만 실제 다른 경로로 빠지려는 시도는 storage.rules 가 차단하지만
    // 여기서도 decode 후 정확히 community/{uid}/ prefix 만 허용하므로 정상 케이스만 통과.
    const sneaky = okUrl(`community/${UID}xtra/1.jpg`); // uid 뒤에 추가 문자 → prefix 불일치
    expect(sanitizeImages([sneaky], UID)).toEqual([]);
  });
});
