/**
 * AI 챗 프롬프트 ↔ 환불정책 SSOT 패리티 (2026-08-19).
 *
 * 사고: api/chat.js SYSTEM_PROMPT 가 실존한 적 없는 옛 등급표(7일+ 100% / 3-7일 50% /
 * 3일 이내 0%)를 안내하고 있었다 — 실제 정책은 api/_refund-policy.js 의 24시간
 * 바이너리(24h+ 100% / 미만·노쇼 0%, 2026-07-14 운영자 확정)이고 RefundPolicyModal ·
 * cancelBooking 은 전부 그걸 따른다. 챗만 틀린 환불율을 손님에게 말하고 있었고,
 * 게스트 챗 개방(#1321) 후엔 노출면이 더 커졌다.
 *
 * 잠금: ①옛 등급표 문구 부재 ②24시간 바이너리 문구 존재 ③SSOT 임계값(24h,
 * 1.0/0.0)이 _refund-policy.js 에 그대로 있는지 — 정책이 바뀌면 세 파일이 같이
 * 바뀌어야 이 테스트가 통과한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const chatSrc = readFileSync(join(process.cwd(), 'api', 'chat.js'), 'utf8');
const policySrc = readFileSync(join(process.cwd(), 'api', '_refund-policy.js'), 'utf8');

describe('chat SYSTEM_PROMPT — 환불정책이 SSOT(24시간 바이너리)와 일치', () => {
  it('옛 등급표(7일/3-7일 50%)가 프롬프트에 없다', () => {
    expect(chatSrc).not.toMatch(/7\+ days before: 100%/);
    expect(chatSrc).not.toMatch(/3-7 days: 50%/);
    expect(chatSrc).not.toMatch(/Within 3 days: non-refundable/);
  });

  it('24시간 바이너리 문구가 프롬프트에 있다', () => {
    expect(chatSrc).toMatch(/Cancel 24\+ hours before the tour start \(KST\): 100% refund/);
    expect(chatSrc).toMatch(/Within 24 hours of the tour start, or no-show: no refund/);
  });

  it('배차 실패 자동취소·전액환불 안내가 있다 (TourBookingDialog autoCancelNote 와 정합)', () => {
    expect(chatSrc).toMatch(/cannot assign a vehicle or driver.*100% refund/);
  });

  it('SSOT(_refund-policy.js)가 여전히 24h 바이너리다 — 정책 바뀌면 이 테스트부터 빨강', () => {
    expect(policySrc).toMatch(/thresholdHours:\s*24/);
    // 등급표 흔적(50% 류 중간 구간)이 SSOT 에 없다.
    expect(policySrc).not.toMatch(/0\.5/);
  });
});
