/**
 * feat/guest-anon-auth-pii (2026-06-15): 게스트(비로그인) 플랜 보호용 격리 익명
 * Firebase 인스턴스 + 플랜 읽기 fallback 회귀 테스트.
 *
 * 최우선 제약: VITE_FEATURE_GUEST_ANON_AUTH 플래그 OFF(기본) = 기존 동작 100% 동일.
 *   - 순수 헬퍼(chooseReaderContext / shouldAttachGuestAnonToken)는 flagOn 을 명시
 *     주입받아 env 비의존 → 양쪽 분기 직접 검증.
 *   - 소스 정규식 가드로 (1) 플래그 게이트 존재 (2) OFF 경로(기존 db/uid/autherror) 보존
 *     (3) 결제 Authorization 헤더 불변 (4) 신규 코드 nullish 연산자 미사용 을 확인.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  chooseReaderContext,
  shouldAttachGuestAnonToken,
} from '../../src/lib/guestReader';

const ROOT = resolve(__dirname, '../..');

describe('chooseReaderContext — db/uid 선택 분기', () => {
  it('플래그 OFF = 항상 메인 경로 (게스트여도 useGuestReader=false)', () => {
    expect(chooseReaderContext({ loggedInUid: null, flagOn: false }).useGuestReader).toBe(false);
    expect(chooseReaderContext({ loggedInUid: 'user-123', flagOn: false }).useGuestReader).toBe(false);
    expect(chooseReaderContext({ loggedInUid: undefined, flagOn: false }).useGuestReader).toBe(false);
  });

  it('플래그 ON + 로그인 사용자 = 메인 경로 (로그인은 기존 db/uid)', () => {
    expect(chooseReaderContext({ loggedInUid: 'user-123', flagOn: true }).useGuestReader).toBe(false);
  });

  it('플래그 ON + 비로그인 게스트 = 게스트 익명 인스턴스', () => {
    expect(chooseReaderContext({ loggedInUid: null, flagOn: true }).useGuestReader).toBe(true);
    expect(chooseReaderContext({ loggedInUid: undefined, flagOn: true }).useGuestReader).toBe(true);
    expect(chooseReaderContext({ loggedInUid: '', flagOn: true }).useGuestReader).toBe(true);
  });
});

describe('shouldAttachGuestAnonToken — 게스트 익명 토큰 헤더 첨부 분기', () => {
  it('플래그 OFF = 절대 첨부 안 함 (게스트여도)', () => {
    expect(shouldAttachGuestAnonToken(false, false)).toBe(false);
    expect(shouldAttachGuestAnonToken(true, false)).toBe(false);
  });

  it('플래그 ON + Authorization 있음(로그인) = 첨부 안 함', () => {
    expect(shouldAttachGuestAnonToken(true, true)).toBe(false);
  });

  it('플래그 ON + Authorization 없음(게스트) = 첨부', () => {
    expect(shouldAttachGuestAnonToken(false, true)).toBe(true);
  });
});

describe('소스 회귀 가드 — 플래그 게이트 + OFF 경로 보존', () => {
  it('guestReader.ts: VITE_FEATURE_GUEST_ANON_AUTH 게이트 + 신규 코드 nullish 0', () => {
    const src = readFileSync(resolve(ROOT, 'src/lib/guestReader.ts'), 'utf8');
    expect(src).toContain("VITE_FEATURE_GUEST_ANON_AUTH === 'true'");
    expect(src.includes('?' + '?')).toBe(false);
  });

  it('PlanDetailPage: 소유자 onSnapshot + 비소유자 /api/get-plan (PII wire 누출 차단)', () => {
    // fix/plan-pii-wire-leak (2026-06-20): 게스트 익명 onSnapshot read 경로 제거.
    //   이전엔 비로그인 게스트가 격리 익명 인스턴스(getGuestDb/ensureGuestAnon)로 plans 를
    //   직접 onSnapshot → raw doc 이 WebSocket 프레임에 노출됐다. 이제 비소유자(비로그인 +
    //   로그인 비소유자)는 /api/get-plan(서버 마스킹) 경유만, 소유자만 onSnapshot.
    const src = readFileSync(resolve(ROOT, 'src/pages/PlanDetailPage/index.tsx'), 'utf8');
    // 소유자(로그인 본인) 경로 = 메인 db onSnapshot 유지
    expect(src).toContain("onSnapshot(doc(db, 'plans', planId)");
    expect(src).toContain("setError('autherror')");
    // 비소유자 경로 = 서버 경유 읽기 (wire 전에 서버 마스킹)
    expect(src).toContain('fetchViaApi');
    expect(src).toContain('/api/get-plan');
    // 비로그인은 onSnapshot 절대 안 함 → uid 없으면 fetchViaApi 후 early return
    expect(src).toMatch(/if\s*\(\s*!uid\s*\)\s*\{[\s\S]*?fetchViaApi/);
    // 게스트 익명 onSnapshot read 경로(누출 원인)는 완전히 제거됨
    expect(src).not.toContain('getGuestDb');
    expect(src).not.toContain('ensureGuestAnon');
    expect(src).not.toContain('chooseReaderContext');
    // 마스킹 로직 보존 (방어심층 — 멱등)
    expect(src).toContain('delete data.accessToken');
  });

  it('usePlannerHandlers: 결제 Authorization 헤더 불변 + 익명은 별도 헤더만', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/PlannerPage/hooks/usePlannerHandlers.ts'), 'utf8');
    // 기존 결제 인증 헤더 패턴 보존
    expect(src).toContain('Authorization: `Bearer ${idToken}`');
    // 익명 토큰은 별도 헤더명 (Authorization 미변경)
    expect(src).toContain('x-guest-anon-token');
    expect(src).toContain('shouldAttachGuestAnonToken');
    // 두 호출처 모두 guestAnonHeaders spread (handlePaymentSuccess + handleRevisionRegenerate)
    const spreadCount = (src.match(/\.\.\.guestAnonHeaders/g) || []).length;
    expect(spreadCount).toBe(2);
  });
});
