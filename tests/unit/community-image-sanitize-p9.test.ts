/**
 * 커뮤니티 사진 첨부 보안 게이트 (UIUX P9, 2026-07-13)
 * sanitizeImages 는 본인 Firebase Storage community/{uid}/ 경로의 다운로드 URL 만 통과시켜야 함.
 * 임의 외부 URL(핫링크·피싱 이미지), 타인 경로 주입, 비-firebase 호스트를 전부 차단하는지 고정.
 * 이 게이트가 무너지면 게시글 images[] 로 임의 URL 이 저장·표시되므로 SAFETY 성격.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sanitizeImages } from '../../api/community-posts.js';

const UID = 'user123';
const BUCKET = 'cocotrip-test.appspot.com';
// sanitizeImages 는 FIREBASE_PROJECT_ID(또는 FIREBASE_STORAGE_BUCKET)로 앱 버킷을 도출.
beforeAll(() => { process.env.FIREBASE_PROJECT_ID = 'cocotrip-test'; });

const bucketUrl = (bucket: string, path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=abc`;
const okUrl = (path: string) => bucketUrl(BUCKET, path);

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
    expect(sanitizeImages([`http://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/community%2Fuser123%2F1.jpg`], UID)).toEqual([]); // http (not https)
    expect(sanitizeImages(['javascript:alert(1)'], UID)).toEqual([]);
  });

  it('타 프로젝트 버킷(공격자 버킷) 주입은 차단 — host 만이 아니라 bucket 대조 (리뷰 fix)', () => {
    // firebasestorage.googleapis.com 은 전 세계 공용 호스트. 공격자가 자기 버킷에
    // community/{uid}/ 경로로 올려도 앱 자체 버킷이 아니면 거부해야 함.
    const attacker = bucketUrl('attacker-project.appspot.com', `community/${UID}/x.jpg`);
    expect(sanitizeImages([attacker], UID)).toEqual([]);
    // .firebasestorage.app 신규 도메인 형식도 도출 버킷과 일치할 때만 통과
    expect(sanitizeImages([bucketUrl('cocotrip-test.firebasestorage.app', `community/${UID}/x.jpg`)], UID)).toHaveLength(1);
  });

  it('FIREBASE_PROJECT_ID 미설정 시 fail-closed (전 이미지 거부)', () => {
    const saved = process.env.FIREBASE_PROJECT_ID;
    const savedBucket = process.env.FIREBASE_STORAGE_BUCKET;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_STORAGE_BUCKET;
    expect(sanitizeImages([okUrl(`community/${UID}/1.jpg`)], UID)).toEqual([]);
    process.env.FIREBASE_PROJECT_ID = saved;
    if (savedBucket) process.env.FIREBASE_STORAGE_BUCKET = savedBucket;
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
