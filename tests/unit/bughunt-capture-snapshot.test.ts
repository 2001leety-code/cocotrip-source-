/**
 * 버그헌트 #11 — 단건 결제 주문 스냅샷(금액↔상품 위조 방지).
 *
 * createPaypalOrder 가 paypal_order_snapshots/{orderID} 에 {productType, expectedUSD, expectedKRW,
 * passengers, dateStart} 저장 → capturePaypalOrder 가 capture-time 클라 body 대신 이 스냅샷의
 * product/pax/date 를 사용해, 저가 주문으로 고가 서비스를 booking 에 위조 기록하는 공격을 무력화.
 * 스냅샷이 없거나 기대금액/통화가 유효하지 않으면 PayPal capture 전에 거절한다.
 * (핸들러는 부작용 import 多 → 직접 호출 대신 소스 구조 가드.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const r = (p: string) => resolve(process.cwd(), p);
const createSrc = readFileSync(r('api/createPaypalOrder.js'), 'utf8');
const captureSrc = readFileSync(r('api/capturePaypalOrder.js'), 'utf8');

describe('버그헌트 #11 — createPaypalOrder 가 주문 스냅샷 영속화', () => {
  it('paypal_order_snapshots/{orderID} 에 productType + expected 금액 저장', () => {
    expect(createSrc).toContain("collection('paypal_order_snapshots')");
    expect(createSrc).toMatch(/doc\(order\.id\)\.set\(/);
    expect(createSrc).toMatch(/productType\s*,/);
    expect(createSrc).toMatch(/expectedUSD:\s*usdAmount/);
    expect(createSrc).toMatch(/expectedKRW:\s*krwAmount/);
  });
  // 🔄 정책 반전 (2026-07-15): 이전엔 best-effort — 스냅샷 쓰기가 실패해도 주문을 진행했다.
  //   이제 이 스냅샷은 AI 플래너 gate 의 **유일한 provenance 근거**다(productType·expectedUSD).
  //   best-effort 를 유지하면 create 시점의 Firestore 깜빡임 하나가 "고객은 결제했는데 상품은
  //   영구 거부"로 이어진다(격리 해제 경로도 없음). → 돈이 움직이기 전인 주문 생성 시점에
  //   fail-closed 로 막는다. 미캡처 PayPal 주문은 무해하게 만료되고 사용자는 안전하게 재시도한다.
  //   createCartOrder.js 가 이미 동일 정책(SNAPSHOT_FAILED 500).
  it('fail-closed — 스냅샷 쓰기 실패 시 주문 ID 를 반환하지 않음 (SNAPSHOT_FAILED)', () => {
    expect(createSrc).toMatch(/SNAPSHOT_FAILED/);
    // 스냅샷 catch 안에서 조기 return — orderID 를 프론트에 주지 않는다.
    const snapIdx = createSrc.indexOf("collection('paypal_order_snapshots')");
    const okIdx = createSrc.indexOf('_ok({ orderID: order.id');
    expect(snapIdx).toBeGreaterThan(-1);
    expect(okIdx).toBeGreaterThan(-1);
    expect(snapIdx).toBeLessThan(okIdx);
    expect(createSrc.slice(snapIdx, okIdx)).toMatch(/catch\s*\([\s\S]{0,400}return res\.end/);
  });

  it('gate provenance 를 위해 expectedCurrency 를 명시 저장', () => {
    expect(createSrc).toMatch(/expectedCurrency:\s*'USD'/);
  });
});

describe('버그헌트 #11 — capturePaypalOrder 가 스냅샷으로 body 위조 무력화', () => {
  it('paypal_order_snapshots 읽어 product/pax/date override', () => {
    expect(captureSrc).toContain("collection('paypal_order_snapshots')");
    expect(captureSrc).toMatch(/if\s*\(\s*_s\.productType\s*\)\s*product\s*=\s*_s\.productType/);
    expect(captureSrc).toMatch(/paxCount\s*=\s*_s\.passengers/);
  });
  it('스냅샷 read 가 AI-planner-gate 보다 먼저 (보정된 product 로 gate 실행)', () => {
    const snapIdx = captureSrc.indexOf('paypal_order_snapshots');
    const gateIdx = captureSrc.indexOf('checkAiPlannerCouponPolicy({');
    expect(snapIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeGreaterThan(snapIdx);
  });
  it('destructure 가 let — 서버 스냅샷으로만 예약 필드를 보정', () => {
    expect(captureSrc).toMatch(/let\s*\{\s*orderID,\s*product,/);
  });
  it('snapshot 부재/불량은 body fallback 없이 capture 전에 fail-closed', () => {
    expect(captureSrc).toMatch(/if\s*\(\s*!_snap\.exists\s*\)[\s\S]{0,500}NO_ORDER_SNAPSHOT/);
    expect(captureSrc).toMatch(/expectedCurrency\s*!==\s*'USD'[\s\S]{0,500}INVALID_ORDER_SNAPSHOT/);
    expect(captureSrc).toMatch(/catch\s*\(\s*_snapErr\s*\)[\s\S]{0,500}ORDER_CHECK_UNAVAILABLE/);
    const snapshotGuardIdx = captureSrc.indexOf('NO_ORDER_SNAPSHOT');
    const paypalTokenIdx = captureSrc.indexOf('getPaypalAccessToken(');
    expect(snapshotGuardIdx).toBeGreaterThan(-1);
    expect(paypalTokenIdx).toBeGreaterThan(snapshotGuardIdx);
  });
  it('저장한 USD/KRW 견적과 환율을 bookings 에 이어 보존', () => {
    expect(captureSrc).toMatch(/_snapExpectedUSD\s*=\s*_s\.expectedUSD/);
    expect(captureSrc).toMatch(/_snapExpectedKRW\s*=\s*_s\.expectedKRW/);
    expect(captureSrc).toMatch(/_snapUsdRate\s*=\s*_s\.usdRate/);
    expect(captureSrc).toMatch(/amountKRW\s*=\s*_snapExpectedKRW\s*\|\|/);
    expect(captureSrc).toMatch(/capturedExchangeRate:\s*usdToKrw/);
  });
});
