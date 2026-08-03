// @vitest-environment jsdom
//
// 분석 전면 정지(blackout) 회귀 잠금 (2026-08-03).
//
// 🔴 잠근 사고 ①: PostHog 이벤트가 **전면 0건**이었다(2026-08-02~03 서버 실조회).
//   원인은 `before_send` 가 쓰는 `sanitizeCaptureProperties` 가 허용목록에 없는 키를 지우는데,
//   posthog-js 가 모든 이벤트에 붙이는 `token`(프로젝트 API 키)이 그 목록에 없어 **삭제**된
//   것. posthog-js 1.409.5 의 `_runBeforeSend` 는 훅이 `token` 을 지웠는지 검사해서
//   지워졌으면 **이벤트를 통째로 버리고 null 을 반환**한다
//   (`@posthog/core` 의 `knownUnsafeEditableEventProperty = ['token']`).
//   capture() 는 요청 큐에 넣기 전에 빠져나가므로 **네트워크 POST 자체가 생기지 않는다** —
//   실패 요청조차 안 남아서 "자산은 200 인데 이벤트만 0" 이라는 진단하기 어려운 모양이 된다.
//
// 🔴 잠근 사고 ②: `$pathname` 이 삭제 목록에 있었는데, 관리자 전환 퍼널 1단계와 TOP 페이지
//   SQL 이 정확히 그 속성을 조회한다 → 그 두 화면이 영구히 빈다.
//
// 이 테스트는 설치된 SDK 상수까지 함께 확인해서, SDK 를 올렸을 때 규칙이 바뀌면 알아채게 한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sanitizeCaptureProperties, ALLOWED_PROP_KEYS } from '../../src/lib/analyticsProps';

/** posthog-js 가 실제로 이벤트에 붙이는 속성 모양(설치된 SDK 기준). */
function realPosthogEventProps(extra: Record<string, unknown> = {}) {
  return {
    token: 'phc_test_project_key',
    distinct_id: '019fc5d4-27f0-7b21-8fd9-a0981289d7ca',
    $lib: 'web',
    $lib_version: '1.409.5',
    $session_id: '019fc5d4-aaaa-bbbb',
    $insert_id: 'abc123',
    $current_url: 'https://cocotripkr.com/planner?token=secret&freeText=%EC%86%90%EB%8B%98',
    $pathname: '/planner',
    page_path: '/planner',
    ...extra,
  };
}

describe('before_send 가 SDK 필수 속성을 지우지 않는다 (이벤트 전면 유실 방지)', () => {
  it('🔴 token 이 살아남는다 — 지우면 SDK 가 이벤트를 통째로 버린다', () => {
    const out = sanitizeCaptureProperties(realPosthogEventProps());
    expect(out.token, 'token 이 지워지면 PostHog 이벤트가 0건이 된다').toBe('phc_test_project_key');
  });

  it('distinct_id 가 살아남는다 — 지우면 익명 오귀속·중복 사용자가 생긴다', () => {
    const out = sanitizeCaptureProperties(realPosthogEventProps());
    expect(out.distinct_id).toBe('019fc5d4-27f0-7b21-8fd9-a0981289d7ca');
  });

  it('SDK 내부 $ 속성(세션·중복제거)은 그대로 둔다', () => {
    const out = sanitizeCaptureProperties(realPosthogEventProps());
    expect(out.$lib).toBe('web');
    expect(out.$session_id).toBe('019fc5d4-aaaa-bbbb');
    expect(out.$insert_id).toBe('abc123');
  });

  it('$pathname 은 살리고 $current_url 은 버린다 (관리자 퍼널·TOP 페이지가 $pathname 을 읽는다)', () => {
    const out = sanitizeCaptureProperties(realPosthogEventProps());
    expect(out.$pathname, '퍼널 1단계·TOP 페이지 SQL 이 properties.$pathname 을 조회한다').toBe('/planner');
    expect(out.$current_url, '쿼리에 공유 토큰·손님 자유입력이 들어 있어 통째로 버려야 한다').toBeUndefined();
  });

  it('개인정보 성격의 낯선 키는 계속 버린다 (허용목록 정책은 그대로)', () => {
    const out = sanitizeCaptureProperties(realPosthogEventProps({
      email: 'someone@example.com',
      uid: 'firebase-uid-1234',
      planId: 'plan_abc',
    }));
    expect(out.email).toBeUndefined();
    expect(out.uid).toBeUndefined();
    // planId 는 허용목록에 있는 우리 속성이라 통과한다(대조군).
    expect(out.planId).toBe('plan_abc');
  });

  it('빈 입력에도 터지지 않는다', () => {
    expect(sanitizeCaptureProperties(undefined)).toEqual({});
    expect(sanitizeCaptureProperties(null)).toEqual({});
  });
});

describe('설치된 posthog-js 의 규칙과 어긋나지 않는다', () => {
  it("SDK 의 '지우면 이벤트를 버리는 속성' 목록이 여전히 ['token'] 이다", () => {
    // SDK 를 올렸을 때 이 목록이 늘어나면 우리 통과 규칙도 같이 늘려야 한다.
    const src = readFileSync(resolve(process.cwd(), 'node_modules/@posthog/core/dist/types.js'), 'utf8');
    const m = src.match(/const knownUnsafeEditableEventProperty = \[([\s\S]*?)\]/);
    expect(m, 'SDK 상수를 못 찾았다 — posthog-js 구조가 바뀌었을 수 있다').toBeTruthy();
    const names = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(names).toEqual(['token']);
  });

  it('그 목록의 모든 키가 우리 정리 함수를 통과한다', () => {
    const src = readFileSync(resolve(process.cwd(), 'node_modules/@posthog/core/dist/types.js'), 'utf8');
    const m = src.match(/const knownUnsafeEditableEventProperty = \[([\s\S]*?)\]/);
    const names = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const input: Record<string, unknown> = {};
    for (const n of names) input[n] = 'v';
    const out = sanitizeCaptureProperties(input);
    for (const n of names) {
      expect(out[n], `SDK 필수 속성 '${n}' 이 지워지면 이벤트가 통째로 버려진다`).toBe('v');
    }
  });

  it('$pathname 이 허용목록과 삭제목록에 동시에 있지 않다 (두 목록이 모순이었다)', () => {
    expect(ALLOWED_PROP_KEYS).toContain('$pathname');
    const out = sanitizeCaptureProperties({ $pathname: '/tours' });
    expect(out.$pathname).toBe('/tours');
  });
});
