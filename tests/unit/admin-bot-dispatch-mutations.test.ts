/**
 * 어드민 텔레그램 봇 — 배차 변경 3종 배선 + 불변식 (2026-06-14).
 *
 * 추가 명령:
 *   /broadcast_dispatch  — 활성 기사 전원에게 동시 배차 (broadcastDispatchToDrivers 재사용)
 *   /redispatch          — 특정 기사에게 재발송 (sendDispatchToDriver 재사용)
 *   /driver_contact      — 기사 전화/카톡 저장·조회 (merge:true 기존 필드 보존)
 *
 * 소스 가드(검증노트 불변식):
 *   ① 별칭 3개 + case 3개 + 핸들러 3개
 *   ② 전체배차가 broadcastDispatchToDrivers import + 호출 + booking 존재 검증
 *   ③ 재배차가 sendDispatchToDriver 호출 + driver active 검증
 *   ④ 기사연락처가 merge:true 로 저장 (기존 필드 보존)
 *   ⑤ booking 미존재 시 발송 안 함 (가드 존재)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/telegram-webhook-admin.js'), 'utf8');

describe('배차 변경 3종 — 배선', () => {
  const newCmds = ['/broadcast_dispatch', '/redispatch', '/driver_contact'];

  it('KOREAN_ALIASES 에 3개 명령 한글 별칭 등록', () => {
    for (const cmd of newCmds) {
      expect(src).toMatch(new RegExp(`cmd:\\s*'${cmd}'`));
    }
    // 핵심 한글 트리거 단어
    for (const word of ['전체배차', '재배차', '기사연락처']) {
      expect(src).toContain(word);
    }
  });

  it('routeCommand switch 에 3개 case + 핸들러 연결', () => {
    const handlers: [string, string][] = [
      ['/broadcast_dispatch', 'handleBroadcastDispatchCommand'],
      ['/redispatch', 'handleRedispatchCommand'],
      ['/driver_contact', 'handleDriverContactCommand'],
    ];
    for (const [cmd, fn] of handlers) {
      expect(src).toMatch(new RegExp(`case '${cmd}':[\\s\\S]{0,80}${fn}\\(`));
      expect(src).toMatch(new RegExp(`function ${fn}\\(`));
    }
  });

  it('"배차" 별칭과 "전체배차"/"재배차" 별칭이 충돌하지 않음 (다른 정규식)', () => {
    // /dispatch cmd
    expect(src).toMatch(/cmd:\s*'\/dispatch'/);
    // /broadcast_dispatch cmd — 앞에 "전체배차" 포함
    expect(src).toMatch(/전체배차[^']*'\/broadcast_dispatch'/s);
    // /redispatch cmd — 앞에 "재배차" 포함
    expect(src).toMatch(/재배차[^']*'\/redispatch'/s);
  });
});

describe('배차 변경 3종 — 불변식', () => {
  it('broadcastDispatchToDrivers: dispatch-helpers.js에서 import됨', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*broadcastDispatchToDrivers[^}]*\}\s*from\s*'\.\/_shared\/dispatch-helpers\.js'/
    );
  });

  it('전체배차: broadcastDispatchToDrivers 호출 + booking 존재 검증 포함', () => {
    const body = src.slice(
      src.indexOf('function handleBroadcastDispatchCommand'),
      src.indexOf('function handleRedispatchCommand')
    );
    // broadcastDispatchToDrivers 호출
    expect(body).toMatch(/broadcastDispatchToDrivers\(\s*\{/);
    // orderID + booking 객체 전달
    expect(body).toContain('orderID');
    expect(body).toContain('booking');
    // booking 존재 검증 (.get() 후 !exists 가드)
    expect(body).toMatch(/bookingDoc\.exists/);
    // 미존재 시 조기 return (발송 전 중단)
    expect(body).toMatch(/!bookingDoc\.exists[\s\S]{0,200}return/);
  });

  it('재배차: sendDispatchToDriver 호출 + driver active 검증 포함', () => {
    const body = src.slice(
      src.indexOf('function handleRedispatchCommand'),
      src.indexOf('function handleDriverContactCommand')
    );
    // sendDispatchToDriver 호출
    expect(body).toMatch(/sendDispatchToDriver\(\s*\{/);
    // orderID + booking + driverChatId 전달
    expect(body).toContain('orderID');
    expect(body).toContain('booking');
    expect(body).toContain('driverChatId');
    // driver active 검증
    expect(body).toMatch(/driver\.active\s*===\s*false/);
  });

  it('기사연락처: merge:true 로 저장 (기존 필드 보존)', () => {
    const body = src.slice(
      src.indexOf('function handleDriverContactCommand'),
      // 다음 함수 경계 — todayKstDate 바로 앞
      src.indexOf('// 오늘 KST 날짜')
    );
    // merge:true 포함
    expect(body).toMatch(/\{\s*merge\s*:\s*true\s*\}/);
    // .set() 호출 (update 아닌 set+merge = 기존 필드 보존)
    expect(body).toMatch(/\.set\(/);
    // phone 저장
    expect(body).toContain('phone');
    // driver 존재 검증
    expect(body).toMatch(/driverDoc\.exists/);
  });

  it('booking 미존재 시 발송 안 함 — 전체배차/재배차 모두 가드', () => {
    // 전체배차 핸들러
    const broadcastBody = src.slice(
      src.indexOf('function handleBroadcastDispatchCommand'),
      src.indexOf('function handleRedispatchCommand')
    );
    expect(broadcastBody).toMatch(/!bookingDoc\.exists[\s\S]{0,200}return/);

    // 재배차 핸들러
    const redispatchBody = src.slice(
      src.indexOf('function handleRedispatchCommand'),
      src.indexOf('function handleDriverContactCommand')
    );
    expect(redispatchBody).toMatch(/!bookingDoc\.exists[\s\S]{0,200}return/);
  });

  it('nullish 병합 연산자 미사용 — pre-commit mojibake 오탐 방지', () => {
    // 새로 추가된 핸들러 3개 범위만 검사
    const body = src.slice(
      src.indexOf('function handleBroadcastDispatchCommand'),
      src.indexOf('// 오늘 KST 날짜')
    );
    // nullish 병합 연산자(두 물음표 연속) 미사용 확인 — 대신 || 또는 삼항 사용
    const nullishOp = '?' + '?';
    expect(body).not.toContain(nullishOp);
  });

  it('handleWhois 출력에 phone/kakao 조건부 표시 추가됨', () => {
    const body = src.slice(
      src.indexOf('function handleWhois'),
      src.indexOf('// /cs_resolve')
    );
    expect(body).toContain('d.phone');
    expect(body).toContain('d.kakao');
    // phone/kakao 있을 때만 표시 (조건부)
    expect(body).toMatch(/d\.phone\s*\|\|\s*d\.kakao/);
  });

  it('HELP_TEXT 배차 섹션에 3개 명령 설명 포함', () => {
    const helpBody = src.slice(src.indexOf('const HELP_TEXT'), src.indexOf('export default'));
    expect(helpBody).toContain('전체배차');
    expect(helpBody).toContain('재배차');
    expect(helpBody).toContain('기사연락처');
  });
});
