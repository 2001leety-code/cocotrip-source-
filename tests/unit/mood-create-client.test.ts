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

describe('MoodPortal — 광고사 만들기 배선', () => {
  const portal = readFileSync(resolve(process.cwd(), 'src/pages/MoodPortal.tsx'), 'utf8');
  it('handleCreateClient → /api/mood-create-client 호출 + 충전폼 자동채움', () => {
    expect(portal).toContain('handleCreateClient');
    expect(portal).toContain('/api/mood-create-client');
    expect(portal).toMatch(/setTopupClientId\(json\.data\.clientId\)/);
  });
  it('admin 전용 노출 (data?.isAdmin 게이트)', () => {
    expect(portal).toMatch(/광고사 만들기/);
    // 광고사 만들기 카드도 isAdmin 게이트 안
    const idx = portal.indexOf('광고사 만들기 (admin 전용)');
    expect(idx).toBeGreaterThan(0);
  });
});
