// @vitest-environment jsdom
/**
 * 추정가(charter_custom_estimate) 결제 전 동의 (2026-07-30, P0-2).
 *
 * 🔴 고친 문제
 *   - `/charter` 공개 본문 4개 언어가 "결제 후 추가 청구는 하지 않습니다" 라고 단정했다.
 *   - 그런데 이 상품은 실제 거리·시간이 추정과 ±10% 넘게 다르면 추가 청구 또는 부분 환불을 한다.
 *   - `estimatePayDisclaimer` · `estimatePayAgreeLabel` 번역은 4개 언어 다 있는데 **호출처가 0건**이었다.
 *   - 고지는 결제 **후** 메일·바우처·월렛패스에만 있었다. 결제 후 고지는 결제 전 동의를 대신 못 한다.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ESTIMATE_POLICY_VERSION as FRONT_VERSION,
  ESTIMATE_RECONCILE_TOLERANCE_PCT as FRONT_PCT,
} from '../../src/lib/estimateConsent';
import {
  ESTIMATE_POLICY_VERSION as SERVER_VERSION,
  ESTIMATE_RECONCILE_TOLERANCE_PCT as SERVER_PCT,
  buildEstimateConsentRecord,
} from '../../api/_shared/estimate-consent.js';
import { EstimateConsentBox } from '../../src/components/charter/EstimateConsentBox';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('정책 상수 — 프론트 미러와 서버 정본이 동기', () => {
  it('정책 버전이 같다 (다르면 옛 번들의 동의가 서버에서 거부된다)', () => {
    expect(FRONT_VERSION).toBe(SERVER_VERSION);
    expect(FRONT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\./);
  });

  it('허용 오차가 같고 현재 정책은 ±10%', () => {
    expect(FRONT_PCT).toBe(SERVER_PCT);
    expect(FRONT_PCT).toBe(10);
  });

  it('4개 언어 안내 문구가 실제로 10% 를 말한다 (상수와 문구가 어긋나면 실패)', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const json = JSON.parse(src(`src/i18n/locales/${lang}.json`));
      const disclaimer = json.charterWizard.estimatePayDisclaimer;
      expect(disclaimer, `${lang} estimatePayDisclaimer 없음`).toBeTruthy();
      expect(disclaimer, `${lang} 문구가 ±${FRONT_PCT}% 를 말하지 않는다`).toContain(`${FRONT_PCT}%`);
      expect(json.charterWizard.estimatePayAgreeLabel, `${lang} 동의 라벨 없음`).toBeTruthy();
    }
  });
});

describe('서버 fail-closed — buildEstimateConsentRecord', () => {
  it('동의 없음 → 거부 (ESTIMATE_CONSENT_REQUIRED)', () => {
    expect(buildEstimateConsentRecord(undefined).ok).toBe(false);
    expect(buildEstimateConsentRecord(null).code).toBe('ESTIMATE_CONSENT_REQUIRED');
    expect(buildEstimateConsentRecord({}).code).toBe('ESTIMATE_CONSENT_REQUIRED');
    expect(buildEstimateConsentRecord({ agreed: false, policyVersion: SERVER_VERSION }).code)
      .toBe('ESTIMATE_CONSENT_REQUIRED');
  });

  it("문자열 'true' 같은 느슨한 값도 거부 — 정확히 boolean true 만", () => {
    expect(buildEstimateConsentRecord({ agreed: 'true', policyVersion: SERVER_VERSION }).ok).toBe(false);
    expect(buildEstimateConsentRecord({ agreed: 1, policyVersion: SERVER_VERSION }).ok).toBe(false);
  });

  it('정책 버전 불일치 → 거부 (ESTIMATE_CONSENT_STALE)', () => {
    const r = buildEstimateConsentRecord({ agreed: true, policyVersion: '2020-01-01.old' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ESTIMATE_CONSENT_STALE');
  });

  it('유효 동의 → 정책 버전 + 허용 오차 + **서버 시각** 기록', () => {
    const now = new Date('2026-07-30T12:34:56.000Z');
    const r = buildEstimateConsentRecord({ agreed: true, policyVersion: SERVER_VERSION }, now);
    expect(r.ok).toBe(true);
    expect(r.record).toEqual({
      agreed: true,
      policyVersion: SERVER_VERSION,
      tolerancePct: 10,
      agreedAtServer: '2026-07-30T12:34:56.000Z',
    });
  });

  it('🔴 클라이언트가 보낸 시각은 기록에 들어가지 않는다 (위조·시계 오차 무력화)', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');
    const r = buildEstimateConsentRecord(
      { agreed: true, policyVersion: SERVER_VERSION, agreedAt: '1999-01-01T00:00:00.000Z' },
      now,
    );
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.record)).not.toContain('1999');
    expect(r.record.agreedAtServer).toBe('2026-07-30T12:00:00.000Z');
  });
});

describe('주문 생성 API 배선 (소스 잠금)', () => {
  const server = src('api/createPaypalOrder.js');

  it('custom estimate 분기에서 금액 계산보다 **먼저** 동의를 검사한다', () => {
    const branchIdx = server.indexOf('isCustomEstimateProduct(productType)');
    const consentIdx = server.indexOf('buildEstimateConsentRecord(body.estimateConsent)');
    const amountIdx = server.indexOf('Number(body.customAmountKRW)');
    expect(branchIdx).toBeGreaterThan(-1);
    expect(consentIdx).toBeGreaterThan(branchIdx);
    expect(consentIdx, '동의 검사가 금액 해석보다 뒤에 있으면 fail-closed 가 아니다')
      .toBeLessThan(amountIdx);
  });

  it('거부 시 400 으로 끝낸다 (주문 미생성)', () => {
    expect(server).toMatch(/if \(!_consent\.ok\) \{[\s\S]{0,220}res\.writeHead\(400, JSON_CORS\)/);
  });

  it('주문 스냅샷에 동의 기록을 남긴다', () => {
    expect(server).toMatch(/estimateConsent: estimateConsentRecord/);
  });

  it('capture 는 body 가 아니라 **스냅샷**의 동의만 예약 문서에 쓴다', () => {
    const capture = src('api/capturePaypalOrder.js');
    expect(capture).toMatch(/_snapEstimateConsent = _s\.estimateConsent/);
    expect(capture).toMatch(/estimateConsent: _snapEstimateConsent \|\| null/);
  });
});

describe('화면 게이트 — 동의 전에는 결제 불가', () => {
  it('EstimateConsentBox 가 고지문과 필수 체크박스를 렌더한다', () => {
    const onChange = vi.fn();
    render(<EstimateConsentBox language="ko" agreed={false} onChange={onChange} />);
    const box = screen.getByTestId('estimate-consent-box');
    expect(box.textContent).toContain('10%');
    // 이 하네스는 EN 번들만 eager 라 언어별 문자열 대신 정책 수치로 확인한다(문구는 아래 4언어 케이스).
    expect(box.textContent).toMatch(/estimate/i);

    const cb = screen.getByTestId('estimate-consent-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('4개 언어 모두 고지문이 나온다', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
      const { getByTestId, unmount } = render(
        <EstimateConsentBox language={lang} agreed={false} onChange={() => {}} />,
      );
      expect(getByTestId('estimate-consent-box').textContent!.length).toBeGreaterThan(20);
      expect(getByTestId('estimate-consent-box').textContent).toContain('10%');
      unmount();
    }
  });

  it('CharterNewPage 가 미동의 시 PayPal 버튼을 비활성화하고 동의를 함께 보낸다', () => {
    const page = src('src/pages/CharterNewPage.tsx');
    expect(page).toMatch(/<EstimateConsentBox\s+language=\{language\}\s+agreed=\{estimateAgreed\}/);
    expect(page).toMatch(/disabled=\{!estimateAgreed\}/);
    expect(page).toMatch(/estimateConsent=\{\{ agreed: estimateAgreed, policyVersion: ESTIMATE_POLICY_VERSION \}\}/);
  });

  it('PayPalBookingButton 은 disabled 면 주문 생성 요청 자체를 만들지 않는다', () => {
    const btn = src('src/components/PayPalBookingButton.tsx');
    // 화면 속성만 잠그면 프로그램적 호출로 뚫린다 → 핸들러 첫 줄에서 막아야 한다.
    expect(btn).toMatch(/async function handleBookClick\(\) \{[\s\S]{0,400}if \(disabled\) return;/);
    expect(btn).toMatch(/disabled=\{loading \|\| disabled\}/);
  });
});

describe('확정 가격 상품과 문구가 분리돼 있다', () => {
  it('SEO 본문이 "추가 청구 없음" 을 확정가 상품에만 쓴다', () => {
    const seo = src('src/components/charter/CharterSeoInfo.tsx');
    // 무조건적인 "결제 후 추가 청구는 하지 않습니다" 단정이 사라졌는지.
    expect(seo).not.toMatch(/가격은 결제 전 화면에 전액 표시됩니다\. 결제 후 추가 청구는 하지 않습니다\./);
    expect(seo).not.toMatch(/The full price is shown before payment\. We do not add charges afterwards\./);
    // 확정가/추정가를 나눠 말한다.
    expect(seo).toMatch(/확정 가격 상품은 결제 전 화면에 전액이 표시되고/);
    expect(seo).toMatch(/fixed-price products/);
    expect(seo).toMatch(/tolerancePct/);
  });
});
