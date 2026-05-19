/**
 * P95 — PayPal SDK URL excludes unverified digital wallets (Apple Pay / Google Pay).
 *
 * 회귀 차단: `enable-funding=googlepay,applepay` 가 PayPalBookingButton.tsx 의
 * SDK URL 에 재추가되면 PayPal CDN 이 HTTP 400 반환 → SDK 로드 실패 → 결제 불가.
 *
 * 원인 (2026-05-19 사용자 보고): Apple Pay 활성화는 PayPal 머천트 대시보드
 * 도메인 등록 + /.well-known/apple-developer-merchantid-domain-association 호스팅
 * 둘 다 필수. cocotripkr.com 은 미등록 상태 → enable-funding 에 applepay 포함 시
 * "domain not registered" 400 에러로 모든 결제 surface 사망.
 *
 * 검증 대상: src/components/PayPalBookingButton.tsx 의 sdkUrl 구성 부분.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(
  __dirname,
  '../../src/components/PayPalBookingButton.tsx',
);
const src = readFileSync(FILE, 'utf8');

describe('P95 — PayPal SDK URL excludes unverified digital wallets', () => {
  it('sdkUrl 변수 정의 라인 검출', () => {
    const sdkUrlLine = src.match(/const\s+sdkUrl\s*=\s*[`'"][^`'"]+[`'"]/);
    expect(sdkUrlLine).not.toBeNull();
  });

  it('sdkUrl 에 enable-funding=googlepay,applepay 포함 금지 (P95 핵심)', () => {
    // 전체 파일에서 enable-funding=googlepay,applepay 패턴 검출 차단.
    // 단, 코멘트로 "제거" 설명에 등장하는 건 허용 (실 코드 라인에만 차단).
    const lines = src.split(/\r?\n/);
    const violatingLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      // 코멘트 라인 (`//`, `*`) 은 통과
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (/enable-funding=googlepay,applepay/.test(line)) {
        violatingLines.push(line.trim());
      }
      if (/enable-funding=applepay,googlepay/.test(line)) {
        violatingLines.push(line.trim());
      }
    }
    expect(
      violatingLines,
      `enable-funding=googlepay,applepay 가 코드 라인에 재등장 (Apple Pay 도메인 미등록 상태에서 PayPal SDK HTTP 400 회귀). 머천트 대시보드 설정 완료 전까지 제거 유지.`,
    ).toEqual([]);
  });

  it('sdkUrl 에 components=buttons 포함 (코어 PayPal 버튼 SDK 유지)', () => {
    expect(/components=buttons/.test(src)).toBe(true);
  });

  it('sdkUrl 에 client-id, currency, intent 핵심 파라미터 유지', () => {
    expect(/client-id=\$\{resolvedClientId\}/.test(src)).toBe(true);
    expect(/currency=USD/.test(src)).toBe(true);
    expect(/intent=capture/.test(src)).toBe(true);
  });

  it('PayPal 머천트 대시보드 설정 완료 후 복원 안내 코멘트 유지', () => {
    // 미래 누군가 enable-funding 다시 추가하려 할 때 require/why 컨텍스트 보임.
    expect(
      /(머천트\s*대시보드|merchant\s*dashboard)/i.test(src) ||
        /apple-developer-merchantid-domain-association/.test(src),
    ).toBe(true);
  });

  it('PayPal SDK base URL 는 라이브 (www.paypal.com)', () => {
    expect(/https:\/\/www\.paypal\.com\/sdk\/js/.test(src)).toBe(true);
    // sandbox 분기 (sandbox.paypal.com) 회귀 시 fail.
    expect(/sandbox\.paypal\.com\/sdk\/js/.test(src)).toBe(false);
  });
});
