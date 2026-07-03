/**
 * MOOD 광고사 생성 — mood-create-client 엔드포인트 보안 + 프론트 배선 소스가드 (2026-06-14).
 *
 * 운영자 전용으로 mood_clients/{id} 생성(잔액 0). 첫 client 면 allowlist.clientId 기본지정
 * (단, clientId 필드만 merge — 접근권한 admins/emails 는 절대 무변경).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/mood-create-client.js'), 'utf8');

describe('mood-create-client 엔드포인트 — 보안 가드', () => {
  it('운영자(admin) 전용 — verifyUserToken + emailVerified + isAdminEmail', () => {
    expect(src).toContain('verifyUserToken');
    expect(src).toMatch(/emailVerified/);
    expect(src).toMatch(/isAdminEmail\(allowlist, email\)/);
  });

  it('mood_clients 생성 + 중복 가드(runTransaction, CLIENT_EXISTS)', () => {
    expect(src).toContain("collection('mood_clients')");
    expect(src).toContain('runTransaction');
    expect(src).toContain('CLIENT_EXISTS');
    expect(src).toMatch(/balanceKRW:\s*0/); // 잔액 0 으로 생성
  });

  it('allowlist.clientId 는 빈 경우에만 + clientId 필드만 merge (접근권한 무변경)', () => {
    // !allowlist.clientId 일 때만 세팅
    expect(src).toMatch(/if\s*\(\s*!allowlist\.clientId\s*\)/);
    // merge 로 clientId 만 — admins/emails 미포함
    expect(src).toMatch(/set\(\s*\{\s*clientId\s*\},\s*\{\s*merge:\s*true\s*\}\s*\)/);
    const setBlock = src.slice(src.indexOf('!allowlist.clientId'), src.indexOf('!allowlist.clientId') + 200);
    expect(setBlock).not.toMatch(/admins|emails/);
  });

  it('clientId 형식 검증 (영문/숫자/하이픈)', () => {
    expect(src).toMatch(/CLIENT_ID_RE\s*=\s*\/\^\[a-zA-Z0-9_-\]/);
  });
});

describe('MoodPortal — 운영자 전용 기능 제거됨 (2026-07-03)', () => {
  // /mood 는 MOOD(광고사)가 보는 곳 → 운영자 전용 충전·광고사관리는 어드민으로 이관.
  // 광고사 생성은 어드민/콘솔에서. mood-create-client API(위 블록)는 그대로 유지.
  const portal = readFileSync(resolve(process.cwd(), 'src/pages/MoodPortal.tsx'), 'utf8');
  it('충전 폼 제거 — /mood 에 topup UI 없음(어드민 MoodTopupModal 전용)', () => {
    expect(portal).not.toContain('handleTopup');
    expect(portal).not.toContain('setTopupClientId');
    expect(portal).not.toContain('/api/mood-topup');
  });
  it('광고사 만들기 제거 — /mood 에 create-client UI 없음', () => {
    expect(portal).not.toContain('handleCreateClient');
    expect(portal).not.toContain('/api/mood-create-client');
    expect(portal).not.toMatch(/광고사 만들기 \(admin 전용\)/);
  });
});
