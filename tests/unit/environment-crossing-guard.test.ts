/**
 * 환경 교차 차단 — Preview 가 Production 을 건드리지 못하게 (2026-07-29 P0).
 *
 * 실측된 구멍 두 개:
 *
 *  1. booking-processor 가 적립을 `https://cocotripkr.com/api/loyalty` 로 **하드코딩** 호출.
 *     Firebase 를 분리해도 이 한 줄 때문에 Preview 샌드박스 결제의 적립이
 *     **운영 API + 운영 Firestore 원장**으로 향한다.
 *
 *  2. paypal-webhook 이 live 서명 검증 실패 시 PAYPAL_SANDBOX_CLIENT_ID 만 있으면
 *     **운영에서도** sandbox 검증을 다시 했다. 운영 배포가 가짜 돈 웹훅을 받아
 *     운영 예약을 환불처리할 수 있었다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeFirestore, FieldValue } from '../helpers/fake-firestore.js';
import { applyRefundEvent, checkEnvironmentMatch } from '../../api/_shared/refund-ledger.js';
import { internalApiBase, internalMoneyApiBase } from '../../api/_shared/internal-base-url.js';
import { resolveIsSandbox } from '../../api/_shared/paypal.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const saved = { ...process.env };
afterEach(() => {
  for (const k of ['VERCEL_ENV', 'VERCEL_URL', 'PAYPAL_ENV']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('1. 돈 API 자기호출 주소 — 운영 도메인 하드코딩 금지', () => {
  it('booking-processor 에 cocotripkr.com 하드코딩이 없다', () => {
    const src = read('api/booking-processor.js');
    expect(src).not.toMatch(/fetch\(\s*[`'"]https:\/\/cocotripkr\.com/);
    expect(src).toContain('internalMoneyApiBase()');
  });

  it('VERCEL_ENV=production 에서만 cocotripkr.com 을 쓴다', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_URL = 'ignored-preview-host.vercel.app';
    expect(internalMoneyApiBase()).toBe('https://cocotripkr.com');
  });

  it('VERCEL_ENV=preview 면 프리뷰 배포 URL 을 쓴다', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_URL = 'cocotrip-abc123-team.vercel.app';
    expect(internalMoneyApiBase()).toBe('https://cocotrip-abc123-team.vercel.app');
    expect(internalMoneyApiBase()).not.toContain('cocotripkr.com');
  });

  it('🔴 주소를 특정할 수 없으면 운영으로 폴백하지 않고 null (적립 보류)', () => {
    process.env.VERCEL_ENV = 'preview';
    delete process.env.VERCEL_URL;
    expect(internalMoneyApiBase()).toBeNull();

    // 로컬(환경변수 없음)도 마찬가지 — 로컬 테스트가 운영 원장을 건드리면 안 된다.
    delete process.env.VERCEL_ENV;
    expect(internalMoneyApiBase()).toBeNull();
  });

  it('링크 생성용 internalApiBase 는 기존대로 운영 폴백을 유지한다 (용도가 다르다)', () => {
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_URL;
    expect(internalApiBase()).toBe('https://cocotripkr.com');
  });

  it('돈·예약·적립 API 자기호출에 운영 도메인 하드코딩이 남아 있지 않다 (전수)', () => {
    const files = [
      'api/booking-processor.js',
      'api/capturePaypalOrder.js',
      'api/captureCartOrder.js',
      'api/admin-replay-booking-notifications.js',
      'api/admin-scan-suspect-bookings.js',
      'api/_shared/booking-processor-trigger.js',
      'api/_shared/ai-planner-trigger.js',
      'api/_shared/booking-confirm.js',
      'api/_crons/processor-retry-sweep.js',
      'api/_crons/ai-planner-retry-sweep.js',
    ];
    for (const f of files) {
      const src = read(f);
      // fetch 대상 URL 에 운영 도메인이 리터럴로 박히면 안 된다.
      expect(src, `${f} 에 운영 도메인 자기호출 하드코딩`).not.toMatch(
        /fetch\(\s*[`'"]https:\/\/cocotripkr\.com/,
      );
    }
  });
});

describe('2. Production 은 Sandbox 웹훅을 절대 받지 않는다', () => {
  it('resolveIsSandbox 는 production 에서 PAYPAL_ENV=sandbox 여도 false', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.PAYPAL_ENV = 'sandbox';
    expect(resolveIsSandbox()).toBe(false);
  });

  it('preview + PAYPAL_ENV=sandbox 일 때만 true', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.PAYPAL_ENV = 'sandbox';
    expect(resolveIsSandbox()).toBe(true);
    process.env.PAYPAL_ENV = '';
    expect(resolveIsSandbox()).toBe(false);
  });

  it('🔴 폴백 자체가 없다 — 이 배포의 환경으로 1회만 검증한다', () => {
    const src = read('api/paypal-webhook.js');
    expect(src).toContain('const isSandboxDeploy = resolveIsSandbox();');
    expect(src).toMatch(/const activeWebhookId = isSandboxDeploy/);
    // 두 번째 검증 호출이 존재하면 안 된다.
    expect(src.match(/await verifyWebhookSignature\(/g) || []).toHaveLength(1);
    // 옛 폴백 형태들이 되살아나면 실패한다.
    expect(src).not.toMatch(/!verifyResult\.verified\s*&&\s*process\.env\.PAYPAL_SANDBOX_CLIENT_ID/);
    expect(src).not.toMatch(/!verifyResult\.verified\s*&&\s*sandboxAllowed/);
  });

  it('검증 전에는 unverified, 통과해야 환경이 확정된다', () => {
    const src = read('api/paypal-webhook.js');
    expect(src).toContain("let verifiedEnvironment = 'unverified'");
    expect(src).toMatch(/verifiedEnvironment = isSandboxDeploy \? 'sandbox' : 'live'/);
    expect(src).toContain('paypalEnvironment: environment');
    expect(src).toContain('environment: verifiedEnvironment');
  });
});

describe('3. 웹훅 환경 ≠ 예약 환경이면 데이터를 갱신하지 않는다', () => {
  const seed = (env: string | null) => ({
    'bookings/ORD-1': {
      bookingRef: 'CT-20260729-001', captureID: 'CAP-1',
      amountUSD: 9.9, status: 'CONFIRMED',
      ...(env ? { paypalEnvironment: env } : {}),
    },
  });
  const ev = (over: Record<string, unknown>) => ({
    FieldValue, eventType: 'PAYMENT.CAPTURE.REFUNDED', captureId: 'CAP-1',
    bookingsDocId: 'ORD-1', bookingRef: 'CT-20260729-001',
    refundedUSD: 9.9, refundedKRW: 0, ...over,
  });

  it('🔴 sandbox 웹훅이 운영 예약을 환불처리하지 못한다', async () => {
    const db = createFakeFirestore(seed('live'));
    const r = await applyRefundEvent(ev({ db, eventId: 'E1', refundId: 'R1', webhookEnvironment: 'sandbox' }) as never);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('environment_mismatch');
    expect(db.__get('bookings/ORD-1')!.status).toBe('CONFIRMED');
    expect(db.__get('bookings/ORD-1')!.refundedUSDTotal).toBeUndefined();
    expect(db.__get('paypal_webhook_log/E1')!.status).toBe('environment_mismatch');
  });

  it('🔴 반대 방향 — live 웹훅이 샌드박스 예약을 건드리지 못한다', async () => {
    const db = createFakeFirestore(seed('sandbox'));
    const r = await applyRefundEvent(ev({ db, eventId: 'E2', refundId: 'R2', webhookEnvironment: 'live' }) as never);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('environment_mismatch');
    expect(db.__get('bookings/ORD-1')!.refundedUSDTotal).toBeUndefined();
  });

  it('환경이 같으면 정상 처리된다', async () => {
    const db = createFakeFirestore(seed('sandbox'));
    const r = await applyRefundEvent(ev({ db, eventId: 'E3', refundId: 'R3', webhookEnvironment: 'sandbox' }) as never);
    expect(r.applied).toBe(true);
    expect(db.__get('bookings/ORD-1')!.status).toBe('REFUNDED');
  });

  it('환경 표시가 없는 레거시 예약은 live 웹훅만 허용한다', () => {
    expect(checkEnvironmentMatch(null, 'live').ok).toBe(true);
    expect(checkEnvironmentMatch(null, 'sandbox').ok).toBe(false);
    // 🔴 검증되지 않은 웹훅(unverified)은 레거시 예약도 건드리지 못한다.
    expect(checkEnvironmentMatch(null, undefined).ok).toBe(false);
    expect(checkEnvironmentMatch(null, 'unverified').ok).toBe(false);
  });

  it('결제 시점에 환경이 예약 문서에 박힌다', () => {
    expect(read('api/capturePaypalOrder.js')).toContain("paypalEnvironment: _isSandboxCapture ? 'sandbox' : 'live'");
    expect(read('api/captureCartOrder.js')).toContain("paypalEnvironment: isSandbox ? 'sandbox' : 'live'");
  });
});
