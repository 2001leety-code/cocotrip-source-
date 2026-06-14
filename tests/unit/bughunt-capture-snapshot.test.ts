/**
 * 버그헌트 #11 — 단건 결제 주문 스냅샷(금액↔상품 위조 방지).
 *
 * createPaypalOrder 가 paypal_order_snapshots/{orderID} 에 {productType, expectedUSD, expectedKRW,
 * passengers, dateStart} 저장 → capturePaypalOrder 가 capture-time 클라 body 대신 이 스냅샷의
 * product/pax/date 를 사용해, 저가 주문으로 고가 서비스를 booking 에 위조 기록하는 공격을 무력화.
 * 스냅샷 없으면(client-side 주문/legacy/쓰기실패) body 유지 = graceful(결제 차단 금지).
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
  it('best-effort — 스냅샷 쓰기 실패해도 주문 생성 진행(try/catch, 결제 차단 금지)', () => {
    expect(createSrc).toMatch(/try\s*\{[\s\S]{0,400}paypal_order_snapshots[\s\S]{0,400}catch\s*\(/);
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
  it('destructure 가 let (override 가능) — body override 가능하도록', () => {
    expect(captureSrc).toMatch(/let\s*\{\s*orderID,\s*product,/);
  });
  it('graceful — 스냅샷 없거나 read 실패 시 body 유지(try/catch, 결제 차단 금지)', () => {
    expect(captureSrc).toMatch(/catch\s*\(\s*_snapErr\s*\)/); // 스냅샷 read 전용 try/catch
    // _snap.exists 일 때만 override (없으면 body 그대로)
    expect(captureSrc).toMatch(/_snap\.exists/);
  });
});
